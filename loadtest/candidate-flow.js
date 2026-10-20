import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

// ---------------------------------------------------------------------------
// Talo load test. One k6 process per scenario (selected by SCEN env var) so
// each run starts from a freshly reseeded local DB. MODE=flow drives the full
// candidate journey (the real D1 write load: logins, answer autosaves,
// heartbeats). MODE=prod runs a NON-DESTRUCTIVE production smoke (static assets
// + auth read-path with non-existent emails that 403 before any DB write).
// ---------------------------------------------------------------------------

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8787';
const MODE = __ENV.MODE || 'flow';
const SCEN = __ENV.SCEN || 'spike';

// Each full journey must use a UNIQUE candidate email (#6 locks an email once its
// test has started). iterationInTest is globally unique + monotonic within a run,
// and we reseed (700 fresh candidates) before every scenario, so index starts at 1.
const POOL = Number(__ENV.POOL) || 3500; // seeded candidate pool size
function candidateEmail() {
  const n = (exec.scenario.iterationInTest % POOL) + 1;
  return 'load' + String(n).padStart(4, '0') + '@load.test';
}

const journeyOk = new Counter('journey_completed');
const journeyFail = new Counter('journey_failed');
const journeyDur = new Trend('journey_duration_ms', true);

const ANSWER = 'SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY customer_id HAVING SUM(amount) > 0; -- grouped aggregate with a filter, written out in the candidate\'s own words.';

// ---- scenario catalogue (one is activated per process via SCEN) ----
const scenarios = {
  // Pipeline sanity check: 3 journeys, no arrival jitter.
  smoke: { executor: 'per-vu-iterations', vus: 3, iterations: 1, maxDuration: '3m' },
  // A. Realistic spike: 100 students arrive over ~2.5 min and each completes once.
  spike: { executor: 'per-vu-iterations', vus: 100, iterations: 1, maxDuration: '8m' },
  // B. Headroom: 300 concurrent students, each completes once.
  headroom: { executor: 'per-vu-iterations', vus: 300, iterations: 1, maxDuration: '10m' },
  // B2. Upper-clean checkpoint: 500 concurrent students.
  mid500: { executor: 'per-vu-iterations', vus: 500, iterations: 1, maxDuration: '10m' },
  // C. Stress to breaking point: open model, offered journey-rate climbs until the
  //    system can't keep up (rising latency / dropped iterations = the ceiling).
  stress: {
    executor: 'ramping-arrival-rate',
    startRate: 5, timeUnit: '1s',
    preAllocatedVUs: 400, maxVUs: 1200,
    stages: [
      { duration: '20s', target: 5 },   // ~100 journeys/s*  warm-up
      { duration: '40s', target: 15 },  // climbing offered journey-rate
      { duration: '40s', target: 28 },
      { duration: '40s', target: 42 },  // peak ~42 journeys/s (~750 req/s)
    ], // total offered ≈ 2,760 journeys, under the 3,500 pool (no email reuse)
  },
  // Production smoke (non-destructive): gentle, looping, assets + 403 auth reads.
  prod: {
    executor: 'ramping-vus', startVUs: 0,
    stages: [{ duration: '30s', target: 30 }, { duration: '1m', target: 30 }, { duration: '20s', target: 0 }],
  },
};

const gating = SCEN === 'spike'; // the "are we good for 100?" pass/fail gate
export const options = {
  scenarios: { [SCEN]: scenarios[SCEN] },
  thresholds: gating
    ? {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<1500'],
        journey_failed: ['count<1'],
      }
    : {}, // headroom / stress / prod: observe, never abort
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// Session cookie is Secure; k6 won't send Secure cookies over local http (unlike
// Chromium, which exempts localhost). So we capture the token from login and attach
// it manually. Over prod https the jar would work, but manual is uniform + reliable.
function post(path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  return http.post(BASE + path, body ? JSON.stringify(body) : null, {
    headers,
    tags: { ep: path.replace(/\/load[0-9]+.*/, '') },
  });
}

// ------------------------------- PROD SMOKE -------------------------------
function prodSmoke() {
  const a = http.get(BASE + '/', { tags: { ep: 'asset_index' } });
  check(a, { 'index 200': (r) => r.status === 200 });
  http.get(BASE + '/app.js?v=21', { tags: { ep: 'asset_js' } });
  http.get(BASE + '/styles.css?v=11', { tags: { ep: 'asset_css' } });
  // Auth read-path with an email that is NOT on the allowlist → 403 BEFORE any write.
  const probe = 'probe-' + exec.scenario.iterationInTest + '-' + Date.now() + '@invalid.example';
  const r = post('/api/candidate/login', { email: probe });
  check(r, { 'login rejects unknown (403)': (res) => res.status === 403 });
  sleep(Math.random() * 1.5 + 0.5);
}

// ------------------------------- FULL JOURNEY -------------------------------
function journey() {
  // Spread arrivals across the ramp window so 100 VUs don't all hit login on t=0.
  if (MODE === 'flow' && (SCEN === 'spike' || SCEN === 'headroom' || SCEN === 'mid500')) {
    sleep(Math.random() * 60); // all students arrive within ~1 min (denser than real = conservative)
  }
  const t0 = Date.now();
  const email = candidateEmail();

  const login = post('/api/candidate/login', { email });
  if (!check(login, { 'login 200': (r) => r.status === 200 })) { journeyFail.add(1); return; }
  // Pull the session token out of the login response and carry it by hand.
  let cookie = '';
  try { const c = login.cookies['chs_candidate']; if (c && c[0]) cookie = 'chs_candidate=' + c[0].value; } catch (e) {}

  check(http.get(BASE + '/api/candidate/me', { headers: { Cookie: cookie }, tags: { ep: '/api/candidate/me' } }), { 'me 200': (r) => r.status === 200 });

  post('/api/candidate/part1/prepare', null, cookie);
  const start = post('/api/candidate/part1/start', null, cookie);
  if (!check(start, { 'part1 start 200': (r) => r.status === 200 })) { journeyFail.add(1); return; }
  let q1 = [];
  try { q1 = JSON.parse(start.body).questions || []; } catch (e) {}

  // Answer each Part 1 question with think-time + an autosave, plus heartbeats.
  for (const q of q1) {
    sleep(Math.random() * 3 + 1);
    post('/api/candidate/part1/answer', { questionId: q.id, answerText: ANSWER }, cookie);
    post('/api/candidate/part1/heartbeat', null, cookie);
  }
  post('/api/candidate/part1/heartbeat', null, cookie);
  const sub1 = post('/api/candidate/part1/submit', null, cookie);
  check(sub1, { 'part1 submit 200': (r) => r.status === 200 });

  // Part 2.
  sleep(Math.random() * 2 + 1);
  const start2 = post('/api/candidate/part2/start', null, cookie);
  check(start2, { 'part2 start 200': (r) => r.status === 200 });
  let q2 = [];
  try { q2 = JSON.parse(start2.body).questions || []; } catch (e) {}
  for (const q of q2) {
    sleep(Math.random() * 3 + 1);
    post('/api/candidate/part2/answer', { questionId: q.id, answerText: ANSWER }, cookie);
    post('/api/candidate/part2/heartbeat', null, cookie);
  }
  const sub2 = post('/api/candidate/part2/submit', null, cookie);
  const done = check(sub2, { 'part2 submit 200': (r) => r.status === 200 });

  if (done) { journeyOk.add(1); journeyDur.add(Date.now() - t0); }
  else journeyFail.add(1);
}

export default function () {
  if (MODE === 'prod') prodSmoke();
  else journey();
}
