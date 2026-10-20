// End-to-end tour against a local Worker (bash e2e/serve.sh): first-run setup,
// drive + college, resume upload, fix details, candidate exam, grading views,
// bulk actions and export. Saves screenshots and fails loudly on console errors.
import { chromium } from '@playwright/test';
import fs from 'fs';

const out = process.argv[2] || 'tour-shots';
fs.mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:8787';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const problems = [];
const watch = (page, tag) => {
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/status of (401|404|409|400|429)/.test(t)) problems.push(`[${tag}] console: ${t}`);
    if (/Content Security Policy|Refused to/.test(t)) problems.push(`[${tag}] CSP: ${t}`);
  });
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
};
let n = 0;
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` }); };
const step = (s) => console.log('•', s);

// ---------- synthetic resume PDF ----------
const pdfPage = await browser.newPage();
await pdfPage.setContent(`<html><body style="font-family:Arial;padding:40px"><h1>Riya Deshmukh</h1><p>riya.deshmukh@viit.example.edu · +91 98765 43210</p><h2>Education</h2><p>B.Tech Computer Engineering, Vishwakarma Institute of Information Technology, Pune — 2027</p><h2>Skills</h2><p>SQL, Python, Data structures, Git</p><h2>Projects</h2><p>Library management system using Python and SQLite.</p></body></html>`);
fs.writeFileSync(`${out}/resume.pdf`, await pdfPage.pdf({ format: 'A4' }));
await pdfPage.close();

// ---------- admin: first-run setup ----------
const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const a = await admin.newPage();
watch(a, 'admin');
step('admin first-run setup');
await a.goto(`${base}/admin/`);
await a.fill('#email', 'admin@talo.test');
await a.fill('#password', 'e2e-setup-password-77');
await a.click('#login-btn');
await a.waitForSelector('#setup');
await a.fill('#name', 'Asha Manager');
await a.fill('#newpw', 'Talo-manager-pass-2026');
await shot(a, 'admin-setup');
await a.click('#setup-btn');
await a.waitForSelector('.pipeline');
await shot(a, 'admin-overview-empty');

step('create college + drive');
await a.goto(`${base}/admin/#/drives`);
await a.click('#new-college');
await a.fill('#cl-name', 'Vishwakarma Institute of Information Technology');
await a.fill('#cl-city', 'Pune');
await a.click('dialog [data-confirm]');
await a.waitForSelector('text=Vishwakarma Institute of Information Technology');
await a.click('#new-drive');
await a.fill('#dv-name', 'VIIT Pune · Data Engineer · Nov 2026');
await a.selectOption('#dv-college', { label: 'Vishwakarma Institute of Information Technology' });
await a.fill('#dv-date', '2026-11-04');
await a.click('dialog [data-confirm]');
await a.waitForSelector('dialog .code-chip');
const hallCode = (await a.textContent('dialog .code-chip')).trim();
await shot(a, 'drive-created');
await a.click('dialog [data-confirm]');
await a.click('[data-menu]');
await a.click('.menu button:has-text("Set live")');
await a.waitForSelector('td .badge.success:has-text("Live")');
await shot(a, 'drives');
console.log('  hall code', hallCode);

step('upload resume (no AI key locally, so it lands in Needs details)');
await a.goto(`${base}/admin/#/resumes`);
await a.waitForSelector('#up-drive');
await a.selectOption('#up-drive', { label: 'VIIT Pune · Data Engineer · Nov 2026 · Vishwakarma Institute of Information Technology' });
await a.setInputFiles('#file-input', `${out}/resume.pdf`);
await shot(a, 'resumes-selected');
await a.click('#upload-btn');
await a.waitForSelector('#prog-foot:not([hidden])', { timeout: 60000 });
await shot(a, 'resumes-done');

step('fix details from the drawer');
await a.goto(`${base}/admin/#/candidates?stage=attention`);
await a.waitForSelector('tr[data-id]');
await shot(a, 'candidates-attention');
await a.click('tr[data-id]');
await a.waitForSelector('.drawer #dr-actions');
await shot(a, 'drawer-summary');
await a.click('#fix-inline');
await a.fill('#fx-name', 'Riya Deshmukh');
await a.fill('#fx-email', 'riya.deshmukh@viit.example.edu');
await shot(a, 'fix-details');
await a.click('dialog [data-confirm]');
await a.waitForSelector('.drawer .badge:has-text("Not started")');
await a.keyboard.press('Escape');

// ---------- candidate ----------
step('candidate signs in and takes the test');
const cand = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const c = await cand.newPage();
watch(c, 'candidate');
await c.goto(`${base}/`);
await c.fill('#email', 'riya.deshmukh@viit.example.edu');
await c.fill('#code', 'WRONG1');
await c.click('#signin-btn');
await c.waitForSelector('#signin-error:not([hidden])');
await shot(c, 'cand-wrong-code');
await c.fill('#code', hallCode);
await c.click('#signin-btn');
await c.waitForSelector('#consent');
await c.waitForSelector('#prep-state:has-text("ready")', { timeout: 20000 });
await shot(c, 'cand-rules');
await c.check('#consent');
await c.click('#start-btn');
await c.waitForSelector('.exam');
// Headless Chromium may refuse full screen: use the overlay button if shown.
if (await c.$('#ov-fs')) await c.click('#ov-fs');
await c.waitForTimeout(500);
await shot(c, 'exam-q1');
const pills = await c.$$('.qpill');
for (let i = 0; i < pills.length; i++) {
  await c.click(`.qpill[data-i="${i}"]`);
  await c.click('.editor-input');
  await c.keyboard.type(i === 0 ? 'SELECT name, SUM(amount) AS total\nFROM orders\nGROUP BY name;' : `// approach for question ${i + 1}\nfor each item in list:\n    count it`);
  if (i === 2) await shot(c, 'exam-typing');
}
await c.keyboard.press('Control+s');
await c.waitForTimeout(800);
await shot(c, 'exam-saved');
// simulate a connection drop
await cand.setOffline(true);
await c.waitForSelector('.overlay[data-kind="offline"]', { timeout: 15000 });
await shot(c, 'exam-offline');
await cand.setOffline(false); // the page notices and reconnects by itself
await c.waitForSelector('.overlay[data-kind="offline"]', { state: 'detached', timeout: 20000 });
await c.click('#submit-btn');
await c.waitForSelector('dialog[open]');
await shot(c, 'exam-submit-dialog');
await c.click('dialog [data-confirm]');
await c.waitForSelector('.done-mark', { timeout: 20000 });
await shot(c, 'cand-done');

// ---------- admin again ----------
step('admin reviews');
await a.goto(`${base}/admin/#/overview`);
await a.waitForSelector('.pipeline');
await shot(a, 'admin-overview');
await a.goto(`${base}/admin/#/candidates`);
await a.waitForSelector('tr[data-id]');
await shot(a, 'candidates');
await a.click('tr[data-id]');
await a.click('[data-tab="answers"]');
await shot(a, 'drawer-answers');
await a.click('[data-tab="activity"]');
await shot(a, 'drawer-activity');
await a.keyboard.press('Escape');
await a.check('tr[data-id] [data-sel]');
await a.waitForSelector('.bulkbar');
await shot(a, 'bulkbar');
await a.click('[data-bulk="shortlist"]');
await a.click('dialog [data-confirm]');
await a.waitForTimeout(800);
await a.goto(`${base}/admin/#/questions`);
await a.waitForSelector('#qtable table');
await shot(a, 'questions');
await a.click('#qtable tr[data-id]');
await a.waitForSelector('dialog .preview-pane');
await shot(a, 'question-preview');
await a.keyboard.press('Escape');
await a.goto(`${base}/admin/#/results`);
await a.waitForSelector('#ex-form');
const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#ex-btn')]);
console.log('  downloaded', await dl.suggestedFilename());
await a.waitForTimeout(800);
await shot(a, 'results');
for (const [h, name] of [['#/integrity', 'integrity'], ['#/activity', 'activity'], ['#/settings/assessment', 'settings-assessment'], ['#/settings/security', 'settings-security'], ['#/settings/team', 'settings-team'], ['#/settings/data', 'settings-data'], ['#/settings/usage', 'settings-usage'], ['#/settings/integrations', 'settings-integrations'], ['#/account', 'account']]) {
  await a.goto(`${base}/admin/${h}`);
  await a.waitForSelector('#view > :not(.view-loading)', { timeout: 15000 });
  await a.waitForTimeout(500);
  await shot(a, name);
}

// ---------- mobile ----------
step('mobile views');
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const m = await mob.newPage();
watch(m, 'mobile');
await m.goto(`${base}/admin/`);
await m.fill('#email', 'admin@talo.test');
await m.fill('#password', 'Talo-manager-pass-2026');
await m.click('#login-btn');
await m.waitForSelector('.pipeline');
await shot(m, 'm-overview');
for (const h of ['#/overview', '#/drives', '#/questions', '#/results', '#/settings/assessment']) {
  await m.goto(`${base}/admin/${h}`);
  await m.waitForTimeout(900);
  const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 1) problems.push(`mobile: horizontal page scroll of ${over}px on ${h}`);
}
await m.goto(`${base}/admin/#/overview`);
await m.waitForSelector('.pipeline');
await m.click('#menu-toggle');
await shot(m, 'm-nav');
await m.click('[data-nav="candidates"]');
await m.waitForSelector('tr[data-id]');
await shot(m, 'm-candidates');
const scroll = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (scroll > 1) problems.push(`mobile: horizontal page scroll of ${scroll}px on candidates`);

await browser.close();
console.log(problems.length ? `\nPROBLEMS:\n${problems.join('\n')}` : '\nNo console or CSP problems.');
process.exit(problems.length ? 1 : 0);
