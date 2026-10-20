import type { Router } from '../../router';
import type { Ctx } from '../../lib/context';
import type { AdminUserRow } from '../../env';
import { json, readJson, str, email as emailField, HttpError, bad, unauthorized, forbidden } from '../../lib/http';
import { enforce, hit, block, clear, humanWait } from '../../lib/ratelimit';
import { verifyTurnstile, turnstileEnabled } from '../../lib/turnstile';
import { hashPassword, verifyPassword, passwordProblem } from '../../lib/passwords';
import { createAdminSession, signToken, verifyToken, revokeAdminSession, revokeAllAdminSessions, clearCookie, ADMIN_COOKIE, loadAdmin } from '../../lib/sessions';
import { safeEqual, hashCode, randomDigits, randomToken, sha256Hex } from '../../lib/security';
import { emailConfigured, sendEmail, adminCodeEmail, resetEmail, maskEmail } from '../../lib/email';
import { getSettings } from '../../lib/settings';
import { audit } from '../../lib/audit';
import { track } from '../../lib/telemetry';
import { newId } from '../../db/db';

const WRONG = 'Wrong email or password.';
const LOCK_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;

/** Setup is open only while NO manager account has ever been created (active or not). */
async function managerCount(ctx: Ctx): Promise<number> {
  return Number((await ctx.db.value<number>("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'manager'")) ?? 0);
}

export function appOrigin(ctx: Ctx): string {
  return (ctx.env.APP_ORIGIN || ctx.url.origin).replace(/\/$/, '');
}

async function twoFactorOn(ctx: Ctx): Promise<boolean> {
  const s = await getSettings(ctx.env, ctx.db);
  return s.admin2fa === 'email' && emailConfigured(ctx.env);
}

/** After the password (and any forced change) is done: send a code, or sign in. */
async function nextStep(ctx: Ctx, user: AdminUserRow): Promise<Response> {
  if (await twoFactorOn(ctx)) {
    const code = randomDigits(6);
    const challengeId = newId('ch');
    await ctx.db.batch([
      ctx.db.stmt("UPDATE auth_challenges SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE purpose = 'admin_login' AND subject_id = ? AND consumed_at IS NULL", user.id),
      ctx.db.stmt('INSERT INTO auth_challenges (id, purpose, subject_id, code_hash, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?)',
        challengeId, 'admin_login', user.id, await hashCode(ctx.env, 'admin_login', user.id, code), new Date(Date.now() + 10 * 60_000).toISOString(), ctx.ip),
    ]);
    const s = await getSettings(ctx.env, ctx.db);
    const sent = await sendEmail(ctx.env, { to: user.email, ...adminCodeEmail(s.orgName, user.name, code) });
    if (!sent.ok) throw new HttpError(503, 'We could not send your sign-in code. Try again in a minute, or ask your manager to check the email settings.', 'email_failed');
    return json({ next: 'code', token: await signToken(ctx.env, { k: '2fa', u: user.id, c: challengeId }, 600), emailHint: maskEmail(user.email) });
  }
  return finishLogin(ctx, user);
}

async function finishLogin(ctx: Ctx, user: AdminUserRow): Promise<Response> {
  ctx.cookies.push(await createAdminSession(ctx.db, user.id, user.role, ctx.ip, ctx.ua));
  ctx.admin = { userId: user.id, email: user.email, name: user.name, role: user.role, tokenHash: '', mustChangePassword: false };
  await audit(ctx, 'login', { type: 'admin_user', id: user.id });
  await track(ctx.db, 'admin_login');
  return json({ next: 'done', role: user.role, name: user.name });
}

async function setPassword(ctx: Ctx, userId: string, password: string, extraSql = ''): Promise<void> {
  const { salt, hash, iterations } = await hashPassword(password);
  await ctx.db.run(
    `UPDATE admin_users SET pass_salt = ?, pass_hash = ?, pass_iterations = ?, must_change_password = 0,
       password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')${extraSql}
     WHERE id = ?`,
    salt, hash, iterations, userId
  );
}

function checkPassword(password: string, context: { email?: string; name?: string }): void {
  const problem = passwordProblem(password, context);
  if (problem) throw bad(problem, 'weak_password', { field: 'password' });
}

export function registerAdminAuth(r: Router): void {
  r.add('GET', '/api/admin/auth/status', 'public', async (ctx) => {
    return json({
      setupRequired: (await managerCount(ctx)) === 0,
      emailEnabled: emailConfigured(ctx.env),
      twoFactor: await twoFactorOn(ctx),
      turnstileSiteKey: turnstileEnabled(ctx.env) ? ctx.env.TURNSTILE_SITE_KEY : null,
    });
  });

  r.add('POST', '/api/admin/auth/login', 'public', async (ctx) => {
    const body = await readJson(ctx.request, 4096);
    const email = emailField(body);
    const password = str(body, 'password', { max: 256, trim: false, label: 'Password' });
    await enforce(ctx.db, `adm-login-ip:${ctx.ip}`, 30, 900);
    await verifyTurnstile(ctx.env, body.turnstileToken, ctx.ip);

    const lockBucket = `adm-fail:${email}`;
    const lock = await ctx.db.first<{ blocked_until: number | null }>('SELECT blocked_until FROM rate_limits WHERE bucket = ?', lockBucket);
    const now = Math.floor(Date.now() / 1000);
    if (lock?.blocked_until && lock.blocked_until > now) {
      throw new HttpError(429, `Too many failed attempts. Sign-in for this account is paused for ${humanWait(lock.blocked_until - now)}.`, 'locked', { retryAfter: lock.blocked_until - now });
    }

    // First-run setup: only while no manager account exists.
    if ((await managerCount(ctx)) === 0) {
      const bootEmail = (ctx.env.ADMIN_EMAIL || '').trim().toLowerCase();
      if (bootEmail && ctx.env.ADMIN_PASSWORD && email === bootEmail && safeEqual(password, ctx.env.ADMIN_PASSWORD)) {
        await clear(ctx.db, lockBucket);
        return json({ next: 'setup', token: await signToken(ctx.env, { k: 'setup', e: email }, 900), email });
      }
    }

    const user = await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE email = ?', email);
    const ok = await verifyPassword(password, user?.pass_salt ?? null, user?.pass_hash ?? null, user?.pass_iterations);
    if (!user || !ok || !user.active) {
      const f = await hit(ctx.db, lockBucket, LOCK_FAILURES, LOCK_SECONDS);
      if (user) {
        await ctx.db.run('UPDATE admin_users SET failed_logins = failed_logins + 1 WHERE id = ?', user.id);
        await ctx.db.run(
          "INSERT INTO audit_log (actor_email, action, target_type, target_id, detail, ip) VALUES (?, 'login_failed', 'admin_user', ?, ?, ?)",
          email, user.id, JSON.stringify({ attempt: f.count }), ctx.ip
        );
      }
      if (!f.ok || f.count >= LOCK_FAILURES) {
        await block(ctx.db, lockBucket, LOCK_SECONDS);
        if (user) {
          await ctx.db.run('UPDATE admin_users SET locked_until = ? WHERE id = ?', new Date(Date.now() + LOCK_SECONDS * 1000).toISOString(), user.id);
          await ctx.db.run("INSERT INTO audit_log (actor_email, action, target_type, target_id, ip) VALUES (?, 'account_locked', 'admin_user', ?, ?)", email, user.id, ctx.ip);
        }
        throw new HttpError(429, `Too many failed attempts. Sign-in for this account is paused for ${humanWait(LOCK_SECONDS)}.`, 'locked', { retryAfter: LOCK_SECONDS });
      }
      throw new HttpError(401, WRONG, 'invalid_login');
    }
    await clear(ctx.db, lockBucket);
    await ctx.db.run('UPDATE admin_users SET failed_logins = 0, locked_until = NULL WHERE id = ?', user.id);
    if (user.must_change_password) {
      return json({ next: 'change_password', token: await signToken(ctx.env, { k: 'pwchange', u: user.id }, 900) });
    }
    return nextStep(ctx, user);
  });

  // First manager account (replaces the old permanent bootstrap password).
  r.add('POST', '/api/admin/auth/setup', 'public', async (ctx) => {
    const body = await readJson(ctx.request, 4096);
    const t = await verifyToken<{ k: string; e: string }>(ctx.env, body.token);
    if (!t || t.k !== 'setup') throw unauthorized('Your setup session expired. Sign in with the setup password again.');
    if ((await managerCount(ctx)) > 0) throw forbidden('Setup is already complete. Sign in with your account.');
    const name = str(body, 'name', { min: 2, max: 80, label: 'Your name' });
    const password = str(body, 'password', { max: 128, trim: false, label: 'Password' });
    checkPassword(password, { email: t.e, name });
    const { salt, hash, iterations } = await hashPassword(password);
    const id = newId('usr');
    await ctx.db.run(
      `INSERT INTO admin_users (id, email, name, role, pass_hash, pass_salt, pass_iterations, email_verified_at, password_changed_at, created_by)
       VALUES (?, ?, ?, 'manager', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup')
       ON CONFLICT(email) DO UPDATE SET role = 'manager', active = 1, name = excluded.name, pass_hash = excluded.pass_hash,
         pass_salt = excluded.pass_salt, pass_iterations = excluded.pass_iterations, must_change_password = 0,
         password_changed_at = excluded.password_changed_at`,
      id, t.e, name, hash, salt, iterations
    );
    const user = (await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE email = ?', t.e))!;
    ctx.admin = { userId: user.id, email: user.email, name: user.name, role: 'manager', tokenHash: '', mustChangePassword: false };
    await audit(ctx, 'setup_complete', { type: 'admin_user', id: user.id }, 'First manager account created; the setup password no longer works.');
    return finishLogin(ctx, user);
  });

  r.add('POST', '/api/admin/auth/change-password', 'public', async (ctx) => {
    const body = await readJson(ctx.request, 4096);
    const t = await verifyToken<{ k: string; u: string }>(ctx.env, body.token);
    if (!t || t.k !== 'pwchange') throw unauthorized('That step expired. Sign in again.');
    const user = await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE id = ? AND active = 1', t.u);
    if (!user) throw unauthorized();
    const password = str(body, 'password', { max: 128, trim: false, label: 'New password' });
    checkPassword(password, { email: user.email, name: user.name });
    if (await verifyPassword(password, user.pass_salt, user.pass_hash, user.pass_iterations)) throw bad('Choose a password different from your current one.', 'same_password');
    await setPassword(ctx, user.id, password);
    await revokeAllAdminSessions(ctx.db, user.id);
    ctx.admin = { userId: user.id, email: user.email, name: user.name, role: user.role, tokenHash: '', mustChangePassword: false };
    await audit(ctx, 'password_changed', { type: 'admin_user', id: user.id }, 'Required change at sign-in');
    return nextStep(ctx, { ...user, must_change_password: 0 });
  });

  r.add('POST', '/api/admin/auth/verify', 'public', async (ctx) => {
    const body = await readJson(ctx.request, 2048);
    const t = await verifyToken<{ k: string; u: string; c: string }>(ctx.env, body.token);
    if (!t || t.k !== '2fa') throw unauthorized('That code expired. Sign in again to get a new one.');
    const code = str(body, 'code', { max: 12, label: 'Code' }).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) throw bad('Enter the 6-digit code from the email.', 'invalid_code');
    await enforce(ctx.db, `adm-2fa:${t.u}`, 10, 600);
    const ch = await ctx.db.first<{ id: string; code_hash: string; attempts: number; expires_at: string; consumed_at: string | null }>(
      "SELECT id, code_hash, attempts, expires_at, consumed_at FROM auth_challenges WHERE id = ? AND purpose = 'admin_login' AND subject_id = ?",
      t.c, t.u
    );
    if (!ch || ch.consumed_at || Date.parse(ch.expires_at) < Date.now() || ch.attempts >= 5) {
      throw unauthorized('That code expired or was used too many times. Sign in again to get a new one.');
    }
    if (!safeEqual(await hashCode(ctx.env, 'admin_login', t.u, code), ch.code_hash)) {
      await ctx.db.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?', ch.id);
      throw new HttpError(401, `That code is not right. ${Math.max(0, 4 - ch.attempts)} attempt(s) left.`, 'invalid_code');
    }
    await ctx.db.run("UPDATE auth_challenges SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", ch.id);
    const user = await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE id = ? AND active = 1', t.u);
    if (!user) throw unauthorized();
    return finishLogin(ctx, user);
  });

  r.add('POST', '/api/admin/auth/resend', 'public', async (ctx) => {
    const body = await readJson(ctx.request, 2048);
    const t = await verifyToken<{ k: string; u: string }>(ctx.env, body.token);
    if (!t || t.k !== '2fa') throw unauthorized('That step expired. Sign in again.');
    await enforce(ctx.db, `adm-resend:${t.u}`, 3, 600, 'A code was sent recently. Check your inbox (and spam) before asking again.');
    const user = await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE id = ? AND active = 1', t.u);
    if (!user) throw unauthorized();
    return nextStep(ctx, user);
  });

  r.add('POST', '/api/admin/auth/forgot', 'public', async (ctx) => {
    const body = await readJson(ctx.request, 2048);
    const email = emailField(body);
    await enforce(ctx.db, `adm-forgot-ip:${ctx.ip}`, 10, 3600);
    await enforce(ctx.db, `adm-forgot:${email}`, 3, 3600, 'A reset link was sent recently. Check your inbox (and spam folder).');
    await verifyTurnstile(ctx.env, body.turnstileToken, ctx.ip);
    const generic = json({ ok: true, message: 'If that email belongs to a Talo account, a reset link is on its way. It is valid for 30 minutes.' });
    if (!emailConfigured(ctx.env)) {
      throw new HttpError(503, 'Password reset by email is not set up yet. Ask your manager to reset your password from Settings → Team.', 'email_off');
    }
    const user = await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE email = ? AND active = 1', email);
    if (!user) return generic;
    const token = randomToken(32);
    const id = newId('ch');
    await ctx.db.batch([
      ctx.db.stmt("UPDATE auth_challenges SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE purpose = 'password_reset' AND subject_id = ? AND consumed_at IS NULL", user.id),
      ctx.db.stmt('INSERT INTO auth_challenges (id, purpose, subject_id, code_hash, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?)',
        id, 'password_reset', user.id, await sha256Hex(token), new Date(Date.now() + 30 * 60_000).toISOString(), ctx.ip),
    ]);
    const s = await getSettings(ctx.env, ctx.db);
    const link = `${appOrigin(ctx)}/admin/#/reset?c=${id}&t=${token}`;
    await sendEmail(ctx.env, { to: user.email, ...resetEmail(s.orgName, user.name, link) });
    await ctx.db.run("INSERT INTO audit_log (actor_email, action, target_type, target_id, ip) VALUES (?, 'password_reset_requested', 'admin_user', ?, ?)", email, user.id, ctx.ip);
    return generic;
  });

  // Completes both a password reset and a member invite (both verify the email address).
  r.add('POST', '/api/admin/auth/reset', 'public', async (ctx) => {
    const body = await readJson(ctx.request, 4096);
    const id = str(body, 'challengeId', { max: 64 });
    const token = str(body, 'token', { max: 128 });
    await enforce(ctx.db, `adm-reset-ip:${ctx.ip}`, 20, 3600);
    const ch = await ctx.db.first<{ id: string; purpose: string; subject_id: string; code_hash: string; expires_at: string; consumed_at: string | null; attempts: number }>(
      "SELECT * FROM auth_challenges WHERE id = ? AND purpose IN ('password_reset', 'invite')", id
    );
    const invalid = new HttpError(400, 'This link is invalid or has expired. Ask for a new one.', 'invalid_link');
    if (!ch || ch.consumed_at || Date.parse(ch.expires_at) < Date.now() || ch.attempts >= 5) throw invalid;
    if (!safeEqual(await sha256Hex(token), ch.code_hash)) {
      await ctx.db.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?', ch.id);
      throw invalid;
    }
    const user = await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE id = ? AND active = 1', ch.subject_id);
    if (!user) throw invalid;
    const password = str(body, 'password', { max: 128, trim: false, label: 'New password' });
    checkPassword(password, { email: user.email, name: user.name });
    await setPassword(ctx, user.id, password, ", email_verified_at = COALESCE(email_verified_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')), locked_until = NULL, failed_logins = 0");
    await ctx.db.run("UPDATE auth_challenges SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", ch.id);
    await revokeAllAdminSessions(ctx.db, user.id);
    await clear(ctx.db, `adm-fail:${user.email}`);
    ctx.admin = { userId: user.id, email: user.email, name: user.name, role: user.role, tokenHash: '', mustChangePassword: false };
    await audit(ctx, ch.purpose === 'invite' ? 'invite_accepted' : 'password_reset', { type: 'admin_user', id: user.id });
    return json({ ok: true, message: 'Your password is set. You can sign in now.' });
  });

  r.add('POST', '/api/admin/auth/logout', 'public', async (ctx) => {
    ctx.cookies.push(clearCookie(ADMIN_COOKIE));
    const current = await loadAdmin(ctx.db, ctx.request);
    if (current) {
      await revokeAdminSession(ctx.db, current.tokenHash);
      ctx.admin = current;
      await audit(ctx, 'logout', { type: 'admin_user', id: current.userId });
    }
    return json({ ok: true });
  });

  r.add('GET', '/api/admin/auth/me', 'admin', async (ctx) => {
    const a = ctx.admin!;
    return json({ user: { id: a.userId, email: a.email, name: a.name, role: a.role, mustChangePassword: a.mustChangePassword } });
  }, { allowDuringPasswordChange: true });

  /* ---------- own account ---------- */

  r.add('POST', '/api/admin/account/password', 'admin', async (ctx) => {
    const body = await readJson(ctx.request, 4096);
    const current = str(body, 'currentPassword', { max: 256, trim: false, label: 'Current password' });
    const next = str(body, 'newPassword', { max: 128, trim: false, label: 'New password' });
    const user = (await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE id = ?', ctx.admin!.userId))!;
    await enforce(ctx.db, `adm-pw:${user.id}`, 10, 900);
    if (!(await verifyPassword(current, user.pass_salt, user.pass_hash, user.pass_iterations))) throw bad('Your current password is not right.', 'wrong_password', { field: 'currentPassword' });
    checkPassword(next, { email: user.email, name: user.name });
    if (current === next) throw bad('Choose a password different from your current one.', 'same_password');
    await setPassword(ctx, user.id, next);
    const revoked = await revokeAllAdminSessions(ctx.db, user.id, ctx.admin!.tokenHash);
    await audit(ctx, 'password_changed', { type: 'admin_user', id: user.id }, { otherSessionsSignedOut: revoked });
    return json({ ok: true, message: revoked ? `Password updated. ${revoked} other session(s) were signed out.` : 'Password updated.' });
  }, { allowDuringPasswordChange: true });

  r.add('GET', '/api/admin/account/sessions', 'admin', async (ctx) => {
    const rows = await ctx.db.all<{ token_hash: string; created_at: string; last_seen_at: string | null; ip: string | null; user_agent: string | null }>(
      "SELECT token_hash, created_at, last_seen_at, ip, user_agent FROM admin_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY created_at DESC LIMIT 20",
      ctx.admin!.userId
    );
    return json({
      sessions: rows.map((s) => ({ id: s.token_hash.slice(0, 16), createdAt: s.created_at, lastSeenAt: s.last_seen_at, ip: s.ip, userAgent: s.user_agent, current: s.token_hash === ctx.admin!.tokenHash })),
    });
  }, { allowDuringPasswordChange: true });

  r.add('POST', '/api/admin/account/sessions/revoke-others', 'admin', async (ctx) => {
    const n = await revokeAllAdminSessions(ctx.db, ctx.admin!.userId, ctx.admin!.tokenHash);
    await audit(ctx, 'sessions_revoked', { type: 'admin_user', id: ctx.admin!.userId }, { count: n });
    return json({ ok: true, revoked: n });
  });
}
