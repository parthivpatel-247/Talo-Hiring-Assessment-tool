import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { migrate, req, adminCookie, seedCandidate } from './helpers';

// Shared-code fixes from the 2026-10-21 audit, checked on the SUPPORT site (default env).
describe('support site — shared security fixes', () => {
  beforeEach(async () => { await migrate(); });

  it('the CSV export neutralises spreadsheet formulas', async () => {
    await seedCandidate('f1', 'f1@x.com', 'part2_ready');
    await env.DB.prepare("UPDATE candidates SET name = '=HYPERLINK(\"http://evil\",\"x\")' WHERE id = 'f1'").run();
    const admin = await adminCookie();
    const csv = await (await req('/api/admin/export.csv?format=summary', { headers: { Cookie: admin } })).text();
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  it('an expired admin session is refused (ISO expiry compared correctly)', async () => {
    const admin = await adminCookie();
    await env.DB.prepare('UPDATE admin_sessions SET expires_at = ?').bind(new Date(Date.now() - 60_000).toISOString()).run();
    expect((await req('/api/admin/candidates', { headers: { Cookie: admin } })).status).toBe(401);
  });

  it('cross-site writes are refused, same-site writes work', async () => {
    const admin = await adminCookie();
    const h = (origin: string) => ({ method: 'POST', headers: { Cookie: admin, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 60 }) });
    expect((await req('/api/admin/assessment-duration', h('https://evil.example'))).status).toBe(403);
    expect((await req('/api/admin/assessment-duration', h('https://test.local'))).status).toBe(200);
  });
});
