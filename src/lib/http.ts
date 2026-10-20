/**
 * HTTP helpers: JSON responses, typed errors and input validation.
 *
 * Rule: never trust the frontend. Every handler reads its body through
 * readJson() and validates each field with the helpers below, which throw a
 * 400 HttpError with a message a person can act on.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export const bad = (message: string, code = 'invalid_input', extra: Record<string, unknown> = {}) => new HttpError(400, message, code, extra);
export const unauthorized = (message = 'Please sign in to continue.') => new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'You do not have access to this action.') => new HttpError(403, message, 'forbidden');
export const notFound = (message = 'Not found.') => new HttpError(404, message, 'not_found');
export const conflict = (message: string, code = 'conflict') => new HttpError(409, message, code);

const NO_STORE = 'no-store, no-cache, must-revalidate';

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', NO_STORE);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: HttpError, requestId?: string): Response {
  return json({ error: err.message, code: err.code, ...err.extra, ...(requestId ? { requestId } : {}) }, { status: err.status });
}

export function withCookies(res: Response, cookies: string[]): Response {
  const r = new Response(res.body, res);
  for (const c of cookies) r.headers.append('Set-Cookie', c);
  return r;
}

const MAX_JSON_BYTES = 256 * 1024;

/** Parse a JSON object body. Rejects non-JSON, arrays, oversized bodies. */
export async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'That request is too large.', 'too_large');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'That request is too large.', 'too_large');
  if (!text.trim()) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw bad('The request body must be valid JSON.', 'invalid_json');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('The request body must be a JSON object.', 'invalid_json');
  return data as Record<string, unknown>;
}

/* ---------------- field validators ---------------- */

type StrOpts = { min?: number; max?: number; optional?: boolean; trim?: boolean; label?: string; pattern?: RegExp; patternMessage?: string };

export function str(body: Record<string, unknown>, key: string, opts: StrOpts = {}): string {
  const label = opts.label ?? key;
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') {
    if (opts.optional) return '';
    throw bad(`${label} is required.`, 'required', { field: key });
  }
  if (typeof raw !== 'string') throw bad(`${label} must be text.`, 'invalid_type', { field: key });
  const v = opts.trim === false ? raw : raw.trim();
  if (!v && !opts.optional) throw bad(`${label} is required.`, 'required', { field: key });
  if (opts.min != null && v.length < opts.min) throw bad(`${label} must be at least ${opts.min} characters.`, 'too_short', { field: key });
  if (opts.max != null && v.length > opts.max) throw bad(`${label} must be at most ${opts.max} characters.`, 'too_long', { field: key });
  if (opts.pattern && v && !opts.pattern.test(v)) throw bad(opts.patternMessage ?? `${label} is not valid.`, 'invalid_format', { field: key });
  return v;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isEmail(v: string): boolean {
  return v.length <= 254 && EMAIL_RE.test(v);
}

export function email(body: Record<string, unknown>, key = 'email', opts: { optional?: boolean; label?: string } = {}): string {
  const v = str(body, key, { max: 254, optional: opts.optional, label: opts.label ?? 'Email' }).toLowerCase();
  if (!v) return v;
  if (!isEmail(v)) throw bad('Enter a valid email address, like name@college.edu.', 'invalid_email', { field: key });
  return v;
}

export function int(body: Record<string, unknown>, key: string, opts: { min?: number; max?: number; optional?: boolean; label?: string } = {}): number | null {
  const label = opts.label ?? key;
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') {
    if (opts.optional) return null;
    throw bad(`${label} is required.`, 'required', { field: key });
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n)) throw bad(`${label} must be a whole number.`, 'invalid_type', { field: key });
  if (opts.min != null && n < opts.min) throw bad(`${label} must be at least ${opts.min}.`, 'too_small', { field: key });
  if (opts.max != null && n > opts.max) throw bad(`${label} must be at most ${opts.max}.`, 'too_large', { field: key });
  return n;
}

export function num(body: Record<string, unknown>, key: string, opts: { min?: number; max?: number; optional?: boolean; label?: string } = {}): number | null {
  const label = opts.label ?? key;
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') {
    if (opts.optional) return null;
    throw bad(`${label} is required.`, 'required', { field: key });
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) throw bad(`${label} must be a number.`, 'invalid_type', { field: key });
  if (opts.min != null && n < opts.min) throw bad(`${label} must be at least ${opts.min}.`, 'too_small', { field: key });
  if (opts.max != null && n > opts.max) throw bad(`${label} must be at most ${opts.max}.`, 'too_large', { field: key });
  return n;
}

export function bool(body: Record<string, unknown>, key: string, opts: { optional?: boolean } = {}): boolean | null {
  const raw = body[key];
  if (raw === undefined || raw === null) {
    if (opts.optional) return null;
    throw bad(`${key} is required.`, 'required', { field: key });
  }
  if (typeof raw !== 'boolean') throw bad(`${key} must be true or false.`, 'invalid_type', { field: key });
  return raw;
}

export function oneOf<T extends string>(body: Record<string, unknown>, key: string, allowed: readonly T[], opts: { optional?: boolean; label?: string } = {}): T | null {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') {
    if (opts.optional) return null;
    throw bad(`${opts.label ?? key} is required.`, 'required', { field: key });
  }
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    throw bad(`${opts.label ?? key} must be one of: ${allowed.join(', ')}.`, 'invalid_choice', { field: key });
  }
  return raw as T;
}

export function idList(body: Record<string, unknown>, key: string, opts: { max: number; min?: number; label?: string }): string[] {
  const raw = body[key];
  if (!Array.isArray(raw)) throw bad(`${opts.label ?? key} must be a list.`, 'invalid_type', { field: key });
  const ids = Array.from(new Set(raw.filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)) as string[]));
  if (ids.length !== raw.length) throw bad(`${opts.label ?? key} contains an invalid or repeated id.`, 'invalid_ids', { field: key });
  if (ids.length < (opts.min ?? 1)) throw bad(`Select at least ${opts.min ?? 1}.`, 'too_few', { field: key });
  if (ids.length > opts.max) throw bad(`You can select at most ${opts.max} at a time.`, 'too_many', { field: key, max: opts.max });
  return ids;
}

/** Validate a path parameter id. */
export function pathId(v: string | undefined): string {
  if (!v || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw notFound();
  return v;
}

export function countWords(text: string): number {
  const t = (text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Strip control characters (except tab/newline) from free text before storing it. */
export function cleanText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
