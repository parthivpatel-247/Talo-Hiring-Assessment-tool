import type { Env } from '../types';

/** Small helpers around D1 so route handlers stay readable. */

export function newId(prefix: string): string {
  // e.g. "cand_9f2a1c3d4e5f6789"
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export async function getCandidateByEmail(env: Env, email: string) {
  return env.DB.prepare('SELECT * FROM candidates WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .first();
}

export async function getCandidateById(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(id).first();
}

export async function getAttempt(env: Env, candidateId: string) {
  return env.DB.prepare('SELECT * FROM attempts WHERE candidate_id = ?')
    .bind(candidateId)
    .first();
}

export async function ensureAttempt(env: Env, candidateId: string) {
  const existing = await getAttempt(env, candidateId);
  if (existing) return existing;
  await env.DB.prepare('INSERT INTO attempts (candidate_id) VALUES (?)').bind(candidateId).run();
  return getAttempt(env, candidateId);
}

/**
 * Run a self-healing schema check at most ONCE per Worker instance. The checks
 * below used to run a PRAGMA (or CREATE) on every request that touched them —
 * thousands of times during a drive. A schema check that succeeded doesn't need
 * repeating for the life of the instance. A check that throws is NOT marked done,
 * so it retries next time.
 */
const ensured = new Set<string>();
export async function ensureOnce(key: string, fn: () => Promise<void>): Promise<void> {
  if (ensured.has(key)) return;
  await fn();
  ensured.add(key);
}
/** Tests reset the database between cases, so they must reset this cache too. */
export function resetEnsureCache(): void {
  ensured.clear();
}

/** Self-heal: question_bank gained a `hint` column (migration 0012). Keeps the
 *  candidate flow working even if the deployed DB hasn't had migrations re-applied. */
export async function ensureQuestionHintCol(env: Env): Promise<void> {
  try {
    await ensureOnce('qb.hint', async () => {
      const cols = await env.DB.prepare('PRAGMA table_info(question_bank)').all<{ name: string }>();
      if (!(cols.results ?? []).some((c) => c.name === 'hint')) {
        await env.DB.prepare('ALTER TABLE question_bank ADD COLUMN hint TEXT').run();
      }
    });
  } catch { /* best effort */ }
}

/** Ensure question_bank has the soft-delete column (migration 0013). */
export async function ensureQuestionDeletedCol(env: Env): Promise<void> {
  try {
    await ensureOnce('qb.deleted_at', async () => {
      const cols = await env.DB.prepare('PRAGMA table_info(question_bank)').all<{ name: string }>();
      if (!(cols.results ?? []).some((c) => c.name === 'deleted_at')) {
        await env.DB.prepare('ALTER TABLE question_bank ADD COLUMN deleted_at TEXT').run();
      }
    });
  } catch { /* best effort */ }
}

/** Ensure question_bank has the checkpoints column (migration 0014). */
export async function ensureQuestionCheckpointsCol(env: Env): Promise<void> {
  try {
    await ensureOnce('qb.checkpoints', async () => {
      const cols = await env.DB.prepare('PRAGMA table_info(question_bank)').all<{ name: string }>();
      if (!(cols.results ?? []).some((c) => c.name === 'checkpoints')) {
        await env.DB.prepare('ALTER TABLE question_bank ADD COLUMN checkpoints TEXT').run();
      }
    });
  } catch { /* best effort */ }
}

/** Ensure candidates has the grading-claim columns so concurrent analysis/run
 *  calls can each claim a DISJOINT batch of candidates to grade (no double work). */
export async function ensureGradingClaimCols(env: Env): Promise<void> {
  try {
    await ensureOnce('candidates.grading_claim', async () => {
      const cols = await env.DB.prepare('PRAGMA table_info(candidates)').all<{ name: string }>();
      const have = new Set((cols.results ?? []).map((c) => c.name));
      if (!have.has('grading_claim')) await env.DB.prepare('ALTER TABLE candidates ADD COLUMN grading_claim TEXT').run();
      if (!have.has('grading_claimed_at')) await env.DB.prepare('ALTER TABLE candidates ADD COLUMN grading_claimed_at TEXT').run();
    });
  } catch { /* best effort */ }
}

/**
 * Performance schema (also in migrations/0015_perf.sql — this self-heals it if
 * that file was never run):
 *   - idx_audit_action_cand: the Flags panel counts duplicate-login events per
 *     candidate; without this index every count scanned the whole audit table.
 *   - idx_qbank_deleted_cat: the deleted-question count and the category list
 *     read just the index instead of every question row.
 *   - part1_seen: every question a candidate has ever been assigned (survives retakes).
 *   - question_usage: how many students have seen each question — a small counter
 *     the rotation reads (one row per question) instead of re-counting all history.
 * The one-time backfills only run when the target table is still empty.
 */
export async function ensurePerfSchema(env: Env): Promise<void> {
  try {
    await ensureOnce('perf', async () => {
      await env.DB.batch([
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_action_cand ON admin_audit(action, candidate_id)'),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_qbank_deleted_cat ON question_bank(deleted_at, category)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS part1_seen (candidate_id TEXT NOT NULL, question_id TEXT NOT NULL, PRIMARY KEY (candidate_id, question_id))'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS question_usage (question_id TEXT PRIMARY KEY, uses INTEGER NOT NULL DEFAULT 0)'),
      ]);
      const seenAny = await env.DB.prepare('SELECT 1 FROM part1_seen LIMIT 1').first();
      if (!seenAny) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO part1_seen (candidate_id, question_id) SELECT candidate_id, question_id FROM part1_assignments'
        ).run();
      }
      const usageAny = await env.DB.prepare('SELECT 1 FROM question_usage LIMIT 1').first();
      if (!usageAny) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO question_usage (question_id, uses) SELECT question_id, COUNT(*) FROM part1_seen GROUP BY question_id'
        ).run();
      }
    });
  } catch { /* best effort — the rotation falls back gracefully if these are missing */ }
}

export function nowIso(): string {
  return new Date().toISOString();
}
