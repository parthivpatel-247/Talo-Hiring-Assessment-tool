// Browser smoke test of the SUPPORT site against a LOCAL dev server
// (npx wrangler dev --port 8789), with two ready candidates and a small question bank:
//   BASE=http://127.0.0.1:8789 ADMIN_EMAIL=... ADMIN_PASSWORD=... CAND1=... CAND2=... \
//   CHROME=/path/to/chrome node scripts/support-smoke.mjs
// Credentials come from the environment only. Uses a fresh local database.
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:8789';
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const CAND1 = process.env.CAND1 || 'sup.one@example.com';
const CAND2 = process.env.CAND2 || 'sup.two@example.com';
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD'); process.exit(2); }

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const results = []; const issues = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const watch = (page, label) => {
  page.on('pageerror', (e) => issues.push(`${label} page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|403|409|Failed to load resource/.test(m.text())) issues.push(`${label} console: ${m.text()}`); });
};
const api = (page, path, method = 'GET', body) => page.evaluate(async ([p, m, b]) => {
  const r = await fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, [path, method, body]);

async function signIn(page, email) {
  await page.goto(BASE + '/');
  await page.fill('#login-email', email);
  await page.click('#login-btn');
}

// 1. Candidate A and a second browser B sign in before Start; A starts.
const ctxA = await browser.newContext(); const A = await ctxA.newPage(); watch(A, 'A');
const ctxB = await browser.newContext(); const B = await ctxB.newPage(); watch(B, 'B');
A.on('dialog', (d) => d.accept()); B.on('dialog', (d) => d.accept());
await signIn(A, CAND1);
await A.waitForSelector('#overview-section:not(.hidden)');
check('candidate signs in and sees the overview', true);
await signIn(B, CAND1);
await B.waitForSelector('#overview-section:not(.hidden)');
check('a second browser can sign in before the start', true);

await A.check('#consent-chk');
await A.click('#begin-part1-btn');
await A.click('#part1-fullscreen-btn');
await A.waitForSelector('#part1-work:not(.hidden)');
check('the test starts in browser A', true);
await A.fill('#part1-answer', 'SELECT 1;');
await A.click('#part1-save');
await A.waitForTimeout(1500);
const saved = await api(A, '/api/candidate/part1/questions');
check('A\'s answer is saved', saved.status === 200 && saved.body.questions?.some((q) => q.answer === 'SELECT 1;'), String(saved.status));

// 2. Browser B is shut out of the running sitting.
const bq = await api(B, '/api/candidate/part1/questions');
check('browser B cannot read the questions', bq.status === 401 && bq.body.code === 'other_session', `${bq.status} ${bq.body.code}`);
const bs = await api(B, '/api/candidate/part1/submit', 'POST');
check('browser B cannot submit A\'s test', bs.status === 401, String(bs.status));
await B.reload();
await B.waitForSelector('#login-section:not(.hidden)', { timeout: 10000 }).catch(() => {});
check('browser B is back at the sign-in screen after a reload', await B.isVisible('#login-section'));
await signIn(B, CAND1);
await B.waitForTimeout(800);
check('browser B cannot sign in again (already started)', /already been started/i.test(await B.textContent('#login-error')));

// 3. A finishes; the test is closed and A is signed out.
for (let i = 0; i < 10 && !(await A.isVisible('#part1-submit-btn')); i++) { await A.click('#part1-next'); await A.waitForTimeout(200); }
await A.click('#part1-submit-btn');
await A.waitForSelector('#done-section:not(.hidden)', { timeout: 15000 }).catch(() => {});
check('submitting shows the done screen', await A.isVisible('#done-section'));
const me = await api(A, '/api/candidate/me');
check('…and this browser is signed out', me.status === 401, String(me.status));

// 4. Admin: Resume gives a message; old sign-ins are void and a fresh sign-in works.
const ctxM = await browser.newContext(); const M = await ctxM.newPage(); watch(M, 'admin');
M.on('dialog', (d) => d.accept());
await M.goto(BASE + '/admin/');
await M.fill('#login-email', ADMIN_EMAIL);
await M.fill('#login-password', ADMIN_PASSWORD);
await M.click('#login-btn');
await M.waitForTimeout(1500);
const list = await api(M, '/api/admin/candidates');
check('admin signs in and sees the candidates', list.status === 200 && list.body.candidates?.length >= 2, String(list.status));
const one = list.body.candidates.find((c) => c.email === CAND1);
check('the finished candidate shows as submitted', one?.status === 'submitted', one?.status);
const sl = await api(M, `/api/admin/candidates/${one.id}/shortlist`, 'POST');
check('shortlisting before grading is refused', sl.status === 409, String(sl.status));
const rs = await api(M, `/api/admin/candidates/${one.id}/resume`, 'POST');
check('Resume tells the admin the candidate signs in again', rs.status === 200 && /signs in again/.test(rs.body.message || ''), rs.body.message);
const ctxC = await browser.newContext(); const C = await ctxC.newPage(); watch(C, 'C');
await signIn(C, CAND1);
await C.waitForSelector('#overview-section:not(.hidden)', { timeout: 10000 }).catch(() => {});
check('after Resume the candidate can sign in again', await C.isVisible('#overview-section'));
const st = await api(C, '/api/candidate/part1/start', 'POST');
check('…and gets the same saved answer back', st.status === 200 && st.body.questions?.some((q) => q.answer === 'SELECT 1;'), String(st.status));

// 5. Second candidate unaffected; unknown email refused.
const ctxD = await browser.newContext(); const D = await ctxD.newPage(); watch(D, 'D');
await signIn(D, CAND2);
await D.waitForSelector('#overview-section:not(.hidden)', { timeout: 10000 }).catch(() => {});
check('another candidate signs in normally', await D.isVisible('#overview-section'));
const ctxE = await browser.newContext(); const E = await ctxE.newPage(); watch(E, 'E');
await signIn(E, 'nobody@example.com');
await E.waitForTimeout(800);
check('an email not on the list is refused', /not on the assessment list/i.test(await E.textContent('#login-error')));

await browser.close();
console.log('\nISSUES:', issues.length ? '\n  ' + issues.join('\n  ') : 'none');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) && !issues.length ? 0 : 1);
