import type { Db } from '../db/db';
import { HttpError } from './http';

/**
 * Fixed-window rate limiting backed by D1 (one upsert per hit). Used on every
 * public form: admin login, candidate login, code requests, password reset,
 * client error reports. Rows are cleaned up by the daily cron.
 */
export async function hit(db: Db, bucket: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfter: number; count: number }> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSeconds;
  const row = await db.first<{ count: number; window_start: number; blocked_until: number | null }>(
    `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END
     RETURNING count, window_start, blocked_until`,
    bucket.slice(0, 200), now, cutoff, cutoff
  );
  const count = Number(row?.count ?? 1);
  const windowStart = Number(row?.window_start ?? now);
  const blockedUntil = Number(row?.blocked_until ?? 0);
  if (blockedUntil > now) return { ok: false, retryAfter: blockedUntil - now, count };
  if (count > limit) return { ok: false, retryAfter: Math.max(1, windowStart + windowSeconds - now), count };
  return { ok: true, retryAfter: 0, count };
}

/** Throw 429 if the bucket is over its limit. */
export async function enforce(db: Db, bucket: string, limit: number, windowSeconds: number, message?: string): Promise<void> {
  const r = await hit(db, bucket, limit, windowSeconds);
  if (!r.ok) {
    throw new HttpError(429, message ?? `Too many attempts. Please wait ${humanWait(r.retryAfter)} and try again.`, 'rate_limited', { retryAfter: r.retryAfter });
  }
}

export async function block(db: Db, bucket: string, seconds: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.run(
    `INSERT INTO rate_limits (bucket, count, window_start, blocked_until) VALUES (?, 0, ?, ?)
     ON CONFLICT(bucket) DO UPDATE SET blocked_until = excluded.blocked_until`,
    bucket.slice(0, 200), now, now + seconds
  );
}

export async function clear(db: Db, bucket: string): Promise<void> {
  await db.run('DELETE FROM rate_limits WHERE bucket = ?', bucket.slice(0, 200));
}

export function humanWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const m = Math.ceil(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}
