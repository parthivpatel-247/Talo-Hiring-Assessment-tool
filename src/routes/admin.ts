import type { Env, Candidate, QuestionBankRow, ParsedResume } from '../types';
import { createAdminSession, getAdminRole, hashPassword, verifyPassword, clearAdminSession, json, withCookie, secretEqual, revokeUserSessions, type AdminRole } from '../lib/auth';
import { newId, nowIso, ensureQuestionHintCol, ensureQuestionDeletedCol, ensureGradingClaimCols, ensureParseClaimCols, ensureQuestionCheckpointsCol, ensureOnce, ensurePerfSchema, addColumn } from '../lib/db';
import { extractResumeText, emailsInText } from '../lib/resume';
import {
  parseResume,
  enrichQuestion,
  gradeWrittenAnswer,
  generateInterviewQuestions,
  normalizeParsed,
} from '../lib/openai';
import { part1Summary, part2Summary, part3Summary, cohortSummaries, EMPTY_SUMMARY } from '../lib/scoring';
import { ensurePart3Schema, seedDefaultPart3 } from '../lib/part3bank';
import { getAssessmentMinutes } from '../lib/timer';
import { isDocs } from '../lib/team';
import { isManagerOnlyRoute, MANAGER_ONLY_MESSAGE } from '../lib/roles';
import { handleDocsAdminRoute, docsAdminConfig, gradeDocsCandidate, closeTimedOutDocs } from './admin-docs';
import { ensureDocsAttemptCols, testIsOpen, openSetting } from './candidate-docs';
import { adminSigninBegin, adminSigninFailed, adminSigninSucceeded, unlockAdminAccount, liftAllPauses, activePauses } from '../lib/ratelimit';

const PROCESS_BATCH_LIMIT = 20;

/** A question's marks: a whole number from 1 to 100, or null if invalid. */
function marksValue(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

/**
 * Run `fn` over every item with at most `limit` in flight at once, preserving
 * input order in the results. Lets us parse/upload many resumes concurrently
 * (overlapping the slow OpenAI / R2 round-trips) without firing all N at once,
 * which would blow past OpenAI rate limits and the Worker's subrequest budget.
 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Single source of truth for the question-bank sections. Add one entry here and
 * it appears automatically in the admin "Add a question" Type dropdown, the marks
 * default, and validation — no other change needed. (Also: any extra category
 * already present in the bank is surfaced too; see questionCategories().)
 */
const QUESTION_CATEGORIES: { value: string; label: string; fallbackMarks: number }[] = [
  { value: 'sql', label: 'SQL', fallbackMarks: 3 },
  { value: 'python', label: 'Python', fallbackMarks: 4 },
  { value: 'dsa', label: 'DSA', fallbackMarks: 5 },
  { value: 'scenario', label: 'Scenario', fallbackMarks: 5 },
];
function defaultMarks(env: Env, category: string): number {
  const envMarks: Record<string, string | undefined> = {
    sql: env.SQL_MARKS, python: env.PYTHON_MARKS, dsa: env.DSA_MARKS, scenario: env.SCENARIO_MARKS,
  };
  const cat = QUESTION_CATEGORIES.find((c) => c.value === category);
  return Number(envMarks[category]) || (cat ? cat.fallbackMarks : 4);
}
/** The sections offered in the UI: the defined ones, plus any extra category
 *  already present in the bank (so adding a type to the bank surfaces it). */
async function questionCategories(env: Env): Promise<{ value: string; label: string; marks: number }[]> {
  const base = QUESTION_CATEGORIES.map((c) => ({ value: c.value, label: c.label, marks: defaultMarks(env, c.value) }));
  const have = new Set(base.map((c) => c.value));
  try {
    const rows = await env.DB.prepare('SELECT DISTINCT category FROM question_bank WHERE deleted_at IS NULL').all<{ category: string }>();
    for (const r of rows.results ?? []) {
      if (r.category && !have.has(r.category)) {
        base.push({ value: r.category, label: r.category.toUpperCase(), marks: defaultMarks(env, r.category) });
        have.add(r.category);
      }
    }
  } catch { /* bank may not exist yet */ }
  return base;
}

/** Default college names from the COLLEGES env var (used before any edit). */
function defaultColleges(env: Env): string[] {
  return (env.COLLEGES || 'College Name 1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Make sure the college feature's schema exists even if migrations 0005/0006
 * weren't applied to this database yet — so editing colleges, uploading with a
 * college, and setting a candidate's college never fail with a raw 500.
 */
async function ensureCollegeSchema(env: Env): Promise<void> {
  try {
    await ensureOnce('college', async () => {
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
      const cols = await env.DB.prepare('PRAGMA table_info(candidates)').all<{ name: string }>();
      const hasCollege = (cols.results ?? []).some((c) => c.name === 'college');
      if (!hasCollege) {
        await addColumn(env, 'ALTER TABLE candidates ADD COLUMN college TEXT');
      }
    });
  } catch { /* best effort — reads already tolerate a missing table/column */ }
}

/** Ensure the named-admin-accounts table exists (self-heal if migration 0007 wasn't run). */
async function ensureAuthSchema(env: Env): Promise<void> {
  try {
    await ensureOnce('auth', async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS admin_users (
          id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_salt TEXT NOT NULL,
          pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
          active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`
      ).run();
      // Self-heal: panel members are identified by a real email (added later).
      const cols = await env.DB.prepare('PRAGMA table_info(admin_users)').all<{ name: string }>();
      if (!(cols.results ?? []).some((c) => c.name === 'email')) {
        await addColumn(env, 'ALTER TABLE admin_users ADD COLUMN email TEXT');
      }
    });
  } catch { /* best effort */ }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Self-heal the Part 2 AI-content column (migration 0009) so grading can store it. */
async function ensurePart2AiCol(env: Env): Promise<void> {
  try {
    await ensureOnce('part2.ai', async () => {
      const cols = await env.DB.prepare('PRAGMA table_info(part2_answers)').all<{ name: string }>();
      if (!(cols.results ?? []).some((c) => c.name === 'ai_content_pct')) {
        await addColumn(env, 'ALTER TABLE part2_answers ADD COLUMN ai_content_pct REAL');
      }
    });
  } catch { /* best effort */ }
}

/** Self-heal: interview_questions gained a model_answer column (migration 0011). */
async function ensureInterviewAnswerCol(env: Env): Promise<void> {
  try {
    await ensureOnce('interview.model_answer', async () => {
      const cols = await env.DB.prepare('PRAGMA table_info(interview_questions)').all<{ name: string }>();
      if (!(cols.results ?? []).some((c) => c.name === 'model_answer')) {
        await addColumn(env, 'ALTER TABLE interview_questions ADD COLUMN model_answer TEXT');
      }
    });
  } catch { /* best effort */ }
}

/** The candidate's assigned questions + their (latest-trial) answers — the context
 *  the interview-question generator uses. Part 1 answers are per-trial (a retake
 *  clears them), so this is always the latest attempt. */
async function assessmentQAForInterview(env: Env, candidateId: string) {
  const rows = await env.DB.prepare(
    `SELECT qb.prompt AS question, qb.category AS category, a.answer_text AS answer, a.ai_score AS score
     FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id
     LEFT JOIN part1_answers a ON a.question_id = pa.question_id AND a.candidate_id = pa.candidate_id
     WHERE pa.candidate_id = ? ORDER BY pa.position`
  ).bind(candidateId).all<{ question: string; category: string | null; answer: string | null; score: number | null }>();
  return (rows.results ?? []).map((r) => ({ question: r.question, category: r.category, answer: r.answer ?? '', score: r.score }));
}

/** JSON.parse that falls back instead of throwing on malformed stored data. */
function jsonOr<T>(text: string | null | undefined, fallback: T): unknown {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

/** Generate personalised interview questions (with model answers) for a candidate
 *  from their resume + latest answers, REPLACING any previous set. Returns the count. */
async function generateAndStoreInterview(env: Env, candidate: Candidate): Promise<number> {
  await ensureInterviewAnswerCol(env);
  const parsed: ParsedResume = normalizeParsed({
    name: candidate.name ?? '', email: candidate.email,
    skills: jsonOr(candidate.skills, []),
    projects: jsonOr(candidate.projects, []),
  });
  // The attempt this guide is built from: if a Retake or Resume starts a new attempt
  // while the model is writing, the guide is dropped instead of stored on it.
  await ensureDocsAttemptCols(env);
  const at = await env.DB.prepare('SELECT resumed_at FROM attempts WHERE candidate_id = ?').bind(candidate.id).first<{ resumed_at: string | null }>();
  const attemptMark = at?.resumed_at ?? null;
  const qa = await assessmentQAForInterview(env, candidate.id);
  const generated = await generateInterviewQuestions(env, parsed, qa);
  const same = 'EXISTS (SELECT 1 FROM attempts WHERE candidate_id = ? AND resumed_at IS ?) OR NOT EXISTS (SELECT 1 FROM attempts WHERE candidate_id = ?)';
  const stmts = [env.DB.prepare(`DELETE FROM interview_questions WHERE candidate_id = ? AND (${same})`).bind(candidate.id, candidate.id, attemptMark, candidate.id)];
  const ins = env.DB.prepare(
    `INSERT INTO interview_questions (id, candidate_id, position, question, model_answer, follow_up, based_on)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${same}`
  );
  generated.forEach((q, i) => stmts.push(ins.bind(newId('iq'), candidate.id, i, q.question, q.model_answer ?? null, q.follow_up ?? null, q.based_on ?? null, candidate.id, attemptMark, candidate.id)));
  const res = await env.DB.batch(stmts);
  if (generated.length && !res.slice(1).some((r) => r.meta?.changes)) throw new Error('The candidate started a new attempt while the interview guide was being written; generate it again.');
  return generated.length;
}

/** Current college list: manager-edited value from settings, else env default. */
async function getColleges(env: Env): Promise<string[]> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'colleges'").first<{ value: string }>();
    if (row?.value) {
      const arr = JSON.parse(row.value);
      // Return the stored list even when EMPTY — colleges are optional, and an
      // explicit "no colleges" must stick rather than snapping back to defaults.
      // Only fall through to the defaults when nothing was ever configured.
      if (Array.isArray(arr)) return arr.map((s) => String(s).trim()).filter(Boolean);
    }
  } catch { /* settings table may not exist yet (pre-migration) */ }
  return defaultColleges(env);
}

/**
 * The parsed name, but only if it actually comes from the resume: at least one
 * word of it (3+ letters) must appear in the extracted text. Guards against the AI
 * inventing a placeholder like "John Doe" for a PDF it couldn't read properly.
 */
function nameFromResume(name: string | null | undefined, text: string): string | null {
  const n = (name || '').trim();
  if (!n) return null;
  const hay = text.toLowerCase();
  const words = n.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  return words.some((w) => hay.includes(w)) ? n : null;
}

export async function handleAdminRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string
): Promise<Response> {
  if (path === '/api/admin/login' && request.method === 'POST') {
    const body = await request.json<{ email?: string; username?: string; password?: string }>().catch(() => ({} as { email?: string; username?: string; password?: string }));
    // BOTH email and password are required — there is no password-only login.
    const loginEmail = String(body.email || body.username || '').trim().toLowerCase().slice(0, 254);
    const pass = typeof body.password === 'string' ? body.password : '';
    if (pass.length > 1024) return json({ error: 'Wrong email or password' }, { status: 401 });
    if (!loginEmail || !pass) return json({ error: 'Email and password are both required.' }, { status: 400 });

    let loginRole: AdminRole | null = null;
    let loginUserId: string | null = null;
    await ensureAuthSchema(env);
    // 1) Named account created in the Access section (keyed by email).
    const row = await env.DB.prepare('SELECT * FROM admin_users WHERE (email = ? OR username = ?) AND active = 1').bind(loginEmail, loginEmail).first<any>();

    // Sign-in limits (src/lib/ratelimit.ts). This attempt is counted, and a paused
    // account or network refused, BEFORE the password is checked, so guessing can't
    // continue during a pause and a burst of simultaneous guesses can't slip past.
    const adminEmailCfg = (env.ADMIN_EMAIL || '').trim().toLowerCase();
    const panelEmailCfg = (env.PANEL_EMAIL || '').trim().toLowerCase();
    const account = row ? `u:${row.id}` : (loginEmail === adminEmailCfg || loginEmail === panelEmailCfg) && loginEmail ? `e:${loginEmail}` : null;
    const begun = await adminSigninBegin(env, request, account);
    if ('refused' in begun) return begun.refused;

    if (row && (await verifyPassword(pass, row.pass_salt, row.pass_hash))) {
      loginRole = row.role === 'manager' ? 'manager' : 'member';
      loginUserId = row.id;
    } else {
      // 2) Bootstrap logins from config — the email must match too (not just the password).
      const adminEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
      const panelEmail = (env.PANEL_EMAIL || '').trim().toLowerCase();
      if (adminEmail && loginEmail === adminEmail && env.ADMIN_PASSWORD && (await secretEqual(pass, env.ADMIN_PASSWORD))) loginRole = 'manager';
      else if (panelEmail && loginEmail === panelEmail && env.PANEL_PASSWORD && (await secretEqual(pass, env.PANEL_PASSWORD))) loginRole = 'member';
    }
    if (!loginRole) return adminSigninFailed(env, begun.state, loginEmail, newId);
    // A good sign-in gives its count back and marks this browser as trusted for the
    // account (see adminSigninSucceeded).
    const deviceCookie = await adminSigninSucceeded(env, request, begun.state, account ?? `u:${loginUserId}`);
    // This browser's previous admin session (e.g. manager, now signing in as a panel
    // member on a shared laptop) ends here instead of living on until it expires.
    await clearAdminSession(env, request);
    const { cookie } = await createAdminSession(env, loginRole, loginUserId);
    return withCookie(withCookie(json({ ok: true, role: loginRole }), cookie), deviceCookie);
  }

  // Logout — clears the admin session so you can sign back in as a different role
  // (manager <-> panel member). Allowed without a valid session (idempotent).
  if (path === '/api/admin/logout' && request.method === 'POST') {
    const cookie = await clearAdminSession(env, request);
    return withCookie(json({ ok: true }), cookie);
  }

  const role = await getAdminRole(env, request);
  if (!role) return json({ error: 'Not authenticated as admin' }, { status: 401 });
  // Indexes + rotation tables (runs once per Worker instance, then is a no-op).
  await ensurePerfSchema(env);

  // Lift every sign-in pause (both sites, manager only): for when a pause on the
  // campus network, or on an account, is getting in the way during a drive.
  if (path === '/api/admin/signin-pauses/clear' && request.method === 'POST') {
    if (role !== 'manager') return json({ error: MANAGER_ONLY_MESSAGE }, { status: 403 });
    const cleared = await liftAllPauses(env);
    await audit(env, 'signin_pauses_lifted', null, `${cleared} sign-in counter(s) cleared`);
    return json({ ok: true, cleared });
  }

  // Open / close the test (both sites, manager only). Closed = nobody NEW can start;
  // candidates already in the test carry on. Writers starts closed, support open.
  if (path === '/api/admin/start-open' && request.method === 'POST') {
    if (role !== 'manager') return json({ error: MANAGER_ONLY_MESSAGE }, { status: 403 });
    const b = await request.json<{ open?: unknown }>().catch(() => ({} as { open?: unknown }));
    if (typeof b.open !== 'boolean') return json({ error: 'Send open: true or false.' }, { status: 400 });
    await ensureCollegeSchema(env); // guarantees the settings table exists
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(openSetting(env).key, b.open ? '1' : '0').run();
    await audit(env, b.open ? 'test_opened' : 'test_closed', null, b.open ? 'Candidates can start the test' : 'Starting the test is closed');
    return json({ ok: true, startOpen: b.open });
  }

  // Writers site (TEAM = "docs"): the routes that differ for its two-part writing
  // test are handled in admin-docs.ts; everything else below is shared.
  if (isDocs(env)) {
    // Same manager-only rule as below, applied before any writers route runs.
    if (isManagerOnlyRoute(path, request.method) && role !== 'manager') {
      return json({ error: MANAGER_ONLY_MESSAGE }, { status: 403 });
    }
    const docsRes = await handleDocsAdminRoute(request, env, path, role);
    if (docsRes) return docsRes;
  }

  // Who am I + college list — used by the frontend to tailor the UI (both roles).
  if (path === '/api/admin/config' && request.method === 'GET') {
    if (isDocs(env)) {
      return json({ role, colleges: await getColleges(env), signinPauses: await activePauses(env), startOpen: await testIsOpen(env), ...(await docsAdminConfig(env)) });
    }
    return json({
      role,
      signinPauses: await activePauses(env),
      startOpen: await testIsOpen(env),
      colleges: await getColleges(env),
      questionCategories: await questionCategories(env),
      assessmentMinutes: await getAssessmentMinutes(env),
    });
  }

  // Assessment length — customizable by the manager (default 60 min). Takes effect
  // for every candidate who STARTS after this is saved; attempts already in progress
  // keep the time they were given. (Setup action — manager only.)
  if (path === '/api/admin/assessment-duration' && request.method === 'POST') {
    if (role !== 'manager') return json({ error: 'Manager access required.' }, { status: 403 });
    const b = await request.json<{ minutes?: unknown }>().catch(() => ({} as any));
    const n = Math.round(Number(b.minutes));
    if (!Number.isFinite(n) || n < 5 || n > 240) {
      return json({ error: 'Enter a duration between 5 and 240 minutes.' }, { status: 400 });
    }
    await ensureCollegeSchema(env); // guarantees the settings table exists
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('assessment_minutes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(n))
      .run();
    await audit(env, 'edit_duration', null, `${n} min`);
    return json({ ok: true, assessmentMinutes: await getAssessmentMinutes(env) });
  }

  // Integrity flags for the manager portal: duplicate logins, multiple logins, and
  // leaving the test (tab switch / full-screen exit). Read-only; any admin can view.
  if (path === '/api/admin/flags' && request.method === 'GET') {
    // One grouped pass over just the duplicate-login audit rows (index
    // idx_audit_action_cand), instead of a per-candidate subquery that scanned the
    // ENTIRE audit table once for every candidate (candidates x audit rows per
    // refresh — the main cause of the drive-day read spike). Only candidates with
    // something to flag are returned.
    const rows = await env.DB.prepare(
      `SELECT c.id AS id, c.name AS name, c.email AS email, c.college AS college,
              COALESCE(a.login_count, 0) AS login_count,
              COALESCE(a.part1_tab_switch_count, 0) AS tab_switches,
              COALESCE(d.n, 0) AS dup_blocks
       FROM candidates c
       LEFT JOIN attempts a ON a.candidate_id = c.id
       LEFT JOIN (SELECT candidate_id, COUNT(*) AS n FROM admin_audit
                  WHERE action = 'duplicate_login_blocked' GROUP BY candidate_id) d ON d.candidate_id = c.id
       WHERE COALESCE(a.login_count, 0) > ? OR COALESCE(a.part1_tab_switch_count, 0) > 0 OR COALESCE(d.n, 0) > 0`
    ).bind(isDocs(env) ? 2 : 1).all<{ id: string; name: string | null; email: string; college: string | null; login_count: number; tab_switches: number; dup_blocks: number }>();
    const rank: Record<string, number> = { high: 2, medium: 1 };
    const docsSite = isDocs(env);
    type Item = { type: string; severity: 'high' | 'medium'; label: string; detail: string };
    const flags: { candidateId: string; name: string | null; email: string; college: string | null; severity: 'high' | 'medium'; items: Item[] }[] = [];
    for (const r of rows.results ?? []) {
      const items: Item[] = [];
      if (r.dup_blocks > 0) items.push({ type: 'duplicate_login', severity: 'high', label: 'Duplicate login blocked', detail: `${r.dup_blocks} blocked login attempt(s) after the test had started — possible second person on the same email.` });
      // The writers site allows one extra sign-in between Part 1 and Part 2, so it
      // only flags sign-ins beyond that.
      const allowedLogins = docsSite ? 2 : 1;
      if (r.login_count > allowedLogins) items.push({ type: 'multiple_logins', severity: r.login_count >= allowedLogins + 2 ? 'high' : 'medium', label: 'Multiple logins', detail: `${r.login_count} sign-ins recorded on this account${docsSite ? ' (one extra sign-in between the parts is normal)' : ''}.` });
      if (r.tab_switches > 0) items.push({ type: 'left_test', severity: r.tab_switches >= 3 ? 'high' : 'medium', label: 'Left the test', detail: `Left full-screen / switched tab ${r.tab_switches} time(s)${docsSite ? ' in Part 1' : ''}. Each time, the candidate had 10 seconds to return before the test was submitted.` });
      if (!items.length) continue;
      const severity: 'high' | 'medium' = items.some((i) => i.severity === 'high') ? 'high' : 'medium';
      flags.push({ candidateId: r.id, name: r.name, email: r.email, college: r.college, severity, items });
    }
    flags.sort((a, b) => (rank[b.severity] - rank[a.severity]) || (b.items.length - a.items.length));
    return json({ flags, count: flags.length });
  }

  // Rename / add / remove colleges (manager only). Renames cascade to the
  // college stored on each candidate so existing groupings stay correct.
  if (path === '/api/admin/colleges' && request.method === 'POST') {
    if (role !== 'manager') return json({ error: 'Manager access required.' }, { status: 403 });
    await ensureCollegeSchema(env);
    const b = await request.json<{ colleges?: unknown; renames?: { from?: string; to?: string }[] }>().catch(() => ({} as any));
    const raw: unknown[] = Array.isArray(b.colleges) ? b.colleges : [];
    const names: string[] = raw.map((s) => String(s ?? '').trim()).filter(Boolean);
    // An empty list is allowed — colleges are OPTIONAL. Removing them all is fine;
    // resumes then upload as "Unassigned". (No "at least one college" requirement.)
    if (names.length > 20) return json({ error: 'At most 20 colleges.' }, { status: 400 });
    if (names.some((n) => n.length > 80)) return json({ error: 'College names must be under 80 characters.' }, { status: 400 });
    const lower = names.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) return json({ error: 'College names must be unique.' }, { status: 400 });
    // Apply renames to candidates first (from → to), skipping no-op/unknown.
    // All renames apply in ONE statement against the old values, so swapping two
    // names (A→B and B→A) swaps the groups instead of merging them.
    const renames = (Array.isArray(b.renames) ? b.renames : [])
      .map((r: { from?: unknown; to?: unknown }) => ({ from: String(r?.from ?? '').trim(), to: String(r?.to ?? '').trim() }))
      .filter((r: { from: string; to: string }) => r.from && r.to && r.from !== r.to && names.includes(r.to))
      .slice(0, 20);
    const seenFrom = new Set<string>();
    const uniqueRenames = renames.filter((r: { from: string }) => (seenFrom.has(r.from) ? false : (seenFrom.add(r.from), true)));
    if (uniqueRenames.length) {
      await env.DB.prepare(
        `UPDATE candidates SET college = CASE college ${uniqueRenames.map(() => 'WHEN ? THEN ?').join(' ')} END
          WHERE college IN (${uniqueRenames.map(() => '?').join(',')})`
      ).bind(...uniqueRenames.flatMap((r: { from: string; to: string }) => [r.from, r.to]), ...uniqueRenames.map((r: { from: string }) => r.from)).run();
    }
    // Cascade REMOVED colleges: any candidate whose college is no longer in the
    // valid list (a college that was deleted, not renamed) becomes Unassigned, so
    // the removed college disappears from the candidate list and the filters too —
    // no orphaned college values left behind. With an empty list, unassign everyone.
    const cleared = names.length
      ? await env.DB.prepare(
          `UPDATE candidates SET college = NULL WHERE college IS NOT NULL AND college NOT IN (${names.map(() => '?').join(',')})`
        ).bind(...names).run()
      : await env.DB.prepare('UPDATE candidates SET college = NULL WHERE college IS NOT NULL').run();
    const unassigned = (cleared as { meta?: { changes?: number } }).meta?.changes ?? 0;
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('colleges', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(names))
      .run();
    await audit(env, 'edit_colleges', null, names.join(', ').slice(0, 200) + (unassigned ? ` (unassigned ${unassigned})` : ''));
    return json({ ok: true, colleges: names, unassigned });
  }

  // ---- Panel member accounts (manager only) ----
  if (path === '/api/admin/members' && request.method === 'GET') {
    if (role !== 'manager') return json({ error: 'Manager access required.' }, { status: 403 });
    await ensureAuthSchema(env);
    const rows = await env.DB.prepare('SELECT id, username, email, role, active, created_at FROM admin_users ORDER BY created_at').all();
    // The config sign-ins (ADMIN_EMAIL / PANEL_EMAIL with their wrangler secrets) are
    // not stored accounts, but they are logins too: list them, read-only, so the
    // manager signed in with one sees it here.
    const config: { email: string; role: AdminRole }[] = [];
    const adminEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
    const panelEmail = (env.PANEL_EMAIL || '').trim().toLowerCase();
    if (adminEmail && env.ADMIN_PASSWORD) config.push({ email: adminEmail, role: 'manager' });
    if (panelEmail && env.PANEL_PASSWORD) config.push({ email: panelEmail, role: 'member' });
    return json({ members: rows.results ?? [], config });
  }
  if (path === '/api/admin/members' && request.method === 'POST') {
    if (role !== 'manager') return json({ error: 'Manager access required.' }, { status: 403 });
    await ensureAuthSchema(env);
    const b = await request.json<{ name?: string; username?: string; email?: string; password?: string; role?: string }>().catch(() => ({} as any));
    // "username" column stores the display NAME; panel members sign in with EMAIL.
    const name = (b.name || b.username || '').trim();
    const email = (b.email || '').trim().toLowerCase();
    const password = b.password || '';
    const r: AdminRole = b.role === 'manager' ? 'manager' : 'member';
    if (!name || name.length > 64) return json({ error: 'A name (up to 64 characters) is required.' }, { status: 400 });
    if (!email || !EMAIL_RE.test(email) || email.length > 200) return json({ error: 'A valid email address is required.' }, { status: 400 });
    if (password.length < 10 || password.length > 256) return json({ error: 'Password must be 10 to 256 characters.' }, { status: 400 });
    const exists = await env.DB.prepare('SELECT 1 FROM admin_users WHERE email = ? OR username = ?').bind(email, name).first();
    if (exists) return json({ error: 'A member with that email or name already exists.' }, { status: 409 });
    const { salt, hash } = await hashPassword(password);
    await env.DB.prepare('INSERT INTO admin_users (id, username, email, pass_salt, pass_hash, role, active) VALUES (?,?,?,?,?,?,1)')
      .bind(newId('usr'), name, email, salt, hash, r).run();
    await audit(env, 'member_add', null, `${name} <${email}> (${r})`);
    return json({ ok: true });
  }
  const memberMatch = path.match(/^\/api\/admin\/members\/([^/]+)$/);
  if (memberMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    if (role !== 'manager') return json({ error: 'Manager access required.' }, { status: 403 });
    await ensureAuthSchema(env);
    const id = memberMatch[1];
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
      await revokeUserSessions(env, id); // signed-in sessions of a deleted account end now
      await audit(env, 'member_delete', null, id);
      return json({ ok: true });
    }
    const b = await request.json<{ role?: string; active?: boolean; password?: string }>().catch(() => ({} as any));
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (b.role === 'manager' || b.role === 'member') { sets.push('role = ?'); binds.push(b.role); }
    if (typeof b.active === 'boolean') { sets.push('active = ?'); binds.push(b.active ? 1 : 0); }
    if (typeof b.password === 'string' && b.password) {
      if (b.password.length < 10 || b.password.length > 256) return json({ error: 'Password must be 10 to 256 characters.' }, { status: 400 });
      const { salt, hash } = await hashPassword(b.password);
      sets.push('pass_salt = ?', 'pass_hash = ?'); binds.push(salt, hash);
    }
    if (!sets.length) return json({ error: 'Nothing to update.' }, { status: 400 });
    binds.push(id);
    await env.DB.prepare(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    // A new password or deactivation signs the account out everywhere. (Role changes
    // apply on the next request anyway, because the session reads the current role.)
    if (b.password || b.active === false) await revokeUserSessions(env, id);
    // A manager setting a new password also lifts any sign-in pause on the account.
    if (b.password) await unlockAdminAccount(env, `u:${id}`).catch(() => {});
    await audit(env, 'member_update', null, id);
    return json({ ok: true });
  }

  // ---- Role gate: setup/config/destructive actions are manager-only. ----
  const managerOnly = isManagerOnlyRoute(path, request.method);
  if (managerOnly && role !== 'manager') {
    return json({ error: MANAGER_ONLY_MESSAGE }, { status: 403 });
  }

  // ---- Resume upload ----
  if (path === '/api/admin/resumes/upload' && request.method === 'POST') {
    await ensureCollegeSchema(env);
    const form = await request.formData();
    const files = form.getAll('files') as unknown as File[];
    if (!files.length) return json({ error: 'No files uploaded' }, { status: 400 });
    const maxFiles = Number(env.MAX_UPLOAD_FILES) || 100;
    if (files.length > maxFiles) return json({ error: `Upload at most ${maxFiles} resumes at a time` }, { status: 400 });
    // Optional college for this batch — must be one of the configured colleges.
    const collegeRaw = ((form.get('college') as string) || '').trim();
    const college = (await getColleges(env)).includes(collegeRaw) ? collegeRaw : null;

    const created: { id: string; filename: string }[] = [];
    const skipped: { filename: string; reason: string }[] = [];
    // Separate the PDFs from the rejects up front so a single bad file never drops
    // the rest of the batch.
    // A real PDF: the right name or type AND the "%PDF-" signature in its first bytes,
    // and at most 10 MB.
    const pdfs: File[] = [];
    for (const f of files) {
      const named = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
      const head = named ? new Uint8Array(await f.slice(0, 5).arrayBuffer()) : new Uint8Array();
      const magic = head.length === 5 && String.fromCharCode(...head) === '%PDF-';
      if (!named || !magic) skipped.push({ filename: f.name || '(unnamed)', reason: 'not a PDF' });
      else if (f.size > 10 * 1024 * 1024) skipped.push({ filename: f.name, reason: 'larger than 10 MB' });
      else pdfs.push(f);
    }

    // Upload the files to R2 CONCURRENTLY (bounded) instead of one-after-another —
    // the per-file round-trip is the cost, so overlapping them cuts a 100-file
    // upload from ~100 sequential puts to a handful of parallel waves.
    const uploadConc = Number(env.RESUME_UPLOAD_CONCURRENCY) || 15;
    const prepared = await mapPool(pdfs, uploadConc, async (file) => {
      try {
        const id = newId('cand');
        const r2Key = `resumes/${id}.pdf`;
        await env.RESUMES.put(r2Key, await file.arrayBuffer());
        return { id, r2Key, filename: file.name, ok: true as const };
      } catch (err) {
        return { filename: file.name || '(unnamed)', ok: false as const, reason: err instanceof Error ? err.message : String(err) };
      }
    });

    // One batched INSERT for every file that uploaded cleanly (single round-trip)
    // rather than an INSERT per candidate.
    const good = prepared.filter((p): p is { id: string; r2Key: string; filename: string; ok: true } => p.ok);
    for (const p of prepared) if (!p.ok) skipped.push({ filename: p.filename, reason: p.reason });
    if (good.length) {
      const stmt = env.DB.prepare(
        'INSERT INTO candidates (id, email, resume_r2_key, resume_filename, status, college) VALUES (?, ?, ?, ?, ?, ?)'
      );
      try {
        await env.DB.batch(good.map((p) => stmt.bind(p.id, `pending+${p.id}@unresolved.local`, p.r2Key, p.filename, 'uploaded', college)));
      } catch (err) {
        // No rows were saved, so remove the files just stored (nothing else would find them).
        await env.RESUMES.delete(good.map((p) => p.r2Key)).catch(() => {});
        throw err;
      }
      for (const p of good) created.push({ id: p.id, filename: p.filename });
    }
    return json({ ok: true, uploaded: created, skipped });
  }

  if (path === '/api/admin/resumes/process' && request.method === 'POST') {
    // Several parse requests may run at once (the admin page sends a few in parallel,
    // and two admins may press Parse together). Each request first CLAIMS a disjoint
    // set of waiting resumes in one UPDATE (SQLite serialises writes, so two claims
    // never pick the same row), then parses only what it claimed. A claim left by a
    // request that died part-way is taken over after 10 minutes (longer than any
    // batch takes, even with OpenAI retries). The final save only lands if this
    // request still holds the claim, so a slow request can't overwrite a takeover.
    // A resume that has been claimed 3 times without finishing (a PDF that crashes
    // the reader, say) is marked failed instead of being retried forever.
    await ensureParseClaimCols(env);
    const token = newId('parse');
    await env.DB.prepare(
      `UPDATE candidates SET parse_claim = ?, parse_claimed_at = datetime('now'), parse_attempts = parse_attempts + 1
        WHERE id IN (SELECT id FROM candidates
                      WHERE status = 'uploaded'
                        AND (parse_claim IS NULL OR parse_claimed_at IS NULL OR parse_claimed_at < datetime('now', '-10 minutes'))
                      LIMIT ?)`
    ).bind(token, Number(env.RESUME_PROCESS_BATCH) || PROCESS_BATCH_LIMIT).run();
    const rows = await env.DB.prepare("SELECT * FROM candidates WHERE parse_claim = ? AND status = 'uploaded'").bind(token).all<Candidate & { parse_attempts: number }>();
    const claimedRows = rows.results ?? [];
    const gaveUp = claimedRows.filter((c) => Number(c.parse_attempts) > 3);
    if (gaveUp.length) {
      await env.DB.batch(gaveUp.map((c) => env.DB.prepare("UPDATE candidates SET status = 'parse_failed', parse_claim = NULL WHERE id = ? AND parse_claim = ?").bind(c.id, token)));
    }
    const batch = claimedRows.filter((c) => Number(c.parse_attempts) <= 3);

    // Parse resumes CONCURRENTLY (bounded). Each resume is a slow PDF-extract +
    // OpenAI round-trip; doing 20 one-after-another is what made a batch take over
    // a minute. Overlapping ~6 at a time cuts that to roughly batch/concurrency.
    // In-batch email claims stay race-free because JS runs single-threaded: the
    // check-and-add on this Set happens synchronously between awaits.
    const conc = Number(env.RESUME_PARSE_CONCURRENCY) || 10;
    const claimedEmails = new Set<string>();

    const results = await mapPool(batch, conc, async (candidate) => {
      let parsed: ParsedResume | null = null;
      let text = '';
      try {
        const file = await env.RESUMES.get(candidate.resume_r2_key);
        if (!file) throw new Error('resume file missing in storage');
        text = await extractResumeText(await file.arrayBuffer());
        parsed = await parseResume(env, text);

        // Only trust an email that literally appears in the resume (visible text or
        // a mailto: link). If the AI returns an address that isn't there — e.g. it
        // invented "johndoe@example.com" for a PDF it couldn't read — use a real
        // address from the resume instead, or fail so an admin can fix it.
        const found = emailsInText(text);
        const aiEmail = (parsed.email || '').trim().toLowerCase();
        const email = aiEmail && found.includes(aiEmail) ? aiEmail : (found[0] ?? '');
        if (!email) throw new Error('could not find an email address on this resume — use "Fix email" to add it');

        // Two resumes in the SAME batch resolving to one email would otherwise race
        // past the DB check — claim the email atomically here.
        if (claimedEmails.has(email)) throw new Error(`parsed email ${email} appears on more than one resume in this batch — check for a duplicate`);
        const emailTaken = await env.DB.prepare('SELECT id FROM candidates WHERE email = ? AND id != ?')
          .bind(email, candidate.id)
          .first();
        if (emailTaken) throw new Error(`parsed email ${email} is already used by another candidate — check for a duplicate resume`);
        claimedEmails.add(email);

        // Single-part fixed-bank assessment — no per-resume question generation.
        // We parse identity (name + email) + skills, then mark ready. 'part2_ready'
        // is kept as the internal "ready to start" status so the rest of the
        // pipeline (login, assignment) is unchanged.
        try {
          const saved = await env.DB.prepare(
            `UPDATE candidates SET email = ?, name = ?, skills = ?, projects = ?, parsed_at = ?, status = 'part2_ready', parse_claim = NULL WHERE id = ? AND parse_claim = ?`
          )
            .bind(email, nameFromResume(parsed.name, text), JSON.stringify(parsed.skills), JSON.stringify(parsed.projects), nowIso(), candidate.id, token)
            .run();
          // Another request took this resume over (this one ran past the 10 minutes).
          if (!saved.meta?.changes) return { id: candidate.id, filename: candidate.resume_filename, ok: false as const, skipped: true, error: 'taken over by another parse request' };
        } catch (e) {
          // Another request running at the same time took this email first (emails are UNIQUE).
          if (/UNIQUE/i.test(String(e))) throw new Error(`parsed email ${email} is already used by another candidate — check for a duplicate resume`);
          throw e;
        }
        return { id: candidate.id, filename: candidate.resume_filename, ok: true as const };
      } catch (err) {
        // Keep whatever identity we could read (name, skills) even when the email is
        // missing, so the admin sees WHO this is and can use "Fix email" — instead of
        // an anonymous "(unparsed)" row.
        const name = parsed ? nameFromResume(parsed.name, text) : null;
        await env.DB.prepare(
          "UPDATE candidates SET status = 'parse_failed', parse_claim = NULL, name = COALESCE(?, name), skills = COALESCE(?, skills), projects = COALESCE(?, projects) WHERE id = ? AND parse_claim = ?"
        )
          .bind(name, parsed ? JSON.stringify(parsed.skills ?? []) : null, parsed ? JSON.stringify(parsed.projects ?? []) : null, candidate.id, token)
          .run()
          .catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        // Never show raw database or storage errors in the admin table.
        const safe = /D1_|SQLITE|constraint/i.test(msg) ? 'could not save this resume — try Parse again' : msg;
        return { id: candidate.id, filename: candidate.resume_filename, ok: false as const, error: safe };
      }
    });

    // remainingToProcess: still waiting, including resumes another request is parsing
    // right now (inFlight), so the page keeps going until every one is done.
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN parse_claim IS NOT NULL AND parse_claimed_at >= datetime('now', '-10 minutes') THEN 1 ELSE 0 END) AS inFlight
         FROM candidates WHERE status = 'uploaded'`
    ).first<{ n: number; inFlight: number | null }>();
    const failedReads = gaveUp.map((c) => ({ id: c.id, filename: c.resume_filename, ok: false as const, error: 'this resume could not be read after 3 tries — check the PDF opens, or use "Fix email" to enter the details' }));
    return json({ processed: [...failedReads, ...results], claimed: claimedRows.length, remainingToProcess: remaining?.n ?? 0, inFlight: remaining?.inFlight ?? 0 });
  }

  // Admin-only resume PDF stream (for the side panel viewer).
  const resumeMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/resume$/);
  if (resumeMatch && request.method === 'GET') {
    const c = (await env.DB.prepare('SELECT resume_r2_key, resume_filename FROM candidates WHERE id = ?').bind(resumeMatch[1]).first()) as
      | { resume_r2_key: string; resume_filename: string | null }
      | null;
    if (!c) return json({ error: 'Not found' }, { status: 404 });
    const obj = await env.RESUMES.get(c.resume_r2_key);
    if (!obj) return json({ error: 'Resume file missing' }, { status: 404 });
    // Served as a PDF only: no content sniffing, never cached, framed only by the
    // admin page, and the (uploader-controlled) file name is sanitised for the header.
    const safeName = (c.resume_filename || 'resume.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'resume.pdf';
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}"`,
        'X-Content-Type-Options': 'nosniff',
        // Always a PDF (the upload checks the %PDF- signature and nosniff stops the
        // browser guessing otherwise), framed only by our own admin page. No CSP
        // "sandbox": Chrome refuses to show a PDF in a sandboxed document.
        'Content-Security-Policy': "frame-ancestors 'self'",
        'X-Frame-Options': 'SAMEORIGIN',
        'Cache-Control': 'no-store',
      },
    });
  }

  // ---- Question bank ----
  if (path === '/api/admin/questions' && request.method === 'GET') {
    await ensureQuestionHintCol(env);
    await ensureQuestionDeletedCol(env);
    await ensureQuestionCheckpointsCol(env);
    // ?deleted=1 returns the soft-deleted bin (for restore); otherwise only live rows.
    const qUrl = new URL(request.url);
    const wantDeleted = qUrl.searchParams.get('deleted') === '1';
    const where = wantDeleted ? 'WHERE deleted_at IS NOT NULL' : 'WHERE deleted_at IS NULL';
    const rows = await env.DB.prepare(`SELECT * FROM question_bank ${where} ORDER BY category, created_at`).all<QuestionBankRow>();
    // A lightweight count of the deleted bin so the UI can show "Show deleted (N)".
    const del = await env.DB.prepare('SELECT COUNT(*) AS n FROM question_bank WHERE deleted_at IS NOT NULL').first<{ n: number }>();
    return json({ questions: rows.results ?? [], deletedCount: del?.n ?? 0 });
  }

  // Part 3 question bank (debugging / break-fix). GET lists them (any admin);
  // POST /seed loads the built-in default bank (manager only, idempotent).
  if (path === '/api/admin/part3/questions' && request.method === 'GET') {
    await ensurePart3Schema(env);
    const rows = await env.DB.prepare(
      'SELECT id, kind, title, prompt, code_snippet, reference_answer, marks, difficulty, active FROM part3_questions ORDER BY kind, created_at'
    ).all();
    return json({ questions: rows.results ?? [] });
  }

  if (path === '/api/admin/part3/seed' && request.method === 'POST') {
    const inserted = await seedDefaultPart3(env);
    const total = await env.DB.prepare('SELECT COUNT(*) as n FROM part3_questions').first<{ n: number }>();
    await audit(env, 'part3_seed', null, `inserted ${inserted}`);
    return json({ ok: true, inserted, total: total?.n ?? 0 });
  }

  // Manual add: human types the question + reference answer; AI enriches (sample table + rubric).
  if (path === '/api/admin/questions' && request.method === 'POST') {
    const body = await request.json<{
      category: 'sql' | 'python' | 'dsa' | 'scenario';
      prompt: string;
      referenceAnswer?: string;
      marks?: number;
      difficulty?: string;
      enrich?: boolean;
    }>().catch(() => ({} as any));
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || typeof body.category !== 'string') return json({ error: 'category and prompt are required' }, { status: 400 });
    if (body.prompt.length > 20000 || (body.referenceAnswer != null && (typeof body.referenceAnswer !== 'string' || body.referenceAnswer.length > 20000))) {
      return json({ error: 'The question and reference answer must each be under 20,000 characters.' }, { status: 400 });
    }
    if (body.marks != null && marksValue(body.marks) == null) return json({ error: 'Marks must be a whole number from 1 to 100.' }, { status: 400 });
    if (body.difficulty != null && !DIFFICULTIES.has(String(body.difficulty))) return json({ error: 'Difficulty must be easy, medium or hard.' }, { status: 400 });
    if (!QUESTION_CATEGORIES.some((c) => c.value === body.category)) {
      return json({ error: `Unknown question type "${body.category}".` }, { status: 400 });
    }
    const marks = body.marks != null ? (marksValue(body.marks) as number) : defaultMarks(env, body.category);
    const id = newId('q');

    await ensureQuestionHintCol(env);
    await ensureQuestionCheckpointsCol(env);
    let sampleData: string | null = null;
    let expectedOutput: string | null = null;
    let rubric: string | null = null;
    let hint: string | null = null;
    let checkpoints: string | null = null;
    let enrichError: string | null = null;
    if (body.enrich !== false) {
      try {
        const e = await enrichQuestion(env, body.category, body.prompt, body.referenceAnswer ?? null);
        sampleData = e.sample_data;
        expectedOutput = e.expected_output;
        rubric = e.rubric;
        hint = e.hint;
        checkpoints = e.checkpoints;
      } catch (err) {
        enrichError = err instanceof Error ? err.message : String(err);
      }
    }

    await env.DB.prepare(
      `INSERT INTO question_bank (id, category, prompt, reference_answer, sample_data, expected_output, rubric, hint, checkpoints, marks, difficulty, status, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1)`
    )
      .bind(id, body.category, body.prompt, body.referenceAnswer ?? null, sampleData, expectedOutput, rubric, hint, checkpoints, marks, body.difficulty ?? 'medium')
      .run();
    return json({ ok: true, id, enrichError });
  }

  // Re-run AI enrichment for a question (regenerate sample table + rubric).
  const enrichMatch = path.match(/^\/api\/admin\/questions\/([^/]+)\/enrich$/);
  if (enrichMatch && request.method === 'POST') {
    await ensureQuestionHintCol(env);
    await ensureQuestionCheckpointsCol(env);
    const q = (await env.DB.prepare('SELECT * FROM question_bank WHERE id = ?').bind(enrichMatch[1]).first()) as QuestionBankRow | null;
    if (!q) return json({ error: 'Not found' }, { status: 404 });
    try {
      const e = await enrichQuestion(env, q.category as 'sql' | 'python' | 'dsa' | 'scenario', q.prompt, q.reference_answer);
      await env.DB.prepare('UPDATE question_bank SET sample_data = ?, expected_output = ?, rubric = ?, hint = ?, checkpoints = ? WHERE id = ?')
        .bind(e.sample_data, e.expected_output, e.rubric, e.hint, e.checkpoints, q.id)
        .run();
      return json({ ok: true });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

  // Batch-enrich every question still missing enrichment (sample data / expected
  // output / rubric / hint, and checkpoints for DSA & Scenario). Used after a bulk
  // import or to backfill checkpoints — grades a few per call so the admin can loop
  // it without hitting time limits.
  if (path === '/api/admin/questions/enrich-all' && request.method === 'POST') {
    await ensureQuestionHintCol(env);
    await ensureQuestionDeletedCol(env);
    await ensureQuestionCheckpointsCol(env);
    const batchSize = Number(env.ANALYSIS_BATCH_SIZE) || 4;
    // A DSA/Scenario question with no checkpoints yet also counts as "needs enrichment",
    // so running Enrich-all backfills checkpoints onto the existing bank.
    const needs = "(rubric IS NULL OR expected_output IS NULL OR sample_data IS NULL OR (category IN ('dsa','scenario') AND (checkpoints IS NULL OR checkpoints = '')))";
    const rows = await env.DB.prepare(
      `SELECT * FROM question_bank WHERE deleted_at IS NULL AND ${needs} LIMIT ?`
    ).bind(batchSize).all<QuestionBankRow>();
    const batch = rows.results ?? [];
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const q of batch) {
      try {
        const e = await enrichQuestion(env, q.category as 'sql' | 'python' | 'dsa' | 'scenario', q.prompt, q.reference_answer);
        await env.DB.prepare('UPDATE question_bank SET sample_data = ?, expected_output = ?, rubric = ?, hint = ?, checkpoints = ? WHERE id = ?')
          .bind(e.sample_data, e.expected_output, e.rubric, e.hint, e.checkpoints, q.id)
          .run();
        results.push({ id: q.id, ok: true });
      } catch (err) {
        results.push({ id: q.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM question_bank WHERE deleted_at IS NULL AND ${needs}`
    ).first<{ n: number }>();
    return json({ processed: results, remaining: remaining?.n ?? 0 });
  }

  // Edit a question's fields.
  const editMatch = path.match(/^\/api\/admin\/questions\/([^/]+)$/);
  if (editMatch && request.method === 'PUT') {
    const b = await request.json<Partial<{ prompt: string; reference_answer: string; sample_data: string; rubric: string; marks: number; difficulty: string; active: number }>>().catch(() => ({} as any));
    const q = (await env.DB.prepare('SELECT * FROM question_bank WHERE id = ?').bind(editMatch[1]).first()) as QuestionBankRow | null;
    if (!q) return json({ error: 'Not found' }, { status: 404 });
    for (const k of ['prompt', 'reference_answer', 'sample_data', 'rubric'] as const) {
      if (b[k] != null && (typeof b[k] !== 'string' || (b[k] as string).length > 20000)) return json({ error: `${k} must be text under 20,000 characters.` }, { status: 400 });
    }
    if (b.marks != null && marksValue(b.marks) == null) return json({ error: 'Marks must be a whole number from 1 to 100.' }, { status: 400 });
    if (b.difficulty != null && !DIFFICULTIES.has(String(b.difficulty))) return json({ error: 'Difficulty must be easy, medium or hard.' }, { status: 400 });
    if (b.active != null && b.active !== 0 && b.active !== 1) return json({ error: 'active must be 0 or 1.' }, { status: 400 });
    await env.DB.prepare(
      'UPDATE question_bank SET prompt = ?, reference_answer = ?, sample_data = ?, rubric = ?, marks = ?, difficulty = ?, active = ? WHERE id = ?'
    )
      .bind(
        b.prompt ?? q.prompt,
        b.reference_answer ?? q.reference_answer,
        b.sample_data ?? q.sample_data,
        b.rubric ?? q.rubric,
        b.marks != null ? marksValue(b.marks) : q.marks,
        b.difficulty ?? q.difficulty,
        b.active ?? q.active,
        q.id
      )
      .run();
    return json({ ok: true });
  }

  const toggleMatch = path.match(/^\/api\/admin\/questions\/([^/]+)\/toggle-active$/);
  if (toggleMatch && request.method === 'POST') {
    await env.DB.prepare('UPDATE question_bank SET active = 1 - active WHERE id = ?').bind(toggleMatch[1]).run();
    return json({ ok: true });
  }

  // Restore a soft-deleted question back into the live bank.
  const qRestoreMatch = path.match(/^\/api\/admin\/questions\/([^/]+)\/restore$/);
  if (qRestoreMatch && request.method === 'POST') {
    await ensureQuestionDeletedCol(env);
    const qid = qRestoreMatch[1];
    const q = await env.DB.prepare('SELECT id FROM question_bank WHERE id = ?').bind(qid).first();
    if (!q) return json({ error: 'Not found' }, { status: 404 });
    // Deleting also switched it off; restoring puts it back in rotation.
    await env.DB.prepare('UPDATE question_bank SET deleted_at = NULL, active = 1 WHERE id = ?').bind(qid).run();
    await audit(env, 'restore_question', null, qid);
    return json({ ok: true });
  }

  // SOFT-delete a question: stamp deleted_at (keeping the row, its full content, and
  // every answer/assignment that referenced it) and keep a complete JSON snapshot in
  // the audit log. The question leaves the live bank and is never assigned again, but
  // nothing is lost — it can be restored, and a snapshot survives even a later purge.
  const qDeleteMatch = path.match(/^\/api\/admin\/questions\/([^/]+)$/);
  if (qDeleteMatch && request.method === 'DELETE') {
    await ensureQuestionDeletedCol(env);
    const qid = qDeleteMatch[1];
    const q = await env.DB.prepare('SELECT * FROM question_bank WHERE id = ?').bind(qid).first<QuestionBankRow>();
    if (!q) return json({ error: 'Not found' }, { status: 404 });
    if (q.deleted_at) return json({ ok: true, alreadyDeleted: true });
    await env.DB.prepare("UPDATE question_bank SET deleted_at = datetime('now'), active = 0 WHERE id = ?").bind(qid).run();
    // Full snapshot so the entry is recoverable from the audit trail even if the row
    // is ever hard-purged later.
    await audit(env, 'delete_question', null, JSON.stringify({ snapshot: q }));
    return json({ ok: true });
  }

  // Bulk import (used for seeding). Accepts written questions with reference answers.
  if (path === '/api/admin/questions/bulk-import' && request.method === 'POST') {
    const body = await request.json<{ questions?: { category?: string; prompt?: string; referenceAnswer?: string; marks?: number; difficulty?: string }[] }>().catch(() => ({} as { questions?: unknown }));
    const list = Array.isArray(body.questions) ? body.questions : [];
    // Keep only well-formed entries: a valid category and a non-empty prompt.
    const allowed = new Set(QUESTION_CATEGORIES.map((c) => c.value));
    const valid = list.filter((q) => q && typeof q.category === 'string' && allowed.has(q.category) && typeof q.prompt === 'string' && q.prompt.trim().length > 0
      && q.prompt.length <= 20000
      && (q.referenceAnswer == null || (typeof q.referenceAnswer === 'string' && q.referenceAnswer.length <= 20000))
      && (q.marks == null || marksValue(q.marks) != null)
      && (q.difficulty == null || DIFFICULTIES.has(String(q.difficulty))));
    if (!valid.length) {
      return json({ error: `No valid questions to import. Each needs a category (${QUESTION_CATEGORIES.map((c) => `"${c.value}"`).join(', ')}) and a non-empty prompt.` }, { status: 400 });
    }
    // Skip any question whose prompt already exists in the bank, so re-importing
    // the same file (or an overlapping one) never creates duplicates.
    const norm = (p: string) => p.trim().toLowerCase().replace(/\s+/g, ' ');
    const existingRows = await env.DB.prepare('SELECT prompt FROM question_bank WHERE deleted_at IS NULL').all<{ prompt: string }>();
    const existing = new Set((existingRows.results ?? []).map((r) => norm(r.prompt)));
    const fresh: typeof valid = [];
    for (const q of valid) {
      const key = norm(q.prompt as string);
      if (existing.has(key)) continue; // already in the bank
      existing.add(key); // also dedupe within this same file
      fresh.push(q);
    }
    const duplicates = valid.length - fresh.length;
    if (!fresh.length) {
      return json({ ok: true, imported: 0, duplicates, skipped: list.length - valid.length });
    }
    const stmt = env.DB.prepare(
      `INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES (?, ?, ?, ?, ?, ?, 'active', 1)`
    );
    await env.DB.batch(
      fresh.map((q) =>
        stmt.bind(newId('q'), q.category, q.prompt, q.referenceAnswer ?? null, q.marks != null ? marksValue(q.marks) : defaultMarks(env, q.category as string), q.difficulty ?? 'medium')
      )
    );
    return json({ ok: true, imported: fresh.length, duplicates, skipped: list.length - valid.length });
  }

  // ---- Candidates / results dashboard ----
  if (path === '/api/admin/candidates' && request.method === 'GET') {
    // Cohort-wide aggregates (a few parallel GROUP BY queries) instead of 4 queries
    // per candidate — keeps "Refresh" fast even for large cohorts.
    const [rows, sums] = await Promise.all([
      env.DB.prepare('SELECT * FROM candidates ORDER BY created_at').all<Candidate>(),
      cohortSummaries(env),
    ]);
    const candidates = (rows.results ?? []).map((c) => {
      const p1 = sums.p1.get(c.id) ?? EMPTY_SUMMARY;
      const p2 = sums.p2.get(c.id) ?? EMPTY_SUMMARY;
      const p3 = sums.p3.get(c.id) ?? EMPTY_SUMMARY;
      return {
        id: c.id,
        name: c.name,
        email: c.email.startsWith('pending+') ? null : c.email,
        status: c.status,
        college: c.college ?? null,
        accessRevoked: !!c.access_revoked,
        retakeGranted: !!c.retake_granted,
        loginCount: sums.logins.get(c.id) ?? 0,
        part1: p1,
        part2: p2,
        part3: p3,
        totalAwarded: p1.awarded + p2.awarded + p3.awarded,
        totalMax: p1.max + p2.max + p3.max,
      };
    });
    return json({ candidates });
  }

  // Delete a candidate and ALL their related data (attempt, assignments,
  // answers, generated questions, interview questions) plus their resume in R2.
  const deleteMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)$/);
  if (deleteMatch && request.method === 'DELETE') {
    const id = deleteMatch[1];
    const c = (await env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(id).first()) as Candidate | null;
    if (!c) return json({ error: 'Not found' }, { status: 404 });
    // Capture a full, recoverable snapshot BEFORE anything is removed: the candidate
    // record plus their score summaries. If a candidate is deleted by mistake, this
    // audit row holds everything needed to recreate them (bar the resume PDF itself).
    const [p1, p2, p3] = await Promise.all([part1Summary(env, id), part2Summary(env, id), part3Summary(env, id)]);
    const snapshot = {
      candidate: {
        id: c.id, name: c.name, email: c.email, college: c.college ?? null, status: c.status,
        resume_filename: c.resume_filename ?? null, resume_r2_key: c.resume_r2_key ?? null,
        created_at: c.created_at ?? null,
      },
      scores: { part1: p1, part2: p2, part3: p3 },
    };
    // The resume file goes first; if it can't be deleted, nothing is (try again), so a
    // file is never left behind without the row that points at it.
    if (c.resume_r2_key) {
      try { await env.RESUMES.delete(c.resume_r2_key); }
      catch { return json({ error: 'Could not delete the resume file just now. Nothing was deleted; please try again.' }, { status: 502 }); }
    }
    await ensurePart3Schema(env);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM interview_questions WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part3_answers WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part2_answers WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part1_answers WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part3_assignments WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part2_questions WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part1_assignments WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM attempts WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM candidates WHERE id = ?').bind(id),
    ]);
    // Clear the lifetime "seen" history too, and give back this candidate's share of
    // each question's usage count so the rotation stays accurate after deletions
    // (best-effort — the tables may not exist yet on a fresh DB).
    try {
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE question_usage SET uses = MAX(0, uses - 1) WHERE question_id IN (SELECT question_id FROM part1_seen WHERE candidate_id = ?)'
        ).bind(id),
        env.DB.prepare('DELETE FROM part1_seen WHERE candidate_id = ?').bind(id),
      ]);
    } catch { /* tables not created yet */ }
    await audit(env, 'delete', id, JSON.stringify(snapshot));
    return json({ ok: true });
  }

  const detailMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)$/);
  if (detailMatch && request.method === 'GET') {
    const id = detailMatch[1];
    const candidate = (await env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(id).first()) as Candidate | null;
    if (!candidate) return json({ error: 'Not found' }, { status: 404 });

    const attempt = await env.DB.prepare('SELECT * FROM attempts WHERE candidate_id = ?').bind(id).first();
    const part1Answers = await env.DB.prepare(
      `SELECT qb.prompt, qb.category, qb.reference_answer, a.answer_text, a.ai_score, a.ai_reasoning, a.deductions, a.max_marks
       FROM part1_assignments pa
       JOIN question_bank qb ON qb.id = pa.question_id
       LEFT JOIN part1_answers a ON a.question_id = pa.question_id AND a.candidate_id = pa.candidate_id
       WHERE pa.candidate_id = ? ORDER BY pa.position`
    )
      .bind(id)
      .all();
    await ensurePart2AiCol(env);
    await ensureInterviewAnswerCol(env);
    const part2Answers = await env.DB.prepare(
      `SELECT pq.prompt, pq.based_on_skill, a.answer_text, a.ai_score, a.ai_reasoning, a.deductions, a.max_marks, a.ai_content_pct
       FROM part2_questions pq
       LEFT JOIN part2_answers a ON a.question_id = pq.id AND a.candidate_id = pq.candidate_id
       WHERE pq.candidate_id = ? ORDER BY pq.position`
    )
      .bind(id)
      .all();
    await ensurePart3Schema(env);
    const part3Answers = await env.DB.prepare(
      `SELECT p3.title, p3.kind, p3.prompt, p3.code_snippet, p3.reference_answer, a.answer_text, a.ai_score, a.ai_reasoning, a.deductions, a.max_marks
       FROM part3_assignments pa
       JOIN part3_questions p3 ON p3.id = pa.question_id
       LEFT JOIN part3_answers a ON a.question_id = pa.question_id AND a.candidate_id = pa.candidate_id
       WHERE pa.candidate_id = ? ORDER BY pa.position`
    )
      .bind(id)
      .all();
    const interviewQuestions = await env.DB.prepare('SELECT question, model_answer, follow_up, based_on FROM interview_questions WHERE candidate_id = ? ORDER BY position').bind(id).all();

    return json({
      candidate: {
        ...candidate,
        // Shaped the same way however it was stored, so the detail view always renders.
        skills: normalizeParsed({ skills: jsonOr(candidate.skills, []) }).skills,
        projects: normalizeParsed({ projects: jsonOr(candidate.projects, []) }).projects,
      },
      attempt,
      part1Answers: part1Answers.results ?? [],
      part2Answers: part2Answers.results ?? [],
      part3Answers: part3Answers.results ?? [],
      interviewQuestions: interviewQuestions.results ?? [],
    });
  }

  // ---- Results export (CSV for the hiring team) ----
  // Query params: ?format=summary|full & ?college=all|<name> & ?status=all|<status>
  //   summary = one row per candidate (scores + flags)
  //   full    = one row per candidate PER question (assigned question, the
  //             candidate's answer, AI score, deductions, reasoning) + interview Qs
  if (path === '/api/admin/export.csv' && request.method === 'GET') {
    const url = new URL(request.url);
    const fmt = url.searchParams.get('format') === 'full' ? 'full' : 'summary';
    const collegeFilter = url.searchParams.get('college') || 'all';
    const statusFilter = url.searchParams.get('status') || 'all';

    let candRows = (await env.DB.prepare('SELECT * FROM candidates ORDER BY college, created_at').all<Candidate>()).results ?? [];
    if (collegeFilter === '__none') candRows = candRows.filter((c) => !c.college);
    else if (collegeFilter !== 'all') candRows = candRows.filter((c) => (c.college || '') === collegeFilter);
    if (statusFilter !== 'all') candRows = candRows.filter((c) => c.status === statusFilter);

    const esc = (v: unknown) => {
      let s = v == null ? '' : String(v);
      // Neutralise spreadsheet formulas in candidate text (an answer starting with "=").
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const emailOut = (e: string) => (e.startsWith('pending+') ? '' : e);
    const fmtDed = (raw: unknown) => {
      try { const a = raw ? JSON.parse(String(raw)) : []; return Array.isArray(a) ? a.map((d: any) => `-${d.marks}: ${d.reason}`).join(' | ') : ''; } catch { return ''; }
    };

    const lines: string[] = [];
    if (fmt === 'summary') {
      lines.push(['College', 'Name', 'Email', 'Status', 'Logins', 'Part1 awarded', 'Part1 max', 'Part2 awarded', 'Part2 max', 'Part3 awarded', 'Part3 max', 'Total awarded', 'Total max', 'P1 tab switches', 'P2 tab switches', 'P3 tab switches'].join(','));
      for (const c of candRows) {
        const p1 = await part1Summary(env, c.id);
        const p2 = await part2Summary(env, c.id);
        const p3 = await part3Summary(env, c.id);
        const at = (await env.DB.prepare('SELECT login_count, part1_tab_switch_count, part2_tab_switch_count, part3_tab_switch_count FROM attempts WHERE candidate_id = ?').bind(c.id).first<any>()) || {};
        lines.push([
          esc(c.college || ''), esc(c.name), esc(emailOut(c.email)), esc(c.status), esc(at.login_count ?? ''),
          p1.awarded, p1.max, p2.awarded, p2.max, p3.awarded, p3.max,
          p1.awarded + p2.awarded + p3.awarded, p1.max + p2.max + p3.max,
          at.part1_tab_switch_count ?? 0, at.part2_tab_switch_count ?? 0, at.part3_tab_switch_count ?? 0,
        ].join(','));
      }
    } else {
      lines.push(['College', 'Name', 'Email', 'Status', 'Total awarded', 'Total max', 'Section', 'Q#', 'Category/Skill', 'Question', 'Candidate answer', 'AI score', 'Q max', 'Deductions', 'AI reasoning'].join(','));
      for (const c of candRows) {
        const p1 = await part1Summary(env, c.id);
        const p2 = await part2Summary(env, c.id);
        const p3 = await part3Summary(env, c.id);
        const base = [esc(c.college || ''), esc(c.name), esc(emailOut(c.email)), esc(c.status), p1.awarded + p2.awarded + p3.awarded, p1.max + p2.max + p3.max];
        const p1rows = (await env.DB.prepare(
          `SELECT qb.category, qb.prompt, a.answer_text, a.ai_score, a.max_marks, a.deductions, a.ai_reasoning
           FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id
           LEFT JOIN part1_answers a ON a.question_id = pa.question_id AND a.candidate_id = pa.candidate_id
           WHERE pa.candidate_id = ? ORDER BY pa.position`
        ).bind(c.id).all<any>()).results ?? [];
        p1rows.forEach((q, i) => lines.push([...base, 'Part 1', i + 1, esc(q.category), esc(q.prompt), esc(q.answer_text || ''), q.ai_score ?? '', q.max_marks ?? '', esc(fmtDed(q.deductions)), esc(q.ai_reasoning || '')].join(',')));
        const p2rows = (await env.DB.prepare(
          `SELECT pq.based_on_skill, pq.prompt, a.answer_text, a.ai_score, a.max_marks, a.deductions, a.ai_reasoning, a.ai_content_pct
           FROM part2_questions pq LEFT JOIN part2_answers a ON a.question_id = pq.id AND a.candidate_id = pq.candidate_id
           WHERE pq.candidate_id = ? ORDER BY pq.position`
        ).bind(c.id).all<any>().catch(() => ({ results: [] }))).results ?? [];
        p2rows.forEach((q, i) => lines.push([...base, 'Part 2', i + 1, esc(q.based_on_skill || ''), esc(q.prompt), esc(q.answer_text || ''), q.ai_score ?? '', q.max_marks ?? '', esc(fmtDed(q.deductions)), esc((q.ai_content_pct != null ? `[AI-likelihood ~${Math.round(q.ai_content_pct)}%] ` : '') + (q.ai_reasoning || ''))].join(',')));
        const p3rows = (await env.DB.prepare(
          `SELECT p3.kind, p3.title, p3.prompt, a.answer_text, a.ai_score, a.max_marks, a.deductions, a.ai_reasoning
           FROM part3_assignments pa JOIN part3_questions p3 ON p3.id = pa.question_id
           LEFT JOIN part3_answers a ON a.question_id = pa.question_id AND a.candidate_id = pa.candidate_id
           WHERE pa.candidate_id = ? ORDER BY pa.position`
        ).bind(c.id).all<any>().catch(() => ({ results: [] }))).results ?? [];
        p3rows.forEach((q, i) => lines.push([...base, 'Part 3', i + 1, esc(q.kind === 'buggy_fix' ? 'Buggy-code fix' : 'Break-fix scenario'), esc((q.title ? q.title + ' — ' : '') + q.prompt), esc(q.answer_text || ''), q.ai_score ?? '', q.max_marks ?? '', esc(fmtDed(q.deductions)), esc(q.ai_reasoning || '')].join(',')));
        const iqs = (await env.DB.prepare('SELECT question, follow_up, based_on FROM interview_questions WHERE candidate_id = ? ORDER BY position').bind(c.id).all<any>()).results ?? [];
        iqs.forEach((q, i) => lines.push([...base, 'Interview', i + 1, esc(q.based_on || ''), esc(q.question), esc(q.follow_up ? 'Follow-up: ' + q.follow_up : ''), '', '', '', ''].join(',')));
        if (!p1rows.length && !p2rows.length && !p3rows.length && !iqs.length) lines.push([...base, '', '', '', '(no questions/answers yet)', '', '', '', '', ''].join(','));
      }
    }
    // Leading BOM so Excel opens UTF-8 (names, accents) correctly.
    const fname = `talo-results-${fmt}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response('﻿' + lines.join('\r\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }

  // ---- Admin audit log (accountability) ----
  if (path === '/api/admin/audit' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT action, candidate_id, detail, created_at FROM admin_audit ORDER BY created_at DESC LIMIT 200').all();
    return json({ events: rows.results ?? [] });
  }

  // ---- Batch analysis: grade every submitted candidate, a few per call ----
  if (path === '/api/admin/analysis/status' && request.method === 'GET') {
    const autoClosed = await closeTimedOut(env); // self-heal abandoned attempts so grading isn't blocked
    const counts = await env.DB.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status IN ('uploaded','parsed','part2_ready','in_progress') THEN 1 ELSE 0 END) as pending,
         SUM(CASE WHEN status IN ('submitted','grading') THEN 1 ELSE 0 END) as awaiting_grade,
         SUM(CASE WHEN status IN ('evaluated','shortlisted','rejected') THEN 1 ELSE 0 END) as graded
       FROM candidates`
    ).first<{ total: number; pending: number; awaiting_grade: number; graded: number }>();
    const total = counts?.total ?? 0;
    const pending = counts?.pending ?? 0;
    const awaiting = counts?.awaiting_grade ?? 0;
    // "All done" = every candidate has at least submitted (none still pending) and there's at least one.
    return json({
      total,
      pending,
      awaitingGrade: awaiting,
      graded: counts?.graded ?? 0,
      allSubmitted: total > 0 && pending === 0,
      autoClosed,
    });
  }

  if (path === '/api/admin/analysis/run' && request.method === 'POST') {
    await closeTimedOut(env);
    await ensureGradingClaimCols(env);
    // Grading is parallel on THREE levels for speed on a 100-student cohort:
    //  1) each candidate grades its 5 questions concurrently (in gradeCandidate),
    //  2) this call grades its claimed batch of candidates concurrently (mapPool),
    //  3) the CLIENT can fire several of these calls at once — each atomically
    //     CLAIMS a disjoint batch below, so concurrent calls never double-grade.
    const batchSize = Number(env.GRADING_BATCH_SIZE) || Number(env.ANALYSIS_BATCH_SIZE) || 8;
    const conc = Number(env.GRADING_CONCURRENCY) || 6;

    // Reclaim candidates left in 'grading' by a call that died mid-grade (>3 min).
    await env.DB.prepare(
      "UPDATE candidates SET status = 'submitted', grading_claim = NULL WHERE status = 'grading' AND (grading_claimed_at IS NULL OR grading_claimed_at < datetime('now','-3 minutes'))"
    ).run().catch(() => {});

    // Atomically claim a disjoint batch: SQLite serialises writes, so two concurrent
    // claims pick different rows (the second sees the first's rows already 'grading').
    const token = newId('grade');
    await env.DB.prepare(
      "UPDATE candidates SET status = 'grading', grading_claim = ?, grading_claimed_at = datetime('now') WHERE id IN (SELECT id FROM candidates WHERE status = 'submitted' AND (grading_claim IS NULL OR grading_claimed_at IS NULL OR grading_claimed_at < datetime('now','-3 minutes')) LIMIT ?)"
    ).bind(token, batchSize).run();
    const rows = await env.DB.prepare('SELECT * FROM candidates WHERE grading_claim = ?').bind(token).all<Candidate>();
    const batch = rows.results ?? [];

    const results = await mapPool(batch, conc, async (c) => {
      try {
        await gradeAny(env, c.id, token);
        // Only if this call still holds the claim: a Resume or Retake meanwhile drops
        // it, and the candidate's new attempt must not be marked graded.
        await env.DB.prepare("UPDATE candidates SET status = CASE WHEN status IN ('shortlisted','rejected') THEN status ELSE 'evaluated' END, grading_claim = NULL WHERE id = ? AND grading_claim = ?").bind(c.id, token).run();
        return { id: c.id, name: c.name, ok: true as const };
      } catch (err) {
        // Release the claim so a later call retries this candidate.
        await env.DB.prepare("UPDATE candidates SET status = 'submitted', grading_claim = NULL WHERE id = ? AND grading_claim = ?").bind(c.id, token).run().catch(() => {});
        return { id: c.id, name: c.name, ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    });
    // Remaining = anything not yet graded (still queued, or in flight elsewhere).
    const remaining = await env.DB.prepare("SELECT COUNT(*) as n FROM candidates WHERE status IN ('submitted','grading')").first<{ n: number }>();
    return json({ processed: results, remaining: remaining?.n ?? 0, claimed: batch.length });
  }

  // Grade a single candidate on demand (useful for spot-checks and for testing
  // Part 1 scoring before the full cohort has submitted).
  const gradeOneMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/grade$/);
  if (gradeOneMatch && request.method === 'POST') {
    const id = gradeOneMatch[1];
    await ensureGradingClaimCols(env);
    // Only a finished test is graded (the writers site checks both parts before this).
    if (!isDocs(env)) {
      const at = await env.DB.prepare('SELECT part1_submitted_at FROM attempts WHERE candidate_id = ?').bind(id).first<{ part1_submitted_at: string | null }>();
      if (!at?.part1_submitted_at) return json({ error: "This candidate hasn't finished the test yet, so there is nothing final to grade." }, { status: 409 });
    }
    // Claim the candidate, as Analyze does, so a double-click or a running Analyze
    // can't grade (and pay for) the same candidate twice.
    const token = newId('grade');
    // The finished-test check is repeated inside the claim, so a Resume landing
    // between the check above and this claim can't let a reopened attempt be graded.
    const doneCol = isDocs(env) ? 'part2_submitted_at' : 'part1_submitted_at';
    const claim = await env.DB.prepare(
      `UPDATE candidates SET grading_claim = ?, grading_claimed_at = datetime('now')
       WHERE id = ? AND (grading_claim IS NULL OR grading_claimed_at IS NULL OR grading_claimed_at < datetime('now','-3 minutes'))
         AND EXISTS (SELECT 1 FROM attempts WHERE candidate_id = ? AND ${doneCol} IS NOT NULL)`
    ).bind(token, id, id).run();
    if (!claim.meta?.changes) {
      const still = await env.DB.prepare(`SELECT ${doneCol} AS done FROM attempts WHERE candidate_id = ?`).bind(id).first<{ done: string | null }>();
      if (!still?.done) return json({ error: "This candidate hasn't finished the test yet, so there is nothing final to grade." }, { status: 409 });
      return json({ error: 'This candidate is being graded right now. Try again in a minute.' }, { status: 409 });
    }
    try {
      await gradeAny(env, id, token);
      await env.DB.prepare("UPDATE candidates SET status = CASE WHEN status IN ('shortlisted','rejected') THEN status ELSE 'evaluated' END, grading_claim = NULL WHERE id = ? AND grading_claim = ?").bind(id, token).run();
    } catch (err) {
      await env.DB.prepare('UPDATE candidates SET grading_claim = NULL WHERE id = ? AND grading_claim = ?').bind(id, token).run().catch(() => {});
      throw err;
    }
    await audit(env, 'grade', id);
    return json({ ok: true });
  }

  // Manual fix for a candidate whose resume didn't parse (or needs a corrected
  // email): set their email/name and make them ready to take the assessment.
  const manualMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/manual$/);
  if (manualMatch && request.method === 'POST') {
    const id = manualMatch[1];
    const b = await request.json<{ email?: string; name?: string }>().catch(() => ({} as { email?: string; name?: string }));
    const email = (b.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return json({ error: 'A valid email is required' }, { status: 400 });
    const clash = await env.DB.prepare('SELECT id FROM candidates WHERE email = ? AND id != ?').bind(email, id).first();
    if (clash) return json({ error: 'Another candidate already has that email.' }, { status: 409 });
    // Only a candidate who isn't ready yet becomes ready; a candidate already in or
    // past the test keeps their status (resetting it stranded finished candidates).
    await env.DB.prepare("UPDATE candidates SET email = ?, name = COALESCE(NULLIF(?, ''), name), status = CASE WHEN status IN ('uploaded','parsed','parse_failed') THEN 'part2_ready' ELSE status END WHERE id = ?")
      .bind(email, b.name || '', id)
      .run();
    // Sign-ins made under the old address end, unless a test is already running
    // (that candidate couldn't sign in again until a Resume).
    await ensureDocsAttemptCols(env);
    await env.DB.prepare('UPDATE attempts SET sessions_valid_after = ? WHERE candidate_id = ? AND part1_started_at IS NULL').bind(nowIso(), id).run();
    await audit(env, 'manual_fix', id, email);
    return json({ ok: true });
  }

  // Force-submit: finalize a candidate's attempt immediately (e.g. they
  // disconnected and can't return). Stops timers, submits both parts, marks submitted.
  const forceMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/force-submit$/);
  if (forceMatch && request.method === 'POST') {
    const id = forceMatch[1];
    await ensurePart3Schema(env);
    await env.DB.batch([
      env.DB.prepare("UPDATE attempts SET part1_submitted_at = COALESCE(part1_submitted_at, datetime('now')), part2_submitted_at = COALESCE(part2_submitted_at, datetime('now')), part3_submitted_at = COALESCE(part3_submitted_at, datetime('now')) WHERE candidate_id = ?").bind(id),
      env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')").bind(id),
    ]);
    await audit(env, 'force_submit', id);
    return json({ ok: true });
  }

  // ---- Candidate actions ----
  const retakeMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/retake$/);
  if (retakeMatch && request.method === 'POST') {
    const id = retakeMatch[1];
    await ensurePart3Schema(env);
    await ensureDocsAttemptCols(env);
    await ensureGradingClaimCols(env);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE attempts SET part1_started_at=NULL, part1_remaining_seconds=NULL, part1_last_heartbeat_at=NULL, part1_submitted_at=NULL, part1_tab_switch_count=0, part2_started_at=NULL, part2_remaining_seconds=NULL, part2_last_heartbeat_at=NULL, part2_submitted_at=NULL, part2_tab_switch_count=0, part2_tab_switch_log=NULL, part3_started_at=NULL, part3_remaining_seconds=NULL, part3_last_heartbeat_at=NULL, part3_submitted_at=NULL, part3_tab_switch_count=0, part3_tab_switch_log=NULL,
         part1_deadline_at=NULL, part1_reopen_until=?, resumed_at=?, login_count=0, part1_sid=NULL, part2_sid=NULL, sessions_valid_after=? WHERE candidate_id = ?`
      ).bind(new Date(Date.now() + 3 * 3600 * 1000).toISOString(), new Date().toISOString(), new Date().toISOString(), id),
      env.DB.prepare('DELETE FROM part1_assignments WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part1_answers WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part2_answers WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part2_questions WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part3_assignments WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part3_answers WHERE candidate_id = ?').bind(id),
      // Clear stale interview questions from the previous trial — they'll be
      // regenerated from the new attempt's answers.
      env.DB.prepare('DELETE FROM interview_questions WHERE candidate_id = ?').bind(id),
      // Granting a retake also restores access, so a candidate who was revoked
      // (e.g. earlier on the assessment day) can sit the test again.
      env.DB.prepare("UPDATE candidates SET status = 'part2_ready', retake_granted = 1, access_revoked = 0, grading_claim = NULL WHERE id = ?").bind(id),
    ]);
    await audit(env, 'retake', id);
    return json({ ok: true });
  }

  // RESUME — for a candidate who was cut off (e.g. a dropped connection auto-submitted
  // them). Unlike Retake, this KEEPS their exact same questions AND their saved
  // answers, and simply re-opens the attempt: it clears the submission and the start
  // time so they can log back in and continue (a fresh timer), with every answer they
  // had typed already filled in. Nothing is reshuffled or lost.
  const resumeAttemptMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/resume$/);
  if (resumeAttemptMatch && request.method === 'POST') {
    const id = resumeAttemptMatch[1];
    await ensureDocsAttemptCols(env);
    await ensureGradingClaimCols(env);
    await env.DB.batch([
      // Re-open part 1: un-submit and reset the clock (and its hard end time) so
      // startPart gives a fresh timer. part1_assignments and part1_answers are
      // deliberately NOT touched. The candidate may start within 3 hours even if the
      // test is closed.
      env.DB.prepare(
        'UPDATE attempts SET part1_started_at = NULL, part1_remaining_seconds = NULL, part1_last_heartbeat_at = NULL, part1_submitted_at = NULL, part1_deadline_at = NULL, part1_reopen_until = ?, resumed_at = ?, login_count = 0, part1_sid = NULL, sessions_valid_after = ? WHERE candidate_id = ?'
      ).bind(new Date(Date.now() + 3 * 3600 * 1000).toISOString(), new Date().toISOString(), new Date().toISOString(), id),
      // The answers will be edited and graded again: drop the old marks so nothing
      // shows them as current, and the old interview guide with them.
      env.DB.prepare('UPDATE part1_answers SET ai_score = NULL, ai_reasoning = NULL, deductions = NULL, scored_at = NULL WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM interview_questions WHERE candidate_id = ?').bind(id),
      // Allow login again and restore access; drop any grading claim in flight.
      env.DB.prepare("UPDATE candidates SET status = 'part2_ready', retake_granted = 1, access_revoked = 0, grading_claim = NULL WHERE id = ?").bind(id),
    ]);
    await audit(env, 'resume', id);
    return json({ ok: true, message: 'The test is reopened with the same questions and saved answers. The candidate signs in again to continue.' });
  }

  const revokeMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/(revoke|unrevoke)$/);
  if (revokeMatch && request.method === 'POST') {
    const [, cid, action] = revokeMatch;
    if (action === 'revoke') {
      const now = nowIso();
      // Revoking access finalizes the assessment: stop both timers, mark each
      // part submitted (preserving whatever answers were saved), and move the
      // candidate to 'submitted' so their work is graded like everyone else.
      await ensurePart3Schema(env);
      // A candidate who never started is only blocked: nothing is stamped closed, so
      // Restore access later lets them start normally. (On the writers site a started
      // test is finalized as a whole: both parts are closed.)
      // One batch (one transaction): the started check sits inside each statement, so
      // a candidate starting at this very moment can't end up revoked but still running.
      await env.DB.batch([
        env.DB.prepare('UPDATE candidates SET access_revoked = 1 WHERE id = ?').bind(cid),
        env.DB.prepare(
          "UPDATE attempts SET part1_submitted_at = COALESCE(part1_submitted_at, ?), part2_submitted_at = COALESCE(part2_submitted_at, ?), part3_submitted_at = COALESCE(part3_submitted_at, ?) WHERE candidate_id = ? AND part1_started_at IS NOT NULL"
        ).bind(now, now, now, cid),
        env.DB.prepare(
          "UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress') AND EXISTS (SELECT 1 FROM attempts WHERE candidate_id = ? AND part1_submitted_at IS NOT NULL)"
        ).bind(cid, cid),
      ]);
    } else {
      // Restoring access voids every sign-in from before (the one that caused a revoke
      // among them): the candidate signs in again.
      await ensureDocsAttemptCols(env);
      // Only when access was actually revoked, and never for a test that is running
      // (that candidate couldn't sign in again until a Resume).
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE attempts SET sessions_valid_after = ? WHERE candidate_id = ?
             AND (part1_started_at IS NULL OR part1_submitted_at IS NOT NULL)
             AND EXISTS (SELECT 1 FROM candidates WHERE id = ? AND access_revoked = 1)`
        ).bind(nowIso(), cid, cid),
        env.DB.prepare('UPDATE candidates SET access_revoked = 0 WHERE id = ?').bind(cid),
      ]);
    }
    await audit(env, action, cid);
    return json({ ok: true });
  }

  // Assign / change / clear a candidate's college.
  const collegeMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/college$/);
  if (collegeMatch && request.method === 'POST') {
    await ensureCollegeSchema(env);
    const id = collegeMatch[1];
    const b = await request.json<{ college?: string }>().catch(() => ({} as { college?: string }));
    const raw = (b.college || '').trim();
    const college = raw === '' ? null : ((await getColleges(env)).includes(raw) ? raw : undefined);
    if (college === undefined) return json({ error: 'Unknown college.' }, { status: 400 });
    await env.DB.prepare('UPDATE candidates SET college = ? WHERE id = ?').bind(college, id).run();
    await audit(env, 'set_college', id, college || '(cleared)');
    return json({ ok: true });
  }

  const shortlistMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/(shortlist|reject)$/);
  if (shortlistMatch && request.method === 'POST') {
    const [, id, action] = shortlistMatch;
    // Only a graded candidate can be shortlisted or rejected: a stale screen can't
    // flip a candidate who is testing again (after Resume) or being graded.
    const decided = await env.DB.prepare("UPDATE candidates SET status = ? WHERE id = ? AND status IN ('evaluated','shortlisted','rejected')").bind(action === 'shortlist' ? 'shortlisted' : 'rejected', id).run();
    if (!decided.meta?.changes) return json({ error: 'Only a graded candidate can be shortlisted or rejected. Refresh the list.' }, { status: 409 });
    if (action === 'shortlist') {
      const candidate = (await env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(id).first()) as Candidate | null;
      if (candidate) {
        try {
          await generateAndStoreInterview(env, candidate);
        } catch (err) {
          console.error(`Interview question generation failed for ${id}:`, err);
        }
      }
    }
    await audit(env, action, id);
    return json({ ok: true });
  }

  // Generate (or regenerate) personalised interview questions on demand, from the
  // candidate's resume + their LATEST answers. Replaces any previous set.
  const interviewMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/interview$/);
  if (interviewMatch && request.method === 'POST') {
    const id = interviewMatch[1];
    const candidate = (await env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(id).first()) as Candidate | null;
    if (!candidate) return json({ error: 'Not found' }, { status: 404 });
    try {
      const count = await generateAndStoreInterview(env, candidate);
      await audit(env, 'interview_generated', id, `${count} questions`);
      return json({ ok: true, count });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

  return json({ error: 'Not found' }, { status: 404 });
}

/** Grade one candidate with the grader for this site's test (writers or support). */
// `claim` is the grading_claim this call holds: every score is written only while
// the candidate still carries it, so a Resume or Retake (which drops the claim)
// stops a slow grader from writing old scores onto the new attempt.
async function gradeAny(env: Env, candidateId: string, claim: string): Promise<void> {
  return isDocs(env) ? gradeDocsCandidate(env, candidateId, claim) : gradeCandidate(env, candidateId, claim);
}
/** Close abandoned attempts using the rules for this site's test (writers or support). */
async function closeTimedOut(env: Env): Promise<number> {
  return isDocs(env) ? closeTimedOutDocs(env) : closeTimedOutAttempts(env);
}

/** Grade all of one candidate's Part 1 and Part 2 answers with partial credit + deduction reasons. */
async function gradeCandidate(env: Env, candidateId: string, claim: string): Promise<void> {
  await ensurePart2AiCol(env); // Part 2 stores an AI-content estimate
  // Part 1
  await ensureQuestionCheckpointsCol(env);
  const p1 = await env.DB.prepare(
    `SELECT qb.id as question_id, qb.category, qb.prompt, qb.reference_answer, qb.sample_data, qb.expected_output, qb.rubric, qb.checkpoints, qb.marks, a.answer_text
     FROM part1_assignments pa
     JOIN question_bank qb ON qb.id = pa.question_id
     LEFT JOIN part1_answers a ON a.question_id = pa.question_id AND a.candidate_id = pa.candidate_id
     WHERE pa.candidate_id = ?`
  )
    .bind(candidateId)
    .all<{ question_id: string; category: 'sql' | 'python' | 'dsa' | 'scenario'; prompt: string; reference_answer: string | null; sample_data: string | null; expected_output: string | null; rubric: string | null; checkpoints: string | null; marks: number; answer_text: string | null }>();

  // Grade all of this candidate's Part 1 questions CONCURRENTLY (each is its own
  // OpenAI call) instead of one after another — 5 questions in ~1 call's time.
  await Promise.all((p1.results ?? []).map(async (q) => {
    const g = await gradeWrittenAnswer(env, {
      kind: q.category,
      prompt: q.prompt,
      referenceAnswer: q.reference_answer,
      sampleData: q.sample_data,
      expectedOutput: q.expected_output,
      rubric: q.rubric,
      checkpoints: q.checkpoints, // DSA/scenario grace-mark grading
      maxMarks: q.marks,
      answerText: q.answer_text ?? '',
    });
    await env.DB.prepare(
      `INSERT INTO part1_answers (candidate_id, question_id, answer_text, ai_score, ai_reasoning, deductions, max_marks, scored_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM candidates WHERE id = ? AND grading_claim = ?)
       ON CONFLICT (candidate_id, question_id)
       DO UPDATE SET ai_score = excluded.ai_score, ai_reasoning = excluded.ai_reasoning, deductions = excluded.deductions, max_marks = excluded.max_marks, scored_at = excluded.scored_at`
    )
      .bind(candidateId, q.question_id, q.answer_text ?? '', g.score, g.reasoning, JSON.stringify(g.deductions), q.marks, nowIso(), candidateId, claim)
      .run();
  }));

  // Authenticity signals per Part 2 question, from the attempt log (open-book, so
  // pasting isn't blocked — these are inputs the grader weighs together, never a
  // verdict on their own). Built from 'paste' events (largest single paste, count)
  // and 'metrics' events (typed chars, total pasted, active time).
  const attemptRow = await env.DB.prepare('SELECT part2_tab_switch_log FROM attempts WHERE candidate_id = ?')
    .bind(candidateId)
    .first<{ part2_tab_switch_log: string | null }>();
  type Signals = { maxPaste: number; pasteEvents: number; typed: number; pasted: number; activeMs: number };
  const signalsByQuestion: Record<string, Signals> = {};
  const sig = (qid: string): Signals => (signalsByQuestion[qid] || (signalsByQuestion[qid] = { maxPaste: 0, pasteEvents: 0, typed: 0, pasted: 0, activeMs: 0 }));
  try {
    const log = attemptRow?.part2_tab_switch_log ? JSON.parse(attemptRow.part2_tab_switch_log) : [];
    for (const e of log) {
      if (!e || !e.questionId) continue;
      if (e.type === 'paste') {
        const s = sig(e.questionId);
        if (typeof e.chars === 'number') s.maxPaste = Math.max(s.maxPaste, e.chars);
        s.pasteEvents += 1;
      } else if (e.type === 'metrics') {
        const s = sig(e.questionId);
        if (typeof e.typed === 'number') s.typed = Math.max(s.typed, e.typed);
        if (typeof e.pasted === 'number') s.pasted = Math.max(s.pasted, e.pasted);
        if (typeof e.ms === 'number') s.activeMs = Math.max(s.activeMs, e.ms);
      }
    }
  } catch { /* log is best-effort */ }

  // Part 2
  const p2 = await env.DB.prepare(
    `SELECT pq.id as question_id, pq.prompt, pq.rubric, pq.marks, a.answer_text
     FROM part2_questions pq
     LEFT JOIN part2_answers a ON a.question_id = pq.id AND a.candidate_id = pq.candidate_id
     WHERE pq.candidate_id = ?`
  )
    .bind(candidateId)
    .all<{ question_id: string; prompt: string; rubric: string | null; marks: number; answer_text: string | null }>();

  await Promise.all((p2.results ?? []).map(async (q) => {
    let rubricText: string | null = q.rubric;
    try {
      const r = q.rubric ? JSON.parse(q.rubric) : null;
      if (r && (r.strong_answer_looks_like || r.weak_answer_looks_like)) {
        rubricText = `Strong answer: ${r.strong_answer_looks_like}\nWeak answer: ${r.weak_answer_looks_like}`;
      }
    } catch { /* rubric is already plain text */ }
    const g = await gradeWrittenAnswer(env, {
      kind: 'scenario',
      prompt: q.prompt,
      rubric: rubricText,
      maxMarks: q.marks,
      answerText: q.answer_text ?? '',
      authSignals: signalsByQuestion[q.question_id],
    });
    await env.DB.prepare(
      `INSERT INTO part2_answers (candidate_id, question_id, answer_text, ai_score, ai_reasoning, deductions, max_marks, ai_content_pct, scored_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM candidates WHERE id = ? AND grading_claim = ?)
       ON CONFLICT (candidate_id, question_id)
       DO UPDATE SET ai_score = excluded.ai_score, ai_reasoning = excluded.ai_reasoning, deductions = excluded.deductions, max_marks = excluded.max_marks, ai_content_pct = excluded.ai_content_pct, scored_at = excluded.scored_at`
    )
      .bind(candidateId, q.question_id, q.answer_text ?? '', g.score, g.reasoning, JSON.stringify(g.deductions), q.marks, g.aiContentPercent ?? null, nowIso(), candidateId, claim)
      .run();
  }));

  // Part 3 — closed-book debugging / break-fix. Graded on cause/check/fix/clarity
  // (kind 'debug'), no authenticity scan (pasting was impossible in lockdown).
  await ensurePart3Schema(env);
  const p3 = await env.DB.prepare(
    `SELECT p3.id as question_id, p3.kind, p3.title, p3.prompt, p3.code_snippet, p3.reference_answer, p3.rubric, p3.marks, a.answer_text
     FROM part3_assignments pa
     JOIN part3_questions p3 ON p3.id = pa.question_id
     LEFT JOIN part3_answers a ON a.question_id = pa.question_id AND a.candidate_id = pa.candidate_id
     WHERE pa.candidate_id = ?`
  )
    .bind(candidateId)
    .all<{ question_id: string; kind: string; title: string | null; prompt: string; code_snippet: string | null; reference_answer: string | null; rubric: string | null; marks: number; answer_text: string | null }>();

  await Promise.all((p3.results ?? []).map(async (q) => {
    // Give the grader the full question the candidate saw: title + prompt + the
    // broken code snippet (for buggy_fix), so it can judge the diagnosis + fix.
    const fullPrompt = [q.title ? `${q.title}\n` : '', q.prompt, q.code_snippet ? `\n\nCode / snippet shown to the candidate:\n${q.code_snippet}` : '']
      .join('')
      .trim();
    const g = await gradeWrittenAnswer(env, {
      kind: 'debug',
      prompt: fullPrompt,
      referenceAnswer: q.reference_answer,
      rubric: q.rubric,
      maxMarks: q.marks,
      answerText: q.answer_text ?? '',
    });
    await env.DB.prepare(
      `INSERT INTO part3_answers (candidate_id, question_id, answer_text, ai_score, ai_reasoning, deductions, max_marks, scored_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM candidates WHERE id = ? AND grading_claim = ?)
       ON CONFLICT (candidate_id, question_id)
       DO UPDATE SET ai_score = excluded.ai_score, ai_reasoning = excluded.ai_reasoning, deductions = excluded.deductions, max_marks = excluded.max_marks, scored_at = excluded.scored_at`
    )
      .bind(candidateId, q.question_id, q.answer_text ?? '', g.score, g.reasoning, JSON.stringify(g.deductions), q.marks, nowIso(), candidateId, claim)
      .run();
  }));
}

/** Record a mutating admin action for accountability. Best-effort. */
async function audit(env: Env, action: string, candidateId: string | null, detail = ''): Promise<void> {
  try {
    await env.DB.prepare('INSERT INTO admin_audit (id, action, candidate_id, detail) VALUES (?, ?, ?, ?)')
      .bind(newId('aud'), action, candidateId, detail.slice(0, 500))
      .run();
  } catch { /* auditing must never break the action it records */ }
}

/**
 * Backstop for abandoned attempts. The timer pauses on disconnect (for fairness),
 * so a candidate who never returns would otherwise stay 'in_progress' forever and
 * block the whole cohort's batch grading. This force-submits any part whose start
 * is older than its allotted time plus a generous grace window (real wall-clock),
 * so grading can always proceed. Returns how many candidates it closed.
 */
async function closeTimedOutAttempts(env: Env): Promise<number> {
  await ensurePart3Schema(env);
  await ensureDocsAttemptCols(env);
  const grace = Number(env.STALE_GRACE_MINUTES ?? 30) * 60;
  const p1Cutoff = (await getAssessmentMinutes(env)) * 60 + grace;
  const p2Cutoff = Number(env.PART2_DURATION_MINUTES) * 60 + grace;
  const p3Cutoff = Number(env.PART3_DURATION_MINUTES ?? 15) * 60 + grace;
  const now = Date.now();
  // A Part 2 that finished but never advanced to Part 3, left idle past a Part 3
  // duration + grace, is also stale (the candidate walked away between parts).
  const rows = await env.DB.prepare(
    `SELECT candidate_id, part1_started_at, part1_submitted_at, part1_deadline_at, part2_started_at, part2_submitted_at, part3_started_at, part3_submitted_at
     FROM attempts
     WHERE (part1_started_at IS NOT NULL AND part1_submitted_at IS NULL)
        OR (part2_started_at IS NOT NULL AND part2_submitted_at IS NULL)
        OR (part3_started_at IS NOT NULL AND part3_submitted_at IS NULL)
        OR (part2_submitted_at IS NOT NULL AND part3_submitted_at IS NULL)`
  ).all<Record<string, string | null>>();

  let closed = 0;
  for (const a of rows.results ?? []) {
    const cid = a.candidate_id as string;
    // An attempt's own hard end time (fixed when it started) decides; the current
    // duration setting is only a fallback for attempts started before deadlines existed,
    // so shortening the duration mid-drive can't close running tests early.
    const p1Deadline = a.part1_deadline_at ? Date.parse(a.part1_deadline_at) : NaN;
    const p1Stale = a.part1_started_at && !a.part1_submitted_at && (Number.isFinite(p1Deadline)
      ? (now - p1Deadline) / 1000 > grace
      : (now - new Date(a.part1_started_at).getTime()) / 1000 > p1Cutoff);
    const p2Stale = a.part2_started_at && !a.part2_submitted_at && (now - new Date(a.part2_started_at).getTime()) / 1000 > p2Cutoff;
    const p3Stale = a.part3_started_at && !a.part3_submitted_at && (now - new Date(a.part3_started_at).getTime()) / 1000 > p3Cutoff;
    // Between Part 2 and Part 3: finished Part 2, never started Part 3, idle too long.
    const betweenStale = a.part2_submitted_at && !a.part3_submitted_at && !a.part3_started_at && (now - new Date(a.part2_submitted_at).getTime()) / 1000 > p3Cutoff;
    if (!p1Stale && !p2Stale && !p3Stale && !betweenStale) continue;
    await env.DB.batch([
      env.DB.prepare("UPDATE attempts SET part1_submitted_at = COALESCE(part1_submitted_at, datetime('now')), part2_submitted_at = COALESCE(part2_submitted_at, datetime('now')), part3_submitted_at = COALESCE(part3_submitted_at, datetime('now')) WHERE candidate_id = ?").bind(cid),
      env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')").bind(cid),
    ]);
    await audit(env, 'auto_close_timed_out', cid, 'attempt exceeded allotted time + grace');
    closed++;
  }
  return closed;
}

/** Test hook: run the grader as a call holding `claim`. */
export const gradeAnyForTests = gradeAny;
