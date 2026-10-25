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
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Compare a typed secret with the configured one without leaking its length or
 * content through timing: both sides are hashed first, so the compare always
 * runs over 32 equal-length bytes.
 */
export async function secretEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode('talo-secret:' + a)),
    crypto.subtle.digest('SHA-256', enc.encode('talo-secret:' + b)),
  ]);
  const x = new Uint8Array(da), y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function verify<T = Record<string, unknown>>(
  secret: string,
  token: string | undefined
): Promise<T | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null; // exactly body.signature, nothing appended
  const [body, sig] = parts;
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

// Candidate sessions last 12 hours: longer than the longest possible test (two parts
// of up to 4 hours each) and the signed token itself expires then too, so a copied
// cookie can't be replayed later.
const CANDIDATE_SESSION_SECONDS = 60 * 60 * 12;
// sid: a random id for this sign-in. The first sign-in to start a part binds the
// part to its sid, so other browsers signed in earlier can't take part in that sitting.
export async function createCandidateSession(env: Env, candidateId: string): Promise<string> {
  const token = await sign(env.SESSION_SECRET, { cid: candidateId, iat: Date.now(), sid: crypto.randomUUID() });
  return setCookieHeader(CANDIDATE_COOKIE, token, CANDIDATE_SESSION_SECONDS);
}

export type CandidateSession = { cid: string; sid: string; iat: number };

export async function getCandidateSession(env: Env, request: Request): Promise<CandidateSession | null> {
  const token = readCookie(request, CANDIDATE_COOKIE);
  const payload = await verify<{ cid: string; iat?: number; sid?: string }>(env.SESSION_SECRET, token);
  if (!payload?.cid) return null;
  if (typeof payload.iat !== 'number' || Date.now() - payload.iat > CANDIDATE_SESSION_SECONDS * 1000) return null;
  // A sign-in from before sittings were tracked has no sid: its own sign-in time
  // stands in (unique per sign-in), so it keeps working without a new sign-in.
  return { cid: payload.cid, sid: typeof payload.sid === 'string' ? payload.sid : `legacy-${payload.iat}`, iat: payload.iat };
}

/** Set-Cookie that signs the candidate out of this browser. */
export function clearCandidateSessionCookie(): string {
  return clearCookieHeader(CANDIDATE_COOKIE);
}

export async function getCandidateIdFromRequest(env: Env, request: Request): Promise<string | null> {
  return (await getCandidateSession(env, request))?.cid ?? null;
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

/** admin_sessions.user_id links a session to its named account (NULL for the bootstrap login). */
let sessionUserColReady = false;
async function ensureSessionUserCol(env: Env): Promise<void> {
  if (sessionUserColReady) return;
  const cols = await env.DB.prepare('PRAGMA table_info(admin_sessions)').all<{ name: string }>();
  if (!(cols.results ?? []).some((c) => c.name === 'user_id')) {
    // Another instance may add it at the same moment: "duplicate column" is success.
    await env.DB.prepare('ALTER TABLE admin_sessions ADD COLUMN user_id TEXT').run()
      .catch((err) => { if (!/duplicate column/i.test(String(err))) throw err; });
  }
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id)').run();
  sessionUserColReady = true;
}
/** Tests reset the database between cases. */
export function resetAuthSchemaCache(): void { sessionUserColReady = false; }

export async function createAdminSession(env: Env, role: AdminRole = 'manager', userId: string | null = null, viaConfig: AdminRole | null = null): Promise<{ cookie: string; token: string; role: AdminRole }> {
  // Role is carried inside the HMAC-signed token, so it can't be tampered with
  // client-side. For a named account the session also records the account, so
  // deactivating, demoting or deleting the account takes effect at once.
  await ensureSessionUserCol(env);
  // n: a random nonce, so two sign-ins in the same millisecond never collide.
  // bc: for a config (bootstrap) sign-in, a keyed tag of the credential that issued
  // it — changing ADMIN_EMAIL/ADMIN_PASSWORD (or the panel pair) ends those sessions.
  const payload: Record<string, unknown> = { admin: true, role, iat: Date.now(), n: crypto.randomUUID() };
  // A sign-in made with the config password (ADMIN_PASSWORD / PANEL_PASSWORD) carries
  // a tag of that credential, so changing the secret ends those sessions.
  const configRole = viaConfig ?? (userId ? null : role);
  if (configRole) {
    const bc = await bootstrapTag(env, configRole);
    if (!bc) throw new Error('No config credential for this role');
    payload.bc = bc;
    payload.bcr = configRole;
  }
  const token = await sign(env.SESSION_SECRET, payload);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  await env.DB.prepare('INSERT INTO admin_sessions (token, expires_at, user_id) VALUES (?, ?, ?)')
    .bind(token, expiresAt, userId)
    .run();
  return { cookie: setCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 12), token, role };
}

/**
 * A keyed fingerprint of the config credential behind a bootstrap role, or null
 * when that login is switched off (email or password empty).
 */
async function bootstrapTag(env: Env, role: AdminRole): Promise<string | null> {
  const email = ((role === 'manager' ? env.ADMIN_EMAIL : env.PANEL_EMAIL) || '').trim().toLowerCase();
  const pass = (role === 'manager' ? env.ADMIN_PASSWORD : env.PANEL_PASSWORD) || '';
  if (!email || !pass || !env.SESSION_SECRET) return null;
  return (await hmac(env.SESSION_SECRET, `bootstrap:${role}:${email}:${pass}`)).slice(0, 32);
}

/** End every session of one named account (after its role, password or status changes). */
export async function revokeUserSessions(env: Env, userId: string): Promise<void> {
  await ensureSessionUserCol(env);
  await env.DB.prepare('DELETE FROM admin_sessions WHERE user_id = ?').bind(userId).run();
}

/** Returns the admin's role if the request carries a valid, unexpired admin session, else null. */
export async function getAdminRole(env: Env, request: Request): Promise<AdminRole | null> {
  const token = readCookie(request, ADMIN_COOKIE);
  const payload = await verify<{ admin: boolean; role?: AdminRole; bc?: string; bcr?: AdminRole }>(env.SESSION_SECRET, token);
  if (!payload?.admin || !token) return null;
  // expires_at is stored as an ISO timestamp ("2026-10-21T20:00:00.000Z"), so compare
  // it with an ISO "now". (datetime('now') returns "2026-10-21 08:00:00", and the space
  // sorts before "T", which let a session outlive its 12 hours until the date changed.)
  await ensureSessionUserCol(env);
  const row = await env.DB.prepare(
    `SELECT s.user_id AS user_id, u.role AS user_role, u.active AS user_active
     FROM admin_sessions s LEFT JOIN admin_users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  )
    .bind(token, new Date().toISOString())
    .first<{ user_id: string | null; user_role: string | null; user_active: number | null }>();
  if (!row) return null;
  if (row.user_id) {
    // Named account: its CURRENT role and status decide, not the role at sign-in.
    if (!row.user_active) return null;
    // Signed in with the config password: only while that secret is unchanged.
    if (typeof payload.bc === 'string') {
      const tag = await bootstrapTag(env, payload.bcr === 'member' ? 'member' : 'manager');
      if (!tag || !timingSafeEqual(tag, payload.bc)) return null;
    }
    return row.user_role === 'manager' ? 'manager' : 'member';
  }
  // Config (bootstrap) sign-in: valid only while the credential that issued it is
  // unchanged. Older tokens without a tag (issued before this check) must sign in again.
  const bootRole: AdminRole = payload.role === 'member' ? 'member' : 'manager';
  const tag = await bootstrapTag(env, bootRole);
  if (!tag || typeof payload.bc !== 'string' || !timingSafeEqual(tag, payload.bc)) return null;
  return bootRole;
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
      'X-Content-Type-Options': 'nosniff',
      ...(init.headers || {}),
    },
  });
}

export function withCookie(response: Response, cookie: string): Response {
  const r = new Response(response.body, response);
  r.headers.append('Set-Cookie', cookie);
  return r;
}

// ---------------------------------------------------------------------------
// Trusted admin device. After a good admin sign-in the browser gets a signed,
// HttpOnly cookie, scoped to the sign-in URL only, that names the account. Sign-ins
// from that browser for that account skip the network-wide and account-wide sign-in
// pauses, so a student on the same campus network can't lock the invigilators out
// by typing wrong passwords. That browser has its own small limit instead.
// ---------------------------------------------------------------------------
const DEVICE_COOKIE = 'chs_admin_dev';
const DEVICE_SECONDS = 60 * 60 * 24 * 90;

export async function createAdminDeviceCookie(env: Env, account: string, deviceId: string): Promise<string> {
  const token = await sign(env.SESSION_SECRET, { k: 'dev', a: account, d: deviceId, iat: Date.now() });
  return `${DEVICE_COOKIE}=${token}; Path=/api/admin/login; HttpOnly; Secure; SameSite=Strict; Max-Age=${DEVICE_SECONDS}`;
}

/** The device id if the request carries a valid trusted-device cookie for `account`. */
export async function adminDeviceFor(env: Env, request: Request, account: string): Promise<string | null> {
  const p = await verify<{ k?: string; a?: string; d?: string; iat?: number }>(env.SESSION_SECRET, readCookie(request, DEVICE_COOKIE));
  if (!p || p.k !== 'dev' || p.a !== account || typeof p.d !== 'string' || !p.d) return null;
  if (typeof p.iat !== 'number' || Date.now() - p.iat > DEVICE_SECONDS * 1000) return null;
  return p.d;
}

/** The trusted-device id in the request, whichever account it names (or null). */
export async function adminDeviceId(env: Env, request: Request): Promise<string | null> {
  const p = await verify<{ k?: string; d?: string; iat?: number }>(env.SESSION_SECRET, readCookie(request, DEVICE_COOKIE));
  if (!p || p.k !== 'dev' || typeof p.d !== 'string' || typeof p.iat !== 'number' || Date.now() - p.iat > DEVICE_SECONDS * 1000) return null;
  return p.d;
}
