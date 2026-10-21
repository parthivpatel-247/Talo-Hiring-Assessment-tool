import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, fetchMock, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { migrate, adminCookie, seedCandidate, openAiReply, applySql } from './helpers';
import { bucket, purgeRateLimits, ensureRateLimitTable, networkKey } from '../src/lib/ratelimit';
import { resetEnsureCache, ensureParseClaimCols } from '../src/lib/db';
import d16 from '../migrations-docs/0016_writers_two_part.sql?raw';
import d17 from '../migrations-docs/0017_writers_indexes.sql?raw';
import d18 from '../migrations-docs/0018_rate_limits.sql?raw';
import { MAILTO_ONLY_PDF_B64 } from './fixtures/resumes';

// Sign-in limits, per-request ceilings and parallel resume parsing, on BOTH sites.

const docsEnv = { ...env, TEAM: 'docs', PART1_DURATION_MINUTES: '30', PART2_DURATION_MINUTES: '45', DOCS_PART1_QUESTIONS: '1', DOCS_PART2_QUESTIONS: '1' } as typeof env;

async function call(path: string, init: RequestInit & { ip?: string } = {}, e: any = env): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.ip) headers.set('CF-Connecting-IP', init.ip);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request('https://test.local' + path, { ...init, headers }), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const post = (body: unknown, ip = '10.0.0.1', cookie = '') => ({
  method: 'POST', ip, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
});
const adminLogin = (email: string, password: string, ip = '10.0.0.1', e: any = env) => call('/api/admin/login', post({ email, password }, ip), e);
const candLogin = (email: string, ip = '10.0.0.1', e: any = env) => call('/api/candidate/login', post({ email }, ip), e);
const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];

async function migrateDocs() {
  await migrate();
  await applySql(d16); await applySql(d17); await applySql(d18);
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('docs_start_open', '1')").run();
}

for (const site of ['support', 'writers'] as const) {
  const E: any = site === 'writers' ? docsEnv : env;
  describe(`${site} site — sign-in limits`, () => {
    beforeEach(async () => { await (site === 'writers' ? migrateDocs() : migrate()); });

    it('5 wrong passwords for one account pause it on that network only', async () => {
      for (let i = 1; i <= 4; i++) {
        const r = await adminLogin('admin@test.local', 'wrong', '10.0.0.1', E);
        expect(r.status).toBe(401);
        const b = await r.json<any>();
        if (i >= 3) expect(b.error).toMatch(/more tr(y|ies) before sign-in is paused/);
      }
      const fifth = await adminLogin('admin@test.local', 'wrong', '10.0.0.1', E);
      expect(fifth.status).toBe(429);
      expect(Number(fifth.headers.get('Retry-After'))).toBeGreaterThan(800);
      // Even the RIGHT password is refused during the pause (guessing can't continue)…
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.0.0.1', E)).status).toBe(429);
      // …but the real manager on another network is not locked out.
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.0.0.2', E)).status).toBe(200);
      // A pause is recorded in the activity log.
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'admin_signin_paused'").first<{ n: number }>();
      expect(n?.n).toBe(1);
    });

    it('a good sign-in resets that network\'s count for the account', async () => {
      for (let i = 0; i < 4; i++) await adminLogin('admin@test.local', 'wrong', '10.0.0.3', E);
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.0.0.3', E)).status).toBe(200);
      for (let i = 0; i < 4; i++) expect((await adminLogin('admin@test.local', 'wrong', '10.0.0.3', E)).status).toBe(401);
    });

    it('20 wrong sign-ins from one network (any accounts) pause that network', async () => {
      for (let i = 0; i < 19; i++) expect((await adminLogin(`nobody${i}@x.com`, 'wrong', '10.0.0.4', E)).status).toBe(401);
      expect((await adminLogin('nobody19@x.com', 'wrong', '10.0.0.4', E)).status).toBe(429);
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.0.0.4', E)).status).toBe(429);
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.0.0.5', E)).status).toBe(200);
    });

    it('50 wrong passwords for one account spread across networks pause it everywhere', async () => {
      for (let i = 0; i < 49; i++) expect((await adminLogin('admin@test.local', 'wrong', `10.1.${i}.1`, E)).status).toBe(401);
      expect((await adminLogin('admin@test.local', 'wrong', '10.1.99.1', E)).status).toBe(429);
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.2.0.1', E)).status).toBe(429);
    });

    it('a manager setting a new password lifts the pause on that account', async () => {
      const mgr = cookieOf(await adminLogin('admin@test.local', 'test-admin-pass', '10.9.9.9', E));
      expect((await call('/api/admin/members', post({ email: 'pm@x.com', name: 'PM', password: 'first-pass', role: 'member' }, '10.9.9.9', mgr), E)).status).toBe(200);
      for (let i = 0; i < 5; i++) await adminLogin('pm@x.com', 'wrong', '10.0.0.6', E);
      expect((await adminLogin('pm@x.com', 'first-pass', '10.0.0.6', E)).status).toBe(429);
      const { id } = (await env.DB.prepare("SELECT id FROM admin_users WHERE email = 'pm@x.com'").first<{ id: string }>())!;
      expect((await call(`/api/admin/members/${id}`, post({ password: 'second-pass' }, '10.9.9.9', mgr), E)).status).toBe(200);
      expect((await adminLogin('pm@x.com', 'second-pass', '10.0.0.6', E)).status).toBe(200);
    });

    it('guesses sent all at once still get only 5 tries', async () => {
      const rs = await Promise.all(Array.from({ length: 12 }, () => adminLogin('admin@test.local', 'wrong', '10.0.1.1', E)));
      const codes = rs.map((r) => r.status);
      expect(codes.filter((c) => c === 401)).toHaveLength(4);
      expect(codes.filter((c) => c === 429)).toHaveLength(8);
    });

    it('a counter whose window has passed starts again from zero', async () => {
      await ensureRateLimitTable(E);
      const old = Math.floor(Date.now() / 1000) - 16 * 60;
      for (const kind of ['adm-ipacct', 'adm-ip']) {
        const b = kind === 'adm-ip' ? await bucket(E, kind, '10.0.1.2') : await bucket(E, kind, 'e:admin@test.local', '10.0.1.2');
        await env.DB.prepare('INSERT INTO rate_limits (bucket, count, window_start, blocked_until) VALUES (?, 19, ?, ?)').bind(b, old, old + 60).run();
      }
      const r = await adminLogin('admin@test.local', 'wrong', '10.0.1.2', E);
      expect(r.status).toBe(401);
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.0.1.2', E)).status).toBe(200);
    });

    it('a browser that signed in before is not locked out by others on the same network', async () => {
      const ok = await adminLogin('admin@test.local', 'test-admin-pass', '10.0.1.3', E);
      const setCookies = ok.headers.getSetCookie();
      const dev = setCookies.find((c) => c.startsWith('chs_admin_dev='))!;
      expect(dev).toMatch(/Path=\/api\/admin\/login; HttpOnly; Secure; SameSite=Strict/);
      const devCookie = dev.split(';')[0];
      // Someone on the same network: 20 wrong sign-ins pause the network, then 5 more
      // for the manager's own email pause the account on this network.
      for (let i = 0; i < 20; i++) await adminLogin(`x${i}@x.com`, 'wrong', '10.0.1.3', E);
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.0.1.3', E)).status).toBe(429);
      // The manager's own browser still gets in…
      const mine = (pw: string) => call('/api/admin/login', { ...post({ email: 'admin@test.local', password: pw }, '10.0.1.3'), headers: { 'Content-Type': 'application/json', Cookie: devCookie } }, E);
      expect((await mine('test-admin-pass')).status).toBe(200);
      // …and has its own limit: 10 wrong passwords pause that browser.
      for (let i = 0; i < 9; i++) expect((await mine('wrong')).status).toBe(401);
      expect((await mine('wrong')).status).toBe(429);
      // A device cookie for one account does nothing for another account.
      expect((await call('/api/admin/login', { ...post({ email: 'panel@test.local', password: 'test-panel-pass' }, '10.0.1.3'), headers: { 'Content-Type': 'application/json', Cookie: devCookie } }, E)).status).toBe(429);
    });

    it('a manager can lift every pause; panel members cannot', async () => {
      for (let i = 0; i < 20; i++) await adminLogin(`y${i}@x.com`, 'wrong', '10.0.1.4', E);
      await seedCandidate('lp1', 'lp1@college.edu', 'part2_ready');
      await env.DB.prepare('INSERT INTO rate_limits (bucket, count, window_start, blocked_until) VALUES (?, 200, ?, ?)')
        .bind(await bucket(E, 'cand-ip', '10.0.1.4'), Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 600).run();
      expect((await candLogin('lp1@college.edu', '10.0.1.4', E)).status).toBe(429);
      const mgr = cookieOf(await adminLogin('admin@test.local', 'test-admin-pass', '10.0.1.5', E));
      const cfg = await (await call('/api/admin/config', { headers: { Cookie: mgr } }, E)).json<any>();
      expect(cfg.signinPauses).toBe(2);
      const panel = cookieOf(await adminLogin('panel@test.local', 'test-panel-pass', '10.0.1.6', E));
      expect((await call('/api/admin/signin-pauses/clear', post({}, '10.0.1.6', panel), E)).status).toBe(403);
      expect((await call('/api/admin/signin-pauses/clear', post({}, '10.0.1.5', mgr), E)).status).toBe(200);
      expect((await candLogin('lp1@college.edu', '10.0.1.4', E)).status).toBe(200);
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.0.1.4', E)).status).toBe(200);
    });

    it('IPv6 addresses in one /64 count as one network', async () => {
      for (let i = 0; i < 19; i++) expect((await adminLogin(`v6${i}@x.com`, 'wrong', `2001:db8:1:2::${(i + 1).toString(16)}`, E)).status).toBe(401);
      expect((await adminLogin('v6last@x.com', 'wrong', '2001:db8:1:2:ffff:ffff:ffff:fffe', E)).status).toBe(429);
      expect((await adminLogin('admin@test.local', 'test-admin-pass', '2001:db8:1:3::1', E)).status).toBe(200);
    });

    it('a sign-in with an unknown email writes one counter, not three', async () => {
      await adminLogin('nobody@nowhere.com', 'wrong', '10.0.1.7', E);
      expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_limits').first<{ n: number }>())?.n).toBe(1);
    });

    it('candidate sign-in: many unknown emails from one network pause it; known emails elsewhere still work', async () => {
      await seedCandidate('rl1', 'real@college.edu', 'part2_ready');
      await ensureRateLimitTable(E);
      // 199 unknown-email sign-ins already counted for this network:
      await env.DB.prepare('INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 199, ?)')
        .bind(await bucket(E, 'cand-ip', '10.0.0.7'), Math.floor(Date.now() / 1000)).run();
      const r = await candLogin('guess@college.edu', '10.0.0.7', E);
      expect(r.status).toBe(429);
      expect((await r.json<any>()).error).toMatch(/invigilator/);
      expect((await candLogin('real@college.edu', '10.0.0.7', E)).status).toBe(429);
      expect((await candLogin('real@college.edu', '10.0.0.8', E)).status).toBe(200);
    });

    it('a typo is not punished: a single unknown email just gets the normal message', async () => {
      const r = await candLogin('typo@college.edu', '10.0.0.9', E);
      expect(r.status).toBe(403);
    });

    it('stores only hashes, never a raw email or IP', async () => {
      await adminLogin('admin@test.local', 'wrong', '10.0.0.10', E);
      await candLogin('who@college.edu', '10.0.0.10', E);
      const rows = (await env.DB.prepare('SELECT bucket FROM rate_limits').all<{ bucket: string }>()).results ?? [];
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) { expect(r.bucket).not.toMatch(/@|10\.0\.0/); expect(r.bucket).toMatch(/^[a-z-]+(:[0-9a-f]{32})+$/); }
    });

    it('bad or missing sign-in bodies get a 400, not a server error', async () => {
      for (const path of ['/api/admin/login', '/api/candidate/login']) {
        const r = await call(path, { method: 'POST', ip: '10.0.0.11', headers: { 'Content-Type': 'application/json' }, body: '{not json' }, E);
        expect(r.status).toBe(400);
      }
      expect((await call('/api/candidate/login', post({ email: 42 }, '10.0.0.11'), E)).status).toBe(400);
    });
  });
}

describe('networks', () => {
  it('IPv4 is used as is and IPv6 is reduced to its /64', () => {
    expect(networkKey('203.0.113.9')).toBe('203.0.113.9');
    expect(networkKey('2001:db8:1:2::a')).toBe('2001:0db8:0001:0002::/64');
    expect(networkKey('2001:DB8:1:2:ffff:ffff:ffff:fffe'.toLowerCase())).toBe('2001:0db8:0001:0002::/64');
    expect(networkKey('::1')).toBe('0000:0000:0000:0000::/64');
  });
  it('a client-supplied X-Forwarded-For header is ignored', async () => {
    await migrate();
    for (let i = 0; i < 20; i++) await call('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.8.0.1', 'X-Forwarded-For': `10.9.${i}.1` }, body: JSON.stringify({ email: `z${i}@x.com`, password: 'w' }) });
    expect((await adminLogin('admin@test.local', 'test-admin-pass', '10.8.0.1')).status).toBe(429);
  });
});

describe('per-request ceilings (Workers Rate Limiting bindings)', () => {
  beforeEach(async () => { await migrate(); });
  const deny = { limit: async () => ({ success: false }) };
  const broken = { limit: async () => { throw new Error('limiter down'); } };

  it('the network ceiling applies to every API call', async () => {
    const r = await call('/api/health', { ip: '10.3.0.1' }, { ...env, RL_IP: deny });
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('10');
    expect((await r.json<any>()).rateLimited).toBe(true);
  });

  it('the candidate and admin ceilings key on the sign-in cookie', async () => {
    await seedCandidate('rq1', 'rq1@x.com', 'part2_ready');
    const cand = cookieOf(await candLogin('rq1@x.com'));
    expect((await call('/api/candidate/me', { headers: { Cookie: cand } }, { ...env, RL_CANDIDATE: deny })).status).toBe(429);
    expect((await call('/api/candidate/me', { headers: { Cookie: cand } }, { ...env, RL_ADMIN: deny })).status).toBe(200);
    const admin = await adminCookie();
    expect((await call('/api/admin/candidates', { headers: { Cookie: admin } }, { ...env, RL_ADMIN: deny })).status).toBe(429);
  });

  it('a limiter that fails lets the request through (never blocks a test)', async () => {
    expect((await call('/api/health', {}, { ...env, RL_IP: broken, RL_CANDIDATE: broken, RL_ADMIN: broken })).status).toBe(200);
    expect((await call('/api/health', {}, env)).status).toBe(200); // no bindings configured
  });

  it('the daily cleanup deletes counters more than a day old', async () => {
    await ensureRateLimitTable(env);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)').bind('old:1', now - 2 * 86400),
      env.DB.prepare('INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)').bind('new:1', now),
    ]);
    await purgeRateLimits(env);
    const left = (await env.DB.prepare('SELECT bucket FROM rate_limits').all<{ bucket: string }>()).results?.map((r) => r.bucket);
    expect(left).toEqual(['new:1']);
  });

  it('the rate_limits table is created by the Worker even if the migration was never applied', async () => {
    await env.DB.prepare('DROP TABLE rate_limits').run();
    resetEnsureCache();
    expect((await adminLogin('admin@test.local', 'wrong', '10.4.0.1')).status).toBe(401);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_limits').first<{ n: number }>())?.n).toBe(3);
  });
});

function bytes(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

for (const site of ['support', 'writers'] as const) {
  describe(`${site} site — parallel resume parsing`, () => {
    const E: any = { ...(site === 'writers' ? docsEnv : env), RESUME_PROCESS_BATCH: '2', RESUME_PARSE_CONCURRENCY: '2' };
    beforeEach(async () => { await (site === 'writers' ? migrateDocs() : migrate()); fetchMock.activate(); fetchMock.disableNetConnect(); });
    afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } catch {} });

    async function upload(id: string) {
      await env.RESUMES.put(`resumes/${id}.pdf`, bytes(MAILTO_ONLY_PDF_B64));
      await env.DB.prepare("INSERT INTO candidates (id, email, resume_r2_key, resume_filename, status) VALUES (?, ?, ?, ?, 'uploaded')")
        .bind(id, `pending+${id}@unresolved.local`, `resumes/${id}.pdf`, `${id}.pdf`).run();
    }

    it('requests running at the same time each parse different resumes (none twice)', async () => {
      for (const id of ['p1', 'p2', 'p3', 'p4']) await upload(id);
      // Exactly 4 OpenAI calls are allowed: a resume parsed twice would need a 5th.
      fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
        .reply(200, openAiReply({ name: 'Asha Kulkarni', email: 'asha.k@college.edu', skills: [], projects: [] })).times(4);
      const admin = cookieOf(await adminLogin('admin@test.local', 'test-admin-pass', '10.5.0.1', E));
      const proc = () => call('/api/admin/resumes/process', { method: 'POST', headers: { Cookie: admin } }, E).then((r) => r.json<any>());
      const [a, b, c] = await Promise.all([proc(), proc(), proc()]);
      const ids = [...a.processed, ...b.processed, ...c.processed].map((p: any) => p.id).sort();
      expect(ids).toEqual(['p1', 'p2', 'p3', 'p4']);
      expect(a.claimed + b.claimed + c.claimed).toBe(4);
      // All four carry the same email: exactly one wins, the rest get a clear duplicate message.
      const all = [...a.processed, ...b.processed, ...c.processed];
      expect(all.filter((p: any) => p.ok)).toHaveLength(1);
      for (const f of all.filter((p: any) => !p.ok)) {
        expect(f.error).toMatch(/already used by another candidate|more than one resume/);
        expect(f.error).not.toMatch(/UNIQUE|SQLITE|D1_/);
      }
      const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM candidates WHERE status = 'uploaded' OR parse_claim IS NOT NULL").first<{ n: number }>();
      expect(left?.n).toBe(0);
    });

    it('a resume another request is parsing right now is left alone, and reported as in flight', async () => {
      await upload('q1');
      await ensureParseClaimCols(env);
      await env.DB.prepare("UPDATE candidates SET parse_claim = 'other', parse_claimed_at = datetime('now') WHERE id = 'q1'").run();
      const admin = cookieOf(await adminLogin('admin@test.local', 'test-admin-pass', '10.5.0.2', E));
      const r = await (await call('/api/admin/resumes/process', { method: 'POST', headers: { Cookie: admin } }, E)).json<any>();
      expect(r.claimed).toBe(0);
      expect(r.remainingToProcess).toBe(1);
      expect(r.inFlight).toBe(1);
    });

    it('a slow request whose resume was taken over does not overwrite the result', async () => {
      await upload('t1');
      const admin = cookieOf(await adminLogin('admin@test.local', 'test-admin-pass', '10.5.0.4', E));
      fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
        .reply(200, openAiReply({ name: 'Asha Kulkarni', email: 'asha.k@college.edu', skills: [], projects: [] })).delay(400);
      const slow = call('/api/admin/resumes/process', { method: 'POST', headers: { Cookie: admin } }, E).then((r) => r.json<any>());
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 20));
        const row = await env.DB.prepare("SELECT parse_claim FROM candidates WHERE id = 't1'").first<any>().catch(() => null);
        if (row?.parse_claim) break;
      }
      await env.DB.prepare("UPDATE candidates SET parse_claim = 'newer' WHERE id = 't1'").run(); // the takeover
      const r = await slow;
      expect(r.processed[0]).toMatchObject({ ok: false, skipped: true });
      const row = await env.DB.prepare("SELECT status, parse_claim FROM candidates WHERE id = 't1'").first<any>();
      expect(row).toEqual({ status: 'uploaded', parse_claim: 'newer' });
    });

    it('a resume claimed 3 times without finishing is marked failed with a clear reason', async () => {
      await upload('u1');
      await ensureParseClaimCols(env);
      await env.DB.prepare("UPDATE candidates SET parse_attempts = 3, parse_claim = 'dead', parse_claimed_at = datetime('now', '-11 minutes') WHERE id = 'u1'").run();
      const admin = cookieOf(await adminLogin('admin@test.local', 'test-admin-pass', '10.5.0.5', E));
      const r = await (await call('/api/admin/resumes/process', { method: 'POST', headers: { Cookie: admin } }, E)).json<any>();
      expect(r.processed[0].ok).toBe(false);
      expect(r.processed[0].error).toMatch(/could not be read after 3 tries/);
      expect((await env.DB.prepare("SELECT status FROM candidates WHERE id = 'u1'").first<any>()).status).toBe('parse_failed');
    });

    it('a claim left by a request that died is taken over after 10 minutes', async () => {
      await upload('s1');
      const admin = cookieOf(await adminLogin('admin@test.local', 'test-admin-pass', '10.5.0.3', E));
      fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
        .reply(200, openAiReply({ name: 'Asha Kulkarni', email: 'asha.k@college.edu', skills: [], projects: [] }));
      // First call creates the claim columns and parses s1; reset it to a stale claim.
      await call('/api/admin/resumes/process', { method: 'POST', headers: { Cookie: admin } }, E);
      await env.DB.prepare("UPDATE candidates SET status = 'uploaded', email = 'pending+s1@unresolved.local', parse_claim = 'dead', parse_claimed_at = datetime('now', '-11 minutes') WHERE id = 's1'").run();
      fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
        .reply(200, openAiReply({ name: 'Asha Kulkarni', email: 'asha.k@college.edu', skills: [], projects: [] }));
      const r = await (await call('/api/admin/resumes/process', { method: 'POST', headers: { Cookie: admin } }, E)).json<any>();
      expect(r.claimed).toBe(1);
      expect(r.processed[0].ok).toBe(true);
      expect(r.remainingToProcess).toBe(0);
    });
  });
}
