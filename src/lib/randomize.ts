import type { Env, QuestionBankRow } from '../types';
import { ensurePart3Schema, seedDefaultPart3 } from './part3bank';
import { ensurePerfSchema } from './db';

/**
 * Assigns each candidate a Part 1 set (N SQL + M Python + DSA + Scenario) by a
 * LEAST-USED ROTATION: each category's questions are drawn in order of how many
 * students have seen them so far (fewest first), with a random tie-break among
 * equally-used questions. So the whole bank is cycled through before any question
 * repeats, repeats are spread as evenly as the pool allows, and a candidate never
 * sees a question twice across attempts (their own history is excluded). No
 * question repeats within a single student's set.
 */
// A candidate's lifetime "seen" set lives in part1_seen — every question ever
// assigned to them, across ALL attempts. Unlike part1_assignments (which a retake
// deletes), it is never cleared, so a retake excludes everything already seen.
// part1_seen and the question_usage counter are created by ensurePerfSchema.

async function seenQuestionIds(env: Env, candidateId: string): Promise<Set<string>> {
  try {
    const rows = await env.DB.prepare('SELECT question_id FROM part1_seen WHERE candidate_id = ?')
      .bind(candidateId)
      .all<{ question_id: string }>();
    return new Set((rows.results ?? []).map((r) => r.question_id));
  } catch {
    return new Set();
  }
}

export async function assignPart1Questions(env: Env, candidateId: string): Promise<void> {
  const existing = await env.DB.prepare('SELECT 1 FROM part1_assignments WHERE candidate_id = ?')
    .bind(candidateId)
    .first();
  if (existing) return; // idempotent

  await ensurePerfSchema(env);
  const seen = await seenQuestionIds(env, candidateId); // exclude on retakes

  const sqlCount = Number(env.SQL_QUESTIONS_PER_STUDENT);
  const pyCount = Number(env.PYTHON_QUESTIONS_PER_STUDENT);
  const dsaCount = Number(env.DSA_QUESTIONS_PER_STUDENT || 0);
  const scenarioCount = Number(env.SCENARIO_QUESTIONS_PER_STUDENT || 0);

  const sqlIds = await pickLeastUsed(env, 'sql', sqlCount, seen);
  const pyIds = await pickLeastUsed(env, 'python', pyCount, seen);
  const dsaIds = await pickLeastUsed(env, 'dsa', dsaCount, seen);
  const scenarioIds = await pickLeastUsed(env, 'scenario', scenarioCount, seen);

  if (sqlIds.length < sqlCount || pyIds.length < pyCount || dsaIds.length < dsaCount || scenarioIds.length < scenarioCount) {
    throw new Error(
      `Question bank too small: need ${sqlCount} SQL + ${pyCount} Python + ${dsaCount} DSA + ${scenarioCount} Scenario active questions, ` +
      `have ${sqlIds.length} + ${pyIds.length} + ${dsaIds.length} + ${scenarioIds.length}.`
    );
  }

  const chosen = [...sqlIds, ...pyIds, ...dsaIds, ...scenarioIds];
  const ordered = shuffle(chosen);
  const stmt = env.DB.prepare(
    'INSERT INTO part1_assignments (candidate_id, question_id, position) VALUES (?, ?, ?)'
  );
  await env.DB.batch(ordered.map((qId, i) => stmt.bind(candidateId, qId, i)));

  // Record everything this candidate has now seen (so a future retake excludes it),
  // and bump the per-question usage counter for questions NEW to this candidate —
  // the counter is "distinct students who have seen it", so a top-up repeat of a
  // question they already saw doesn't count twice.
  try {
    const fresh = chosen.filter((qId) => !seen.has(qId));
    const seenStmt = env.DB.prepare('INSERT OR IGNORE INTO part1_seen (candidate_id, question_id) VALUES (?, ?)');
    const usageStmt = env.DB.prepare(
      'INSERT INTO question_usage (question_id, uses) VALUES (?, 1) ON CONFLICT(question_id) DO UPDATE SET uses = uses + 1'
    );
    await env.DB.batch([
      ...chosen.map((qId) => seenStmt.bind(candidateId, qId)),
      ...fresh.map((qId) => usageStmt.bind(qId)),
    ]);
  } catch { /* best effort — never block the assessment over history bookkeeping */ }
}

/**
 * Pick `count` active question ids from a category by LEAST-USED ROTATION.
 *
 * Goal: every candidate gets the questions seen by the FEWEST students so far, so
 * the whole bank is cycled through before any question repeats — repeats are
 * minimised and spread as evenly as the pool allows. With a pool of P questions
 * and S students, each question is used either floor(S/P) or ceil(S/P) times.
 *
 *   - "times seen" = number of DISTINCT students who have ever been assigned the
 *     question, kept in the small question_usage counter (one row per question,
 *     bumped on assignment, never dropped by a retake). So the rotation reads ~one
 *     row per question instead of re-counting every past assignment.
 *   - FAIRNESS PER CANDIDATE: the `exclude` set (everything this candidate has
 *     already seen) is skipped first, so a retake is a genuinely fresh paper.
 *   - RANDOM TIE-BREAK: among questions with the SAME least-used count, one is
 *     chosen at random (key = uses + random in [0,1)), so two students sitting at
 *     the same usage tier don't deterministically get the same question — yet the
 *     ordering by usage is never violated.
 *
 * If excluding the seen set leaves too few questions (a candidate past the pool
 * size on repeated retakes), we top up from the seen ones by the same ordering,
 * so assignment never fails.
 */
async function pickLeastUsed(
  env: Env,
  category: 'sql' | 'python' | 'dsa' | 'scenario',
  count: number,
  exclude: Set<string> = new Set()
): Promise<string[]> {
  if (count <= 0) return [];
  // Reads only this category's pool (via idx_qbank_cat_active) plus one counter row
  // per question — not the whole assignment history, which grew with every student.
  const rows = await env.DB.prepare(
    `SELECT qb.id AS id, COALESCE(u.uses, 0) AS uses
     FROM question_bank qb
     LEFT JOIN question_usage u ON u.question_id = qb.id
     WHERE qb.category = ? AND qb.active = 1 AND qb.deleted_at IS NULL`
  )
    .bind(category)
    .all<{ id: string; uses: number }>();
  const pool = rows.results ?? [];

  // Lower key wins. The integer usage dominates; the random fraction only breaks
  // ties within the same usage count.
  const keyOf = (uses: number) => Number(uses) + Math.random();

  const fresh = pool.filter((q) => !exclude.has(q.id)).map((q) => ({ id: q.id, key: keyOf(q.uses) }));
  fresh.sort((a, b) => a.key - b.key);
  const picked = fresh.slice(0, count).map((k) => k.id);

  if (picked.length < count) {
    const used = new Set(picked);
    const rest = pool
      .filter((q) => exclude.has(q.id) && !used.has(q.id))
      .map((q) => ({ id: q.id, key: keyOf(q.uses) }));
    rest.sort((a, b) => a.key - b.key);
    for (const r of rest) {
      if (picked.length >= count) break;
      picked.push(r.id);
    }
  }
  return picked;
}

/**
 * Assign each candidate their Part 3 set: N buggy_fix + M scenario questions,
 * drawn randomly from the active Part 3 bank. Self-heals the schema and, if the
 * bank is empty, seeds the built-in default questions first — so Part 3 works
 * even if the admin never manually seeded and migrations weren't run. Never
 * throws for a too-small bank (Part 3 must never block finishing the assessment):
 * it assigns as many of each kind as exist.
 */
export async function assignPart3Questions(env: Env, candidateId: string): Promise<void> {
  await ensurePart3Schema(env);
  const existing = await env.DB.prepare('SELECT 1 FROM part3_assignments WHERE candidate_id = ?')
    .bind(candidateId)
    .first();
  if (existing) return; // idempotent

  // Auto-seed the built-in bank the first time it's needed and still empty.
  const count = await env.DB.prepare('SELECT COUNT(*) as n FROM part3_questions WHERE active = 1').first<{ n: number }>();
  if (!count || count.n === 0) {
    await seedDefaultPart3(env);
  }

  const buggyCount = Number(env.PART3_BUGGY_PER_STUDENT ?? 1);
  const scenarioCount = Number(env.PART3_SCENARIO_PER_STUDENT ?? 1);

  const buggyPool = await env.DB.prepare("SELECT id FROM part3_questions WHERE kind = 'buggy_fix' AND active = 1")
    .all<{ id: string }>();
  const scenarioPool = await env.DB.prepare("SELECT id FROM part3_questions WHERE kind = 'scenario' AND active = 1")
    .all<{ id: string }>();

  const buggyIds = shuffle(buggyPool.results?.map((r) => r.id) ?? []).slice(0, buggyCount);
  const scenarioIds = shuffle(scenarioPool.results?.map((r) => r.id) ?? []).slice(0, scenarioCount);

  // buggy first, then scenario (stable ordering the candidate sees).
  const ordered = [...buggyIds, ...scenarioIds];
  if (!ordered.length) return; // nothing to assign — candidate will simply finish

  const stmt = env.DB.prepare(
    'INSERT OR IGNORE INTO part3_assignments (candidate_id, question_id, position) VALUES (?, ?, ?)'
  );
  await env.DB.batch(ordered.map((qId, i) => stmt.bind(candidateId, qId, i)));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
