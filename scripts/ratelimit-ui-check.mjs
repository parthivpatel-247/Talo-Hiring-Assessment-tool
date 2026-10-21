// Browser check of how the pages behave when the server asks them to slow down
// (429), on BOTH sites. Run against local servers (wrangler dev), never production:
//
//   SITE=writers BASE=http://127.0.0.1:8788 CAND_EMAIL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/ratelimit-ui-check.mjs
//   SITE=support BASE=http://127.0.0.1:8789 CAND_EMAIL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/ratelimit-ui-check.mjs
//
// The candidate must be able to start Part 1. Credentials come only from the
// environment. The page's clock is faked, so the 10 s / 30 s syncs run instantly.
import { chromium } from 'playwright';

const BASE = process.env.BASE;
const SITE = process.env.SITE || 'writers';
const { CAND_EMAIL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!BASE || !CAND_EMAIL || !ADMIN_EMAIL || !ADMIN_PASSWORD) { console.error('Set BASE, CAND_EMAIL, ADMIN_EMAIL and ADMIN_PASSWORD'); process.exit(2); }
const SYNC_MS = SITE === 'writers' ? 30000 : 10000;

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const results = [];
const issues = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [${SITE}] ${name}${detail ? ' — ' + detail : ''}`); };
const tooMany = { status: 429, contentType: 'application/json', headers: { 'Retry-After': '1' }, body: JSON.stringify({ error: 'Too many requests. Please wait a few seconds; your answers and time are safe.', rateLimited: true, retryAfter: 1 }) };

// ---------- Candidate: a 429 on the clock sync is NOT a lost connection ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => issues.push(`candidate page error: ${e.message}`));
  p.on('dialog', (d) => d.accept());
  if (process.env.DEBUG) p.on('response', (r) => { if (r.url().includes('/api/')) console.log('   ', r.status(), new URL(r.url()).pathname); });
  await p.clock.install();
  await p.goto(BASE + '/');
  await p.fill('#login-email', CAND_EMAIL); await p.click('#login-btn');
  await p.waitForSelector('#overview-section:not(.hidden)');
  await p.check('#consent-chk');
  await p.click('#begin-part1-btn'); await p.click('#part1-fullscreen-btn');
  await p.waitForSelector('#part1-work:not(.hidden)');
  await p.waitForFunction(() => /\d+:\d+/.test(document.getElementById('timer')?.textContent || ''), null, { timeout: 15000 });
  await p.clock.runFor(2000);
  const t0 = await p.textContent('#timer');

  let limited = 0;
  await p.route('**/api/candidate/part1/heartbeat', (r) => { limited++; return r.fulfill(tooMany); });
  for (let i = 0; i < 3; i++) await p.clock.runFor(SYNC_MS + 500);
  check('three 429 clock syncs in a row', limited >= 3, `${limited} refused`);
  check('…do not show the "connection lost" screen', !(await p.isVisible('#offline-overlay')));
  const t1 = await p.textContent('#timer');
  check('…and the clock keeps counting down', t0 !== t1, `${t0} → ${t1}`);
  await p.unroute('**/api/candidate/part1/heartbeat');

  const synced = p.waitForResponse((r) => r.url().includes('/part1/heartbeat') && r.status() === 200, { timeout: 5000 }).then(() => true).catch(() => false);
  await p.clock.runFor(SYNC_MS + 500);
  check('the next clock sync goes through normally', await synced);

  // A real connection failure must still pause the test.
  // A real connection failure (every request fails) must still pause the test.
  await p.route('**/api/candidate/**', (r) => r.abort('internetdisconnected'));
  for (let i = 0; i < 2; i++) await p.clock.runFor(SYNC_MS + 500);
  check('a real connection failure still shows "connection lost"', await p.isVisible('#offline-overlay'));
  await p.unroute('**/api/candidate/**');
  if (SITE === 'writers') {
    await p.clock.runFor(11000); await p.waitForTimeout(500);
    check('writers: the page resumes by itself once the server answers again', !(await p.isVisible('#offline-overlay')));
  }
  await ctx.close();
}

// ---------- Admin: short ceilings are retried; sign-in pauses are shown ----------
{
  const watch = (p, label) => {
    p.on('pageerror', (e) => issues.push(`${label} page error: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.push(`${label} console: ${m.text()}`); });
    p.on('dialog', (d) => d.accept());
  };
  const signIn = async (p, email, password) => { await p.fill('#login-email', email); await p.fill('#login-password', password); await p.click('#login-btn'); };
  // The manager's own browser: signs in once (and is then a trusted device).
  const mctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const m = await mctx.newPage(); watch(m, 'manager');
  let first = true;
  await m.route('**/api/admin/candidates', (r) => { if (first) { first = false; return r.fulfill(tooMany); } return r.continue(); });
  await m.goto(BASE + '/admin/');
  await signIn(m, ADMIN_EMAIL, ADMIN_PASSWORD);
  await m.waitForSelector('#shell:not(.hidden)'); await m.waitForTimeout(2500);
  const rows = await m.locator('#candidate-table tbody tr').count();
  check('a 429 on the candidate list is retried and the table still loads', !first && rows > 0, `${rows} rows`);
  await m.unroute('**/api/admin/candidates');

  // Someone else on the same network types 20 wrong sign-ins.
  const gctx = await browser.newContext(); const g = await gctx.newPage(); watch(g, 'guesser');
  await g.goto(BASE + '/admin/');
  for (let i = 0; i < 20; i++) { await signIn(g, `guess${i}.${SITE}@example.com`, 'wrong'); await g.waitForTimeout(150); }
  const msg = await g.textContent('#login-error');
  check('20 wrong sign-ins from one network pause it, with a clear message', /paused for \d+ minutes/i.test(msg), msg);
  await signIn(g, ADMIN_EMAIL, ADMIN_PASSWORD); await g.waitForTimeout(500);
  check('…a browser that never signed in is paused too', /paused/i.test(await g.textContent('#login-error')));

  // The manager's browser signs out and back in: not paused.
  await m.click('#logout-btn'); await m.waitForSelector('#login-section:not(.hidden)');
  await signIn(m, ADMIN_EMAIL, ADMIN_PASSWORD);
  check("…but the manager's own browser still signs in", await m.waitForSelector('#shell:not(.hidden)', { timeout: 8000 }).then(() => true).catch(() => false));
  await m.waitForTimeout(800);
  check('Overview shows the pause', await m.isVisible('#pauses-card'));
  await m.click('#pauses-lift-btn'); await m.waitForTimeout(800);
  check('Lift sign-in pauses clears it', !(await m.isVisible('#pauses-card')));
  await signIn(g, ADMIN_EMAIL, ADMIN_PASSWORD);
  check('…and the other browser can sign in again', await g.waitForSelector('#shell:not(.hidden)', { timeout: 8000 }).then(() => true).catch(() => false));
  await gctx.close(); await mctx.close();
}

await browser.close();
console.log(issues.length ? 'ISSUES:\n' + issues.map((i) => '  - ' + i).join('\n') : 'ISSUES: none');
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || issues.length ? 1 : 0);
