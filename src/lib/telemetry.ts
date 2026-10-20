import type { Env } from '../env';
import { Db, type DbStats } from '../db/db';
import { sha256Hex } from './security';

/**
 * Lightweight, first-party telemetry. No third-party scripts, no cookies, no
 * personal data:
 *  - usage_daily: requests and D1 rows read/written per route per day (approximate;
 *    aggregated in memory and flushed in batches to keep writes low)
 *  - analytics_daily: counts of a few product events (page views, sign-ins, submits)
 *  - client_errors / server errors: deduplicated by fingerprint with a counter
 */

type Bucket = { requests: number; reads: number; writes: number };
const pending = new Map<string, Bucket>();
let pendingRequests = 0;
let lastFlush = Date.now();
const FLUSH_EVERY_MS = 20_000;
const FLUSH_AT_REQUESTS = 40;

export function day(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function recordUsage(env: Env, exec: ExecutionContext, route: string, stats: DbStats): void {
  const key = `${day()}|${route}`;
  const b = pending.get(key) ?? { requests: 0, reads: 0, writes: 0 };
  b.requests += 1;
  b.reads += stats.rowsRead;
  b.writes += stats.rowsWritten;
  pending.set(key, b);
  pendingRequests += 1;
  if (pendingRequests >= FLUSH_AT_REQUESTS || Date.now() - lastFlush > FLUSH_EVERY_MS) {
    exec.waitUntil(flushUsage(env).catch((e) => console.error('usage flush failed', e)));
  }
}

export async function flushUsage(env: Env): Promise<void> {
  if (!pending.size) return;
  const items = Array.from(pending.entries());
  pending.clear();
  pendingRequests = 0;
  lastFlush = Date.now();
  const db = new Db(env.DB);
  await db.batch(
    items.map(([key, b]) => {
      const [d, route] = key.split('|');
      return db.stmt(
        `INSERT INTO usage_daily (day, route, requests, rows_read, rows_written) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(day, route) DO UPDATE SET requests = requests + excluded.requests,
           rows_read = rows_read + excluded.rows_read, rows_written = rows_written + excluded.rows_written`,
        d, route, b.requests, b.reads, b.writes
      );
    })
  );
}

export const ANALYTICS_EVENTS = new Set([
  'view_candidate_login', 'view_candidate_rules', 'view_candidate_exam', 'view_admin_login', 'view_privacy', 'view_terms', 'view_404',
  'candidate_login', 'candidate_start', 'candidate_submit', 'admin_login',
]);

export async function track(db: Db, event: string, path = ''): Promise<void> {
  if (!ANALYTICS_EVENTS.has(event)) return;
  try {
    await db.run(
      `INSERT INTO analytics_daily (day, event, path, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(day, event, path) DO UPDATE SET count = count + 1`,
      day(), event, path.slice(0, 120)
    );
  } catch (e) {
    console.error('analytics write failed', e);
  }
}

export async function recordError(db: Db, e: { surface: string; message: string; source?: string; stack?: string; url?: string; userAgent?: string }): Promise<void> {
  const message = String(e.message || 'Unknown error').slice(0, 500);
  const source = (e.source || '').slice(0, 300);
  const fingerprint = await sha256Hex(`${e.surface}|${message}|${source}`);
  try {
    await db.run(
      `INSERT INTO client_errors (fingerprint, surface, message, source, stack, url, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET count = count + 1, last_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         stack = COALESCE(excluded.stack, stack), url = excluded.url, user_agent = excluded.user_agent`,
      fingerprint, e.surface.slice(0, 20), message, source || null, (e.stack || '').slice(0, 4000) || null,
      (e.url || '').slice(0, 300) || null, (e.userAgent || '').slice(0, 300) || null
    );
  } catch (err) {
    console.error('error record failed', err);
  }
}
