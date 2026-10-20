import type { Env } from '../env';

/* ---------------- crypto helpers ---------------- */

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function toB64Url(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = hmacKeys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, k);
  }
  return k;
}

export async function hmacB64(secret: string, value: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(value));
  return toB64Url(sig);
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(value));
  return toHex(sig);
}

/** Constant-time comparison for equal-length strings. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Uniform random numeric code, e.g. "042918". */
export function randomDigits(length = 6): string {
  const out: string[] = [];
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  for (let i = 0; i < length; i++) out.push(String(buf[i] % 10));
  return out.join('');
}

/** Hall code: 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L). */
export function randomHallCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

/** Hash a short code bound to its subject, so a code is useless for anyone else. */
export async function hashCode(env: Env, purpose: string, subject: string, code: string): Promise<string> {
  return hmacHex(env.SESSION_SECRET, `${purpose}:${subject}:${code.trim().toUpperCase()}`);
}

/* ---------------- request facts ---------------- */

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || '0.0.0.0';
}

export function userAgent(request: Request): string {
  return (request.headers.get('User-Agent') || '').slice(0, 300);
}

/**
 * CSRF / cross-origin guard for state-changing API calls. Browsers always send
 * Origin on POST/PUT/DELETE; a request from another site is rejected. Requests
 * with no Origin and no Sec-Fetch-Site (scripts, curl, tests) are not browser
 * requests and cannot carry a victim's cookies, so they are allowed.
 */
export function isCrossSite(request: Request, env: Env): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site') return true;
  if (!origin) return false;
  const self = new URL(request.url).origin;
  const allowed = new Set([self]);
  if (env.APP_ORIGIN) allowed.add(env.APP_ORIGIN.replace(/\/$/, ''));
  return !allowed.has(origin);
}

/* ---------------- response hardening ---------------- */

export function contentSecurityPolicy(env: Env, opts: { allowFraming?: boolean } = {}): string {
  const turnstile = !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);
  const cf = 'https://challenges.cloudflare.com';
  return [
    "default-src 'self'",
    `script-src 'self'${turnstile ? ` ${cf}` : ''}`,
    `style-src 'self'${turnstile ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${turnstile ? ` ${cf}` : ''}`,
    `frame-src 'self'${turnstile ? ` ${cf}` : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'none'",
    `frame-ancestors ${opts.allowFraming ? "'self'" : "'none'"}`,
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Apply the security headers to any response (API or static asset). */
export function secureResponse(res: Response, env: Env, path: string): Response {
  const r = new Response(res.body, res);
  const h = r.headers;
  const allowFraming = /^\/api\/admin\/candidates\/[^/]+\/resume$/.test(path);
  const isHtml = (h.get('Content-Type') || '').includes('text/html');
  if (isHtml || path.startsWith('/api/')) h.set('Content-Security-Policy', contentSecurityPolicy(env, { allowFraming }));
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', allowFraming ? 'SAMEORIGIN' : 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), fullscreen=(self)');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (path.startsWith('/api/') || path.startsWith('/admin')) h.set('X-Robots-Tag', 'noindex, nofollow');
  h.delete('Server');
  h.delete('X-Powered-By');
  return r;
}
