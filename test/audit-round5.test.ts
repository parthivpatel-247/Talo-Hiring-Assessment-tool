import { describe, it, expect, beforeEach } from 'vitest';
import { env, fetchMock, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { migrate, req, adminCookie, panelCookie, seedQuestions, seedCandidate, applySql, openAiReply } from './helpers';
import d16 from '../migrations-docs/0016_writers_two_part.sql?raw';
import d17 from '../migrations-docs/0017_writers_indexes.sql?raw';
import d18 from '../migrations-docs/0018_rate_limits.sql?raw';

// Security audit run 2 (Cloudflare security-audit skill, quick profile, scoped to the
// changes since run 1). Owner-side regression cases for its two leads and for the
// three units its coverage critic deferred.

const O = 'https://test.local';
const post = (cookie: string, body: unknown = {}) => ({ method: 'POST', headers: { Cookie: cookie, Origin: O, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ck = (r: Response) => (r.headers.get('Set-Cookie') || '').split(';')[0];
const login = (email: string, password: string) =>
  req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });

describe('lead: shared panel password re-enables a panel account a manager turned off', () => {
  let mgr: string; let pid: string;
  beforeEach(async () => {
    await migrate();
    await panelCookie();
    mgr = await adminCookie();
    pid = (await env.DB.prepare("SELECT id FROM admin_users WHERE email = 'panel@test.local'").first<any>()).id;
  });

  it('Disable keeps the shared panel password out until the account is enabled again', async () => {
    expect((await req(`/api/admin/members/${pid}`, post(mgr, { active: false }))).status).toBe(200);
    expect((await login('panel@test.local', 'test-panel-pass')).status).toBe(401);
    expect((await env.DB.prepare('SELECT active FROM admin_users WHERE id = ?').bind(pid).first<any>()).active).toBe(0);
    expect((await req(`/api/admin/members/${pid}`, post(mgr, { active: true }))).status).toBe(200);
    expect((await login('panel@test.local', 'test-panel-pass')).status).toBe(200);
  });

  it('Delete keeps the shared panel password out (the row is not recreated)', async () => {
    expect((await req(`/api/admin/members/${pid}`, { method: 'DELETE', headers: { Cookie: mgr, Origin: O } })).status).toBe(200);
    expect((await login('panel@test.local', 'test-panel-pass')).status).toBe(401);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE email = 'panel@test.local'").first<any>()).n).toBe(0);
  });

  it('Reset password retires the shared panel password; the new password works', async () => {
    expect((await req(`/api/admin/members/${pid}`, post(mgr, { password: 'new-panel-pass-1' }))).status).toBe(200);
    expect((await login('panel@test.local', 'test-panel-pass')).status).toBe(401);
    expect((await login('panel@test.local', 'new-panel-pass-1')).status).toBe(200);
  });

  it('a rotated PANEL_PASSWORD works again after a Delete', async () => {
    await req(`/api/admin/members/${pid}`, { method: 'DELETE', headers: { Cookie: mgr, Origin: O } });
    const rotated = { ...env, PANEL_PASSWORD: 'rotated-panel-pass-2' };
    const ctx = createExecutionContext();
    const r = await worker.fetch(new Request(O + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'panel@test.local', password: 'rotated-panel-pass-2' }) }), rotated as any, ctx);
    await waitOnExecutionContext(ctx);
    expect(r.status).toBe(200);
  });

  it('a session from the shared panel password never gets manager rights, even if its row is promoted', async () => {
    await req(`/api/admin/members/${pid}`, post(mgr, { role: 'manager' }));
    const pan = ck(await login('panel@test.local', 'test-panel-pass'));
    const cfg = await (await req('/api/admin/config', { headers: { Cookie: pan } })).json<any>();
    expect(cfg.role).toBe('member');
    expect((await req('/api/admin/start-open', post(pan, { open: false }))).status).toBe(403);
  });

  it('the main manager config login is still the recovery login', async () => {
    const aid = (await env.DB.prepare("SELECT id FROM admin_users WHERE email = 'admin@test.local'").first<any>()).id;
    await env.DB.prepare("UPDATE admin_users SET active = 0, role = 'member' WHERE id = ?").bind(aid).run();
    const r = await login('admin@test.local', 'test-admin-pass');
    expect(r.status).toBe(200);
    expect((await env.DB.prepare('SELECT role, active FROM admin_users WHERE id = ?').bind(aid).first<any>())).toEqual({ role: 'manager', active: 1 });
  });
});

describe('lead: revoke-and-reject status and later decisions', () => {
  let mgr: string; let pan: string;
  beforeEach(async () => {
    await migrate(); await seedQuestions();
    // Shortlisting writes an interview guide with AI: answer it locally.
    fetchMock.activate(); fetchMock.disableNetConnect();
    fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, openAiReply({ questions: [] })).persist();
    mgr = await adminCookie(); pan = await panelCookie();
  });
  const status = async (id: string) => (await env.DB.prepare('SELECT status, status_before_revoke FROM candidates WHERE id = ?').bind(id).first<any>());

  it('an ungraded candidate rejected by a revoke cannot be shortlisted, and Restore access puts them back', async () => {
    await seedCandidate('r3', 'r3@x.com');
    expect((await req('/api/admin/candidates/r3/revoke', post(mgr, { reject: true }))).status).toBe(200);
    expect(await status('r3')).toEqual({ status: 'rejected', status_before_revoke: 'part2_ready' });
    expect((await req('/api/admin/candidates/r3/shortlist', post(pan))).status).toBe(409);
    await req('/api/admin/candidates/r3/unrevoke', post(mgr));
    expect((await status('r3')).status).toBe('part2_ready');
  });

  it('a decision made after the revoke stands: Restore access does not undo it', async () => {
    await seedCandidate('r4', 'r4@x.com', 'evaluated');
    await req('/api/admin/candidates/r4/revoke', post(mgr, { reject: true }));
    expect((await req('/api/admin/candidates/r4/shortlist', post(pan))).status).toBe(200);
    expect((await req('/api/admin/candidates/r4/reject', post(pan))).status).toBe(200);
    await req('/api/admin/candidates/r4/unrevoke', post(mgr));
    expect((await status('r4'))).toEqual({ status: 'rejected', status_before_revoke: null });
  });
});

describe('deferred unit: writers "every candidate" questions in Part 2', () => {
  const D = 'https://docs.test';
  const docsEnv = { ...env, TEAM: 'docs' } as typeof env;
  async function dreq(path: string, init: RequestInit = {}) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(D + path, { ...init, headers: { Origin: D, ...(init.headers as any) } }), docsEnv as any, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }
  const dpost = (cookie: string, body: unknown = {}) => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('a pinned Part 2 question goes to every candidate', async () => {
    await migrate(); await applySql(d16); await applySql(d17); await applySql(d18);
    const a = ck(await dreq('/api/admin/login', dpost('', { email: 'admin@test.local', password: 'test-admin-pass' })));
    const qs = [1, 2, 3].map((i) => ({ part: 1, prompt: `Sentence ${i}.` }));
    qs.push({ part: 2, prompt: 'Optional writing A.' } as any, { part: 2, prompt: 'Optional writing B.' } as any, { part: 2, prompt: 'The PRD outline.', required: true } as any);
    await dreq('/api/admin/questions/bulk-import', dpost(a, { questions: qs }));
    expect((await dreq('/api/admin/assessment-length', dpost(a, { part1: { questions: 3, minutes: 30 }, part2: { questions: 1, minutes: 45 } }))).status).toBe(200);
    await dreq('/api/admin/start-open', dpost(a, { open: true }));
    for (let n = 1; n <= 4; n++) {
      await seedCandidate(`w${n}`, `w${n}@x.com`);
      const c = ck(await dreq('/api/candidate/login', dpost('', { email: `w${n}@x.com` })));
      await dreq('/api/candidate/part1/start', dpost(c));
      await dreq('/api/candidate/part1/submit', dpost(c));
      await dreq('/api/candidate/part2/start', dpost(c));
      const q2 = (await (await dreq('/api/candidate/part2/questions', { headers: { Cookie: c } })).json<any>()).questions;
      expect(q2).toHaveLength(1);
      expect(q2[0].prompt).toContain('PRD outline');
    }
  });
});

describe('deferred unit: sign-in limits for the main manager account', () => {
  beforeEach(async () => { await migrate(); });

  it('Reset password lifts a pause on the config-email account', async () => {
    const mgr = await adminCookie();
    const aid = (await env.DB.prepare("SELECT id FROM admin_users WHERE email = 'admin@test.local'").first<any>()).id;
    for (let i = 0; i < 6; i++) await login('admin@test.local', 'wrong-password-x');
    expect((await login('admin@test.local', 'test-admin-pass')).status).toBe(429);
    expect((await req(`/api/admin/members/${aid}`, post(mgr, { password: 'brand-new-pass-1' }))).status).toBe(200);
    expect((await login('admin@test.local', 'brand-new-pass-1')).status).toBe(200);
  });

  it('the config row reached by its display name shares the email account\'s counter', async () => {
    const mgr = await adminCookie();
    const row = await env.DB.prepare("SELECT id, username FROM admin_users WHERE email = 'admin@test.local'").first<any>();
    await req(`/api/admin/members/${row.id}`, post(mgr, { password: 'brand-new-pass-1' }));
    // Sign-in lowercases what is typed, so a lowercase display name reaches the row.
    await env.DB.prepare("UPDATE admin_users SET username = 'mainmanager' WHERE id = ?").bind(row.id).run();
    for (let i = 0; i < 3; i++) await login('admin@test.local', 'wrong-password-x');
    for (let i = 0; i < 3; i++) await login('mainmanager', 'wrong-password-x');
    expect((await login('mainmanager', 'brand-new-pass-1')).status).toBe(429);
  });
});

describe('pinned questions can never exceed what each candidate gets', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('support: pinning, enabling or restoring past the count is refused with a clear message', async () => {
    const mgr = await adminCookie();
    const put = (id: string, body: unknown) => req(`/api/admin/questions/${id}`, { method: 'PUT', headers: { Cookie: mgr, Origin: O, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // DSA: 1 per candidate (wrangler.toml default)
    expect((await put('qb-dsa-1', { required: true })).status).toBe(200);
    const r = await put('qb-dsa-2', { required: true });
    expect(r.status).toBe(409);
    expect((await r.json<any>()).error).toMatch(/each candidate gets only 1/);
    // a pinned question that is switched off can't come back on past the limit
    await env.DB.prepare("UPDATE question_bank SET required = 1, active = 0 WHERE id = 'qb-dsa-2'").run();
    expect((await req('/api/admin/questions/qb-dsa-2/toggle-active', post(mgr))).status).toBe(409);
    await env.DB.prepare("UPDATE question_bank SET active = 0, deleted_at = datetime('now') WHERE id = 'qb-dsa-2'").run();
    expect((await req('/api/admin/questions/qb-dsa-2/restore', post(mgr))).status).toBe(409);
    // raising the count makes room
    expect((await req('/api/admin/assessment-length', post(mgr, { counts: { sql: 2, python: 1, dsa: 2, scenario: 1 } }))).status).toBe(200);
    expect((await req('/api/admin/questions/qb-dsa-2/restore', post(mgr))).status).toBe(200);
  });
});

describe('hardening from the run 2 notes', () => {
  beforeEach(async () => { await migrate(); });

  it('CSV formula guard also catches a formula after leading spaces or in full-width', async () => {
    await seedCandidate('x1', 'x1@x.com');
    await env.DB.prepare("UPDATE candidates SET name = '  =HYPERLINK(\"http://e\")', college = '＝1+1' WHERE id = 'x1'").run();
    const mgr = await adminCookie();
    const csv = await (await req('/api/admin/export.csv?format=summary', { headers: { Cookie: mgr } })).text();
    expect(csv).toContain(`"'  =HYPERLINK(""http://e"")"`);
    expect(csv).toContain("'＝1+1");
  });

  it('the copy check sees through accents, full-width letters and invisible joiners', async () => {
    const { copiedFromQuestion } = await import('../src/lib/openai');
    const q = 'The alerting system should notify users about pipeline failures delays and schema changes through email slack and the dashboard';
    const disguised = 'Thé ａlerting sys​tem should notify users about pipeline failures delays and schema changes through email slack and the dashboard';
    expect(copiedFromQuestion(q, disguised).ratio).toBeGreaterThan(0.85);
  });
});
