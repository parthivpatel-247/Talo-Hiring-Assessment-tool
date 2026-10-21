import type { Env } from '../types';

/**
 * Minimal signed-cookie sessions — no external auth library needed.
 * Candidate login is intentionally just "email on the allowlist" (no OTP,
 * per the decision to skip it); the signed token below only carries that
 * decision forward across requests so the timer/answers can be tied to the
 * right candidate without re-checking the email on every call.
 */

const CANDIDATE_COOKIE = 'chs_candidate';
const ADMIN_COOKIE = 'chs_admin';

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sign(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = btoa(JSON.stringify(payload));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

/** Constant-time string compare — avoids leaking the signature via compare timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify<T = Record<string, unknown>>(
  secret: string,
  token: string | undefined
): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  // Constant-time compare so an attacker can't forge a signature byte-by-byte
  // off compare-timing differences.
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    return JSON.parse(atob(body)) as T;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match?.[1];
}

function setCookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/** Expire a cookie immediately (used for logout). */
function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * Log the admin out: delete the current session token (if any) and return a
 * Set-Cookie that clears the admin cookie. Idempotent — safe to call even with
 * no / an invalid session (so switching manager <-> panel member always works).
 */
export async function clearAdminSession(env: Env, request: Request): Promise<string> {
  const token = readCookie(request, ADMIN_COOKIE);
  if (token) {
    try { await env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run(); } catch { /* best effort */ }
  }
  return clearCookieHeader(ADMIN_COOKIE);
}

export async function createCandidateSession(env: Env, candidateId: string): Promise<string> {
  const token = await sign(env.SESSION_SECRET, { cid: candidateId, iat: Date.now() });
  return setCookieHeader(CANDIDATE_COOKIE, token, 60 * 60 * 6); // 6h covers both parts + buffer
}

export async function getCandidateIdFromRequest(env: Env, request: Request): Promise<string | null> {
  const token = readCookie(request, CANDIDATE_COOKIE);
  const payload = await verify<{ cid: string }>(env.SESSION_SECRET, token);
  return payload?.cid ?? null;
}

export type AdminRole = 'manager' | 'member';

/* ---- Password hashing (PBKDF2-SHA256) for named admin accounts ---- */
function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
const PBKDF2_ITERS = 100_000;
export async function hashPassword(password: string, saltHex?: string): Promise<{ salt: string; hash: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' }, key, 256);
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}
export async function verifyPassword(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  const { hash } = await hashPassword(password, saltHex);
  // constant-time compare
  if (hash.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

export async function createAdminSession(env: Env, role: AdminRole = 'manager'): Promise<{ cookie: string; token: string; role: AdminRole }> {
  // Role is carried inside the HMAC-signed token, so it can't be tampered with
  // client-side and needs no extra DB column.
  const token = await sign(env.SESSION_SECRET, { admin: true, role, iat: Date.now() });
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  await env.DB.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)')
    .bind(token, expiresAt)
    .run();
  return { cookie: setCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 12), token, role };
}

/** Returns the admin's role if the request carries a valid, unexpired admin session, else null. */
export async function getAdminRole(env: Env, request: Request): Promise<AdminRole | null> {
  const token = readCookie(request, ADMIN_COOKIE);
  const payload = await verify<{ admin: boolean; role?: AdminRole }>(env.SESSION_SECRET, token);
  if (!payload?.admin || !token) return null;
  // expires_at is stored as an ISO timestamp ("2026-10-21T20:00:00.000Z"), so compare
  // it with an ISO "now". (datetime('now') returns "2026-10-21 08:00:00", and the space
  // sorts before "T", which let a session outlive its 12 hours until the date changed.)
  const row = await env.DB.prepare('SELECT 1 FROM admin_sessions WHERE token = ? AND expires_at > ?')
    .bind(token, new Date().toISOString())
    .first();
  if (!row) return null;
  return payload.role === 'member' ? 'member' : 'manager'; // default legacy tokens to manager
}

export async function isAdminRequest(env: Env, request: Request): Promise<boolean> {
  return (await getAdminRole(env, request)) !== null;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // API data must never be cached by the browser or the edge — otherwise a GET
      // like /api/admin/candidates can be served stale after a delete/update, so the
      // change "doesn't reflect" until a hard refresh. no-store forces a fresh fetch.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...(init.headers || {}),
    },
  });
}

export function withCookie(response: Response, cookie: string): Response {
  const r = new Response(response.body, response);
  r.headers.append('Set-Cookie', cookie);
  return r;
}
