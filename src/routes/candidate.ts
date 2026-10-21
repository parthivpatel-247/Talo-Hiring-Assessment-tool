import type { Env, Candidate } from '../types';
import { createCandidateSession, getCandidateSession, json, withCookie, clearCandidateSessionCookie, type CandidateSession } from '../lib/auth';
import { candidateSigninPaused, candidateUnknownEmail } from '../lib/ratelimit';
import { getCandidateByEmail, getCandidateById, getAttempt, ensureAttempt, newId, ensureQuestionHintCol, ensureQuestionDeletedCol } from '../lib/db';
import { assignPart1Questions } from '../lib/randomize';
import { startPart, heartbeat, markSubmitted, logTabSwitch, durationSeconds } from '../lib/timer';
import { isDocs } from '../lib/team';
import { handleDocsCandidateRoute, ensureDocsAttemptCols, maxPauseSeconds, testIsOpen, candidateStage, sittingStatus, sittingRefused, bindSitting, publicAttempt } from './candidate-docs';

/**
 * CANDIDATE API — privacy rule: this endpoint set NEVER returns marks, scores,
 * correctness, reference answers, rubrics, or max-marks. Nothing about scoring
 * is sent to the browser, so it can't appear in the page, network tab, or
 * inspect element. Grading happens later, admin-side only.
 */

// Client limits answers to 1000 words; the server enforces a hard character cap
// too so a crafted request can't bloat the database or grading cost. ~1000 words
// of prose runs ~6-7k chars; 15000 leaves generous headroom for code/formatting.
const MAX_ANSWER_CHARS = 15000;

async function requireCandidate(env: Env, request: Request): Promise<{ candidate: Candidate; session: CandidateSession } | null> {
  const session = await getCandidateSession(env, request);
  if (!session) return null;
  const candidate = (await getCandidateById(env, session.cid)) as Candidate | null;
  if (!candidate || candidate.access_revoked) return null;
  return { candidate, session };
}

export async function handleCandidateRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string
): Promise<Response> {
  // The writers site (TEAM = "docs") has its own two-part flow; the support test below is unchanged.
  if (isDocs(env)) return handleDocsCandidateRoute(request, env, ctx, path);

  // --- Login: email must be on the allowlist (built from uploaded resumes). No OTP, by design. ---
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

    // ONE test per email: once the assessment has STARTED on this account, a NEW
    // login (a second person with the shared link, or a re-entry after the session
    // ended) is blocked, and the manager is alerted in the activity log. The
    // original candidate keeps going on their existing session (no re-login needed).
    // A manager-granted retake clears the start time, which re-opens login.
    const at = (await getAttempt(env, candidate.id)) as Record<string, unknown> | null;
    const alreadyStarted = !!(at && at.part1_started_at);
    if (alreadyStarted) {
      const count = Number(at?.login_count ?? 0);
      // Record every blocked attempt — the admin portal's Flags panel surfaces these.
      try {
        // At most one row per candidate per minute, so repeated attempts can't flood
        // the activity log (or the daily write allowance).
        await env.DB.prepare(
          `INSERT INTO admin_audit (id, action, candidate_id, detail)
           SELECT ?, 'duplicate_login_blocked', ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM admin_audit WHERE action = 'duplicate_login_blocked' AND candidate_id = ? AND created_at > datetime('now', '-1 minute'))`
        ).bind(newId('aud'), candidate.id, `Blocked a repeat sign-in for ${candidate.email} (after ${count} sign-in(s)) — the test was already started on this account.`, candidate.id).run();
      } catch { /* audit is best-effort */ }
      return json({ error: 'This assessment has already been started on this account and can only be taken once. If you believe this is a mistake, contact your coordinator.' }, { status: 403 });
    }

    // Counted only when a sign-in actually succeeds, so repeated refused attempts
    // can't make an honest candidate look like they signed in many times.
    await env.DB.prepare(
      "UPDATE attempts SET login_count = login_count + 1, first_login_at = COALESCE(first_login_at, datetime('now')), last_login_at = datetime('now') WHERE candidate_id = ?"
    ).bind(candidate.id).run();
    const cookie = await createCandidateSession(env, candidate.id);
    return withCookie(json({ ok: true, name: candidate.name }), cookie);
  }

  // Sign out (no session needed): used by the end screen's "different candidate" button.
  if (path === '/api/candidate/logout' && request.method === 'POST') {
    return withCookie(json({ ok: true }), clearCandidateSessionCookie());
  }

  // Public, pre-login config so the intro page can show the live assessment
  // length (which the admin can change). No candidate data is exposed here.
  if (path === '/api/candidate/config' && request.method === 'GET') {
    return json({ assessmentMinutes: Math.round((await durationSeconds(env, 'part1')) / 60) });
  }

  const auth = await requireCandidate(env, request);
  if (!auth) return json({ error: 'Not logged in' }, { status: 401 });
  const { candidate, session } = auth;
  await ensureDocsAttemptCols(env); // deadlines, reopen time, sitting ids (shared columns)
  const at = (await getAttempt(env, candidate.id)) as Record<string, unknown> | null;
  // One browser per sitting: once the test is started, only the sign-in that started
  // it may continue; a Resume/Retake voids every earlier sign-in.
  const sitting = sittingStatus(at, session, false);
  if (sitting !== 'ok') return sittingRefused(sitting);

  if (path === '/api/candidate/me' && request.method === 'GET') {
    // attempt carries timers + tab-switch counts only — no scores.
    // Stage only (not started / in progress / submitted): never the hiring outcome.
    return json({ candidate: { name: candidate.name, email: candidate.email, status: candidateStage(candidate.status) }, attempt: publicAttempt(at) });
  }

  // --- The test: one closed-book, timed part (Part 1) ---
  // The server enforces the rules the page shows: questions only once the clock is
  // running, answers only while the part is open and before its hard end time, and
  // nothing after submit. (Same model as the writers site, candidate-docs.ts.)
  const started = !!at?.part1_started_at;
  const closed = !!at?.part1_submitted_at;
  const pastDeadline = () => !!at?.part1_deadline_at && Date.now() > Date.parse(String(at.part1_deadline_at));
  const finish = async () => {
    await markSubmitted(env, candidate.id, 'part1');
    // Single-part test: closing Part 1 finalizes the whole assessment. Guarded so a
    // late or duplicate close can't revert an admin-set status.
    await env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')").bind(candidate.id).run();
  };
  // Only prompt, category, sample data and hint go to the browser — never the
  // reference answer, expected output, rubric, checkpoints or marks.
  const questionsFor = async () => {
    const rows = await env.DB.prepare(
      `SELECT qb.id, qb.category, qb.prompt, qb.sample_data, qb.hint, pa2.answer_text AS answer
       FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id
       LEFT JOIN part1_answers pa2 ON pa2.candidate_id = pa.candidate_id AND pa2.question_id = qb.id
       WHERE pa.candidate_id = ? ORDER BY pa.position`
    )
      .bind(candidate.id)
      .all<{ id: string; category: string; prompt: string; sample_data: string | null; hint: string | null; answer: string | null }>();
    return (rows.results ?? []).map((q) => ({ id: q.id, category: q.category, prompt: q.prompt, sampleData: q.sample_data, hint: q.hint, answer: q.answer ?? '' }));
  };

  // Prepare = assign the question set without starting the clock. It never returns
  // the questions: they are sent only once the clock is running (start).
  if (path === '/api/candidate/part1/prepare' && request.method === 'POST') {
    if (closed) return json({ error: 'Your assessment has been submitted.', closed: true }, { status: 409 });
    await ensureQuestionHintCol(env);
    await ensureQuestionDeletedCol(env);
    await assignPart1Questions(env, candidate.id);
    return json({ questions: [], ready: true });
  }

  if (path === '/api/candidate/part1/start' && request.method === 'POST') {
    if (closed) return json({ error: 'Your assessment has been submitted.', closed: true }, { status: 409 });
    // A manager can close the test so nobody new can start (open by default on this
    // site). A candidate given Resume or Retake may start within 3 hours of that.
    const reopened = !!at?.part1_reopen_until && Date.parse(String(at.part1_reopen_until)) > Date.now();
    if (!started && !reopened && !(await testIsOpen(env))) {
      return json({ error: 'The assessment has not opened yet. Please wait for the invigilator to open it.', notOpen: true }, { status: 409 });
    }
    await ensureQuestionHintCol(env);
    await ensureQuestionDeletedCol(env);
    await assignPart1Questions(env, candidate.id);
    if (!(await bindSitting(env, candidate.id, 'part1', session.sid))) return sittingRefused(session.sid ? 'other' : 'ended');
    await startPart(env, candidate.id, 'part1');
    const seconds = await durationSeconds(env, 'part1');
    // Hard end time: the test's minutes plus an allowance for connection drops. After
    // it, nothing more is saved, even if the page stopped syncing the clock.
    await env.DB.batch([
      env.DB.prepare('UPDATE attempts SET part1_deadline_at = ? WHERE candidate_id = ? AND part1_deadline_at IS NULL')
        .bind(new Date(Date.now() + (seconds + maxPauseSeconds(env)) * 1000).toISOString(), candidate.id),
      env.DB.prepare('UPDATE attempts SET part1_reopen_until = NULL WHERE candidate_id = ?').bind(candidate.id),
      env.DB.prepare("UPDATE candidates SET status = 'in_progress' WHERE id = ? AND status = 'part2_ready'").bind(candidate.id),
    ]);
    return json({ ok: true, durationSeconds: seconds, questions: await questionsFor() });
  }

  if (path === '/api/candidate/part1/questions' && request.method === 'GET') {
    if (!started) return json({ error: 'The assessment has not started.' }, { status: 409 });
    await ensureQuestionHintCol(env);
    await ensureQuestionDeletedCol(env);
    return json({ questions: await questionsFor() });
  }

  if (path === '/api/candidate/part1/answer' && request.method === 'POST') {
    const body = await request.json<{ questionId?: unknown; answerText?: unknown }>().catch(() => ({} as { questionId?: unknown; answerText?: unknown }));
    const questionId = body.questionId;
    if (typeof questionId !== 'string' || !questionId || questionId.length > 64) return json({ error: 'questionId required' }, { status: 400 });
    // Ownership: the question must actually be assigned to this candidate.
    const owned = await env.DB.prepare('SELECT 1 FROM part1_assignments WHERE candidate_id = ? AND question_id = ?')
      .bind(candidate.id, questionId)
      .first();
    if (!owned) return json({ error: 'This question is not part of your assessment.' }, { status: 403 });
    if (started && !closed && pastDeadline()) { await finish(); return json({ error: 'Time is up. Your assessment has been submitted.', closed: true }, { status: 409 }); }
    // A save also moves the clock (as on the writers site), so a page that stops
    // sending heartbeats can't keep the clock paused while answers keep arriving.
    if (started && !closed) {
      const left = await heartbeat(env, candidate.id, 'part1');
      if (left <= 0) { await finish(); return json({ error: 'Time is up. Your assessment has been submitted.', closed: true }, { status: 409 }); }
    }
    const text = String(body.answerText ?? '').slice(0, MAX_ANSWER_CHARS); // hard server cap
    // Saved only if, at the moment of writing, the test is running and before its end
    // time. The condition is inside the INSERT, so a request already in flight when
    // the test closed can't slip in.
    const r = await env.DB.prepare(
      `INSERT INTO part1_answers (candidate_id, question_id, answer_text)
       SELECT ?, ?, ? WHERE EXISTS (
         SELECT 1 FROM attempts WHERE candidate_id = ? AND part1_started_at IS NOT NULL AND part1_submitted_at IS NULL
           AND (part1_deadline_at IS NULL OR part1_deadline_at > ?))
       ON CONFLICT (candidate_id, question_id)
       DO UPDATE SET answer_text = excluded.answer_text, updated_at = datetime('now'),
         ai_score = NULL, ai_reasoning = NULL, deductions = NULL, scored_at = NULL`
    )
      .bind(candidate.id, questionId, text, candidate.id, new Date().toISOString())
      .run();
    if (!r.meta?.changes) return json({ error: 'Your assessment is not running, so this answer was not saved.', closed: true }, { status: 409 });
    return json({ ok: true }); // no correctness, ever
  }

  if (path === '/api/candidate/part1/heartbeat' && request.method === 'POST') {
    if (started && !closed && pastDeadline()) { await finish(); return json({ remainingSeconds: 0, closed: true }); }
    const remaining = await heartbeat(env, candidate.id, 'part1');
    if (remaining <= 0 && started) await finish();
    return json({ remainingSeconds: remaining });
  }

  if (path === '/api/candidate/part1/tab-switch' && request.method === 'POST') {
    // Counted only while the test is running.
    if (!started || closed) return json({ ok: true });
    await logTabSwitch(env, candidate.id, 'part1', 'tab-switch');
    return json({ ok: true });
  }

  if (path === '/api/candidate/part1/submit' && request.method === 'POST') {
    if (!started) return json({ error: 'The assessment has not started.' }, { status: 409 });
    await finish();
    // The test is over: sign this browser out, so a shared lab PC is ready for the
    // next candidate and this session can't be reused.
    return withCookie(json({ ok: true }), clearCandidateSessionCookie());
  }

  // Parts 2 and 3 are retired on this site: their candidate routes are switched off,
  // so nobody can add them to their own test.
  return json({ error: 'Not found' }, { status: 404 });
}
