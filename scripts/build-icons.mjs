import { chromium } from '@playwright/test';
import fs from 'fs';
const svg = fs.readFileSync('public/favicon.svg', 'utf8');
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage();
for (const [out, size, bg] of [['public/favicon-32.png', 32, 'transparent'], ['public/apple-touch-icon.png', 180, '#171717'], ['public/assets/img/icon-192.png', 192, 'transparent'], ['public/assets/img/icon-512.png', 512, 'transparent']]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:${bg}">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: out, omitBackground: bg === 'transparent' });
}
await b.close();
