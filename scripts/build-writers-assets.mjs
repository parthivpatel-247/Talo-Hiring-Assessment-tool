// Builds the static files for the writers' site (wrangler.toml [env.docs]).
// dist-docs/ = public/ with the writers' candidate page as index.html, so the
// writers' site never ships the support test's page (and the support site, which
// serves public/ directly, never ships the writers' page).
import { cpSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-docs');
const page = join(root, 'writers', 'index.html');
if (!existsSync(page)) throw new Error('writers/index.html is missing');
rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'public'), out, { recursive: true });
writeFileSync(join(out, 'index.html'), readFileSync(page));
console.log('Writers site assets ready in dist-docs/');
