import type { Env } from '../types';
import { ensureOnce } from './db';
import { adminDeviceFor, adminDeviceId, createAdminDeviceCookie, json } from './auth';

/**
 * Two layers of request limiting, shared by the support and writers sites.
 *
 * 1. Sign-in limits, stored in D1 (`rate_limits`). They work on every Cloudflare
 *    plan and are exact.
 *      Admin sign-in (each attempt is counted BEFORE the password is checked, so a
 *      burst of simultaneous guesses can't slip past the limit; a good sign-in then
 *      gives its count back):
 *        - 5 wrong passwords for one account from one network: that account is
 *          paused on that network for 15 minutes.
 *        - 50 wrong passwords for one account in an hour, from anywhere: the account
 *          is paused everywhere (a guessing attack spread over many networks).
 *        - 20 wrong sign-ins from one network, any accounts: that network is paused.
 *        - Unknown emails only count against the network, so junk attempts cost one
 *          D1 write each.
 *        - A browser that has signed in to the account before (trusted-device
 *          cookie) skips all of these and has its own limit of 10 wrong passwords
 *          per 15 minutes. So a student on the campus network can't lock the
 *          invigilators out by typing wrong passwords.
 *      Candidate sign-in: 200 sign-ins with an email that is NOT on the list, from
 *        one network in 10 minutes, pauses that network for 10 minutes. The limit is
 *        high because a whole college shares one internet address.
 *      A manager can lift every pause at once from the admin Overview.
 *
 * 2. A per-request ceiling on every /api/ call, using Cloudflare's Workers Rate
 *    Limiting bindings (`[[ratelimits]]` in wrangler.toml). These cost no D1 reads
 *    or writes. Counts are approximate and kept per Cloudflare location. If a
 *    binding isn't configured, or the call fails, the request goes through:
 *    a limiter problem must never stop a candidate's test.
 *
 * A "network" is the IPv4 address, or the /64 prefix of an IPv6 address (one home
 * or phone gets a whole /64, so counting single IPv6 addresses would be useless).
 * Keys are stored as keyed hashes (HMAC with SESSION_SECRET), so the table never
 * holds a raw email or IP and the hashes can't be reversed by trying every IPv4.
 */

export const ADMIN_FAIL_PER_IP_ACCOUNT = 5;
export const ADMIN_FAIL_PER_ACCOUNT = 50;
export const ADMIN_FAIL_PER_IP = 20;
export const ADMIN_FAIL_PER_DEVICE = 10;
export const ADMIN_LOCK_SECONDS = 15 * 60;
export const ADMIN_ACCOUNT_WINDOW_SECONDS = 60 * 60;
export const CANDIDATE_UNKNOWN_PER_IP = 200;
export const CANDIDATE_LOCK_SECONDS = 10 * 60;

export async function ensureRateLimitTable(env: Env): Promise<void> {
  await ensureOnce('rate_limits', async () => {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS rate_limits (
         bucket        TEXT PRIMARY KEY CHECK (length(bucket) BETWEEN 1 AND 80),
         count         INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
         window_start  INTEGER NOT NULL,
         blocked_until INTEGER
       )`
    ).run();
  });
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();
async function keyedHash(env: Env, value: string): Promise<string> {
  const secret = env.SESSION_SECRET || 'unset';
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', new TextEncoder().encode('rate-limit:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, key);
  }
  const sig = await crypto.subtle.sign('HMAC', await key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A bucket name: a kind label plus one keyed hash per value, e.g.
 *  `adm-ipacct:<account hash>:<network hash>`. One hash per part lets an account's
 *  buckets on every network be cleared by prefix. */
export async function bucket(env: Env, kind: string, ...parts: string[]): Promise<string> {
  const hashes = await Promise.all(parts.map((p) => keyedHash(env, p.toLowerCase())));
  return `${kind}:${hashes.join(':')}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Seconds left on the longest pause among the buckets, or 0. One read. */
export async function longestBlock(env: Env, buckets: string[]): Promise<number> {
  if (!buckets.length) return 0;
  const row = await env.DB.prepare(
    `SELECT MAX(blocked_until) AS until FROM rate_limits WHERE bucket IN (${buckets.map(() => '?').join(',')})`
  ).bind(...buckets).first<{ until: number | null }>();
  const left = Number(row?.until ?? 0) - nowSec();
  return left > 0 ? left : 0;
}

/** Count one event in a fixed window (the window restarts once it has passed, and an
 *  expired pause is cleared with it). Returns the new count. */
function countStmt(env: Env, b: string, windowSeconds: number) {
  return env.DB.prepare(
    `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(bucket) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN ?2 ELSE rate_limits.window_start END,
       blocked_until = CASE WHEN rate_limits.blocked_until IS NOT NULL AND rate_limits.blocked_until <= ?2 THEN NULL ELSE rate_limits.blocked_until END
     RETURNING count`
  ).bind(b, nowSec(), windowSeconds);
}

async function pause(env: Env, buckets: string[], seconds: number): Promise<void> {
  if (!buckets.length) return;
  const until = nowSec() + seconds;
  await env.DB.prepare(
    `UPDATE rate_limits SET blocked_until = MAX(COALESCE(blocked_until, 0), ?) WHERE bucket IN (${buckets.map(() => '?').join(',')})`
  ).bind(until, ...buckets).run();
}

/** Count one failure; when the count reaches `limit` the bucket is paused. */
export async function recordFailure(env: Env, b: string, limit: number, windowSeconds: number, lockSeconds: number): Promise<{ count: number; locked: boolean }> {
  const row = await countStmt(env, b, windowSeconds).first<{ count: number }>();
  const count = Number(row?.count ?? 1);
  if (count >= limit) { await pause(env, [b], lockSeconds); return { count, locked: true }; }
  return { count, locked: false };
}

/** Manager action: lift every sign-in pause and reset every counter (both kinds). */
export async function liftAllPauses(env: Env): Promise<number> {
  await ensureRateLimitTable(env);
  const r = await env.DB.prepare('DELETE FROM rate_limits').run();
  return Number(r.meta?.changes ?? 0);
}

/** How many networks or accounts are paused right now (for the admin Overview). */
export async function activePauses(env: Env): Promise<number> {
  try {
    await ensureRateLimitTable(env);
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_limits WHERE blocked_until > ?').bind(nowSec()).first<{ n: number }>();
    return Number(r?.n ?? 0);
  } catch { return 0; }
}

/** Clear an admin account's pauses and counters on every network (new password set). */
export async function unlockAdminAccount(env: Env, account: string): Promise<void> {
  await ensureRateLimitTable(env);
  const h = (await bucket(env, 'x', account)).slice(2);
  await env.DB.prepare('DELETE FROM rate_limits WHERE bucket = ? OR bucket LIKE ?').bind(`adm-acct:${h}`, `adm-ipacct:${h}:%`).run();
}

/** Daily cleanup: counters whose window and pause both ended more than a day ago. */
export async function purgeRateLimits(env: Env): Promise<void> {
  await ensureRateLimitTable(env);
  const cutoff = nowSec() - 86_400;
  await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ? AND (blocked_until IS NULL OR blocked_until < ?)').bind(cutoff, cutoff).run();
}

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------

/** The caller's address. Cloudflare always sets CF-Connecting-IP in production;
 *  no client-supplied header (X-Forwarded-For etc.) is trusted. */
export function clientIp(request: Request): string {
  return (request.headers.get('CF-Connecting-IP') || 'unknown').trim().toLowerCase();
}

function expandV6(ip: string): string[] | null {
  const addr = ip.split('%')[0];
  if (addr.includes('.')) return null; // IPv4-mapped forms: treat as a plain address
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

/** IPv4 as is; IPv6 reduced to its /64 prefix. */
export function networkKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const g = expandV6(ip);
  return g ? g.slice(0, 4).join(':') + '::/64' : ip;
}

export function clientNetwork(request: Request): string {
  return networkKey(clientIp(request));
}

export function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const m = Math.ceil(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/** kind: 'ceiling' = a short per-request limit, safe to retry after a few seconds;
 *  'signin' = a sign-in pause of minutes, shown to the person as is. */
export function tooMany(message: string, retryAfter: number, kind: 'ceiling' | 'signin' = 'signin'): Response {
  return new Response(JSON.stringify({ error: message, rateLimited: true, kind, retryAfter }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.max(1, Math.ceil(retryAfter))), 'Cache-Control': 'no-store' },
  });
}

// ---------------------------------------------------------------------------
// Admin sign-in
// ---------------------------------------------------------------------------

type Bucket = { b: string; limit: number; window: number; resetOnSuccess: boolean };
export interface AdminSigninState { buckets: Bucket[]; counts: number[]; account: string | null; deviceId: string | null }

const ADMIN_PAUSED = (s: number) =>
  `Too many wrong sign-ins. Sign-in is paused for ${waitText(s)}. Ask a manager to reset your password if you've forgotten it.`;

/**
 * Before checking the password: refuse if paused, otherwise count this attempt.
 * `account` is null for an email that matches no account (only the network counts).
 */
export async function adminSigninBegin(env: Env, request: Request, account: string | null): Promise<{ refused: Response } | { state: AdminSigninState }> {
  await ensureRateLimitTable(env);
  const net = clientNetwork(request);
  const deviceId = account ? await adminDeviceFor(env, request, account) : null;
  const buckets: Bucket[] = deviceId
    ? [{ b: await bucket(env, 'adm-dev', deviceId), limit: ADMIN_FAIL_PER_DEVICE, window: ADMIN_LOCK_SECONDS, resetOnSuccess: true }]
    : [
        ...(account ? [
          { b: await bucket(env, 'adm-ipacct', account, net), limit: ADMIN_FAIL_PER_IP_ACCOUNT, window: ADMIN_LOCK_SECONDS, resetOnSuccess: true },
          { b: await bucket(env, 'adm-acct', account), limit: ADMIN_FAIL_PER_ACCOUNT, window: ADMIN_ACCOUNT_WINDOW_SECONDS, resetOnSuccess: false },
        ] : []),
        { b: await bucket(env, 'adm-ip', net), limit: ADMIN_FAIL_PER_IP, window: ADMIN_LOCK_SECONDS, resetOnSuccess: false },
      ];
  const paused = await longestBlock(env, buckets.map((x) => x.b));
  if (paused > 0) return { refused: tooMany(ADMIN_PAUSED(paused), paused) };
  const res = await env.DB.batch(buckets.map((x) => countStmt(env, x.b, x.window)));
  const counts = res.map((r) => Number((r.results?.[0] as { count?: number } | undefined)?.count ?? 1));
  // This attempt is number `count`; refuse if the earlier ones already reached the limit.
  const over = buckets.filter((x, i) => counts[i] - 1 >= x.limit).map((x) => x.b);
  if (over.length) {
    await pause(env, over, ADMIN_LOCK_SECONDS);
    return { refused: tooMany(ADMIN_PAUSED(ADMIN_LOCK_SECONDS), ADMIN_LOCK_SECONDS) };
  }
  return { state: { buckets, counts, account, deviceId } };
}

/** After a wrong password: pause any bucket that reached its limit. */
export async function adminSigninFailed(env: Env, s: AdminSigninState, loginEmail: string, newId: (p: string) => string): Promise<Response> {
  const reached = s.buckets.filter((x, i) => s.counts[i] >= x.limit).map((x) => x.b);
  if (reached.length) {
    await pause(env, reached, ADMIN_LOCK_SECONDS);
    try {
      await env.DB.prepare("INSERT INTO admin_audit (id, action, candidate_id, detail) VALUES (?, 'admin_signin_paused', NULL, ?)")
        .bind(newId('aud'), `Sign-in paused for 15 minutes after repeated wrong passwords for ${loginEmail.slice(0, 120)}.`).run();
    } catch { /* best effort */ }
    return tooMany(ADMIN_PAUSED(ADMIN_LOCK_SECONDS), ADMIN_LOCK_SECONDS);
  }
  const first = s.buckets[0];
  const left = s.account ? first.limit - s.counts[0] : Infinity;
  return json({ error: left <= 2 ? `Wrong email or password. ${left} more ${left === 1 ? 'try' : 'tries'} before sign-in is paused for 15 minutes.` : 'Wrong email or password' }, { status: 401 });
}

/**
 * After a good sign-in: give this attempt's count back, clear this account's count
 * on this network (or this device), and return a trusted-device cookie.
 */
export async function adminSigninSucceeded(env: Env, request: Request, s: AdminSigninState, account: string): Promise<string> {
  const reset = s.buckets.filter((x) => x.resetOnSuccess).map((x) => x.b);
  const giveBack = s.buckets.filter((x) => !x.resetOnSuccess).map((x) => x.b);
  const stmts = [];
  if (reset.length) stmts.push(env.DB.prepare(`DELETE FROM rate_limits WHERE bucket IN (${reset.map(() => '?').join(',')})`).bind(...reset));
  if (giveBack.length) stmts.push(env.DB.prepare(`UPDATE rate_limits SET count = MAX(count - 1, 0) WHERE bucket IN (${giveBack.map(() => '?').join(',')})`).bind(...giveBack));
  if (stmts.length) await env.DB.batch(stmts).catch(() => {});
  const deviceId = s.deviceId || (await adminDeviceId(env, request)) || crypto.randomUUID();
  return createAdminDeviceCookie(env, account, deviceId);
}

// ---------------------------------------------------------------------------
// Candidate sign-in (both sites): only sign-ins with an email that is NOT on the
// list count, since that is what guessing emails looks like.
// ---------------------------------------------------------------------------

const CANDIDATE_PAUSED = (s: number) =>
  `Too many sign-ins with emails that aren't on the list came from this network. Please wait ${waitText(s)}, check the spelling of your email, or ask your invigilator.`;

/** Refuse a candidate sign-in while this network is paused (one read). */
export async function candidateSigninPaused(env: Env, request: Request): Promise<Response | null> {
  await ensureRateLimitTable(env);
  const left = await longestBlock(env, [await bucket(env, 'cand-ip', clientNetwork(request))]);
  return left > 0 ? tooMany(CANDIDATE_PAUSED(left), left) : null;
}

/** Count a sign-in with an unknown email; returns a 429 once the network is paused. */
export async function candidateUnknownEmail(env: Env, request: Request): Promise<Response | null> {
  const r = await recordFailure(env, await bucket(env, 'cand-ip', clientNetwork(request)), CANDIDATE_UNKNOWN_PER_IP, CANDIDATE_LOCK_SECONDS, CANDIDATE_LOCK_SECONDS);
  return r.locked ? tooMany(CANDIDATE_PAUSED(CANDIDATE_LOCK_SECONDS), CANDIDATE_LOCK_SECONDS) : null;
}

// ---------------------------------------------------------------------------
// Layer 2: per-request ceiling (Workers Rate Limiting bindings)
// ---------------------------------------------------------------------------

export interface RateLimiter { limit(opts: { key: string }): Promise<{ success: boolean }> }

async function allowed(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter || typeof limiter.limit !== 'function') return true;
  try {
    const r = await limiter.limit({ key });
    return r?.success !== false;
  } catch {
    return true; // fail open: never block a test because the limiter misbehaved
  }
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

async function plainHash(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Checked before every /api/ request. Returns a 429 response when a ceiling is
 * hit, or null to carry on.
 *   - RL_IP: every request from one network (a whole college shares one, so this
 *     ceiling is set high; it stops a single script flooding the site).
 *   - RL_CANDIDATE: requests carrying one candidate's sign-in cookie.
 *   - RL_ADMIN: requests carrying one admin sign-in cookie.
 * The cookie value is only used as a counter key here; it is verified as usual by
 * the route itself. Someone dropping the cookie still meets the network ceiling,
 * and every route then refuses them as signed out.
 */
export async function requestGuard(request: Request, env: Env): Promise<Response | null> {
  if (!(await allowed(env.RL_IP, `ip:${clientNetwork(request)}`))) {
    return tooMany('Too many requests from this network. Please wait a few seconds and try again.', 10, 'ceiling');
  }
  const cand = cookieValue(request, 'chs_candidate');
  if (cand && !(await allowed(env.RL_CANDIDATE, `c:${await plainHash(cand)}`))) {
    return tooMany('Too many requests. Please wait a few seconds; your answers and time are safe.', 10, 'ceiling');
  }
  const adm = cookieValue(request, 'chs_admin');
  if (adm && !(await allowed(env.RL_ADMIN, `a:${await plainHash(adm)}`))) {
    return tooMany('Too many requests from this admin session. Please wait a few seconds and try again.', 10, 'ceiling');
  }
  return null;
}
