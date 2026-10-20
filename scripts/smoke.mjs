// Quick visual smoke: screenshots + console/CSP errors for the main screens.
import { chromium } from '@playwright/test';
const out = process.argv[2] || 'shots';
const base = 'http://127.0.0.1:8787';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
async function shot(page, name) { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png`, fullPage: false }); }
for (const vp of [{ w: 1440, h: 900, n: 'd' }, { w: 390, h: 844, n: 'm' }]) {
  const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${vp.n} ${page.url()}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${vp.n} ${page.url()}] pageerror: ${e.message}`));
  for (const [path, name] of [['/', 'cand-signin'], ['/admin/', 'admin-login'], ['/privacy/', 'privacy'], ['/terms/', 'terms'], ['/nope', '404']]) {
    await page.goto(base + path);
    await shot(page, `${vp.n}-${name}`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) errors.push(`[${vp.n} ${path}] horizontal scroll ${over}px`);
    const t = await page.title(); const d = await page.$eval('meta[name=description]', (m) => m.content).catch(() => '');
    if (!t || !d) errors.push(`[${vp.n} ${path}] missing title or description`);
  }
  await ctx.close();
}
await b.close();
console.log(errors.join('\n') || 'no console errors');
