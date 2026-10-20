import type { AttemptRow, QuestionCategory } from '../env';
import type { Db } from '../db/db';
import { placeholders } from '../db/db';
import type { Settings } from './settings';

/**
 * The assessment clock, paper assignment and attempt events.
 *
 * Clock rules (server is the source of truth):
 *  - On start we freeze duration_seconds and set a HARD deadline:
 *      deadline = start + duration + pause allowance (default 10 min).
 *  - Each heartbeat subtracts the time since the previous one, capped at 15s,
 *    so a dropped connection pauses the clock (fair to students on bad Wi-Fi).
 *  - Remaining time can never exceed (deadline - now). A client that stops
 *    sending heartbeats can therefore gain at most the pause allowance.
 *  - Answers are accepted only while the attempt is open and before
 *    deadline + 30s. After that the attempt is closed on the server.
 */
export const HEARTBEAT_GAP_CAP_SECONDS = 15;
export const SAVE_GRACE_SECONDS = 30;

export function nowMs(): number {
  return Date.now();
}

export function deadlineMs(a: AttemptRow, s: Settings): number | null {
  if (!a.started_at) return null;
  if (a.deadline_at) return Date.parse(a.deadline_at);
  // Attempts started before v2 have no stored deadline.
  const duration = (a.duration_seconds ?? s.assessmentMinutes * 60) * 1000;
  return Date.parse(a.started_at) + duration + s.pauseAllowanceMinutes * 60_000;
}

/** Remaining seconds right now, without writing anything. */
export function remainingNow(a: AttemptRow, s: Settings, now = nowMs()): number {
  if (!a.started_at || a.submitted_at) return 0;
  const base = Number(a.remaining_seconds ?? a.duration_seconds ?? s.assessmentMinutes * 60);
  const last = a.last_heartbeat_at ? Date.parse(a.last_heartbeat_at) : Date.parse(a.started_at);
  const gap = Math.min(Math.max(0, (now - last) / 1000), HEARTBEAT_GAP_CAP_SECONDS);
  const byClock = base - gap;
  const dl = deadlineMs(a, s);
  const byDeadline = dl == null ? byClock : (dl - now) / 1000;
  return Math.max(0, Math.floor(Math.min(byClock, byDeadline)));
}

export function isOpen(a: AttemptRow): boolean {
  return !!a.started_at && !a.submitted_at;
}

/** True once the attempt can no longer accept answers. */
export function pastSaveWindow(a: AttemptRow, s: Settings, now = nowMs()): boolean {
  if (a.submitted_at) return true;
  const dl = deadlineMs(a, s);
  if (dl != null && now > dl + SAVE_GRACE_SECONDS * 1000) return true;
  return false;
}

/**
 * Every answer save also advances the clock, exactly like a heartbeat, so a
 * client that suppresses heartbeats gains no time. Once the clock reaches zero,
 * saves are accepted for SAVE_GRACE_SECONDS more (the final autosave), then refused.
 */
export function saveDecision(a: AttemptRow, s: Settings, now = nowMs()): { ok: boolean; remaining: number; lastIso: string | null } {
  if (!a.started_at || pastSaveWindow(a, s, now)) return { ok: false, remaining: 0, lastIso: null };
  const remaining = remainingNow(a, s, now);
  if (remaining > 0) return { ok: true, remaining, lastIso: new Date(now).toISOString() };
  const stored = Math.max(0, Number(a.remaining_seconds ?? 0));
  const last = a.last_heartbeat_at ? Date.parse(a.last_heartbeat_at) : Date.parse(a.started_at);
  // The moment the clock ran out: pin last_heartbeat_at there so the grace period can't be renewed.
  const zeroAt = Math.min(now, last + stored * 1000);
  return { ok: now - zeroAt <= SAVE_GRACE_SECONDS * 1000, remaining: 0, lastIso: new Date(zeroAt).toISOString() };
}

export function startStatements(db: Db, candidateId: string, s: Settings, durationSeconds?: number | null, now = new Date()): D1PreparedStatement[] {
  const duration = Math.max(60, Math.round(durationSeconds || s.assessmentMinutes * 60));
  const deadline = new Date(now.getTime() + (duration + s.pauseAllowanceMinutes * 60) * 1000).toISOString();
  const iso = now.toISOString();
  return [
    db.stmt(
      `UPDATE attempts SET started_at = ?, duration_seconds = ?, remaining_seconds = ?, last_heartbeat_at = ?, deadline_at = ?,
         updated_at = ? WHERE candidate_id = ? AND started_at IS NULL`,
      iso, duration, duration, iso, deadline, iso, candidateId
    ),
    db.stmt("UPDATE candidates SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'ready'", iso, candidateId),
  ];
}

export type SubmitReason = 'candidate' | 'time_up' | 'deadline' | 'left_screen' | 'reload' | 'admin' | 'revoked' | 'auto_close';

/** Close an attempt (idempotent) and move the candidate to "submitted". */
export function submitStatements(db: Db, candidateId: string, attemptNo: number, reason: SubmitReason, detail?: Record<string, unknown>): D1PreparedStatement[] {
  const iso = new Date().toISOString();
  return [
    db.stmt(
      `UPDATE attempts SET submitted_at = COALESCE(submitted_at, ?), submit_reason = COALESCE(submit_reason, ?), updated_at = ?
       WHERE candidate_id = ?`,
      iso, reason, iso, candidateId
    ),
    db.stmt("UPDATE candidates SET status = 'submitted', updated_at = ? WHERE id = ? AND status IN ('ready', 'in_progress')", iso, candidateId),
    eventStmt(db, candidateId, attemptNo, 'submit', { reason, ...(detail ?? {}) }),
  ];
}

export function eventStmt(db: Db, candidateId: string, attemptNo: number, type: string, detail?: Record<string, unknown> | null): D1PreparedStatement {
  return db.stmt(
    'INSERT INTO attempt_events (candidate_id, attempt_no, type, detail) VALUES (?, ?, ?, ?)',
    candidateId, attemptNo, type.slice(0, 40), detail ? JSON.stringify(detail).slice(0, 2000) : null
  );
}

/* ---------------- paper assignment (least-used rotation) ---------------- */

interface PoolRow {
  id: string;
  difficulty: string;
  assigned_count: number;
}

/**
 * Assign this candidate's paper, once. For each slot in the paper (category +
 * difficulty + count), pick the active questions seen by the FEWEST students so
 * far (random tie-break), never re-serving a question this candidate has already
 * seen (retakes get a fresh paper). If a pool runs out, top up from questions the
 * candidate has seen, so assignment never fails while the pool has any question.
 */
export async function ensurePaper(db: Db, candidateId: string, s: Settings): Promise<{ assigned: boolean; shortfall: string[] }> {
  const existing = await db.value<number>('SELECT COUNT(*) AS n FROM assignments WHERE candidate_id = ?', candidateId);
  if (existing && existing > 0) return { assigned: false, shortfall: [] };

  const categories = Array.from(new Set(s.paper.filter((x) => x.count > 0).map((x) => x.category)));
  if (!categories.length) return { assigned: false, shortfall: ['paper'] };
  const [pool, seen] = await Promise.all([
    db.all<PoolRow & { category: QuestionCategory }>(
      `SELECT id, category, difficulty, assigned_count FROM questions
       WHERE category IN (${placeholders(categories.length)}) AND active = 1 AND deleted_at IS NULL`,
      ...categories
    ),
    db.all<{ question_id: string }>('SELECT question_id FROM question_exposures WHERE candidate_id = ?', candidateId),
  ]);
  const seenSet = new Set(seen.map((r) => r.question_id));
  const picked: string[] = [];
  const used = new Set<string>();
  const shortfall: string[] = [];

  for (const slot of s.paper) {
    if (slot.count <= 0) continue;
    const candidates = pool.filter((q) => q.category === slot.category && (slot.difficulty === 'any' || q.difficulty === slot.difficulty) && !used.has(q.id));
    const key = (q: PoolRow) => Number(q.assigned_count) + Math.random();
    const fresh = candidates.filter((q) => !seenSet.has(q.id)).map((q) => ({ id: q.id, k: key(q) })).sort((a, b) => a.k - b.k);
    const repeat = candidates.filter((q) => seenSet.has(q.id)).map((q) => ({ id: q.id, k: key(q) })).sort((a, b) => a.k - b.k);
    const chosen = [...fresh, ...repeat].slice(0, slot.count).map((x) => x.id);
    if (chosen.length < slot.count) shortfall.push(`${slot.category}${slot.difficulty === 'any' ? '' : `/${slot.difficulty}`}`);
    for (const id of chosen) {
      used.add(id);
      picked.push(id);
    }
  }
  if (shortfall.length) return { assigned: false, shortfall };

  const iso = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  picked.forEach((qid, i) => {
    stmts.push(db.stmt('INSERT OR IGNORE INTO assignments (candidate_id, question_id, position, assigned_at) VALUES (?, ?, ?, ?)', candidateId, qid, i, iso));
  });
  for (const qid of picked) {
    if (seenSet.has(qid)) continue;
    stmts.push(db.stmt('INSERT OR IGNORE INTO question_exposures (candidate_id, question_id, first_seen_at) VALUES (?, ?, ?)', candidateId, qid, iso));
    stmts.push(db.stmt("UPDATE questions SET assigned_count = assigned_count + 1 WHERE id = ?", qid));
  }
  await db.batch(stmts);
  return { assigned: true, shortfall: [] };
}

/** The candidate-safe view of their paper: never includes answers keys or marks. */
export async function paperForCandidate(db: Db, candidateId: string) {
  const rows = await db.all<{
    id: string; category: QuestionCategory; title: string | null; topic: string | null; difficulty: string;
    prompt: string; sample_data: string | null; hint: string | null; answer: string | null; language: string | null; saved_at: string | null;
  }>(
    `SELECT q.id, q.category, q.title, q.topic, q.difficulty, q.prompt, q.sample_data, q.hint,
            a.answer_text AS answer, a.language, a.saved_at
     FROM assignments s JOIN questions q ON q.id = s.question_id
     LEFT JOIN answers a ON a.candidate_id = s.candidate_id AND a.question_id = s.question_id
     WHERE s.candidate_id = ? ORDER BY s.position`,
    candidateId
  );
  return rows.map((q) => ({
    id: q.id,
    category: q.category,
    title: q.title,
    topic: q.topic,
    difficulty: q.difficulty,
    prompt: q.prompt,
    sampleData: q.sample_data,
    hint: q.hint,
    answer: q.answer ?? '',
    language: q.language ?? null,
    savedAt: q.saved_at ?? null,
  }));
}

/** Languages the editor offers; the grader judges logic, not syntax. */
export const LANGUAGES = ['sql', 'python', 'java', 'cpp', 'c', 'javascript', 'csharp', 'go', 'pseudocode', 'text'] as const;
export type Language = (typeof LANGUAGES)[number];
