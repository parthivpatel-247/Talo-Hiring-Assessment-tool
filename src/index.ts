import type { Env } from './types';
import { handleAdminRoute } from './routes/admin';
import { handleCandidateRoute } from './routes/candidate';
import { json } from './lib/auth';
import { ensurePart3Schema } from './lib/part3bank';
import { isDocs } from './lib/team';
import { purgeExpiredDocs } from './routes/admin-docs';
import { requestGuard, purgeRateLimits } from './lib/ratelimit';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Cross-site request guard: a browser always sends Origin on POST/PUT/DELETE.
      // If it names another site, refuse — so no other page can make a signed-in
      // admin's or candidate's browser change data here. (Tools that send no Origin,
      // like curl, are unaffected; they need the session cookie anyway.)
      if (path.startsWith('/api/') && request.method !== 'GET' && request.method !== 'HEAD') {
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) return json({ error: 'Cross-site request refused' }, { status: 403 });
      }
      // Per-request ceilings on every API call (src/lib/ratelimit.ts). Static files
      // are served by Cloudflare before the Worker runs, so they never reach this.
      if (path.startsWith('/api/')) {
        const limited = await requestGuard(request, env);
        if (limited) return limited;
      }
      if (path.startsWith('/api/admin/')) {
        return await handleAdminRoute(request, env, ctx, path);
      }
      if (path.startsWith('/api/candidate/')) {
        return await handleCandidateRoute(request, env, ctx, path);
      }
      if (path === '/api/health') {
        return json({ ok: true, time: new Date().toISOString() });
      }
      // Everything else is the static frontend (public/), served by the
      // Worker's assets binding — see [assets] in wrangler.toml.
      return await env.ASSETS.fetch(request);
    } catch (err) {
      // Log full detail server-side, but never return internal error text to the
      // client — an unhandled error reaches unauthenticated/candidate callers too,
      // and the message can disclose schema or implementation details.
      console.error('Unhandled error:', err);
      return json({ error: 'Internal error' }, { status: 500 });
    }
  },

  // Daily retention sweep: delete candidate data (and their resume in R2)
  // once it's past DATA_RETENTION_DAYS old. Runs on the cron schedule in
  // wrangler.toml.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // The writers site purges set-based (fixed query count) — see purgeExpiredDocs.
    ctx.waitUntil(isDocs(env) ? purgeExpiredDocs(env) : purgeExpiredCandidates(env));
    // Old sign-in counters (both sites).
    ctx.waitUntil(purgeRateLimits(env).catch((err) => console.error('rate_limits purge failed:', err)));
  },
};

export async function purgeExpiredCandidates(env: Env): Promise<void> {
  // Set-based, like the writers site's purge: a fixed number of queries however many
  // candidates expire. Compared in SQLite's own date format (the stored one), so
  // nobody is deleted early on the cutoff day.
  const days = Math.max(1, Math.round(Number(env.DATA_RETENTION_DAYS) || 15));
  const age = `-${days} days`;

  // Make sure the Part 3 tables exist before deleting from them — otherwise, on a
  // DB where migration 0008 wasn't applied, the DELETE would throw and abort the
  // whole purge (leaving ALL expired candidate data in place).
  await ensurePart3Schema(env);

  const expired = (await env.DB.prepare("SELECT resume_r2_key FROM candidates WHERE created_at < datetime('now', ?)")
    .bind(age).all<{ resume_r2_key: string | null }>()).results ?? [];
  const keys = expired.map((r) => r.resume_r2_key).filter((k): k is string => !!k);
  for (let i = 0; i < keys.length; i += 1000) {
    await env.RESUMES.delete(keys.slice(i, i + 1000)).catch(() => {});
  }
  // Every table that holds a candidate's data, so nothing lingers past
  // DATA_RETENTION_DAYS (retention contract). One batch = one transaction.
  const sub = "SELECT id FROM candidates WHERE created_at < datetime('now', ?)";
  const tables = ['interview_questions', 'part3_answers', 'part2_answers', 'part1_answers', 'part3_assignments', 'part2_questions', 'part1_assignments', 'part1_seen', 'attempts'];
  await env.DB.batch([
    ...tables.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE candidate_id IN (${sub})`).bind(age)),
    env.DB.prepare("DELETE FROM candidates WHERE created_at < datetime('now', ?)").bind(age),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"),
    // The activity log keeps snapshots of deleted candidates (name, email, scores);
    // it follows the same retention period.
    env.DB.prepare("DELETE FROM admin_audit WHERE created_at < datetime('now', ?)").bind(age),
  ]);
}
