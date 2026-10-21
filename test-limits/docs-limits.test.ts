import { describe, it, expect, beforeAll } from 'vitest';
import { env, fetchMock, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { migrate, openAiReply, applySql } from '../test/helpers';
import m16 from '../migrations-docs/0016_writers_two_part.sql?raw';
import m17 from '../migrations-docs/0017_writers_indexes.sql?raw';
import { MAILTO_ONLY_PDF_B64 } from '../test/fixtures/resumes';

/**
 * Cloudflare Workers Free budget check for the writers site.
 *
 * Every request is run against a METERED copy of the D1 binding that counts the
 * statements it sends and the rows D1 reports reading and writing (the same
 * figures Cloudflare bills), plus the outbound fetches it makes. Each route must
 * stay inside the Free per-request limits with room to spare, measured on a full
 * 100-candidate cohort. A drive-day estimate is printed from the same numbers.
 *
 * Free plan (developers.cloudflare.com, Oct 2026): 50 D1 queries and 50 subrequests
 * per invocation; 100,000 requests, 5,000,000 rows read and 100,000 rows written
 * per day per account.
 */

const QUERY_BUDGET = 40; // of 50 — counts every statement inside a batch separately
const FETCH_BUDGET = 40; // of 50
const N = 100;

type Meter = { statements: number; roundTrips: number; rowsRead: number; rowsWritten: number; fetches: number };
let current: Meter = fresh();
function fresh(): Meter { return { statements: 0, roundTrips: 0, rowsRead: 0, rowsWritten: 0, fetches: 0 }; }
function add(meta: any) { current.rowsRead += Number(meta?.rows_read) || 0; current.rowsWritten += Number(meta?.rows_written) || 0; }

function wrapStmt(s: any): any {
  return {
    __inner: s,
    bind: (...a: unknown[]) => wrapStmt(s.bind(...a)),
    async first(col?: string) {
      current.statements++; current.roundTrips++;
      const r = await s.all(); add(r.meta);
      const row = (r.results ?? [])[0];
      return row == null ? null : col ? (row[col] ?? null) : row;
    },
    async all() { current.statements++; current.roundTrips++; const r = await s.all(); add(r.meta); return r; },
    async run() { current.statements++; current.roundTrips++; const r = await s.run(); add(r.meta); return r; },
    async raw(o?: any) { current.statements++; current.roundTrips++; return s.raw(o); },
  };
}
const meteredDB = {
  prepare: (q: string) => wrapStmt(env.DB.prepare(q)),
  async batch(list: any[]) {
    current.statements += list.length; current.roundTrips++;
    const rs = await env.DB.batch(list.map((x) => x.__inner));
    for (const r of rs) add(r.meta);
    return rs;
  },
  exec: (q: string) => env.DB.exec(q),
};

const docsEnv: any = {
  ...env,
  DB: meteredDB,
  TEAM: 'docs',
  PART1_DURATION_MINUTES: '30', PART2_DURATION_MINUTES: '45',
  DOCS_PART1_QUESTIONS: '4', DOCS_PART2_QUESTIONS: '2', DOCS_PART1_MARKS: '5', DOCS_PART2_MARKS: '10', DOCS_WORD_LIMIT: '1000',
  GRADING_BATCH_SIZE: '1', GRADING_CONCURRENCY: '1', RESUME_PROCESS_BATCH: '2', RESUME_PARSE_CONCURRENCY: '2', MAX_UPLOAD_FILES: '10',
};

async function call(path: string, init: RequestInit = {}): Promise<{ res: Response; m: Meter }> {
  current = fresh();
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request('https://docs.test' + path, init), docsEnv, ctx);
  await waitOnExecutionContext(ctx);
  return { res, m: current };
}
const post = (cookie: string, body?: unknown): RequestInit => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];

const measured: Record<string, Meter> = {};
function record(name: string, m: Meter) {
  const prev = measured[name];
  if (!prev || m.statements > prev.statements || m.rowsRead > prev.rowsRead) measured[name] = m; // keep the worst case seen
  expect(m.statements, `${name}: ${m.statements} D1 statements`).toBeLessThanOrEqual(QUERY_BUDGET);
  expect(m.fetches, `${name}: ${m.fetches} outbound fetches`).toBeLessThanOrEqual(FETCH_BUDGET);
}

const ANSWER = 'This is a clear and specific answer written for a first-time reader. '.repeat(12);

async function runCandidate(i: number, measure: boolean) {
  const email = `w${i}@x.com`;
  const step = async (name: string, path: string, init?: RequestInit) => {
    let r;
    try { r = await call(path, init); } catch (e) { throw new Error(`candidate ${i}, ${name}: ${(e as Error).message}`); }
    if (measure) record(name, r.m);
    return r.res;
  };
  const login = await step('candidate: sign in', '/api/candidate/login', post('', { email }));
  expect(login.status).toBe(200);
  const c = cookieOf(login);
  await step('candidate: test config', '/api/candidate/config');
  await step('candidate: who am I', '/api/candidate/me', { headers: { Cookie: c } });
  await step('candidate: Part 1 prepare', '/api/candidate/part1/prepare', post(c));
  const s1 = await (await step('candidate: Part 1 start', '/api/candidate/part1/start', post(c))).json<any>();
  for (const q of s1.questions) {
    await step('candidate: clock sync + save', '/api/candidate/part1/heartbeat', post(c, { questionId: q.id, answerText: ANSWER }));
    await step('candidate: save answer (switch question)', '/api/candidate/part1/answer', post(c, { questionId: q.id, answerText: ANSWER + '.' }));
  }
  await step('candidate: clock sync (no change)', '/api/candidate/part1/heartbeat', post(c));
  await step('candidate: Part 1 leave-test log', '/api/candidate/part1/tab-switch', post(c, { type: 'tab_hidden' }));
  await step('candidate: Part 1 submit', '/api/candidate/part1/submit', post(c));
  const s2 = await (await step('candidate: Part 2 start', '/api/candidate/part2/start', post(c))).json<any>();
  for (const q of s2.questions) {
    await step('candidate: Part 2 paste log', '/api/candidate/part2/tab-switch', post(c, { type: 'paste', chars: 300, questionId: q.id }));
    await step('candidate: clock sync + save', '/api/candidate/part2/heartbeat', post(c, { questionId: q.id, answerText: ANSWER }));
  }
  await step('candidate: Part 2 submit', '/api/candidate/part2/submit', post(c));
}

describe('writers site stays inside Cloudflare Workers Free limits', () => {
  let admin = '';
  beforeAll(async () => {
    await migrate();
    await applySql(m16);
    await applySql(m17);
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('docs_start_open', '1')").run(); // admin opened the test
    const qs = env.DB.prepare("INSERT INTO question_bank (id, category, prompt, marks, word_limit, status, active) VALUES (?, ?, ?, ?, ?, 'active', 1)");
    await env.DB.batch([
      ...Array.from({ length: 30 }, (_, i) => qs.bind(`p1-${i}`, 'part1', `Part 1 writing question ${i}`, 5, 300)),
      ...Array.from({ length: 10 }, (_, i) => qs.bind(`p2-${i}`, 'part2', `Part 2 writing question ${i}`, 10, 800)),
    ]);
    const cs = env.DB.prepare("INSERT INTO candidates (id, email, name, resume_r2_key, resume_filename, status, college) VALUES (?, ?, ?, ?, 'r.pdf', 'part2_ready', 'College A')");
    for (let i = 0; i < N; i += 50) {
      await env.DB.batch(Array.from({ length: Math.min(50, N - i) }, (_, k) => cs.bind(`c${i + k}`, `w${i + k}@x.com`, `Writer ${i + k}`, `resumes/c${i + k}.pdf`)));
    }
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, (opts: any) => {
        current.fetches++;
        const body = JSON.parse(String(opts.body));
        const max = Number((/Max marks: (\d+)/.exec(body.messages[1].content) || [])[1]);
        if (max) return openAiReply({ score: max - 1, reasoning: 'Clear.', deductions: [{ reason: 'Minor', marks: 1 }], ai_content_percent: 10 });
        return openAiReply({ name: 'Asha K', email: 'asha.k@college.edu', skills: ['Writing'], projects: [] }); // resume parse
      }).persist();
    const lr = await call('/api/admin/login', post('', { email: 'admin@test.local', password: 'test-admin-pass' }));
    admin = cookieOf(lr.res);
  });

  it(`every candidate request stays under ${QUERY_BUDGET} D1 queries — first candidate`, async () => {
    await runCandidate(0, true);
  });
  for (let b = 0; b < 4; b++) {
    it(`cohort: candidates ${1 + b * 25}–${Math.min(N - 2, 25 + b * 25)} take the test`, async () => {
      for (let i = 1 + b * 25; i <= Math.min(N - 2, 25 + b * 25); i++) await runCandidate(i, false);
    }, 60_000);
  }
  it(`every candidate request stays under ${QUERY_BUDGET} D1 queries — last of ${N} (largest tables)`, async () => {
    await runCandidate(N - 1, true);
  });

  it('every admin request stays under the per-request limits on a full cohort', async () => {
    const h = { headers: { Cookie: admin } };
    const step = async (name: string, path: string, init: RequestInit = h) => { const r = await call(path, init); record(name, r.m); expect(r.res.status, name).toBeLessThan(500); return r.res; };
    await step('admin: config', '/api/admin/config');
    await step('admin: candidate list', '/api/admin/candidates');
    await step('admin: analysis status', '/api/admin/analysis/status');
    await step('admin: flags', '/api/admin/flags');
    await step('admin: activity log', '/api/admin/audit');
    await step('admin: question bank', '/api/admin/questions');
    await step('admin: candidate detail', '/api/admin/candidates/c5');
    // Grading: the page calls this repeatedly until nothing is left.
    let left = N, calls = 0;
    while (left > 0 && calls < N + 5) {
      const r = await step('admin: grade (one call)', '/api/admin/analysis/run', post(admin));
      left = (await r.json<any>()).remaining; calls++;
    }
    expect(left).toBe(0);
    await step('admin: export summary', '/api/admin/export.csv?format=summary');
    await step('admin: export full', '/api/admin/export.csv?format=full');
    await step('admin: save assessment length', '/api/admin/assessment-length', post(admin, { part1: { questions: 4, minutes: 30 }, part2: { questions: 2, minutes: 45 } }));
    await step('admin: add question', '/api/admin/questions', post(admin, { category: 'part1', prompt: 'New question', marks: 5 }));
    await step('admin: import 30 questions', '/api/admin/questions/bulk-import', post(admin, { questions: Array.from({ length: 30 }, (_, i) => ({ part: 1 + (i % 2), prompt: `Imported question ${i}` })) }));
    await step('admin: resume (reopen part)', '/api/admin/candidates/c7/resume', post(admin));
    await step('admin: retake', '/api/admin/candidates/c8/retake', post(admin));
    await step('admin: delete candidate', '/api/admin/candidates/c9', { method: 'DELETE', headers: { Cookie: admin } });

    // Resume upload (10 files, the most one request accepts) and parsing.
    const pdf = Uint8Array.from(atob(MAILTO_ONLY_PDF_B64), (ch) => ch.charCodeAt(0));
    const form = new FormData();
    for (let i = 0; i < 10; i++) form.append('files', new File([pdf], `r${i}.pdf`, { type: 'application/pdf' }));
    await step('admin: upload 10 resumes', '/api/admin/resumes/upload', { method: 'POST', headers: { Cookie: admin }, body: form });
    const tooMany = new FormData();
    for (let i = 0; i < 11; i++) tooMany.append('files', new File([pdf], `x${i}.pdf`, { type: 'application/pdf' }));
    const over = await call('/api/admin/resumes/upload', { method: 'POST', headers: { Cookie: admin }, body: tooMany });
    expect(over.res.status).toBe(400);
    // The first parse call on a fresh database also adds the parse-claim columns and
    // index (a one-time cost); the second call is what every later call costs.
    await step('admin: parse resumes (first call ever)', '/api/admin/resumes/process', post(admin));
    await step('admin: parse resumes (one call)', '/api/admin/resumes/process', post(admin));
  }, 120_000);

  it('the daily retention purge uses a fixed number of queries for any cohort size', async () => {
    await env.DB.prepare("UPDATE candidates SET created_at = datetime('now', '-30 days')").run();
    current = fresh();
    const ctx = createExecutionContext();
    await worker.scheduled!({} as ScheduledController, docsEnv, ctx);
    await waitOnExecutionContext(ctx);
    record('cron: retention purge (all expired)', current);
    const left = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM candidates) + (SELECT COUNT(*) FROM part1_answers) + (SELECT COUNT(*) FROM part2_questions) + (SELECT COUNT(*) FROM attempts) AS n').first<any>();
    expect(left.n).toBe(0);
  });

  it('prints the measured cost and a drive-day estimate', () => {
    const rows = Object.entries(measured).map(([k, m]) => `${k.padEnd(42)} ${String(m.statements).padStart(3)} queries ${String(m.roundTrips).padStart(3)} trips ${String(m.rowsRead).padStart(6)} rows read ${String(m.rowsWritten).padStart(5)} written ${String(m.fetches).padStart(3)} fetches`);
    console.log('\nPER-REQUEST COST (worst seen, cohort of ' + N + ')\n' + rows.join('\n'));
    const hb = measured['candidate: clock sync + save'];
    const hbIdle = measured['candidate: clock sync (no change)'];
    // One candidate on the writers' page: 75 min of parts, a clock sync every 30 s
    // (about half carry a changed answer), ~10 question switches/blur saves, and
    // ~20 one-off calls (sign in, config, prepare, start, logs, submit).
    const syncs = (30 + 45) * 2;
    const perCand = {
      requests: syncs + 10 + 20,
      read: syncs / 2 * (hb.rowsRead + hbIdle.rowsRead) + 10 * measured['candidate: save answer (switch question)'].rowsRead + 200,
      written: syncs / 2 * (hb.rowsWritten + hbIdle.rowsWritten) + 10 * measured['candidate: save answer (switch question)'].rowsWritten + 40,
    };
    console.log(`\nDRIVE ESTIMATE per candidate: ~${perCand.requests} requests, ~${Math.round(perCand.read)} rows read, ~${Math.round(perCand.written)} rows written`);
    for (const n of [50, 100, 150, 200]) {
      console.log(`  ${n} candidates: ${n * perCand.requests} requests (${Math.round((n * perCand.requests) / 1000)}% of 100k), ${Math.round(n * perCand.written)} rows written (${Math.round((n * perCand.written) / 1000)}% of 100k), ${Math.round(n * perCand.read)} rows read (${((n * perCand.read) / 50000).toFixed(1)}% of 5M)`);
    }
    expect(hb.rowsWritten).toBeLessThanOrEqual(3);
  });
});
