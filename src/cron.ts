import type { Env } from './env';
import { Db, IN_JSON } from './db/db';
import { ensureSchema } from './db/migrate';
import { getSettings } from './lib/settings';
import { closeExpiredAttempts, fullBackup } from './routes/admin/reports';
import { flushUsage } from './lib/telemetry';

/**
 * Scheduled jobs (see [triggers] in wrangler.toml):
 *   every 10 minutes  close attempts past their hard deadline; flush usage counters
 *   daily 03:00 UTC   data-retention purge, expired backups/exports, daily backup, housekeeping
 */
export async function runScheduled(cron: string, env: Env): Promise<void> {
  const db = new Db(env.DB);
  await ensureSchema(env, db);
  const s = await getSettings(env, db);
  if (cron.startsWith('*/')) {
    const closed = await closeExpiredAttempts(env, db, s);
    if (closed) console.log(`auto-closed ${closed} attempt(s)`);
    await flushUsage(env);
    return;
  }
  await retentionPurge(env, db, s.retentionDays);
  await fullBackup(env, db, 'daily', 'system').catch((e) => console.error('daily backup failed', e));
  await housekeeping(db);
}

export async function retentionPurge(env: Env, db: Db, retentionDays: number): Promise<{ candidates: number; backups: number; exports: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const expired = await db.all<{ id: string; resume_key: string | null }>('SELECT id, resume_key FROM candidates WHERE created_at < ?', cutoff);
  for (let i = 0; i < expired.length; i += 50) {
    const chunk = expired.slice(i, i + 50);
    const ids = chunk.map((c) => c.id);
    for (const c of chunk) if (c.resume_key) await env.RESUMES.delete(c.resume_key).catch(() => {});
    await db.batch([
      db.stmt(`UPDATE questions SET assigned_count = MAX(0, assigned_count - (SELECT COUNT(*) FROM question_exposures e WHERE e.question_id = questions.id AND e.candidate_id IN ${IN_JSON}))
               WHERE id IN (SELECT question_id FROM question_exposures WHERE candidate_id IN ${IN_JSON})`, JSON.stringify(ids), JSON.stringify(ids)),
      db.stmt(`DELETE FROM similarity_flags WHERE candidate_a IN ${IN_JSON} OR candidate_b IN ${IN_JSON}`, JSON.stringify(ids), JSON.stringify(ids)),
      db.stmt(`DELETE FROM candidates WHERE id IN ${IN_JSON}`, JSON.stringify(ids)),
      db.stmt("INSERT INTO audit_log (actor_email, action, target_type, detail) VALUES ('system', 'retention_purge', 'candidates', ?)", JSON.stringify({ count: ids.length, retentionDays })),
    ]);
  }
  // Backups and exports hold personal data too: they expire with the same window.
  const oldBackups = await db.all<{ id: string; r2_key: string }>(
    "SELECT id, r2_key FROM backups WHERE (expires_at IS NOT NULL AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (kind = 'pre_migration' AND created_at < ?)",
    cutoff
  );
  for (const b of oldBackups) {
    const prefix = b.r2_key.replace(/[^/]+$/, '');
    if (prefix.startsWith('backups/') && prefix !== 'backups/') {
      const list = await env.RESUMES.list({ prefix });
      for (const o of list.objects) await env.RESUMES.delete(o.key).catch(() => {});
    } else {
      await env.RESUMES.delete(b.r2_key).catch(() => {});
    }
    await db.run('DELETE FROM backups WHERE id = ?', b.id);
  }
  const oldExports = await db.all<{ id: string; r2_key: string | null }>('SELECT id, r2_key FROM exports WHERE created_at < ?', cutoff);
  for (const e of oldExports) {
    if (e.r2_key) await env.RESUMES.delete(e.r2_key).catch(() => {});
    await db.run('DELETE FROM exports WHERE id = ?', e.id);
  }
  await db.run("DELETE FROM data_requests WHERE status != 'open' AND resolved_at < ?", new Date(Date.now() - 365 * 86_400_000).toISOString());
  return { candidates: expired.length, backups: oldBackups.length, exports: oldExports.length };
}

async function housekeeping(db: Db): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.stmt('DELETE FROM rate_limits WHERE window_start < ? AND (blocked_until IS NULL OR blocked_until < ?)', now - 86_400, now),
    db.stmt("DELETE FROM auth_challenges WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')"),
    db.stmt("DELETE FROM admin_sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') OR revoked_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')"),
    db.stmt("DELETE FROM client_errors WHERE last_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')"),
    db.stmt("DELETE FROM usage_daily WHERE day < strftime('%Y-%m-%d','now','-120 days')"),
    db.stmt("DELETE FROM analytics_daily WHERE day < strftime('%Y-%m-%d','now','-400 days')"),
    db.stmt("DELETE FROM audit_log WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-400 days')"),
  ]);
}
