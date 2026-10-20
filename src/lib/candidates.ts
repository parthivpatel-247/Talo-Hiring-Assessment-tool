import type { Env } from '../env';
import type { Db } from '../db/db';
import { newId, placeholders, parseJson, IN_JSON } from '../db/db';
import type { Ctx } from './context';
import { auditStmt } from './audit';
import { eventStmt } from './exam';
import { HttpError } from './http';

/** One row per candidate for the admin table: identity, attempt and integrity counters, score. */
export async function listCandidates(db: Db, filter: { ids?: string[] } = {}) {
  const where = filter.ids?.length ? `WHERE c.id IN ${IN_JSON}` : '';
  const rows = await db.all<Record<string, unknown>>(
    `SELECT c.id, c.name, c.email, c.email_status, c.status, c.college_id, col.name AS college, c.drive_id, d.name AS drive,
            c.resume_college, c.access_revoked, c.is_test, c.parse_error, c.parse_warnings, c.created_at, c.updated_at,
            c.invite_code_set_at, c.invite_sent_at, c.resume_filename, c.score_awarded, c.score_max, c.graded_at, c.decided_at,
            a.attempt_no, a.started_at, a.submitted_at, a.submit_reason, a.duration_seconds, a.remaining_seconds, a.deadline_at,
            a.login_count, a.blocked_login_count, a.tab_switch_count, a.offline_count, a.offline_seconds, a.paste_blocked_count,
            a.last_heartbeat_at, a.last_login_at,
            (SELECT COUNT(*) FROM answers an WHERE an.candidate_id = c.id AND an.word_count > 0) AS answered,
            (SELECT COUNT(*) FROM assignments s WHERE s.candidate_id = c.id) AS question_count,
            (SELECT COUNT(*) FROM similarity_flags sf WHERE sf.candidate_a = c.id OR sf.candidate_b = c.id) AS similar_count
     FROM candidates c
     LEFT JOIN colleges col ON col.id = c.college_id
     LEFT JOIN drives d ON d.id = c.drive_id
     LEFT JOIN attempts a ON a.candidate_id = c.id
     ${where}
     ORDER BY c.created_at`,
    ...(filter.ids?.length ? [JSON.stringify(filter.ids)] : [])
  );
  return rows.map(shapeCandidate);
}

export function timeUsedSeconds(r: Record<string, unknown>): number | null {
  if (!r.started_at) return null;
  const duration = Number(r.duration_seconds ?? 0);
  const remaining = Number(r.remaining_seconds ?? duration);
  if (!duration) return null;
  return Math.max(0, Math.min(duration, duration - remaining));
}

function shapeCandidate(r: Record<string, unknown>) {
  const pending = String(r.email).startsWith('pending+');
  const lastHb = r.last_heartbeat_at ? Date.parse(String(r.last_heartbeat_at)) : 0;
  return {
    id: r.id as string,
    name: (r.name as string) ?? null,
    email: pending ? null : (r.email as string),
    emailStatus: r.email_status as string,
    status: r.status as string,
    collegeId: (r.college_id as string) ?? null,
    college: (r.college as string) ?? null,
    resumeCollege: (r.resume_college as string) ?? null,
    driveId: (r.drive_id as string) ?? null,
    drive: (r.drive as string) ?? null,
    accessRevoked: !!r.access_revoked,
    isTest: !!r.is_test,
    parseError: (r.parse_error as string) ?? null,
    parseWarnings: (r.parse_warnings as string) ?? null,
    resumeFilename: (r.resume_filename as string) ?? null,
    hasPersonalCode: !!r.invite_code_set_at,
    inviteSentAt: (r.invite_sent_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    attemptNo: Number(r.attempt_no ?? 1),
    startedAt: (r.started_at as string) ?? null,
    submittedAt: (r.submitted_at as string) ?? null,
    submitReason: (r.submit_reason as string) ?? null,
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    remainingSeconds: r.remaining_seconds == null ? null : Number(r.remaining_seconds),
    timeUsedSeconds: timeUsedSeconds(r),
    online: !!r.started_at && !r.submitted_at && Date.now() - lastHb < 45_000,
    lastSeenAt: (r.last_heartbeat_at as string) ?? (r.last_login_at as string) ?? null,
    answered: Number(r.answered ?? 0),
    questionCount: Number(r.question_count ?? 0),
    score: r.score_awarded == null ? null : Number(r.score_awarded),
    maxScore: r.score_max == null ? null : Number(r.score_max),
    gradedAt: (r.graded_at as string) ?? null,
    signals: {
      logins: Number(r.login_count ?? 0),
      blockedLogins: Number(r.blocked_login_count ?? 0),
      tabSwitches: Number(r.tab_switch_count ?? 0),
      offline: Number(r.offline_count ?? 0),
      offlineSeconds: Number(r.offline_seconds ?? 0),
      pasteBlocked: Number(r.paste_blocked_count ?? 0),
      similar: Number(r.similar_count ?? 0),
    },
  };
}

export type CandidateSummary = ReturnType<typeof shapeCandidate>;

/* ---------------- backups (delete with backup, restore) ---------------- */

const CANDIDATE_TABLES = ['candidates', 'attempts', 'assignments', 'answers', 'question_exposures', 'interview_questions', 'attempt_events'] as const;

export async function snapshotCandidates(db: Db, ids: string[]): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of CANDIDATE_TABLES) {
    const col = t === 'candidates' ? 'id' : 'candidate_id';
    out[t] = await db.all(`SELECT * FROM ${t} WHERE ${col} IN ${IN_JSON}`, JSON.stringify(ids));
  }
  return out;
}

/**
 * Delete candidates and everything that belongs to them, after writing a
 * restorable backup to R2 (rows + a copy of each resume). The backup expires
 * with the data-retention window, after which the data is gone for good.
 */
export async function deleteCandidatesWithBackup(ctx: Ctx, ids: string[], opts: { retentionDays: number; reason: string }): Promise<{ deleted: number; backupId: string }> {
  const { env, db } = ctx;
  const snapshot = await snapshotCandidates(db, ids);
  const cands = snapshot.candidates as { id: string; resume_key: string | null; email: string; name: string | null }[];
  if (!cands.length) throw new HttpError(404, 'None of those candidates exist (they may already be deleted).', 'not_found');
  const backupId = newId('bak');
  const resumeCopies: Record<string, string> = {};
  for (const c of cands) {
    if (!c.resume_key) continue;
    const obj = await env.RESUMES.get(c.resume_key);
    if (obj) {
      const key = `backups/${backupId}/resumes/${c.id}.pdf`;
      await env.RESUMES.put(key, await obj.arrayBuffer(), { httpMetadata: { contentType: 'application/pdf' } });
      resumeCopies[c.id] = key;
    }
  }
  const body = JSON.stringify({ kind: 'pre_delete', at: new Date().toISOString(), by: ctx.admin?.email ?? 'system', reason: opts.reason, resumeCopies, tables: snapshot });
  const key = `backups/${backupId}/data.json`;
  await env.RESUMES.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  const expires = new Date(Date.now() + opts.retentionDays * 86_400_000).toISOString();
  const real = cands.map((c) => c.id);
  const ph = IN_JSON;
  const realJson = JSON.stringify(real);
  await db.batch([
    db.stmt(
      'INSERT INTO backups (id, kind, r2_key, summary, candidate_count, bytes, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      backupId, 'pre_delete', key,
      `${opts.reason}: ${cands.slice(0, 5).map((c) => c.name || c.email).join(', ')}${cands.length > 5 ? ` and ${cands.length - 5} more` : ''}`,
      cands.length, body.length, ctx.admin?.email ?? 'system', expires
    ),
    // Give back each question's rotation count for the deleted candidates.
    db.stmt(`UPDATE questions SET assigned_count = MAX(0, assigned_count - (SELECT COUNT(*) FROM question_exposures e WHERE e.question_id = questions.id AND e.candidate_id IN ${ph}))
             WHERE id IN (SELECT question_id FROM question_exposures WHERE candidate_id IN ${ph})`, realJson, realJson),
    db.stmt(`DELETE FROM similarity_flags WHERE candidate_a IN ${ph} OR candidate_b IN ${ph}`, realJson, realJson),
    db.stmt(`DELETE FROM candidates WHERE id IN ${ph}`, realJson), // cascades to every child table
    auditStmt(ctx, 'candidates_deleted', { type: 'backup', id: backupId }, { count: real.length, ids: real, reason: opts.reason }),
  ]);
  for (const c of cands) if (c.resume_key) await env.RESUMES.delete(c.resume_key).catch(() => {});
  return { deleted: real.length, backupId };
}

export async function restoreBackup(ctx: Ctx, backupId: string): Promise<{ restored: number }> {
  const { env, db } = ctx;
  const b = await db.first<{ r2_key: string; kind: string; restored_at: string | null }>('SELECT r2_key, kind, restored_at FROM backups WHERE id = ?', backupId);
  if (!b) throw new HttpError(404, 'Backup not found.', 'not_found');
  if (b.kind !== 'pre_delete') throw new HttpError(400, 'Only deletion backups can be restored from the portal. Restore full database backups with Cloudflare D1 Time Travel.', 'not_restorable');
  if (b.restored_at) throw new HttpError(409, 'This backup has already been restored.', 'already_restored');
  const obj = await env.RESUMES.get(b.r2_key);
  if (!obj) throw new HttpError(410, 'The backup file has expired or was removed.', 'gone');
  const data = parseJson<{ tables: Record<string, Record<string, unknown>[]>; resumeCopies: Record<string, string> }>(await obj.text(), { tables: {}, resumeCopies: {} });
  const cands = data.tables.candidates ?? [];
  const emails = cands.map((c) => String(c.email));
  if (emails.length) {
    const clash = await db.all<{ email: string }>(`SELECT email FROM candidates WHERE email IN ${IN_JSON}`, JSON.stringify(emails));
    if (clash.length) throw new HttpError(409, `Cannot restore: ${clash.map((c) => c.email).join(', ')} already exist(s). Delete or rename them first.`, 'email_in_use');
  }
  const questionIds = new Set((await db.all<{ id: string }>('SELECT id FROM questions')).map((q) => q.id));
  const collegeIds = new Set((await db.all<{ id: string }>('SELECT id FROM colleges')).map((q) => q.id));
  const driveIds = new Set((await db.all<{ id: string }>('SELECT id FROM drives')).map((q) => q.id));
  const stmts: D1PreparedStatement[] = [];
  const insertRows = (table: string, rows: Record<string, unknown>[]) => {
    for (const original of rows) {
      const row = { ...original };
      if ('question_id' in row && !questionIds.has(String(row.question_id))) continue;
      if (table === 'attempts') row.session_nonce = null; // restored candidates sign in again
      if (table === 'candidates') {
        if (row.college_id && !collegeIds.has(String(row.college_id))) row.college_id = null;
        if (row.drive_id && !driveIds.has(String(row.drive_id))) row.drive_id = null;
      }
      const cols = Object.keys(row).filter((k) => !(table === 'attempt_events' && k === 'id'));
      stmts.push(db.stmt(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders(cols.length)})`, ...cols.map((k) => row[k] as never)));
    }
  };
  for (const c of cands) {
    const copy = data.resumeCopies?.[String(c.id)];
    if (copy) {
      const pdf = await env.RESUMES.get(copy);
      if (pdf) {
        const key = String(c.resume_key || `resumes/${c.id}.pdf`);
        await env.RESUMES.put(key, await pdf.arrayBuffer(), { httpMetadata: { contentType: 'application/pdf' } });
      }
    }
  }
  for (const t of CANDIDATE_TABLES) insertRows(t, data.tables[t] ?? []);
  stmts.push(db.stmt("UPDATE backups SET restored_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", backupId));
  stmts.push(auditStmt(ctx, 'backup_restored', { type: 'backup', id: backupId }, { candidates: cands.length }));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  // Rotation counts for restored exposures.
  await db.run('UPDATE questions SET assigned_count = (SELECT COUNT(*) FROM question_exposures e WHERE e.question_id = questions.id)');
  return { restored: cands.length };
}

/* ---------------- attempt resets ---------------- */

/** Retake: fresh paper (no repeated questions), answers cleared, access restored. */
export function retakeStatements(ctx: Ctx, id: string): D1PreparedStatement[] {
  const db = ctx.db;
  return [
    db.stmt('DELETE FROM assignments WHERE candidate_id = ?', id), // cascades to answers
    db.stmt('DELETE FROM interview_questions WHERE candidate_id = ?', id),
    db.stmt(
      `UPDATE attempts SET attempt_no = attempt_no + 1, session_nonce = NULL, duration_seconds = NULL, started_at = NULL, deadline_at = NULL,
         remaining_seconds = NULL, last_heartbeat_at = NULL, submitted_at = NULL, submit_reason = NULL,
         tab_switch_count = 0, offline_count = 0, offline_seconds = 0, paste_blocked_count = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE candidate_id = ?`,
      id
    ),
    db.stmt(`UPDATE candidates SET status = 'ready', access_revoked = 0, score_awarded = NULL, score_max = NULL, graded_at = NULL,
             decided_at = NULL, decided_by = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, id),
    db.stmt(`DELETE FROM similarity_flags WHERE candidate_a = ? OR candidate_b = ?`, id, id),
    eventStmt(db, id, 0, 'admin_retake', { by: ctx.admin?.email }),
  ];
}

/**
 * Resume: same questions and saved answers; the clock restarts with the time the
 * candidate had left (at least 5 minutes), or the full length if asked.
 */
export async function resumeStatements(ctx: Ctx, id: string, mode: 'remaining' | 'full', fullSeconds: number): Promise<D1PreparedStatement[]> {
  const db = ctx.db;
  const a = await db.first<{ remaining_seconds: number | null; started_at: string | null }>('SELECT remaining_seconds, started_at FROM attempts WHERE candidate_id = ?', id);
  if (!a) throw new HttpError(409, 'This candidate has not signed in yet, so there is nothing to resume.', 'no_attempt');
  const seconds = mode === 'full' || !a.started_at ? fullSeconds : Math.max(300, Number(a.remaining_seconds ?? fullSeconds));
  return [
    db.stmt(
      `UPDATE attempts SET session_nonce = NULL, started_at = NULL, deadline_at = NULL, submitted_at = NULL, submit_reason = NULL,
         duration_seconds = ?, remaining_seconds = ?, last_heartbeat_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE candidate_id = ?`,
      seconds, seconds, id
    ),
    db.stmt(`UPDATE candidates SET status = 'ready', access_revoked = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, id),
    eventStmt(db, id, 0, 'admin_resume', { by: ctx.admin?.email, seconds }),
  ];
}

export function isTestEmail(email: string): boolean {
  return /@(example\.(com|org|net)|test\.local|e2e\.com|unresolved\.local|mailinator\.com)$/i.test(email) ||
    /^(load|e2e|test|demo|dummy)[-_.+]?\d*@/i.test(email) || /\+test@/i.test(email);
}

export function envRetention(env: Env): number {
  const n = Number(env.DATA_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 15;
}
