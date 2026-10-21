// Checks, in a real browser against a LOCAL writers site (npx wrangler dev --env docs),
// that the support test's protections work the same on the writers' test:
//   full-screen lockdown + 10 s return-or-submit, copy/paste/right-click block,
//   warning toasts, connection-loss pause and automatic recovery, reload ends a
//   running part, a second sign-in is blocked, and Part 2's open-book rules.
// Needs three ready candidates (LOCK, NET, DUP emails below) in the local database.
//   BASE=http://127.0.0.1:8788 CHROME=/path/to/chrome node scripts/writers-parity-check.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const LOCK = process.env.LOCK || 'lock.test@example.com';
const NET = process.env.NET || 'net.test@example.com';
const DUP = process.env.DUP || 'dup.test@example.com';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

async function startPart1(page, email) {
  await page.goto(BASE + '/');
  await page.fill('#login-email', email);
  await page.click('#login-btn');
  await page.waitForSelector('#overview-section:not(.hidden)');
  await page.check('#consent-chk');
  await page.click('#begin-part1-btn');
  await page.click('#part1-fullscreen-btn');
  await page.waitForSelector('#part1-work:not(.hidden)');
  await page.waitForTimeout(600);
}
const inFullscreen = (page) => page.evaluate(() => !!document.fullscreenElement);

// ---- 1. Lockdown: copy/paste/right-click blocked, leaving starts the 10 s countdown, not returning submits ----
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await startPart1(page, LOCK);
  check('Part 1 opens in full screen', await inFullscreen(page));
  const blocked = await page.evaluate(() => {
    const ta = document.getElementById('part1-answer');
    const fire = (type) => { const dt = new DataTransfer(); dt.setData('text/plain', 'x'); return !ta.dispatchEvent(new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true })); };
    const ctxMenu = !document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return { paste: fire('paste'), copy: fire('copy'), cut: fire('cut'), ctxMenu };
  });
  check('Part 1 blocks paste, copy, cut and right-click', blocked.paste && blocked.copy && blocked.cut && blocked.ctxMenu, JSON.stringify(blocked));
  await page.waitForTimeout(300);
  check('a warning toast is shown', await page.isVisible('#warn-toast'));
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForSelector('#lockdown-overlay', { timeout: 3000 }).catch(() => {});
  check('leaving full screen shows the return countdown', await page.isVisible('#lockdown-overlay'), (await page.textContent('#away-count').catch(() => '')) + ' s');
  await page.click('#lockdown-return');
  await page.waitForTimeout(800);
  check('returning cancels the countdown', !(await page.isVisible('#lockdown-overlay')) && (await inFullscreen(page)));
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(11500);
  check('not returning within 10 s submits and closes the assessment', await page.isVisible('#done-section:not(.hidden)'), (await page.textContent('#done-section p')).slice(0, 70) + '…');
  const me = await page.evaluate(() => fetch('/api/candidate/me', { cache: 'no-store' }).then((r) => r.json()));
  check('…both parts are closed on the server', !!(me.attempt?.part1_submitted_at && me.attempt?.part2_submitted_at) && me.candidate.status === 'submitted', `${me.attempt?.part1_tab_switch_count} leave events recorded`);
  await ctx.close();
}

// ---- 2. Connection loss pauses the clock and recovers on its own; reload rules ----
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await startPart1(page, NET);
  await page.fill('#part1-answer', 'Answer typed before the network dropped.');
  await page.dispatchEvent('#part1-answer', 'input');
  await page.route('**/api/candidate/**', (route) => route.abort('internetdisconnected'));
  await page.waitForSelector('#offline-overlay', { timeout: 40000 }).catch(() => {});
  check('a failed clock sync shows "Connection lost — timer paused"', await page.isVisible('#offline-overlay'));
  const frozen = await page.textContent('#timer');
  await page.waitForTimeout(3000);
  check('the countdown is frozen while offline', (await page.textContent('#timer')) === frozen, frozen);
  await page.unroute('**/api/candidate/**');
  await page.waitForSelector('#offline-overlay', { state: 'detached', timeout: 25000 }).catch(() => {});
  check('it resumes by itself once the server is reachable', !(await page.isVisible('#offline-overlay')));
  // Second sign-in on another device while Part 1 runs is refused.
  const other = await browser.newContext(); const p2 = await other.newPage();
  const dup = await p2.request.post(BASE + '/api/candidate/login', { data: { email: NET } });
  check('a second sign-in during a running part is blocked', dup.status() === 403);
  await other.close();
  // Submit Part 1, reload between the parts: safe.
  for (let i = 0; i < 10; i++) { if (await page.isVisible('#part1-submit-btn')) break; await page.click('#part1-next').catch(() => {}); }
  await page.click('#part1-submit-btn');
  await page.waitForSelector('#between-section:not(.hidden)');
  await page.reload();
  await page.waitForTimeout(1200);
  check('reloading between the parts returns to "Start Part 2"', await page.isVisible('#between-section:not(.hidden)'));
  await page.click('#start-part2-btn');
  await page.waitForSelector('#part2-section:not(.hidden)');
  await page.waitForTimeout(600);
  const p2rules = await page.evaluate(() => {
    const ta = document.getElementById('part2-answer');
    const dt = new DataTransfer(); dt.setData('text/plain', 'From the docs page.');
    const pasteAllowed = ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const copyAllowed = document.body.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }));
    return { pasteAllowed, copyAllowed, fullscreen: !!document.fullscreenElement };
  });
  check('Part 2 allows paste and copy, without full screen', p2rules.pasteAllowed && p2rules.copyAllowed, JSON.stringify(p2rules));
  await page.reload();
  await page.waitForTimeout(1500);
  check('reloading while Part 2 runs ends the assessment', await page.isVisible('#done-section:not(.hidden)'));
  await ctx.close();
}

// ---- 3. Duplicate sign-in after finishing; revoked access ----
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const login = await page.request.post(BASE + '/api/candidate/login', { data: { email: LOCK } });
  check('signing in again after the test is over is blocked', login.status() === 403);
  const unknown = await page.request.post(BASE + '/api/candidate/login', { data: { email: 'not.on.list@example.com' } });
  check('an email not on the list is refused', unknown.status() === 403);
  const ok = await page.request.post(BASE + '/api/candidate/login', { data: { email: DUP } });
  check('a ready candidate can sign in', ok.status() === 200);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
