import type { Env, Candidate } from '../types';
import { createCandidateSession, getCandidateSession, json, withCookie, clearCandidateSessionCookie, type CandidateSession } from '../lib/auth';
import { candidateSigninPaused, candidateUnknownEmail } from '../lib/ratelimit';
import { getCandidateByEmail, getCandidateById, getAttempt, ensureAttempt, newId, nowIso, ensureOnce, addColumn } from '../lib/db';
import { assignDocsPart1, assignDocsPart2 } from '../lib/randomize';
import { startPart, durationSeconds } from '../lib/timer';
import { getDocsConfig, DocsPoolTooSmall, isDocs, type DocsConfig } from '../lib/team';

/**
 * CANDIDATE API for the writers site (TEAM = "docs").
 *
 * Two timed parts, each with its own clock:
 *   Part 1: closed book, full screen, no copy or paste. Questions from the Part 1 bank.
 *   Part 2: opens only after Part 1 is closed. Open book: switching tabs and copy /
 *           paste are allowed and logged. Questions from the Part 2 bank.
 * Once Part 1 is submitted (or its time runs out) its answers are locked: the server
 * rejects any further edit. Same privacy rule as the support test: nothing here ever
 * returns marks, scores or grading notes.
 */

type Attempt = Record<string, unknown> | null;

/**
 * The writers' page syncs the clock every 30 s (the support test: every 10 s), and
 * the same request carries the answer being typed, so one request does both jobs.
 * That keeps a 100-student drive well inside the Workers Free daily request and D1
 * write limits. A gap longer than this cap is treated as a disconnect: the clock
 * only loses up to the cap, as with the support test's 15 s cap at 10 s beats.
 */
const HEARTBEAT_CAP_SECONDS = 45;

/**
 * Hard limit on top of each part's clock. The clock pauses while a candidate is
 * disconnected (fairness), so on its own a candidate could stop syncing and keep the
 * part open. Every part therefore also gets a wall-clock deadline when it starts:
 * start + its minutes + this allowance for genuine connection drops. After the
 * deadline nothing more is saved for that part. A longer outage needs an admin Resume.
 */
export function maxPauseSeconds(env: Env): number {
  const m = Number(env.DOCS_MAX_PAUSE_MINUTES);
  return (Number.isFinite(m) && m >= 0 ? Math.min(60, m) : 10) * 60;
}

/** Most integrity events one candidate can log per part (caps database writes). */
const MAX_EVENTS_PER_PART = 300;

/** Writers-only columns, added on first use (works whether or not a migration ran). */
export async function ensureDocsAttemptCols(env: Env): Promise<void> {
  await ensureOnce('docs.attempt_deadlines', async () => {
    const cols = await env.DB.prepare('PRAGMA table_info(attempts)').all<{ name: string }>();
    const have = new Set((cols.results ?? []).map((c) => c.name));
    if (!have.has('part1_deadline_at')) await addColumn(env, 'ALTER TABLE attempts ADD COLUMN part1_deadline_at TEXT');
    if (!have.has('part2_deadline_at')) await addColumn(env, 'ALTER TABLE attempts ADD COLUMN part2_deadline_at TEXT');
    // Set by an admin Resume or Retake of Part 1: until this time the candidate may
    // start Part 1 even while the test is closed. Cleared when they start.
    if (!have.has('part1_reopen_until')) await addColumn(env, 'ALTER TABLE attempts ADD COLUMN part1_reopen_until TEXT');
    // When an admin last used Resume or Retake (the stale sweep measures from it).
    if (!have.has('resumed_at')) await addColumn(env, 'ALTER TABLE attempts ADD COLUMN resumed_at TEXT');
    // One browser per sitting: the sign-in (sid) that started each part, and a floor
    // before which every candidate sign-in for this attempt is void (set by Resume,
    // Retake, Restore access and email fixes, so old sessions can't come back).
    if (!have.has('part1_sid')) await addColumn(env, 'ALTER TABLE attempts ADD COLUMN part1_sid TEXT');
    if (!have.has('part2_sid')) await addColumn(env, 'ALTER TABLE attempts ADD COLUMN part2_sid TEXT');
    if (!have.has('sessions_valid_after')) await addColumn(env, 'ALTER TABLE attempts ADD COLUMN sessions_valid_after TEXT');
  });
}

/**
 * Is this sign-in allowed on the attempt right now?
 *  'ended' — signed in before an admin Resume/Retake/Restore (sign in again);
 *  'other' — the running part was started by a different sign-in (another browser).
 * Support: Part 1 belongs to the sign-in that started it. Writers: the running part
 * belongs to the sign-in that started it; between the parts any sign-in may continue
 * (the one re-login window), and Part 2 then belongs to whoever starts it.
 */
export function sittingStatus(at: Record<string, unknown> | null, s: CandidateSession, twoPart: boolean): 'ok' | 'ended' | 'other' {
  if (!at) return 'ok';
  const floor = at.sessions_valid_after ? Date.parse(String(at.sessions_valid_after)) : NaN;
  if (Number.isFinite(floor) && s.iat < floor) return 'ended';
  let bound: unknown = null;
  if (twoPart) bound = at.part2_sid || (!at.part1_submitted_at ? at.part1_sid : null);
  else bound = at.part1_sid;
  if (bound && bound !== s.sid) return 'other';
  return 'ok';
}

/** The attempt as the candidate's page sees it: timers and counts, without the sitting ids. */
export function publicAttempt(at: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!at) return null;
  const { part1_sid, part2_sid, sessions_valid_after, ...rest } = at as Record<string, unknown>;
  return rest;
}

export function sittingRefused(kind: 'ended' | 'other'): Response {
  return kind === 'other'
    ? json({ error: 'This test is running in another browser. Only the browser that started it can continue. Speak to the invigilator.', code: 'other_session' }, { status: 401 })
    : json({ error: 'Your session has ended. Please sign in again.', code: 'session_ended' }, { status: 401 });
}

/** Bind `part` to this sign-in when it starts. False if another sign-in already holds it. */
export async function bindSitting(env: Env, candidateId: string, part: 'part1' | 'part2', sid: string | null): Promise<boolean> {
  if (!sid) return false; // a sign-in from before sittings were tracked: sign in again
  await env.DB.prepare(`UPDATE attempts SET ${part}_sid = ? WHERE candidate_id = ? AND ${part}_sid IS NULL`).bind(sid, candidateId).run();
  const row = await env.DB.prepare(`SELECT ${part}_sid AS sid FROM attempts WHERE candidate_id = ?`).bind(candidateId).first<{ sid: string | null }>();
  return row?.sid === sid;
}

/** How long an admin Resume or Retake of Part 1 lets a candidate start while the test is closed. */
export const REOPEN_SECONDS = 3 * 60 * 60;

/** Is the test open for candidates to START Part 1? (Admin switch; closed by default.) */
export async function docsStartOpen(env: Env): Promise<boolean> {
  return testIsOpen(env);
}

/** The settings key and default of the "test is open" switch on each site: the
 *  writers site starts CLOSED (a manager opens it on the day); the support site
 *  starts OPEN, as it always worked, and a manager can close it. */
export function openSetting(env: Env): { key: string; defaultOpen: boolean } {
  return isDocs(env) ? { key: 'docs_start_open', defaultOpen: false } : { key: 'start_open', defaultOpen: true };
}
export async function testIsOpen(env: Env): Promise<boolean> {
  const { key, defaultOpen } = openSetting(env);
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    return row ? row.value === '1' : defaultOpen;
  } catch { return defaultOpen; }
}

/** What the candidate's own page may know about their status (never the hiring outcome). */
export function candidateStage(status: string): string {
  if (status === 'part2_ready') return 'ready';
  if (status === 'in_progress') return 'in_progress';
  if (['submitted', 'grading', 'evaluated', 'shortlisted', 'rejected'].includes(status)) return 'submitted';
  return 'not_ready';
}

async function requireCandidate(env: Env, request: Request): Promise<{ candidate: Candidate; session: CandidateSession } | null> {
  const session = await getCandidateSession(env, request);
  if (!session) return null;
  const candidate = (await getCandidateById(env, session.cid)) as Candidate | null;
  if (!candidate || candidate.access_revoked) return null;
  return { candidate, session };
}

function notReady(err: unknown): Response {
  if (err instanceof DocsPoolTooSmall) {
    console.error('Writers question bank too small:', err.message);
    return json({ error: 'Your assessment is not ready yet. Please tell the invigilator.' }, { status: 409 });
  }
  throw err;
}

/** Hard server cap on an answer's size: generous for the word limit, bounded for the database. */
function answerCap(wordLimit: number): number {
  return Math.max(15000, wordLimit * 10);
}

async function part1Questions(env: Env, candidateId: string, defaultWords: number) {
  const rows = await env.DB.prepare(
    `SELECT qb.id, qb.prompt, qb.word_limit, a.answer_text AS answer
     FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id
     LEFT JOIN part1_answers a ON a.candidate_id = pa.candidate_id AND a.question_id = qb.id
     WHERE pa.candidate_id = ? ORDER BY pa.position`
  )
    .bind(candidateId)
    .all<{ id: string; prompt: string; word_limit: number | null; answer: string | null }>();
  return (rows.results ?? []).map((q) => ({ id: q.id, prompt: q.prompt, wordLimit: q.word_limit || defaultWords, answer: q.answer ?? '' }));
}

async function part2Questions(env: Env, candidateId: string, defaultWords: number) {
  const rows = await env.DB.prepare(
    `SELECT pq.id, pq.prompt, pq.word_limit, a.answer_text AS answer
     FROM part2_questions pq
     LEFT JOIN part2_answers a ON a.candidate_id = pq.candidate_id AND a.question_id = pq.id
     WHERE pq.candidate_id = ? ORDER BY pq.position`
  )
    .bind(candidateId)
    .all<{ id: string; prompt: string; word_limit: number | null; answer: string | null }>();
  return (rows.results ?? []).map((q) => ({ id: q.id, prompt: q.prompt, wordLimit: q.word_limit || defaultWords, answer: q.answer ?? '' }));
}

/** Has this part's wall-clock deadline passed? */
function pastDeadline(at: Attempt, part: 'part1' | 'part2'): boolean {
  const d = at?.[`${part}_deadline_at`];
  return !!d && Date.now() > Date.parse(String(d));
}

/**
 * Records one integrity event (leaving the test, a paste, typing metrics) as its own
 * row in attempt_events, and bumps the part's leave-the-test counter in the same
 * atomic batch. One INSERT per event, so events that arrive together are all kept.
 * Pastes and typing metrics are signals, not tab switches, so they don't count.
 */
const NOT_SWITCHES = new Set(['paste', 'paste_blocked', 'copy_blocked', 'metrics']);
async function logEvent(env: Env, candidateId: string, part: 1 | 2, body: Record<string, unknown>, at: Attempt): Promise<void> {
  // Only while the part is running, and at most MAX_EVENTS_PER_PART per part. The one
  // exception: Part 2 typing metrics may arrive up to 2 minutes after the part closed,
  // because the page sends them at submit or time-out, which is often just after the
  // server has closed the part.
  if (!at || !at[`part${part}_started_at`]) return;
  const closedAt = at[`part${part}_submitted_at`];
  if (closedAt) {
    const closedMs = Date.parse(String(closedAt).replace(' ', 'T') + (String(closedAt).endsWith('Z') ? '' : 'Z'));
    const lateMetrics = part === 2 && body.type === 'metrics' && Number.isFinite(closedMs) && Date.now() - closedMs <= 120_000;
    if (!lateMetrics) return;
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempt_events WHERE candidate_id = ? AND part = ?')
    .bind(candidateId, part).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_EVENTS_PER_PART) return;
  const type = typeof body.type === 'string' && body.type ? body.type.slice(0, 40) : 'unknown';
  const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : null);
  const qid = typeof body.questionId === 'string' ? body.questionId.slice(0, 64) : null;
  const stmts = [
    env.DB.prepare('INSERT INTO attempt_events (candidate_id, part, type, question_id, chars, typed, pasted, pastes, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(candidateId, part, type, qid, n(body.chars, 200000), n(body.typed, 200000), n(body.pasted, 200000), n(body.pastes, 1000), n(body.ms, 24 * 60 * 60 * 1000)),
  ];
  if (!NOT_SWITCHES.has(type)) {
    stmts.push(env.DB.prepare(`UPDATE attempts SET part${part}_tab_switch_count = part${part}_tab_switch_count + 1 WHERE candidate_id = ?`).bind(candidateId));
  }
  await env.DB.batch(stmts);
}

async function closePart(env: Env, candidateId: string, part: 'part1' | 'part2'): Promise<void> {
  if (part === 'part2') return finishAssessment(env, candidateId);
  // COALESCE keeps the first close time (a duplicate submit can't move it).
  await env.DB.prepare(`UPDATE attempts SET ${part}_submitted_at = COALESCE(${part}_submitted_at, datetime('now')) WHERE candidate_id = ?`)
    .bind(candidateId)
    .run();
}

async function finishAssessment(env: Env, candidateId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE attempts SET part1_submitted_at = COALESCE(part1_submitted_at, datetime('now')), part2_submitted_at = COALESCE(part2_submitted_at, datetime('now')) WHERE candidate_id = ?"
    ).bind(candidateId),
    env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')").bind(candidateId),
  ]);
}

export async function handleDocsCandidateRoute(request: Request, env: Env, _ctx: ExecutionContext, path: string): Promise<Response> {
  // --- Login: email must be on the list (built from uploaded resumes). ---
  if (path === '/api/candidate/login' && request.method === 'POST') {
    const { email } = await request.json<{ email: string }>().catch(() => ({ email: '' }));
    if (!email || typeof email !== 'string') return json({ error: 'email required' }, { status: 400 });
    const paused = await candidateSigninPaused(env, request);
    if (paused) return paused;
    const candidate = (await getCandidateByEmail(env, email)) as Candidate | null;
    if (!candidate) {
      const limited = await candidateUnknownEmail(env, request);
      if (limited) return limited;
      return json({ error: 'This email is not on the assessment list. Check with your placement coordinator.' }, { status: 403 });
    }
    if (candidate.access_revoked) {
      return json({ error: 'Access to this assessment has been revoked for this account.' }, { status: 403 });
    }
    if (candidate.status === 'uploaded' || candidate.status === 'parsed' || candidate.status === 'parse_failed') {
      return json({ error: 'Your assessment is not ready yet. Please try again shortly or contact the admin.' }, { status: 409 });
    }
    await ensureAttempt(env, candidate.id);

    // One sitting per email. A new sign-in is refused while a part is running or
    // after the test is over. The only gap where signing in again is allowed is
    // between the parts (Part 1 closed, Part 2 not started), which is also where an
    // admin "Resume" of Part 2 puts the candidate.
    const at = (await getAttempt(env, candidate.id)) as Attempt;
    const started = !!(at && at.part1_started_at);
    const betweenParts = !!(at && at.part1_submitted_at && !at.part2_started_at && !at.part2_submitted_at);
    if (started && !betweenParts) {
      const count = Number(at?.login_count ?? 0);
      try {
        // At most one audit row per candidate per minute, so repeated attempts can't
        // flood the activity log (or the daily write allowance).
        await env.DB.prepare(
          `INSERT INTO admin_audit (id, action, candidate_id, detail)
           SELECT ?, 'duplicate_login_blocked', ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM admin_audit WHERE action = 'duplicate_login_blocked' AND candidate_id = ? AND created_at > datetime('now', '-1 minute'))`
        ).bind(newId('aud'), candidate.id, `Blocked a repeat login for ${candidate.email} (attempt #${count}) — the test was already started on this account.`, candidate.id).run();
      } catch { /* best effort */ }
      return json({ error: 'This assessment has already been started on this account and can only be taken once. If you believe this is a mistake, contact your coordinator.' }, { status: 403 });
    }
    // Counted only when a sign-in actually succeeds (see the support route).
    await env.DB.prepare(
      "UPDATE attempts SET login_count = login_count + 1, first_login_at = COALESCE(first_login_at, datetime('now')), last_login_at = datetime('now') WHERE candidate_id = ?"
    ).bind(candidate.id).run();
    const cookie = await createCandidateSession(env, candidate.id);
    return withCookie(json({ ok: true, name: candidate.name }), cookie);
  }

  if (path === '/api/candidate/logout' && request.method === 'POST') {
    return withCookie(json({ ok: true }), clearCandidateSessionCookie());
  }

  // Public, pre-login: the test's shape, so the intro page shows the live numbers.
  if (path === '/api/candidate/config' && request.method === 'GET') {
    const cfg = await getDocsConfig(env);
    return json({
      team: 'docs',
      parts: {
        part1: { questions: cfg.part1.questions, minutes: cfg.part1.minutes },
        part2: { questions: cfg.part2.questions, minutes: cfg.part2.minutes },
      },
      wordLimit: cfg.wordLimit,
      assessmentMinutes: cfg.part1.minutes + cfg.part2.minutes,
      open: await docsStartOpen(env),
    });
  }

  const auth = await requireCandidate(env, request);
  if (!auth) return json({ error: 'Not logged in' }, { status: 401 });
  const { candidate, session } = auth;

  await ensureDocsAttemptCols(env);
  const at = (await getAttempt(env, candidate.id)) as Attempt;
  const sitting = sittingStatus(at as Record<string, unknown> | null, session, true);
  if (sitting !== 'ok') return sittingRefused(sitting);

  if (path === '/api/candidate/me' && request.method === 'GET') {
    return json({ candidate: { name: candidate.name, email: candidate.email, status: candidateStage(candidate.status) }, attempt: publicAttempt(at) });
  }

  // Loaded once per request, and only by the routes that need them.
  let cfgCache: DocsConfig | null = null;
  const config = async () => (cfgCache ??= await getDocsConfig(env));

  /**
   * Saves an answer only if, at the moment of writing, the part is started, not
   * submitted and before its deadline. The condition is part of the INSERT itself,
   * so a request that was already in flight when the part closed can't slip in.
   */
  const saveAnswer = (part: 'part1' | 'part2', questionId: string, text: string) =>
    env.DB.prepare(
      `INSERT INTO ${part}_answers (candidate_id, question_id, answer_text)
       SELECT ?, ?, ? WHERE EXISTS (
         SELECT 1 FROM attempts WHERE candidate_id = ? AND ${part}_started_at IS NOT NULL AND ${part}_submitted_at IS NULL
           AND (${part}_deadline_at IS NULL OR ${part}_deadline_at > ?))
       ON CONFLICT (candidate_id, question_id) DO UPDATE SET answer_text = excluded.answer_text, updated_at = datetime('now'),
         ai_score = NULL, ai_reasoning = NULL, deductions = NULL, scored_at = NULL`
    ).bind(candidate.id, questionId, text, candidate.id, nowIso());

  /** The question's word limit if it belongs to this candidate's part, else null. */
  const ownedQuestion = (part: 'part1' | 'part2', questionId: string) =>
    part === 'part1'
      ? env.DB.prepare('SELECT qb.word_limit FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id WHERE pa.candidate_id = ? AND pa.question_id = ?')
          .bind(candidate.id, questionId).first<{ word_limit: number | null }>()
      : env.DB.prepare('SELECT word_limit FROM part2_questions WHERE candidate_id = ? AND id = ?')
          .bind(candidate.id, questionId).first<{ word_limit: number | null }>();

  /**
   * Clock sync, optionally with the answer being typed. Every save also advances the
   * clock (a save is a sign of life just like a sync), so skipping syncs while still
   * saving can't freeze the timer. Gaps longer than the cap count as a disconnect,
   * up to the part's wall-clock deadline.
   */
  const syncAndSave = async (part: 'part1' | 'part2', body: { questionId?: unknown; answerText?: unknown }): Promise<Response> => {
    if (!at || !at[`${part}_started_at`] || at[`${part}_submitted_at`]) return json({ remainingSeconds: 0, closed: true, saved: false });
    if (pastDeadline(at, part)) {
      await closePart(env, candidate.id, part);
      return json({ remainingSeconds: 0, closed: true, saved: false });
    }
    const remaining = Number(at[`${part}_remaining_seconds`] ?? 0);
    const last = at[`${part}_last_heartbeat_at`] ? Date.parse(String(at[`${part}_last_heartbeat_at`])) : Date.now();
    const elapsed = Math.min(Math.max(0, (Date.now() - last) / 1000), HEARTBEAT_CAP_SECONDS);
    const next = Math.max(0, Math.round(remaining - elapsed));
    const stmts = [
      env.DB.prepare(`UPDATE attempts SET ${part}_remaining_seconds = ?, ${part}_last_heartbeat_at = ? WHERE candidate_id = ? AND ${part}_submitted_at IS NULL`)
        .bind(next, nowIso(), candidate.id),
    ];
    let wantSave = false;
    if (typeof body.questionId === 'string' && body.questionId && typeof body.answerText === 'string' && remaining > 0) {
      const owned = await ownedQuestion(part, body.questionId);
      if (owned) {
        stmts.unshift(saveAnswer(part, body.questionId, body.answerText.slice(0, answerCap(owned.word_limit || (await config()).wordLimit))));
        wantSave = true;
      }
    }
    const results = await env.DB.batch(stmts);
    const saved = wantSave && Number(results[0]?.meta?.changes ?? 0) > 0;
    if (next <= 0) await closePart(env, candidate.id, part);
    return json({ remainingSeconds: next, saved, closed: next <= 0 });
  };

  /** Sets the part's wall-clock deadline when it first starts (idempotent). */
  const setDeadline = async (part: 'part1' | 'part2') => {
    const seconds = (await durationSeconds(env, part)) + maxPauseSeconds(env);
    await env.DB.prepare(`UPDATE attempts SET ${part}_deadline_at = ? WHERE candidate_id = ? AND ${part}_deadline_at IS NULL`)
      .bind(new Date(Date.now() + seconds * 1000).toISOString(), candidate.id).run();
  };

  // ---------------- Part 1: closed book ----------------
  // Prepare checks the candidate can start (bank big enough). It never returns the
  // questions: they are sent only once the part's clock is running.
  if (path === '/api/candidate/part1/prepare' && request.method === 'POST') {
    if (at?.part1_submitted_at) return json({ error: 'Part 1 is closed.', closed: true }, { status: 409 });
    try { await assignDocsPart1(env, candidate.id); } catch (err) { return notReady(err); }
    return json({ questions: [], ready: true });
  }

  if (path === '/api/candidate/part1/start' && request.method === 'POST') {
    if (at?.part1_submitted_at) return json({ error: 'Part 1 is closed.', closed: true }, { status: 409 });
    // Closing the test stops NEW starters only. A candidate a manager has given a
    // Resume or Retake of Part 1 may start it while closed, within 3 hours of that.
    const reopened = !!at?.part1_reopen_until && Date.parse(String(at.part1_reopen_until)) > Date.now();
    if (!at?.part1_started_at && !reopened && !(await docsStartOpen(env))) {
      return json({ error: 'The assessment has not opened yet. Please wait for the invigilator to open it.', notOpen: true }, { status: 409 });
    }
    try { await assignDocsPart1(env, candidate.id); } catch (err) { return notReady(err); }
    if (!(await bindSitting(env, candidate.id, 'part1', session.sid))) return sittingRefused(session.sid ? 'other' : 'ended');
    await startPart(env, candidate.id, 'part1');
    await setDeadline('part1');
    if (at?.part1_reopen_until) await env.DB.prepare('UPDATE attempts SET part1_reopen_until = NULL WHERE candidate_id = ?').bind(candidate.id).run();
    await env.DB.prepare("UPDATE candidates SET status = 'in_progress' WHERE id = ? AND status = 'part2_ready'").bind(candidate.id).run();
    return json({ ok: true, durationSeconds: await durationSeconds(env, 'part1'), questions: await part1Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if (path === '/api/candidate/part1/questions' && request.method === 'GET') {
    if (!at?.part1_started_at) return json({ error: 'Part 1 has not started.' }, { status: 409 });
    return json({ questions: await part1Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if ((path === '/api/candidate/part1/answer' || path === '/api/candidate/part2/answer') && request.method === 'POST') {
    const part = path.includes('/part1/') ? 'part1' : 'part2';
    const body = await request.json<{ questionId?: unknown; answerText?: unknown }>().catch(() => ({} as { questionId?: unknown; answerText?: unknown }));
    if (typeof body.questionId !== 'string' || !body.questionId) return json({ error: 'questionId required' }, { status: 400 });
    if (!(await ownedQuestion(part, body.questionId))) return json({ error: 'This question is not part of your assessment.' }, { status: 403 });
    const res = await (await syncAndSave(part, { questionId: body.questionId, answerText: String(body.answerText ?? '') })).json<{ saved: boolean; remainingSeconds: number }>();
    if (!res.saved) return json({ error: `${part === 'part1' ? 'Part 1' : 'Part 2'} is closed. Your saved answers were kept.`, closed: true }, { status: 409 });
    return json({ ok: true, remainingSeconds: res.remainingSeconds });
  }

  if ((path === '/api/candidate/part1/heartbeat' || path === '/api/candidate/part2/heartbeat') && request.method === 'POST') {
    const body = await request.json<{ questionId?: unknown; answerText?: unknown }>().catch(() => ({} as { questionId?: unknown; answerText?: unknown }));
    return syncAndSave(path.includes('/part1/') ? 'part1' : 'part2', body);
  }

  if (path === '/api/candidate/part1/tab-switch' && request.method === 'POST') {
    const body = await request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    await logEvent(env, candidate.id, 1, body, at);
    return json({ ok: true });
  }

  if (path === '/api/candidate/part1/submit' && request.method === 'POST') {
    if (!at?.part1_started_at) return json({ error: 'Part 1 has not started.' }, { status: 409 });
    await closePart(env, candidate.id, 'part1');
    return json({ ok: true, next: 'part2' });
  }

  // ---------------- Part 2: open book ----------------
  const part2Gate = (): Response | null => {
    if (!at?.part1_submitted_at) return json({ error: 'Finish Part 1 first.' }, { status: 409 });
    if (at?.part2_submitted_at) return json({ error: 'Part 2 is closed.', closed: true }, { status: 409 });
    return null;
  };

  if (path === '/api/candidate/part2/prepare' && request.method === 'POST') {
    const blocked = part2Gate(); if (blocked) return blocked;
    try { await assignDocsPart2(env, candidate.id); } catch (err) { return notReady(err); }
    return json({ questions: [], ready: true });
  }

  if (path === '/api/candidate/part2/start' && request.method === 'POST') {
    const blocked = part2Gate(); if (blocked) return blocked;
    try { await assignDocsPart2(env, candidate.id); } catch (err) { return notReady(err); }
    if (!(await bindSitting(env, candidate.id, 'part2', session.sid))) return sittingRefused(session.sid ? 'other' : 'ended');
    await startPart(env, candidate.id, 'part2');
    await setDeadline('part2');
    await env.DB.prepare("UPDATE candidates SET status = 'in_progress' WHERE id = ? AND status = 'part2_ready'").bind(candidate.id).run();
    return json({ ok: true, durationSeconds: await durationSeconds(env, 'part2'), questions: await part2Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if (path === '/api/candidate/part2/questions' && request.method === 'GET') {
    if (!at?.part2_started_at) return json({ error: 'Part 2 has not started.' }, { status: 409 });
    return json({ questions: await part2Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if (path === '/api/candidate/part2/tab-switch' && request.method === 'POST') {
    const body = await request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    await logEvent(env, candidate.id, 2, body, at); // logged only — Part 2 never blocks
    return json({ ok: true });
  }

  // Ends the whole test: used by "Submit Part 2", and by the page when a reload or
  // leaving full screen in Part 1 closes the assessment early.
  if (path === '/api/candidate/part2/submit' && request.method === 'POST') {
    // Ends a test that is under way; a test that hasn't started can't be ended from here.
    if (!at?.part1_started_at) return json({ error: 'The assessment has not started.' }, { status: 409 });
    await finishAssessment(env, candidate.id);
    // The test is over: sign this browser out (shared lab PCs, no reuse of the session).
    return withCookie(json({ ok: true }), clearCandidateSessionCookie());
  }

  return json({ error: 'Not found' }, { status: 404 });
}
