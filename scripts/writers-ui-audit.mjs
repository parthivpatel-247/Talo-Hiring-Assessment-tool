// End-to-end UI audit of the writers site against a LOCAL server: clicks every admin
// button and every candidate control, checks each one reaches the backend and does
// what it says, and records console errors, page errors and failed API calls.
//
//   npx wrangler dev --env docs --port 8788      (with OPENAI_BASE_URL pointing at a
//   node scripts/... stand-in, see docs/WRITERS-DATA-DESIGN.md)
//   BASE=http://127.0.0.1:8788 ADMIN_EMAIL=... ADMIN_PASSWORD=... QA_DIR=/path/with/cv1.pdf,cv2.pdf,cv3.pdf,notapdf.pdf \
//     node scripts/writers-ui-audit.mjs
// Credentials come from the environment only. Uses a fresh local database.
import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const QA = process.env.QA_DIR;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !QA) throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD and QA_DIR');
const CANDS = [
  { email: 'asha.writer@example.com', name: 'Asha Writer' },
  { email: 'ravi.editor@example.com', name: 'Ravi Editor' },
  { email: 'meera.author@example.com', name: 'Meera Author' },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const results = [];
const issues = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

function instrument(page, label, expected4xx = []) {
  page.on('pageerror', (e) => issues.push(`${label} page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.push(`${label} console: ${m.text()}`); });
  page.on('response', (r) => {
    const u = r.url(); if (!u.includes('/api/')) return;
    const path = new URL(u).pathname;
    if (r.status() >= 500) issues.push(`${label} ${r.status()} ${r.request().method()} ${path}`);
    else if (r.status() >= 400 && !expected4xx.some((x) => path.includes(x))) issues.push(`${label} unexpected ${r.status()} ${r.request().method()} ${path}`);
  });
  page.dialogQueue = [];
  page.on('dialog', async (d) => {
    const next = page.dialogQueue.shift();
    page.lastDialog = d.message();
    if (d.type() === 'prompt') await d.accept(next ?? ''); else if (next === false) await d.dismiss(); else await d.accept();
  });
}
const settle = (p, ms = 500) => p.waitForTimeout(ms);
async function nav(page, view) { await page.click(`.nav-item[data-view="${view}"]`); await settle(page, 600); }
async function rowFor(page, text) { return page.locator('#candidate-table tbody tr', { hasText: text }).first(); }
async function kebab(page, text, action) {
  const row = await rowFor(page, text);
  await row.locator('[data-kebab]').click();
  await settle(page, 200);
  await page.locator(`.menu:not([hidden]) [data-${action}]`).click();
  await settle(page, 900);
}

// ===================== Admin: setup =====================
const actx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const admin = await actx.newPage();
instrument(admin, 'admin', ['/api/admin/login', '/api/admin/candidates', '/grade', '/api/admin/questions', '/api/admin/assessment-length']);
await admin.goto(BASE + '/admin/');
await admin.fill('#login-email', ADMIN_EMAIL); await admin.fill('#login-password', 'wrong-password');
await admin.click('#login-btn'); await settle(admin);
check('wrong password shows an error', /wrong email or password/i.test(await admin.textContent('#login-error')));
await admin.fill('#login-password', ADMIN_PASSWORD); await admin.click('#login-btn');
await admin.waitForSelector('#shell:not(.hidden)'); await settle(admin, 1200);
check('manager signs in; writers tag shown', await admin.isVisible('.team-tag'));
check('test starts CLOSED', (await admin.textContent('#docs-open-pill')) === 'Closed');
await admin.click('#docs-open-btn'); await settle(admin, 800);
check('Open the test → pill says Open', (await admin.textContent('#docs-open-pill')) === 'Open');

for (const v of ['overview', 'questions', 'resumes', 'access', 'activity']) {
  await nav(admin, v);
  check(`nav: ${v} view shows`, await admin.isVisible(`#view-${v}`), await admin.textContent('#page-title'));
}

// ---- Question bank ----
await nav(admin, 'questions');
async function addQ(part, prompt, marks, wl) {
  await admin.selectOption('#q-category', part); await admin.fill('#q-marks', String(marks ?? ''));
  await admin.fill('#q-wordlimit', String(wl ?? '')); await admin.fill('#q-prompt', prompt);
  await admin.click('#q-add-btn'); await settle(admin, 700);
  return admin.textContent('#qform-status');
}
const bad = await addQ('part1', 'Word limit too small', 5, 10);
check('invalid word limit is refused with a message', /word limit/i.test(bad), bad);
for (let i = 1; i <= 5; i++) await addQ('part1', `Rewrite this error message clearly (${i}): "ERR_${i}: target rejected credential".`, 5, 150);
for (let i = 1; i <= 3; i++) await addQ('part2', `Write a short setup guide (${i}) from these notes: host, port 3306, user with SELECT.`, 10, 600);
const qrows = await admin.locator('#question-table tbody tr').count();
check('8 questions listed after adding', qrows === 8, `${qrows} rows`);
check('nav badge shows 8', (await admin.textContent('#nav-q')).trim() === '8');
await admin.locator('#question-table tbody tr').first().locator('[data-view]').click(); await settle(admin, 300);
check('View expands the question detail', await admin.isVisible('.qdetail-row'));
await admin.locator('#question-table tbody tr').first().locator('[data-view]').click(); await settle(admin, 300);
const firstToggle = admin.locator('#question-table tbody tr').first().locator('[data-toggle]');
await firstToggle.click(); await settle(admin, 600);
check('Disable marks the question off', /off/.test(await admin.locator('#question-table tbody tr').first().textContent()));
await admin.locator('#question-table tbody tr').first().locator('[data-toggle]').click(); await settle(admin, 600);
check('Enable turns it back on', /active/.test(await admin.locator('#question-table tbody tr').first().textContent()));
admin.dialogQueue.push(true);
await admin.locator('#question-table tbody tr').last().locator('[data-qdel]').click(); await settle(admin, 800);
check('Delete moves a question to the bin', (await admin.locator('#question-table tbody tr').count()) === 7);
await admin.click('#toggle-deleted-q'); await settle(admin, 600);
check('View deleted lists the bin', (await admin.locator('#question-table tbody tr.deleted-row').count()) === 1);
await admin.locator('[data-qrestore]').first().click(); await settle(admin, 800);
await admin.click('#toggle-deleted-q').catch(() => {}); await settle(admin, 600);
check('Restore puts it back', (await admin.locator('#question-table tbody tr').count()) === 8);

// ---- Resumes: length, colleges, upload, parse ----
await nav(admin, 'resumes');
check('bank counts show green', /5 active/.test(await admin.textContent('#docs-p1-pool')) && /3 active/.test(await admin.textContent('#docs-p2-pool')));
await admin.fill('#docs-p1-q', '0'); await admin.click('#docs-length-save-btn'); await settle(admin, 600);
check('invalid length is refused', /questions must be/i.test(await admin.textContent('#docs-length-status')));
await admin.fill('#docs-p1-q', '4'); await admin.fill('#docs-p1-min', '30'); await admin.fill('#docs-p2-q', '2'); await admin.fill('#docs-p2-min', '45');
await admin.click('#docs-length-save-btn'); await settle(admin, 600);
check('valid length saves', /Saved/.test(await admin.textContent('#docs-length-status')));
await admin.click('#college-add-btn'); await settle(admin, 200);
await admin.locator('#college-editor .college-input').last().fill('Writers College');
await admin.click('#college-save-btn'); await settle(admin, 800);
const opts = await admin.$$eval('#upload-college option', (o) => o.map((x) => x.textContent));
check('a new college appears in the upload list', opts.includes('Writers College'), opts.join(', '));
await admin.selectOption('#upload-college', 'Writers College');
await admin.setInputFiles('#resume-files', ['cv1.pdf', 'cv2.pdf', 'cv3.pdf', 'notapdf.pdf'].map((f) => join(QA, f)));
await admin.click('#upload-btn'); await settle(admin, 1500);
const up = await admin.textContent('#upload-status');
check('upload takes the 3 PDFs and skips the fake one', /Uploaded 3/.test(up) && /notapdf\.pdf \(not a PDF\)/.test(up), up.slice(0, 120));
await admin.click('#process-btn'); await admin.waitForFunction(() => /All done|Done\./.test(document.getElementById('upload-status').textContent), null, { timeout: 30000 }).catch(() => {});
const parsed = await admin.textContent('#upload-status');
check('Parse resumes fills names and emails', /Parsed 3/.test(parsed), parsed.slice(0, 100));

// ---- Access ----
await nav(admin, 'access');
await admin.fill('#m-name', 'Docs Panel'); await admin.fill('#m-email', 'panel.member@example.com');
await admin.fill('#m-password', 'panel-pass-123'); await admin.selectOption('#m-role', 'member');
await admin.click('#m-add-btn'); await settle(admin, 900);
const mrow = admin.locator('#member-table tbody tr', { hasText: 'panel.member@example.com' });
check('Add member lists the account', (await mrow.count()) === 1);
await mrow.locator('[data-mrole]').click(); await settle(admin, 800);
check('Make manager changes the role', /manager/i.test(await admin.locator('#member-table tbody tr', { hasText: 'panel.member@example.com' }).textContent()));
await admin.locator('#member-table tbody tr', { hasText: 'panel.member@example.com' }).locator('[data-mrole]').click(); await settle(admin, 800);
await admin.locator('#member-table tbody tr', { hasText: 'panel.member@example.com' }).locator('[data-mtoggle]').click(); await settle(admin, 800);
check('Deactivate marks the account inactive', /inactive|disabled|off/i.test(await admin.locator('#member-table tbody tr', { hasText: 'panel.member@example.com' }).textContent()));
await admin.locator('#member-table tbody tr', { hasText: 'panel.member@example.com' }).locator('[data-mtoggle]').click(); await settle(admin, 800);
// Sign-in pause: 5 wrong passwords for the panel account from a browser that never
// signed in to it pauses that account on this network; the manager sees it on
// Overview and can lift it.
{
  const gctx = await browser.newContext(); const g = await gctx.newPage();
  instrument(g, 'guesser', ['/api/admin/login', '/api/admin/candidates']);
  await g.goto(BASE + '/admin/');
  await g.fill('#login-email', 'panel.member@example.com');
  for (let i = 0; i < 5; i++) { await g.fill('#login-password', 'guess-' + i); await g.click('#login-btn'); await settle(g, 300); }
  check('repeated wrong passwords pause sign-in with a clear message', /paused for 15 minutes/i.test(await g.textContent('#login-error')), await g.textContent('#login-error'));
  await admin.reload(); await admin.waitForSelector('#shell:not(.hidden)'); await settle(admin, 1200);
  check('Overview shows the sign-in pause to the manager', await admin.isVisible('#pauses-card') && (await admin.textContent('#pauses-pill')).trim() === '1');
  admin.dialogQueue.push(true); await admin.click('#pauses-lift-btn'); await settle(admin, 800);
  check('Lift sign-in pauses clears it', !(await admin.isVisible('#pauses-card')));
  await g.fill('#login-password', 'panel-pass-123'); await g.click('#login-btn');
  check('…and the account can sign in again straight away', await g.waitForSelector('#shell:not(.hidden)', { timeout: 8000 }).then(() => true).catch(() => false));
  await gctx.close();
  await nav(admin, 'access');
}
admin.dialogQueue.push('panel-pass-456');
await admin.locator('#member-table tbody tr', { hasText: 'panel.member@example.com' }).locator('[data-mpass]').click(); await settle(admin, 1200);

// ===================== Candidates =====================
async function candidateRun(email, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  const p = await ctx.newPage();
  // Expected: /me before sign-in (401), and calls refused after the admin acts on a running test.
  instrument(p, `candidate ${email}`, ['/api/candidate/me', '/api/candidate/part1/', '/api/candidate/part2/']);
  await p.goto(BASE + '/');
  await p.click('#theme-toggle'); const theme = await p.evaluate(() => document.documentElement.dataset.theme);
  await p.click('#theme-toggle');
  await p.fill('#login-email', email); await p.click('#login-btn');
  await p.waitForSelector('#overview-section:not(.hidden)');
  const beginDisabled = await p.isDisabled('#begin-part1-btn');
  await p.check('#consent-chk');
  await p.click('#begin-part1-btn'); await p.click('#part1-fullscreen-btn');
  await p.waitForSelector('#part1-work:not(.hidden)'); await settle(p, 700);
  if (mode === 'start') return { ctx, p, theme, beginDisabled };
  // Navigate with pills, prev/next, save; check word-limit clamp.
  const pills = await p.locator('#part1-qnav .qpill').count();
  await p.locator('#part1-qnav .qpill').nth(2).click(); await settle(p, 200);
  const onThird = /Question 3 of/.test(await p.textContent('#part1-qpanel'));
  await p.click('#part1-prev'); await settle(p, 200);
  const prevOk = /Question 2 of/.test(await p.textContent('#part1-qpanel'));
  await p.locator('#part1-qnav .qpill').first().click(); await settle(p, 200);
  const prevDisabledOnFirst = await p.isDisabled('#part1-prev');
  await p.fill('#part1-answer', 'word '.repeat(200)); await p.dispatchEvent('#part1-answer', 'input');
  const clampedWords = (await p.inputValue('#part1-answer')).trim().split(/\s+/).length;
  for (let i = 0; i < pills; i++) {
    await p.fill('#part1-answer', `Answer ${i + 1}: The destination did not accept your sign-in details. Check them and try again.`);
    await p.dispatchEvent('#part1-answer', 'input');
    await p.click('#part1-save'); await settle(p, 400);
    if (i < pills - 1) await p.click('#part1-next');
  }
  const submitShown = await p.isVisible('#part1-submit-btn');
  p.dialogQueue.push(true, true);
  await p.click('#part1-submit-btn');
  await p.waitForSelector('#between-section:not(.hidden)');
  await p.click('#start-part2-btn');
  await p.waitForSelector('#part2-section:not(.hidden)'); await settle(p, 700);
  const p2pills = await p.locator('#part2-qnav .qpill').count();
  for (let i = 0; i < p2pills; i++) {
    await p.fill('#part2-answer', `Part 2 answer ${i + 1}.\nBefore you begin, note the host and port.\n1. Open Sources.\n2. Choose MySQL.`);
    await p.dispatchEvent('#part2-answer', 'input'); await p.click('#part2-save'); await settle(p, 400);
    if (i < p2pills - 1) await p.click('#part2-next');
  }
  p.dialogQueue.push(true, true);
  await p.click('#part2-submit-btn');
  await p.waitForSelector('#done-section:not(.hidden)');
  await ctx.close();
  return { theme, beginDisabled, pills, onThird, prevOk, prevDisabledOnFirst, clampedWords, submitShown, p2pills };
}
const full = await candidateRun(CANDS[0].email, 'full');
check('candidate: theme toggle works', full.theme === 'dark' || full.theme === 'light');
check('candidate: Begin is disabled until the consent box is ticked', full.beginDisabled);
check('candidate: 4 Part 1 questions, pills / prev / next work', full.pills === 4 && full.onThird && full.prevOk && full.prevDisabledOnFirst);
check('candidate: answers are clamped to the word limit', full.clampedWords === 150, `${full.clampedWords} words`);
check('candidate: Submit appears on the last question and both parts complete', full.submitShown && full.p2pills === 2);
const running = await candidateRun(CANDS[1].email, 'start'); // stays in Part 1
const revokedRun = await candidateRun(CANDS[2].email, 'start'); // will be revoked mid-test

// ===================== Admin: candidates =====================
await nav(admin, 'overview'); await admin.click('#refresh-btn'); await settle(admin, 1500);
const statTxt = await admin.textContent('#stats');
check('stats show 3 students, 1 completed, 2 in progress', /3\s*Total students/.test(statTxt) && /1\s*Completed/.test(statTxt) && /2\s*In progress/.test(statTxt), statTxt.replace(/\s+/g, ' '));
await admin.click('#filter-status [data-status="in_progress"]'); await settle(admin, 300);
check('status filter: In progress shows 2', (await admin.locator('#candidate-table tbody tr').count()) === 2);
await admin.click('#filter-status [data-status="all"]'); await settle(admin, 300);
await admin.click('#filter-college [data-college="Writers College"]'); await settle(admin, 300);
check('college filter shows the 3 uploaded', (await admin.locator('#candidate-table tbody tr').count()) === 3);
await admin.click('#filter-college [data-college="all"]'); await settle(admin, 300);
await admin.selectOption('#sort-by', 'name'); await settle(admin, 300);
check('sort by name orders A→Z', /Asha/.test(await admin.locator('#candidate-table tbody tr').first().textContent()));
await admin.click('#analyze-btn');
await admin.waitForFunction(() => /All submissions graded/.test(document.getElementById('analysis-status').textContent), null, { timeout: 30000 }).catch(() => {});
await settle(admin, 800);
check('Analyze grades the finished candidate', /20\/20|\/40/.test(await (await rowFor(admin, 'Asha')).textContent()) || /34/.test(await (await rowFor(admin, 'Asha')).textContent()), (await (await rowFor(admin, 'Asha')).textContent()).replace(/\s+/g, ' ').slice(0, 140));
await (await rowFor(admin, 'Asha')).locator('[data-view]').click();
await admin.waitForSelector('#detail-section:not(.hidden)'); await settle(admin, 1000);
const det = await admin.textContent('#detail-content');
check('detail shows both parts with marks and reasoning', /Part 1 — closed book/.test(det) && /Part 2 — open book/.test(det) && /Clear and mostly on task/.test(det));
const resumeRes = await admin.evaluate(async () => { const f = document.querySelector('.resume-frame'); const r = await fetch(f.src); return { s: r.status, t: r.headers.get('content-type') }; });
check('resume viewer serves the PDF', resumeRes.s === 200 && resumeRes.t === 'application/pdf');
await admin.click('#detail-close'); await settle(admin, 300);
check('Close hides the detail', !(await admin.isVisible('#detail-section')));

await kebab(admin, 'Asha', 'shortlist');
check('Shortlist sets the status', /Shortlisted/i.test(await (await rowFor(admin, 'Asha')).textContent()));
admin.dialogQueue.push(true); await kebab(admin, 'Asha', 'reject');
check('Reject sets the status', /Rejected/i.test(await (await rowFor(admin, 'Asha')).textContent()));

admin.lastDialog = '';
await kebab(admin, 'Ravi', 'grade');
check('Grade now refuses an unfinished candidate with a clear message', /finished both parts/i.test(admin.lastDialog), admin.lastDialog);
admin.dialogQueue.push(true); await kebab(admin, 'Ravi', 'force');
check('Force submit finishes the test', /Submitted/i.test(await (await rowFor(admin, 'Ravi')).textContent()));
await running.p.waitForSelector('#done-section:not(.hidden)', { timeout: 45000 }).catch(() => {});
check("…and the candidate's open page moves to the end screen", await running.p.isVisible('#done-section:not(.hidden)'));
admin.dialogQueue.push(true, true); await kebab(admin, 'Ravi', 'resume');
check('Resume reopens with a message', /reopened|sign in again/i.test(admin.lastDialog), admin.lastDialog);
admin.dialogQueue.push(true); await kebab(admin, 'Ravi', 'retake');
check('Retake resets to not started', /Not started|Ready|part2/i.test(await (await rowFor(admin, 'Ravi')).textContent()));
admin.dialogQueue.push(true); await kebab(admin, 'Meera', 'toggle-access');
check('Revoke access flags the candidate', /revoked/i.test(await (await rowFor(admin, 'Meera')).textContent()));
await revokedRun.p.waitForSelector('#done-section:not(.hidden)', { timeout: 45000 }).catch(() => {});
check("…and the candidate's page says the session was ended", /ended by the hiring team/.test(await revokedRun.p.textContent('#done-section')));
await revokedRun.ctx.close();
await kebab(admin, 'Meera', 'toggle-access');
check('Restore access clears it', !/revoked/i.test(await (await rowFor(admin, 'Meera')).textContent()));
// "Fix email" is offered only for a resume that didn't parse (as on the support site).
await (await rowFor(admin, 'Meera')).locator('[data-kebab]').click(); await settle(admin, 200);
check('Fix email is not offered for a parsed candidate', (await admin.locator('.menu:not([hidden]) [data-fix]').count()) === 0);
await admin.keyboard.press('Escape'); await admin.mouse.click(5, 5); await settle(admin, 200);
const sel = (await rowFor(admin, 'Meera')).locator('select');
if (await sel.count()) { await sel.selectOption(''); await settle(admin, 700); }
await admin.click('#refresh-btn'); await settle(admin, 1200);
check('college change on a row is saved', !/Writers College/.test(await (await rowFor(admin, 'Meera')).locator('select').inputValue().catch(() => 'x')));

for (const [btn, fmt, head] of [['#export-summary', 'summary', 'Part 1 score'], ['#export-full', 'full', 'AI reasoning']]) {
  const [dl] = await Promise.all([admin.waitForEvent('download'), admin.click(btn)]);
  const text = readFileSync(await dl.path(), 'utf8');
  check(`Export ${fmt} downloads a CSV with the right columns`, text.includes(head) && /talo-writers/.test(dl.suggestedFilename()), dl.suggestedFilename());
}
// Bulk import (writers format), sent in chunks of 30 by the page.
await nav(admin, 'questions');
await admin.click('#view-questions details summary');
check('bulk import is offered on the writers site with the writers format', /"part":1/.test(await admin.getAttribute('#bulk-json', 'placeholder')) && await admin.isVisible('#bulk-import-btn'));
const bulk = { questions: Array.from({ length: 35 }, (_, i) => ({ part: (i % 2) + 1, prompt: `Bulk writing task ${i + 1}: explain this setting to a new user.`, wordLimit: 200 })) };
await admin.fill('#bulk-json', JSON.stringify(bulk)); await admin.click('#bulk-import-btn'); await settle(admin, 2500);
const bulkMsg = await admin.textContent('#bank-status');
check('bulk import of 35 questions (2 requests) imports all 35', /Imported 35/.test(bulkMsg), bulkMsg);
await admin.fill('#bulk-json', JSON.stringify({ questions: bulk.questions.slice(0, 3) })); await admin.click('#bulk-import-btn'); await settle(admin, 1500);
check('re-importing the same questions skips them as duplicates', /Skipped 3 already in the bank/.test(await admin.textContent('#bank-status')), await admin.textContent('#bank-status'));
await nav(admin, 'activity'); await settle(admin, 800);
check('Activity log lists actions', (await admin.locator('#audit-table tbody tr').count()) > 5);
admin.dialogQueue.push(true); await nav(admin, 'overview'); await kebab(admin, 'Meera', 'delete');
check('Delete removes the candidate', (await admin.locator('#candidate-table tbody tr', { hasText: 'Meera' }).count()) === 0);
admin.dialogQueue.push(true); await admin.click('#docs-open-btn'); await settle(admin, 800);
check('Close the test → pill says Closed', (await admin.textContent('#docs-open-pill')) === 'Closed');
await admin.click('#theme-toggle'); const at1 = await admin.evaluate(() => document.documentElement.dataset.theme);
await admin.click('#theme-toggle'); const at2 = await admin.evaluate(() => document.documentElement.dataset.theme);
check('admin theme toggle switches', at1 !== at2);
await admin.setViewportSize({ width: 390, height: 800 }); await settle(admin, 300);
await admin.click('#nav-toggle'); await settle(admin, 300);
check('mobile: menu button opens the sidebar', await admin.evaluate(() => document.getElementById('shell').classList.contains('nav-open')));
await admin.click('#scrim').catch(() => {}); await admin.setViewportSize({ width: 1360, height: 900 });
await admin.click('#logout-btn'); await settle(admin, 800);
check('Log out returns to the sign-in screen', await admin.isVisible('#login-section:not(.hidden)'));

// ---- Panel member view ----
await admin.fill('#login-email', 'panel.member@example.com'); await admin.fill('#login-password', 'panel-pass-456');
await admin.click('#login-btn'); await admin.waitForSelector('#shell:not(.hidden)'); await settle(admin, 1200);
check('panel member can sign in with the new password', /Panel member/.test(await admin.textContent('#page-sub')));
check('panel member cannot open/close the test', await admin.isDisabled('#docs-open-btn'));
await nav(admin, 'questions');
check('panel member does not see the add-question form', !(await admin.isVisible('#q-add-btn')));
await running.ctx.close();
await browser.close();

console.log('\nISSUES (console errors, page errors, failed API calls):');
console.log(issues.length ? issues.map((i) => '  - ' + i).join('\n') : '  none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed || issues.length ? 1 : 0);
