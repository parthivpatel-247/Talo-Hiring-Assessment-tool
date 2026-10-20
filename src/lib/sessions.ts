import type { Env, AdminRole, CandidateRow, AttemptRow } from '../env';
import type { Db } from '../db/db';
import type { AdminPrincipal } from './context';
import { hmacB64, randomToken, safeEqual, sha256Hex } from './security';

/**
 * Sessions.
 *
 * Admin: an opaque random token in an HttpOnly, Secure, SameSite=Strict cookie.
 * Only its SHA-256 hash is stored (admin_sessions), so a database leak does not
 * leak live sessions. Sessions can be revoked one by one or all at once.
 *
 * Candidate: an HMAC-signed cookie {candidate id, session nonce, expiry}. The
 * nonce must match attempts.session_nonce, so a new sign-in, an admin revoke or
 * a retake immediately invalidates every older cookie.
 */

export const ADMIN_COOKIE = '__Host-talo_admin';
export const CANDIDATE_COOKIE = '__Host-talo_cand';
const ADMIN_TTL_HOURS = 12;
const CANDIDATE_TTL_HOURS = 8;
const ADMIN_IDLE_MS = 2 * 60 * 60 * 1000;

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return undefined;
}

function cookie(name: string, value: string, maxAge: number, sameSite: 'Strict' | 'Lax'): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/* ---------------- signed tokens ---------------- */

export async function signToken(env: Env, payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const body = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${body}.${await hmacB64(env.SESSION_SECRET, body)}`;
}

export async function verifyToken<T extends Record<string, unknown>>(env: Env, token: unknown): Promise<T | null> {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = await hmacB64(env.SESSION_SECRET, body);
  if (!safeEqual(expected, sig)) return null;
  try {
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(json) as T & { exp?: number };
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

/* ---------------- admin sessions ---------------- */

export async function createAdminSession(db: Db, userId: string, role: AdminRole, ip: string, ua: string): Promise<string> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + ADMIN_TTL_HOURS * 3600 * 1000).toISOString();
  await db.batch([
    db.stmt(
      'INSERT INTO admin_sessions (token_hash, user_id, role, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      tokenHash, userId, role, expires, new Date().toISOString(), ip, ua
    ),
    db.stmt("UPDATE admin_users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), failed_logins = 0, locked_until = NULL WHERE id = ?", userId),
  ]);
  return cookie(ADMIN_COOKIE, token, ADMIN_TTL_HOURS * 3600, 'Strict');
}

export async function loadAdmin(db: Db, request: Request): Promise<AdminPrincipal | null> {
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token || token.length > 128) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db.first<{ user_id: string; role: AdminRole; last_seen_at: string | null; email: string; name: string; active: number; must_change_password: number; user_role: AdminRole }>(
    `SELECT s.user_id, s.role, s.last_seen_at, u.email, u.name, u.active, u.must_change_password, u.role AS user_role
     FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    tokenHash
  );
  if (!row || !row.active) return null;
  // Idle timeout: a session unused for 2 hours ends even inside its 12-hour lifetime.
  if (row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) > ADMIN_IDLE_MS) return null;
  // Sliding "last seen" (at most every 5 minutes, to keep writes low).
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 5 * 60 * 1000) {
    await db.run("UPDATE admin_sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ?", tokenHash);
  }
  // The user's CURRENT role wins: a demotion takes effect on the very next request.
  return { userId: row.user_id, email: row.email, name: row.name, role: row.user_role, tokenHash, mustChangePassword: !!row.must_change_password };
}

export async function revokeAdminSession(db: Db, tokenHash: string): Promise<void> {
  await db.run("UPDATE admin_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ?", tokenHash);
}

export async function revokeAllAdminSessions(db: Db, userId: string, exceptTokenHash?: string): Promise<number> {
  const r = await db.run(
    "UPDATE admin_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND revoked_at IS NULL AND token_hash != ?",
    userId, exceptTokenHash ?? ''
  );
  return r.changes;
}

/* ---------------- candidate sessions ---------------- */

export async function createCandidateSession(env: Env, candidateId: string, nonce: string): Promise<string> {
  const token = await signToken(env, { cid: candidateId, n: nonce }, CANDIDATE_TTL_HOURS * 3600);
  return cookie(CANDIDATE_COOKIE, token, CANDIDATE_TTL_HOURS * 3600, 'Lax');
}

export async function loadCandidate(env: Env, db: Db, request: Request): Promise<{ candidate: CandidateRow; attempt: AttemptRow } | null> {
  const payload = await verifyToken<{ cid: string; n: string }>(env, readCookie(request, CANDIDATE_COOKIE));
  if (!payload?.cid || !payload.n) return null;
  const rows = await db.batch([
    db.stmt('SELECT * FROM candidates WHERE id = ?', payload.cid),
    db.stmt('SELECT * FROM attempts WHERE candidate_id = ?', payload.cid),
  ]);
  const candidate = (rows[0].results?.[0] ?? null) as CandidateRow | null;
  const attempt = (rows[1].results?.[0] ?? null) as AttemptRow | null;
  if (!candidate || !attempt || !attempt.session_nonce) return null;
  if (!safeEqual(attempt.session_nonce, payload.n)) return null;
  if (candidate.access_revoked) return null;
  return { candidate, attempt };
}

export function newNonce(): string {
  return randomToken(12);
}
