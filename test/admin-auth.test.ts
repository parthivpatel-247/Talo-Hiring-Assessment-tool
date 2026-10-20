import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import { fresh, req, cookieOf, managerCookie, memberCookie, BOOT, MANAGER_PASSWORD } from './helpers';

const login = (email: string, password: string) => req('/api/admin/auth/login', { method: 'POST', json: { email, password } });

describe('admin sign-in', () => {
  beforeEach(async () => { await fresh(); });

  it('first-run setup: bootstrap password opens setup only, then stops working', async () => {
    const status = await (await req('/api/admin/auth/status')).json<any>();
    expect(status.setupRequired).toBe(true);
    const r1 = await (await login(BOOT.email, BOOT.password)).json<any>();
    expect(r1.next).toBe('setup');
    const weak = await req('/api/admin/auth/setup', { method: 'POST', json: { token: r1.token, name: 'Parthiv', password: 'short' } });
    expect(weak.status).toBe(400);
    expect((await weak.json<any>()).code).toBe('weak_password');
    const ok = await req('/api/admin/auth/setup', { method: 'POST', json: { token: r1.token, name: 'Parthiv', password: MANAGER_PASSWORD } });
    expect(ok.status).toBe(200);
    expect(cookieOf(ok, '__Host-talo_admin')).toBeTruthy();
    expect(ok.headers.get('Set-Cookie')).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    expect((await login(BOOT.email, BOOT.password)).status).toBe(401);
    expect((await login(BOOT.email, MANAGER_PASSWORD)).status).toBe(200);
  });

  it('locks the account after 5 wrong passwords (same message for unknown emails)', async () => {
    await managerCookie();
    const unknown = await login('nobody@test.local', 'whatever-password');
    const wrong = await login(BOOT.email, 'wrong-password-1');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect((await unknown.json<any>()).error).toBe((await wrong.json<any>()).error);
    for (let i = 2; i <= 4; i++) expect((await login(BOOT.email, `wrong-password-${i}`)).status).toBe(401);
    const fifth = await login(BOOT.email, 'wrong-password-5');
    expect(fifth.status).toBe(429);
    // Even the right password is refused while locked.
    const right = await login(BOOT.email, MANAGER_PASSWORD);
    expect(right.status).toBe(429);
    expect((await right.json<any>()).code).toBe('locked');
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('login_failed','account_locked')").first<any>();
    expect(audit.n).toBeGreaterThanOrEqual(5);
  });

  it('rejects non-string and oversized input with 400, never 500', async () => {
    for (const body of [{ email: ['x'], password: 'y' }, { email: { a: 1 }, password: 'y' }, { email: 'a@b.co', password: 12 }]) {
      const r = await req('/api/admin/auth/login', { method: 'POST', json: body });
      expect(r.status).toBe(400);
    }
    const big = await req('/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(10_000) }) });
    expect([400, 413]).toContain(big.status);
    const notJson = await req('/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    expect(notJson.status).toBe(400);
  });

  it('members: temporary password forces a change; members cannot use manager routes', async () => {
    const mgr = await managerCookie();
    const mem = await memberCookie(mgr);
    expect(mem).toBeTruthy();
    expect((await req('/api/admin/candidates', { headers: { Cookie: mem } })).status).toBe(200);
    expect((await req('/api/admin/members', { headers: { Cookie: mem } })).status).toBe(403);
    const patch = await req('/api/admin/settings', { method: 'PATCH', headers: { Cookie: mem }, json: { assessmentMinutes: 30 } });
    expect(patch.status).toBe(403);
  });

  it('a deactivated member is signed out immediately', async () => {
    const mgr = await managerCookie();
    const mem = await memberCookie(mgr, 'gone@test.local');
    expect((await req('/api/admin/candidates', { headers: { Cookie: mem } })).status).toBe(200);
    const list = await (await req('/api/admin/members', { headers: { Cookie: mgr } })).json<any>();
    const id = list.members.find((m: any) => m.email === 'gone@test.local').id;
    expect((await req(`/api/admin/members/${id}`, { method: 'PATCH', headers: { Cookie: mgr }, json: { active: false } })).status).toBe(200);
    expect((await req('/api/admin/candidates', { headers: { Cookie: mem } })).status).toBe(401);
  });

  it('cannot remove or demote the last manager', async () => {
    const mgr = await managerCookie();
    const me = await (await req('/api/admin/auth/me', { headers: { Cookie: mgr } })).json<any>();
    expect((await req(`/api/admin/members/${me.user.id}`, { method: 'PATCH', headers: { Cookie: mgr }, json: { role: 'member' } })).status).toBe(403);
  });

  it('changing your password signs out your other sessions', async () => {
    const a = await managerCookie();
    const b = cookieOf(await login(BOOT.email, MANAGER_PASSWORD), '__Host-talo_admin');
    const r = await req('/api/admin/account/password', { method: 'POST', headers: { Cookie: a }, json: { currentPassword: MANAGER_PASSWORD, newPassword: 'Another-strong-pass-99' } });
    expect(r.status).toBe(200);
    expect((await req('/api/admin/auth/me', { headers: { Cookie: a } })).status).toBe(200);
    expect((await req('/api/admin/auth/me', { headers: { Cookie: b } })).status).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const a = await managerCookie();
    await req('/api/admin/auth/logout', { method: 'POST', headers: { Cookie: a } });
    expect((await req('/api/admin/auth/me', { headers: { Cookie: a } })).status).toBe(401);
  });
});

describe('admin two-step sign-in and password reset (email)', () => {
  const sent: any[] = [];
  beforeEach(async () => {
    (env as any).EMAIL_PROVIDER = 'resend';
    (env as any).EMAIL_API_KEY = 'test-key';
    (env as any).EMAIL_FROM = 'Talo <talo@test.local>';
    sent.length = 0;
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get('https://api.resend.com').intercept({ path: '/emails', method: 'POST' }).reply(200, (opts: any) => { sent.push(JSON.parse(String(opts.body))); return { id: 'e1' }; }).persist();
    await fresh();
  });
  afterEach(() => {
    (env as any).EMAIL_PROVIDER = '';
    (env as any).EMAIL_API_KEY = undefined;
    (env as any).EMAIL_FROM = '';
    fetchMock.deactivate();
  });

  it('requires the emailed 6-digit code after the password', async () => {
    await managerCookie(); // setup signs in directly
    const r = await (await login(BOOT.email, MANAGER_PASSWORD)).json<any>();
    expect(r.next).toBe('code');
    expect(r.emailHint).toMatch(/@test\.local$/);
    const code = String(sent.at(-1).text).match(/\b(\d{6})\b/)![1];
    const bad = await req('/api/admin/auth/verify', { method: 'POST', json: { token: r.token, code: code === '000000' ? '111111' : '000000' } });
    expect(bad.status).toBe(401);
    const good = await req('/api/admin/auth/verify', { method: 'POST', json: { token: r.token, code } });
    expect(good.status).toBe(200);
    expect(cookieOf(good, '__Host-talo_admin')).toBeTruthy();
    // A code works once.
    expect((await req('/api/admin/auth/verify', { method: 'POST', json: { token: r.token, code } })).status).toBe(401);
  });

  it('forgot password: same answer for unknown emails; the link resets once', async () => {
    await managerCookie();
    const unknown = await (await req('/api/admin/auth/forgot', { method: 'POST', json: { email: 'nobody@test.local' } })).json<any>();
    const known = await (await req('/api/admin/auth/forgot', { method: 'POST', json: { email: BOOT.email } })).json<any>();
    expect(unknown.message).toBe(known.message);
    const link = String(sent.at(-1).text).match(/c=(ch_[A-Za-z0-9]+)&t=([A-Za-z0-9_-]+)/)!;
    const reset = await req('/api/admin/auth/reset', { method: 'POST', json: { challengeId: link[1], token: link[2], password: 'Brand-new-pass-2026' } });
    expect(reset.status).toBe(200);
    expect((await req('/api/admin/auth/reset', { method: 'POST', json: { challengeId: link[1], token: link[2], password: 'Brand-new-pass-2027' } })).status).toBe(400);
    const r = await (await login(BOOT.email, 'Brand-new-pass-2026')).json<any>();
    expect(r.next).toBe('code');
  });
});
