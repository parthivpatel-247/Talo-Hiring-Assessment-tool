// Checks public/_headers against the pages: the Content-Security-Policy must allow
// exactly the one inline theme script in each page (by its sha256), and no page may
// use inline event handlers (the CSP would block them). Run by `npm test` and before
// every deploy of either site (wrangler.toml build commands).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const headers = readFileSync(join(root, 'public', '_headers'), 'utf8');
const allowed = new Set([...headers.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1]));
const problems = [];
for (const rel of ['public/index.html', 'writers/index.html', 'public/admin/index.html']) {
  const page = readFileSync(join(root, rel), 'utf8');
  for (const m of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const h = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');
    if (!allowed.has(h)) problems.push(`${rel}: inline script not allowed by the CSP in public/_headers (add '${h}')`);
  }
  if (/\son[a-z]+="/i.test(page)) problems.push(`${rel}: inline event handler (on…="…") would be blocked by the CSP`);
}
if (!/frame-ancestors 'none'/.test(headers) || !/X-Frame-Options: DENY/.test(headers)) problems.push('public/_headers: framing protection missing');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('Security headers match the pages.');
