// Browser walk-through of the writers' site against a LOCAL server
// (npx wrangler dev --env docs). Takes screenshots of each screen.
//   BASE=http://127.0.0.1:8788 CANDIDATE=writer.one@example.com ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/writers-tour.mjs
// Credentials come from the environment only; this script never stores them.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const OUT = process.env.OUT || 'e2e-results/writers';
const CANDIDATE = process.env.CANDIDATE;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!CANDIDATE || !ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set CANDIDATE, ADMIN_EMAIL and ADMIN_PASSWORD');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const step = (msg) => console.log('•', msg);

// ---- Candidate ----
await page.goto(BASE + '/');
await page.waitForTimeout(500);
await shot('01-login');
step('login page: ' + (await page.textContent('.hero-title')));
await page.fill('#login-email', CANDIDATE);
await page.click('#login-btn');
await page.waitForSelector('#overview-section:not(.hidden)');
await page.waitForTimeout(400);
await shot('02-overview');
step('overview steps: ' + (await page.$$eval('#overview-section .step', (els) => els.map((e) => e.textContent.trim()).join(' | '))));
await page.check('#consent-chk');
await page.click('#begin-part1-btn');
await page.click('#part1-fullscreen-btn');
await page.waitForSelector('#part1-work:not(.hidden)');
await page.waitForTimeout(800);
const qCount1 = await page.$$eval('#part1-qnav .qpill', (els) => els.length);
step(`Part 1 questions: ${qCount1}, timer ${await page.textContent('#timer')}`);
for (let i = 0; i < qCount1; i++) {
  await page.fill('#part1-answer', `Part 1 answer ${i + 1}. The destination did not accept your login details. Check the user name and password, then try again.`);
  await page.dispatchEvent('#part1-answer', 'input');
  if (i === 0) { await shot('03-part1'); step('word count: ' + (await page.textContent('#part1-wc'))); }
  if (i < qCount1 - 1) await page.click('#part1-next');
}
await page.click('#part1-submit-btn');
await page.waitForSelector('#between-section:not(.hidden)');
await page.waitForTimeout(400);
await shot('04-between');
step('between: ' + (await page.textContent('#between-title')));
await page.click('#start-part2-btn');
await page.waitForSelector('#part2-section:not(.hidden)');
await page.waitForTimeout(800);
const qCount2 = await page.$$eval('#part2-qnav .qpill', (els) => els.length);
step(`Part 2 questions: ${qCount2}, timer ${await page.textContent('#timer')}`);
// Paste is allowed in Part 2: a real paste event is not cancelled.
const pasteAllowed = await page.evaluate(() => {
  const ta = document.getElementById('part2-answer');
  const dt = new DataTransfer(); dt.setData('text/plain', 'Pasted reference text.');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  return ta.dispatchEvent(ev); // true = not prevented
});
step('Part 2 paste allowed: ' + pasteAllowed);
for (let i = 0; i < qCount2; i++) {
  await page.fill('#part2-answer', `Part 2 answer ${i + 1}.\n\nBefore you begin, make sure you have the host name and port.\n1. Open Sources.\n2. Select MySQL.`);
  await page.dispatchEvent('#part2-answer', 'input');
  if (i === 0) await shot('05-part2');
  if (i < qCount2 - 1) await page.click('#part2-next');
}
await page.click('#part2-submit-btn');
await page.waitForSelector('#done-section:not(.hidden)');
await shot('06-done');
step('done');

// ---- Admin ----
const admin = await ctx.newPage();
admin.on('pageerror', (e) => errors.push('admin: ' + e.message));
admin.on('dialog', (d) => d.accept());
await admin.goto(BASE + '/admin/');
await admin.fill('#login-email', ADMIN_EMAIL);
await admin.fill('#login-password', ADMIN_PASSWORD);
await admin.click('#login-btn');
await admin.waitForSelector('#shell:not(.hidden)');
await admin.waitForTimeout(1500);
await admin.screenshot({ path: `${OUT}/07-admin-overview.png`, fullPage: true });
step('admin sub: ' + (await admin.textContent('#page-sub')) + ' · tag: ' + (await admin.isVisible('.team-tag')));
await admin.click('[data-view="resumes"]');
await admin.waitForTimeout(600);
await admin.screenshot({ path: `${OUT}/08-admin-length.png`, fullPage: true });
step('pool: ' + (await admin.textContent('#docs-p1-pool')) + ' / ' + (await admin.textContent('#docs-p2-pool')));
await admin.click('[data-view="questions"]');
await admin.waitForTimeout(600);
await admin.screenshot({ path: `${OUT}/09-admin-questions.png`, fullPage: true });
await admin.click('[data-view="overview"]');
await admin.waitForTimeout(400);
await admin.click('#candidate-table [data-view]');
await admin.waitForSelector('#detail-section:not(.hidden)');
await admin.waitForTimeout(800);
await admin.screenshot({ path: `${OUT}/10-admin-detail.png`, fullPage: true });

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'No page errors.');
await browser.close();
