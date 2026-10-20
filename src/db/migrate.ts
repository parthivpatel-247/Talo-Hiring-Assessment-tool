import type { Env } from '../env';
import { Db, newId } from './db';
import { INDEXES, SCHEMA_VERSION, TABLES, V1_TABLES_DROP_ORDER } from './schema';
import { seedQuestionBank } from './seed';

/**
 * Schema management.
 *
 * Talo used to self-heal its schema with ad-hoc ALTER TABLEs on hot paths. v2
 * replaces that with one versioned schema (schema.ts) and this upgrader, which
 * runs once per Worker instance before the first query:
 *
 *   - empty database        -> create schema v2
 *   - schema v1 detected    -> back up every v1 table to R2, then convert the data
 *                              to v2 in ONE atomic D1 batch (all or nothing)
 *   - schema_meta.version=2 -> nothing to do (one indexed read)
 *
 * The v1 conversion introspects each table first, so a column that a given
 * database never got (an older migration that wasn't applied) becomes NULL
 * instead of failing the upgrade.
 */

let ready: Promise<void> | null = null;

export function ensureSchema(env: Env, db: Db): Promise<void> {
  if (!ready) {
    ready = upgrade(env, db).catch((err) => {
      ready = null; // retry on the next request
      throw err;
    });
  }
  return ready;
}

/** Tests reset storage between cases. */
export function resetSchemaCache(): void {
  ready = null;
}

async function currentVersion(db: Db): Promise<number | null> {
  try {
    const v = await db.value<string>("SELECT value FROM schema_meta WHERE key = 'version'");
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

async function tableNames(db: Db): Promise<Set<string>> {
  const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(rows.map((r) => r.name));
}

async function upgrade(env: Env, db: Db): Promise<void> {
  const version = await currentVersion(db);
  if (version === SCHEMA_VERSION) {
    // Schema is current: only add bundled questions from a newer seed (one settings read).
    await seedQuestionBank(db);
    return;
  }
  if (version !== null && version > SCHEMA_VERSION) {
    throw new Error(`Database schema v${version} is newer than this code (v${SCHEMA_VERSION}). Deploy the latest code.`);
  }
  const tables = await tableNames(db);
  const looksV1 = tables.has('candidates') && !tables.has('schema_meta');
  try {
    if (looksV1) await migrateFromV1(env, db, tables);
    else await createFresh(db);
  } catch (err) {
    // Another isolate may have finished the same upgrade a moment earlier; if the
    // schema is now current, carry on.
    if ((await currentVersion(db)) === SCHEMA_VERSION) return;
    throw err;
  }
  await afterUpgrade(env, db);
}

async function createFresh(db: Db): Promise<void> {
  await db.batch([
    ...TABLES.map((sql) => db.stmt(sql)),
    ...INDEXES.map((sql) => db.stmt(sql)),
    db.stmt("INSERT INTO schema_meta (key, value) VALUES ('version', ?)", String(SCHEMA_VERSION)),
    db.stmt("INSERT INTO schema_meta (key, value) VALUES ('created_from', 'fresh')"),
  ]);
}

/** Convert legacy "YYYY-MM-DD HH:MM:SS" (SQLite datetime('now')) to ISO-8601 UTC. */
function ts(expr: string): string {
  return `(CASE WHEN ${expr} IS NULL THEN NULL WHEN ${expr} LIKE '____-__-__ __:__:__' THEN replace(${expr}, ' ', 'T') || 'Z' ELSE ${expr} END)`;
}

async function migrateFromV1(env: Env, db: Db, tables: Set<string>): Promise<void> {
  const present = V1_TABLES_DROP_ORDER.filter((t) => tables.has(t));
  const cols = new Map<string, Set<string>>();
  for (const t of present) {
    const info = await db.all<{ name: string }>(`PRAGMA table_info("${t}")`);
    cols.set(t, new Set(info.map((c) => c.name)));
  }
  const has = (t: string, c?: string) => cols.has(t) && (!c || cols.get(t)!.has(c));
  const col = (t: string, alias: string, c: string, fallback = 'NULL') => (has(t, c) ? `${alias}.${c}` : fallback);

  // 1) Full backup of every v1 table before anything changes.
  let backupKey: string | null = null;
  let backupBytes = 0;
  try {
    const dump: Record<string, unknown[]> = {};
    // Password hashes, salts and tokens are redacted: this file can be downloaded by managers.
    // A byte-exact copy of the old database is available from D1 Time Travel / `wrangler d1 export`.
    const secret = /(pass|salt|secret|token|code_hash)/i;
    for (const t of present) {
      const rows = await db.all<Record<string, unknown>>(`SELECT * FROM "${t}"`);
      dump[t] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, secret.test(k) && v != null ? '[redacted]' : v])));
    }
    const body = JSON.stringify({ kind: 'pre_migration', from: 1, to: SCHEMA_VERSION, at: new Date().toISOString(), tables: dump });
    backupKey = `backups/pre-migration-v1-${Date.now()}.json`;
    backupBytes = body.length;
    await env.RESUMES.put(backupKey, body, { httpMetadata: { contentType: 'application/json' } });
  } catch (err) {
    console.error('pre-migration backup failed', err);
    throw new Error('Database upgrade stopped: could not write the pre-migration backup to storage.');
  }

  const s: string[] = [];
  for (const t of present) s.push(`ALTER TABLE "${t}" RENAME TO "v1_${t}"`);
  s.push(...TABLES);

  // Colleges: the configured list (settings.colleges JSON) + any college on a candidate.
  if (has('settings')) {
    s.push(`INSERT OR IGNORE INTO colleges (id, name)
      SELECT 'col_' || lower(hex(randomblob(10))), trim(j.value)
      FROM v1_settings st, json_each(CASE WHEN json_valid(st.value) AND json_type(st.value) = 'array' THEN st.value ELSE '[]' END) j
      WHERE st.key = 'colleges' AND typeof(j.value) = 'text' AND length(trim(j.value)) BETWEEN 1 AND 120`);
  }
  if (has('candidates', 'college')) {
    s.push(`INSERT OR IGNORE INTO colleges (id, name)
      SELECT 'col_' || lower(hex(randomblob(10))), trim(college) FROM v1_candidates
      WHERE college IS NOT NULL AND length(trim(college)) BETWEEN 1 AND 120 GROUP BY lower(trim(college))`);
  }

  const collegeExpr = has('candidates', 'college')
    ? `(SELECT id FROM colleges WHERE name = trim(c.college) COLLATE NOCASE)`
    : 'NULL';
  s.push(`INSERT INTO candidates (id, email, email_status, name, college_id, skills, projects, resume_key, resume_filename,
      parsed_at, status, access_revoked, grading_claim, grading_claimed_at, created_at, updated_at)
    SELECT c.id, lower(trim(c.email)),
      CASE WHEN c.email LIKE 'pending+%' THEN 'pending' ELSE 'parsed' END,
      c.name, ${collegeExpr},
      CASE WHEN c.skills IS NOT NULL AND json_valid(c.skills) THEN c.skills ELSE '[]' END,
      CASE WHEN c.projects IS NOT NULL AND json_valid(c.projects) THEN c.projects ELSE '[]' END,
      c.resume_r2_key, c.resume_filename, ${ts('c.parsed_at')},
      CASE c.status
        WHEN 'uploaded' THEN 'uploaded' WHEN 'parse_failed' THEN 'parse_failed'
        WHEN 'parsed' THEN 'ready' WHEN 'part2_ready' THEN 'ready' WHEN 'ready' THEN 'ready'
        WHEN 'in_progress' THEN 'in_progress' WHEN 'submitted' THEN 'submitted' WHEN 'grading' THEN 'submitted'
        WHEN 'evaluated' THEN 'graded' WHEN 'shortlisted' THEN 'shortlisted' WHEN 'rejected' THEN 'rejected'
        ELSE 'uploaded' END,
      CASE WHEN COALESCE(c.access_revoked, 0) = 1 THEN 1 ELSE 0 END,
      NULL, NULL,
      COALESCE(${ts('c.created_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      COALESCE(${ts('c.created_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    FROM v1_candidates c`);

  if (has('attempts')) {
    const blocked = has('admin_audit')
      ? `(SELECT COUNT(*) FROM v1_admin_audit au WHERE au.action = 'duplicate_login_blocked' AND au.candidate_id = a.candidate_id)`
      : '0';
    s.push(`INSERT INTO attempts (candidate_id, attempt_no, started_at, remaining_seconds, last_heartbeat_at, submitted_at,
        submit_reason, login_count, first_login_at, last_login_at, blocked_login_count, tab_switch_count)
      SELECT a.candidate_id,
        CASE WHEN COALESCE(c.retake_granted, 0) = 1 THEN 2 ELSE 1 END,
        ${ts('a.part1_started_at')}, a.part1_remaining_seconds, ${ts('a.part1_last_heartbeat_at')}, ${ts('a.part1_submitted_at')},
        CASE WHEN a.part1_submitted_at IS NOT NULL THEN 'candidate' END,
        COALESCE(${col('attempts', 'a', 'login_count', '0')}, 0),
        ${ts(col('attempts', 'a', 'first_login_at'))}, ${ts(col('attempts', 'a', 'last_login_at'))},
        ${blocked},
        COALESCE(a.part1_tab_switch_count, 0)
      FROM v1_attempts a JOIN candidates c2 ON c2.id = a.candidate_id JOIN v1_candidates c ON c.id = a.candidate_id`);
  }

  if (has('admin_audit')) {
    s.push(`INSERT INTO attempt_events (candidate_id, attempt_no, type, detail, at)
      SELECT au.candidate_id, 1, 'login_blocked', json_object('note', au.detail), ${ts('au.created_at')}
      FROM v1_admin_audit au WHERE au.action = 'duplicate_login_blocked' AND au.candidate_id IN (SELECT id FROM candidates)`);
  }

  if (has('question_bank')) {
    const usage = has('question_usage')
      ? `COALESCE((SELECT u.uses FROM v1_question_usage u WHERE u.question_id = q.id), 0)`
      : has('part1_seen')
        ? `(SELECT COUNT(*) FROM v1_part1_seen ps WHERE ps.question_id = q.id)`
        : `(SELECT COUNT(*) FROM v1_part1_assignments pa WHERE pa.question_id = q.id)`;
    s.push(`INSERT INTO questions (id, category, difficulty, prompt, sample_data, hint, reference_answer, expected_output, rubric,
        checkpoints, marks, source, active, assigned_count, created_at, updated_at, deleted_at)
      SELECT q.id,
        CASE q.category WHEN 'python' THEN 'coding' ELSE q.category END,
        CASE lower(trim(COALESCE(q.difficulty, ''))) WHEN 'easy' THEN 'easy' WHEN 'hard' THEN 'hard' ELSE 'medium' END,
        q.prompt, q.sample_data, ${col('question_bank', 'q', 'hint')}, q.reference_answer,
        ${col('question_bank', 'q', 'expected_output')}, q.rubric, ${col('question_bank', 'q', 'checkpoints')},
        CASE WHEN q.marks > 0 AND q.marks <= 100 THEN q.marks ELSE 5 END,
        'v1',
        CASE WHEN q.active = 1 AND ${col('question_bank', 'q', 'deleted_at')} IS NULL THEN 1 ELSE 0 END,
        ${usage},
        COALESCE(${ts('q.created_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        COALESCE(${ts('q.created_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ${ts(col('question_bank', 'q', 'deleted_at'))}
      FROM v1_question_bank q
      WHERE q.category IN ('sql', 'python', 'coding', 'dsa', 'scenario') AND length(COALESCE(q.prompt, '')) > 0`);
  }

  if (has('part1_assignments')) {
    s.push(`INSERT OR IGNORE INTO assignments (candidate_id, question_id, position)
      SELECT pa.candidate_id, pa.question_id, pa.position FROM v1_part1_assignments pa
      WHERE pa.candidate_id IN (SELECT id FROM candidates) AND pa.question_id IN (SELECT id FROM questions)`);
  }
  const exposureSrc = has('part1_seen') ? 'v1_part1_seen' : has('part1_assignments') ? 'v1_part1_assignments' : null;
  if (exposureSrc) {
    s.push(`INSERT OR IGNORE INTO question_exposures (candidate_id, question_id)
      SELECT e.candidate_id, e.question_id FROM ${exposureSrc} e
      WHERE e.candidate_id IN (SELECT id FROM candidates) AND e.question_id IN (SELECT id FROM questions)`);
  }
  s.push(`INSERT OR IGNORE INTO question_exposures (candidate_id, question_id) SELECT candidate_id, question_id FROM assignments`);

  if (has('part1_answers')) {
    s.push(`INSERT OR IGNORE INTO answers (candidate_id, question_id, answer_text, word_count, saved_at, score, max_marks,
        reasoning, deductions, graded_at, grader)
      SELECT a.candidate_id, a.question_id, COALESCE(a.answer_text, ''),
        CASE WHEN length(trim(COALESCE(a.answer_text, ''))) = 0 THEN 0
             ELSE length(trim(a.answer_text)) - length(replace(trim(a.answer_text), ' ', '')) + 1 END,
        COALESCE(${ts('a.updated_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        a.ai_score, a.max_marks, a.ai_reasoning,
        CASE WHEN a.deductions IS NOT NULL AND json_valid(a.deductions) THEN a.deductions END,
        ${ts('a.scored_at')}, CASE WHEN a.scored_at IS NOT NULL THEN 'v1' END
      FROM v1_part1_answers a
      WHERE EXISTS (SELECT 1 FROM assignments s WHERE s.candidate_id = a.candidate_id AND s.question_id = a.question_id)`);
  }

  s.push(`UPDATE candidates SET
      score_awarded = (SELECT SUM(COALESCE(a.score, 0)) FROM answers a WHERE a.candidate_id = candidates.id AND a.graded_at IS NOT NULL),
      score_max = (SELECT SUM(q.marks) FROM assignments s JOIN questions q ON q.id = s.question_id WHERE s.candidate_id = candidates.id),
      graded_at = (SELECT MAX(a.graded_at) FROM answers a WHERE a.candidate_id = candidates.id)
    WHERE status IN ('graded', 'shortlisted', 'rejected')`);

  if (has('interview_questions')) {
    s.push(`INSERT OR IGNORE INTO interview_questions (id, candidate_id, position, question, model_answer, follow_up, based_on, created_at)
      SELECT iq.id, iq.candidate_id, iq.position, iq.question, ${col('interview_questions', 'iq', 'model_answer')}, iq.follow_up, iq.based_on,
        COALESCE(${ts('iq.created_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      FROM v1_interview_questions iq WHERE iq.candidate_id IN (SELECT id FROM candidates)`);
  }

  if (has('admin_users')) {
    const emailExpr = has('admin_users', 'email')
      ? `COALESCE(NULLIF(lower(trim(u.email)), ''), CASE WHEN u.username LIKE '%_@_%' THEN lower(trim(u.username)) END)`
      : `CASE WHEN u.username LIKE '%_@_%' THEN lower(trim(u.username)) END`;
    s.push(`INSERT OR IGNORE INTO admin_users (id, email, name, role, pass_hash, pass_salt, must_change_password, email_verified_at,
        active, created_at, updated_at)
      SELECT u.id, ${emailExpr}, u.username, CASE WHEN u.role = 'manager' THEN 'manager' ELSE 'member' END,
        u.pass_hash, u.pass_salt, 1, ${ts('u.created_at')},
        CASE WHEN u.active = 1 THEN 1 ELSE 0 END,
        COALESCE(${ts('u.created_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        COALESCE(${ts('u.created_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      FROM v1_admin_users u WHERE ${emailExpr} IS NOT NULL`);
  }

  if (has('admin_audit')) {
    s.push(`INSERT INTO audit_log (actor_email, actor_role, action, target_type, target_id, detail, at)
      SELECT 'legacy', NULL, au.action, CASE WHEN au.candidate_id IS NOT NULL THEN 'candidate' END, au.candidate_id,
        substr(COALESCE(au.detail, ''), 1, 4000), COALESCE(${ts('au.created_at')}, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      FROM v1_admin_audit au`);
  }

  if (has('settings')) {
    s.push(`INSERT OR IGNORE INTO settings (key, value) SELECT key, value FROM v1_settings WHERE key NOT IN ('colleges')`);
  }

  for (const t of present) s.push(`DROP TABLE "v1_${t}"`);
  s.push(...INDEXES);
  s.push(`INSERT INTO schema_meta (key, value) VALUES ('version', '${SCHEMA_VERSION}')`);
  s.push(`INSERT INTO schema_meta (key, value) VALUES ('created_from', 'v1')`);
  s.push(`INSERT INTO schema_meta (key, value) VALUES ('migrated_at', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

  const stmts = s.map((sql) => db.stmt(sql));
  if (backupKey) {
    stmts.push(
      db.stmt(
        `INSERT INTO backups (id, kind, r2_key, summary, candidate_count, bytes, created_by, expires_at)
         VALUES (?, 'pre_migration', ?, 'Full copy of every v1 table taken before the v2 upgrade', (SELECT COUNT(*) FROM candidates), ?, 'system', NULL)`,
        newId('bak'), backupKey, backupBytes
      )
    );
    stmts.push(db.stmt(`INSERT INTO audit_log (actor_email, action, target_type, detail) VALUES ('system', 'schema_upgrade', 'database', ?)`, `v1 -> v${SCHEMA_VERSION}; backup ${backupKey}`));
  }
  await db.batch(stmts);
}

/** Idempotent follow-ups that are safe to run on every upgrade. */
async function afterUpgrade(env: Env, db: Db): Promise<void> {
  // Derive title/topic from the "## Title" / "> topic · Level" prompt lines where missing.
  const missing = await db.all<{ id: string; prompt: string }>(
    'SELECT id, prompt FROM questions WHERE title IS NULL OR topic IS NULL'
  );
  const updates = missing
    .map((q) => ({ id: q.id, ...titleAndTopic(q.prompt) }))
    .filter((u) => u.title || u.topic)
    .map((u) => db.stmt('UPDATE questions SET title = COALESCE(title, ?), topic = COALESCE(topic, ?) WHERE id = ?', u.title, u.topic, u.id));
  for (let i = 0; i < updates.length; i += 50) await db.batch(updates.slice(i, i + 50));

  await seedQuestionBank(db);
}

export function titleAndTopic(prompt: string): { title: string | null; topic: string | null } {
  const lines = String(prompt || '').split('\n').map((l) => l.trim());
  const t = lines.find((l) => /^##\s+/.test(l));
  const p = lines.find((l) => /^>\s+/.test(l));
  let topic = p ? p.replace(/^>\s+/, '') : null;
  if (topic) topic = topic.replace(/\s*·\s*(Easy|Medium|Hard)\s*$/i, '').trim() || null;
  let title = t ? t.replace(/^##\s+/, '').trim() : null;
  if (!title) {
    const ask = lines.find((l) => /^(write|find|return|list|given|show|get|calculate|display|count|select|create|implement)\b/i.test(l));
    const first = ask || lines.find((l) => l && !/^(Table|Tables|Columns|-)\b/i.test(l));
    if (first) {
      const clean = first.replace(/[*`#>]/g, '').trim();
      title = (clean.length > 90 ? clean.slice(0, 87).replace(/\s+\S*$/, '') + '…' : clean) || null;
    }
  }
  return { title, topic };
}
