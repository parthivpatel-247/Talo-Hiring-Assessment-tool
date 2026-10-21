import type { Env } from './types';
import { handleAdminRoute } from './routes/admin';
import { handleCandidateRoute } from './routes/candidate';
import { json } from './lib/auth';
import { ensurePart3Schema } from './lib/part3bank';
import { isDocs } from './lib/team';
import { purgeExpiredDocs } from './routes/admin-docs';

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
  },
};

export async function purgeExpiredCandidates(env: Env): Promise<void> {
  const retentionDays = Number(env.DATA_RETENTION_DAYS);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  // Make sure the Part 3 tables exist before deleting from them — otherwise, on a
  // DB where migration 0008 wasn't applied, the DELETE would throw and abort the
  // whole purge (leaving ALL expired candidate data in place).
  await ensurePart3Schema(env);

  const expired = await env.DB.prepare('SELECT id, resume_r2_key FROM candidates WHERE created_at < ?')
    .bind(cutoff)
    .all<{ id: string; resume_r2_key: string }>();

  for (const candidate of expired.results ?? []) {
    await env.RESUMES.delete(candidate.resume_r2_key).catch(() => {});
    // Delete EVERY table that holds this candidate's data, including Part 3, so
    // nothing lingers past DATA_RETENTION_DAYS (retention contract).
    await env.DB.batch([
      env.DB.prepare('DELETE FROM interview_questions WHERE candidate_id = ?').bind(candidate.id),
      env.DB.prepare('DELETE FROM part3_answers WHERE candidate_id = ?').bind(candidate.id),
      env.DB.prepare('DELETE FROM part2_answers WHERE candidate_id = ?').bind(candidate.id),
      env.DB.prepare('DELETE FROM part1_answers WHERE candidate_id = ?').bind(candidate.id),
      env.DB.prepare('DELETE FROM part3_assignments WHERE candidate_id = ?').bind(candidate.id),
      env.DB.prepare('DELETE FROM part2_questions WHERE candidate_id = ?').bind(candidate.id),
      env.DB.prepare('DELETE FROM part1_assignments WHERE candidate_id = ?').bind(candidate.id),
      env.DB.prepare('DELETE FROM attempts WHERE candidate_id = ?').bind(candidate.id),
      env.DB.prepare('DELETE FROM candidates WHERE id = ?').bind(candidate.id),
    ]);
  }
}
