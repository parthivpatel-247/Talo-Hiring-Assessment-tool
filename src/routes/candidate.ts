import type { Env, Candidate } from '../types';
import { createCandidateSession, getCandidateIdFromRequest, json, withCookie } from '../lib/auth';
import { getCandidateByEmail, getCandidateById, getAttempt, ensureAttempt, newId, ensureQuestionHintCol, ensureQuestionDeletedCol } from '../lib/db';
import { assignPart1Questions, assignPart3Questions } from '../lib/randomize';
import { startPart, heartbeat, markSubmitted, logTabSwitch, durationSeconds } from '../lib/timer';
import { isDocs } from '../lib/team';
import { handleDocsCandidateRoute } from './candidate-docs';

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

async function requireCandidate(env: Env, request: Request): Promise<Candidate | null> {
  const id = await getCandidateIdFromRequest(env, request);
  if (!id) return null;
  const candidate = (await getCandidateById(env, id)) as Candidate | null;
  if (!candidate || candidate.access_revoked) return null;
  return candidate;
}

/**
 * Part 3 questions for the candidate — prompt, kind, title and the broken code
 * snippet only. NEVER returns reference_answer, rubric or marks.
 */
async function getPart3Questions(env: Env, candidateId: string) {
  const rows = await env.DB.prepare(
    `SELECT p3.id, p3.kind, p3.title, p3.prompt, p3.code_snippet
     FROM part3_assignments pa JOIN part3_questions p3 ON p3.id = pa.question_id
     WHERE pa.candidate_id = ? ORDER BY pa.position`
  )
    .bind(candidateId)
    .all<{ id: string; kind: string; title: string | null; prompt: string; code_snippet: string | null }>();
  return (rows.results ?? []).map((q) => ({
    id: q.id,
    kind: q.kind,
    title: q.title,
    prompt: q.prompt,
    codeSnippet: q.code_snippet,
  }));
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
    const { email } = await request.json<{ email: string }>();
    if (!email) return json({ error: 'email required' }, { status: 400 });

    const candidate = (await getCandidateByEmail(env, email)) as Candidate | null;
    if (!candidate) {
      return json({ error: 'This email is not on the assessment list. Check with your placement coordinator.' }, { status: 403 });
    }
    if (candidate.access_revoked) {
      return json({ error: 'Access to this assessment has been revoked for this account.' }, { status: 403 });
    }
    if (candidate.status === 'uploaded' || candidate.status === 'parsed' || candidate.status === 'parse_failed') {
      return json({ error: 'Your assessment is not ready yet. Please try again shortly or contact the admin.' }, { status: 409 });
    }

    await ensureAttempt(env, candidate.id);
    // Record the login attempt (count + timestamps) so the admin always has the trail.
    await env.DB.prepare(
      "UPDATE attempts SET login_count = login_count + 1, first_login_at = COALESCE(first_login_at, datetime('now')), last_login_at = datetime('now') WHERE candidate_id = ?"
    ).bind(candidate.id).run();

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
        await env.DB.prepare(
          "INSERT INTO admin_audit (id, action, candidate_id, detail) VALUES (?, 'duplicate_login_blocked', ?, ?)"
        ).bind(newId('aud'), candidate.id, `Blocked a repeat login for ${candidate.email} (attempt #${count}) — the test was already started on this account.`).run();
      } catch { /* audit is best-effort */ }
      return json({ error: 'This assessment has already been started on this account and can only be taken once. If you believe this is a mistake, contact your coordinator.' }, { status: 403 });
    }

    const cookie = await createCandidateSession(env, candidate.id);
    return withCookie(json({ ok: true, name: candidate.name }), cookie);
  }

  // Public, pre-login config so the intro page can show the live assessment
  // length (which the admin can change). No candidate data is exposed here.
  if (path === '/api/candidate/config' && request.method === 'GET') {
    return json({ assessmentMinutes: Math.round((await durationSeconds(env, 'part1')) / 60) });
  }

  const candidate = await requireCandidate(env, request);
  if (!candidate) return json({ error: 'Not logged in' }, { status: 401 });

  if (path === '/api/candidate/me' && request.method === 'GET') {
    const attempt = await getAttempt(env, candidate.id);
    // attempt carries timers + tab-switch counts only — no scores.
    return json({ candidate: { name: candidate.name, email: candidate.email, status: candidate.status }, attempt });
  }

  // --- Part 1: closed-book, timed, written answers ---
  // Prepare = assign the question set and return it WITHOUT starting the timer.
  // The client calls this on the intro screen so questions are ready to render
  // the instant the candidate begins (no perceived load delay).
  if (path === '/api/candidate/part1/prepare' && request.method === 'POST') {
    await ensureQuestionHintCol(env);
    await ensureQuestionDeletedCol(env);
    await assignPart1Questions(env, candidate.id);
    const rows = await env.DB.prepare(
      `SELECT qb.id, qb.category, qb.prompt, qb.sample_data, qb.hint, pa2.answer_text AS answer
       FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id
       LEFT JOIN part1_answers pa2 ON pa2.candidate_id = pa.candidate_id AND pa2.question_id = qb.id
       WHERE pa.candidate_id = ? ORDER BY pa.position`
    )
      .bind(candidate.id)
      .all<{ id: string; category: string; prompt: string; sample_data: string | null; hint: string | null; answer: string | null }>();
    const questions = (rows.results ?? []).map((q) => ({ id: q.id, category: q.category, prompt: q.prompt, sampleData: q.sample_data, hint: q.hint, answer: q.answer ?? '' }));
    return json({ questions });
  }

  if (path === '/api/candidate/part1/start' && request.method === 'POST') {
    await ensureQuestionHintCol(env);
    await ensureQuestionDeletedCol(env);
    await assignPart1Questions(env, candidate.id);
    await startPart(env, candidate.id, 'part1');
    await env.DB.prepare("UPDATE candidates SET status = 'in_progress' WHERE id = ? AND status = 'part2_ready'")
      .bind(candidate.id)
      .run();
    // Return the assigned questions in the same response so the client needs
    // only ONE round-trip before rendering (no separate /questions fetch).
    const rows = await env.DB.prepare(
      `SELECT qb.id, qb.category, qb.prompt, qb.sample_data, qb.hint, pa2.answer_text AS answer
       FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id
       LEFT JOIN part1_answers pa2 ON pa2.candidate_id = pa.candidate_id AND pa2.question_id = qb.id
       WHERE pa.candidate_id = ? ORDER BY pa.position`
    )
      .bind(candidate.id)
      .all<{ id: string; category: string; prompt: string; sample_data: string | null; hint: string | null; answer: string | null }>();
    const questions = (rows.results ?? []).map((q) => ({ id: q.id, category: q.category, prompt: q.prompt, sampleData: q.sample_data, hint: q.hint, answer: q.answer ?? '' }));
    return json({ ok: true, durationSeconds: await durationSeconds(env, 'part1'), questions });
  }

  if (path === '/api/candidate/part1/questions' && request.method === 'GET') {
    await ensureQuestionHintCol(env);
    await ensureQuestionDeletedCol(env);
    // Only prompt, category and sample_data go to the browser — never
    // reference_answer, rubric or marks.
    const rows = await env.DB.prepare(
      `SELECT qb.id, qb.category, qb.prompt, qb.sample_data, qb.hint, pa2.answer_text AS answer
       FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id
       LEFT JOIN part1_answers pa2 ON pa2.candidate_id = pa.candidate_id AND pa2.question_id = qb.id
       WHERE pa.candidate_id = ? ORDER BY pa.position`
    )
      .bind(candidate.id)
      .all<{ id: string; category: string; prompt: string; sample_data: string | null; hint: string | null; answer: string | null }>();
    const questions = (rows.results ?? []).map((q) => ({
      id: q.id,
      category: q.category,
      prompt: q.prompt,
      sampleData: q.sample_data,
      hint: q.hint,
      answer: q.answer ?? '',
    }));
    return json({ questions });
  }

  if (path === '/api/candidate/part1/answer' && request.method === 'POST') {
    const { questionId, answerText } = await request.json<{ questionId: string; answerText: string }>();
    if (typeof questionId !== 'string' || !questionId) return json({ error: 'questionId required' }, { status: 400 });
    // Ownership: the question must actually be assigned to this candidate.
    const owned = await env.DB.prepare('SELECT 1 FROM part1_assignments WHERE candidate_id = ? AND question_id = ?')
      .bind(candidate.id, questionId)
      .first();
    if (!owned) return json({ error: 'This question is not part of your assessment.' }, { status: 403 });
    const text = String(answerText ?? '').slice(0, MAX_ANSWER_CHARS); // hard server cap
    await env.DB.prepare(
      `INSERT INTO part1_answers (candidate_id, question_id, answer_text)
       VALUES (?, ?, ?)
       ON CONFLICT (candidate_id, question_id)
       DO UPDATE SET answer_text = excluded.answer_text, updated_at = datetime('now')`
    )
      .bind(candidate.id, questionId, text)
      .run();
    return json({ ok: true }); // no correctness, ever
  }

  if (path === '/api/candidate/part1/heartbeat' && request.method === 'POST') {
    const remaining = await heartbeat(env, candidate.id, 'part1');
    if (remaining <= 0) {
      await markSubmitted(env, candidate.id, 'part1');
      // Single-part test: the clock running out finalizes the whole assessment.
      await env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')").bind(candidate.id).run();
    }
    return json({ remainingSeconds: remaining });
  }

  if (path === '/api/candidate/part1/tab-switch' && request.method === 'POST') {
    const { type } = await request.json<{ type: string }>().catch(() => ({ type: 'unknown' }));
    await logTabSwitch(env, candidate.id, 'part1', type);
    return json({ ok: true });
  }

  if (path === '/api/candidate/part1/submit' && request.method === 'POST') {
    await markSubmitted(env, candidate.id, 'part1');
    // Single-part assessment: submitting finalizes the whole test. Guard the
    // transition so a late/duplicate submit can't revert an admin-set status.
    await env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')").bind(candidate.id).run();
    return json({ ok: true });
  }

  // --- Part 2: closed-book, personalized, written answers (locked down like Part 1) ---
  if (path === '/api/candidate/part2/prepare' && request.method === 'POST') {
    const rows = await env.DB.prepare(
      'SELECT id, prompt, based_on_skill FROM part2_questions WHERE candidate_id = ? ORDER BY position'
    )
      .bind(candidate.id)
      .all();
    return json({ questions: rows.results ?? [] });
  }

  if (path === '/api/candidate/part2/start' && request.method === 'POST') {
    await startPart(env, candidate.id, 'part2');
    const rows = await env.DB.prepare(
      'SELECT id, prompt, based_on_skill FROM part2_questions WHERE candidate_id = ? ORDER BY position'
    )
      .bind(candidate.id)
      .all();
    return json({ ok: true, durationSeconds: await durationSeconds(env, 'part2'), questions: rows.results ?? [] });
  }

  if (path === '/api/candidate/part2/questions' && request.method === 'GET') {
    // prompt + based_on_skill only — never rubric or marks.
    const rows = await env.DB.prepare(
      'SELECT id, prompt, based_on_skill FROM part2_questions WHERE candidate_id = ? ORDER BY position'
    )
      .bind(candidate.id)
      .all();
    return json({ questions: rows.results ?? [] });
  }

  if (path === '/api/candidate/part2/answer' && request.method === 'POST') {
    const { questionId, answerText } = await request.json<{ questionId: string; answerText: string }>();
    if (typeof questionId !== 'string' || !questionId) return json({ error: 'questionId required' }, { status: 400 });
    const owned = await env.DB.prepare('SELECT 1 FROM part2_questions WHERE candidate_id = ? AND id = ?')
      .bind(candidate.id, questionId)
      .first();
    if (!owned) return json({ error: 'This question is not part of your assessment.' }, { status: 403 });
    const text = String(answerText ?? '').slice(0, MAX_ANSWER_CHARS);
    await env.DB.prepare(
      `INSERT INTO part2_answers (candidate_id, question_id, answer_text)
       VALUES (?, ?, ?)
       ON CONFLICT (candidate_id, question_id)
       DO UPDATE SET answer_text = excluded.answer_text, updated_at = datetime('now')`
    )
      .bind(candidate.id, questionId, text)
      .run();
    return json({ ok: true });
  }

  if (path === '/api/candidate/part2/heartbeat' && request.method === 'POST') {
    const remaining = await heartbeat(env, candidate.id, 'part2');
    if (remaining <= 0) {
      await markSubmitted(env, candidate.id, 'part2');
      await env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')")
        .bind(candidate.id)
        .run();
    }
    return json({ remainingSeconds: remaining });
  }

  if (path === '/api/candidate/part2/tab-switch' && request.method === 'POST') {
    type SwitchBody = { type: string; chars?: number; questionId?: string; typed?: number; pasted?: number; pastes?: number; ms?: number };
    const body = await request.json<SwitchBody>().catch(() => ({ type: 'unknown' } as SwitchBody));
    const type = typeof body.type === 'string' ? body.type : 'unknown';
    // Paste + 'metrics' events carry authenticity signals (how much was pasted vs
    // typed, and time spent) per question — inputs for grading. Part 2 requires
    // the candidate's own words; these are never a verdict on their own.
    const clampN = (v: unknown, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(Number(v)))) : undefined);
    const questionId = typeof body.questionId === 'string' ? body.questionId.slice(0, 64) : undefined;
    await logTabSwitch(env, candidate.id, 'part2', type, {
      chars: clampN(body.chars, 20000),
      questionId,
      typed: clampN(body.typed, 100000),
      pasted: clampN(body.pasted, 100000),
      pastes: clampN(body.pastes, 1000),
      ms: clampN(body.ms, 24 * 60 * 60 * 1000),
    }); // logged only — Part 2 never blocks
    return json({ ok: true });
  }

  if (path === '/api/candidate/part2/submit' && request.method === 'POST') {
    await markSubmitted(env, candidate.id, 'part2');
    // Part 2 is the final part — this finalizes the assessment. Guard the status
    // transition so a late/duplicate submit can't revert an admin-set status.
    await env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')").bind(candidate.id).run();
    return json({ ok: true });
  }

  // --- Part 3: closed-book, timed, debugging / break-fix (locked down like Part 1) ---
  if (path === '/api/candidate/part3/prepare' && request.method === 'POST') {
    await assignPart3Questions(env, candidate.id);
    return json({ questions: await getPart3Questions(env, candidate.id) });
  }

  if (path === '/api/candidate/part3/start' && request.method === 'POST') {
    await assignPart3Questions(env, candidate.id);
    await startPart(env, candidate.id, 'part3');
    return json({ ok: true, durationSeconds: await durationSeconds(env, 'part3'), questions: await getPart3Questions(env, candidate.id) });
  }

  if (path === '/api/candidate/part3/questions' && request.method === 'GET') {
    return json({ questions: await getPart3Questions(env, candidate.id) });
  }

  if (path === '/api/candidate/part3/answer' && request.method === 'POST') {
    const { questionId, answerText } = await request.json<{ questionId: string; answerText: string }>();
    if (typeof questionId !== 'string' || !questionId) return json({ error: 'questionId required' }, { status: 400 });
    const owned = await env.DB.prepare('SELECT 1 FROM part3_assignments WHERE candidate_id = ? AND question_id = ?')
      .bind(candidate.id, questionId)
      .first();
    if (!owned) return json({ error: 'This question is not part of your assessment.' }, { status: 403 });
    const text = String(answerText ?? '').slice(0, MAX_ANSWER_CHARS);
    await env.DB.prepare(
      `INSERT INTO part3_answers (candidate_id, question_id, answer_text)
       VALUES (?, ?, ?)
       ON CONFLICT (candidate_id, question_id)
       DO UPDATE SET answer_text = excluded.answer_text, updated_at = datetime('now')`
    )
      .bind(candidate.id, questionId, text)
      .run();
    return json({ ok: true });
  }

  if (path === '/api/candidate/part3/heartbeat' && request.method === 'POST') {
    const remaining = await heartbeat(env, candidate.id, 'part3');
    if (remaining <= 0) {
      await markSubmitted(env, candidate.id, 'part3');
      await env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')")
        .bind(candidate.id)
        .run();
    }
    return json({ remainingSeconds: remaining });
  }

  if (path === '/api/candidate/part3/tab-switch' && request.method === 'POST') {
    const { type } = await request.json<{ type: string }>().catch(() => ({ type: 'unknown' }));
    await logTabSwitch(env, candidate.id, 'part3', type);
    return json({ ok: true });
  }

  if (path === '/api/candidate/part3/submit' && request.method === 'POST') {
    await markSubmitted(env, candidate.id, 'part3');
    // Part 3 is the last part — this finalizes the assessment. Guard the
    // transition so a late/duplicate submit can't revert an admin-set status.
    await env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')").bind(candidate.id).run();
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, { status: 404 });
}
