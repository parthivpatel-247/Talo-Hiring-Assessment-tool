import type { Env, Candidate } from '../types';
import { createCandidateSession, getCandidateIdFromRequest, json, withCookie } from '../lib/auth';
import { getCandidateByEmail, getCandidateById, getAttempt, ensureAttempt, newId, nowIso } from '../lib/db';
import { assignDocsPart1, assignDocsPart2 } from '../lib/randomize';
import { startPart, durationSeconds } from '../lib/timer';
import { getDocsConfig, DocsPoolTooSmall, type DocsConfig } from '../lib/team';

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

async function requireCandidate(env: Env, request: Request): Promise<Candidate | null> {
  const id = await getCandidateIdFromRequest(env, request);
  if (!id) return null;
  const candidate = (await getCandidateById(env, id)) as Candidate | null;
  if (!candidate || candidate.access_revoked) return null;
  return candidate;
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

/** Is this part open for answers right now (started, not submitted, time left)? */
function partOpen(at: Attempt, part: 'part1' | 'part2'): boolean {
  if (!at || !at[`${part}_started_at`] || at[`${part}_submitted_at`]) return false;
  const remaining = at[`${part}_remaining_seconds`];
  return remaining == null || Number(remaining) > 0;
}

/**
 * Records one integrity event (leaving the test, a paste, typing metrics) as its own
 * row in attempt_events, and bumps the part's leave-the-test counter in the same
 * atomic batch. One INSERT per event, so events that arrive together are all kept.
 * Pastes and typing metrics are signals, not tab switches, so they don't count.
 */
const NOT_SWITCHES = new Set(['paste', 'paste_blocked', 'copy_blocked', 'metrics']);
async function logEvent(env: Env, candidateId: string, part: 1 | 2, body: Record<string, unknown>): Promise<void> {
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
    await env.DB.prepare(
      "UPDATE attempts SET login_count = login_count + 1, first_login_at = COALESCE(first_login_at, datetime('now')), last_login_at = datetime('now') WHERE candidate_id = ?"
    ).bind(candidate.id).run();

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
        await env.DB.prepare(
          "INSERT INTO admin_audit (id, action, candidate_id, detail) VALUES (?, 'duplicate_login_blocked', ?, ?)"
        ).bind(newId('aud'), candidate.id, `Blocked a repeat login for ${candidate.email} (attempt #${count}) — the test was already started on this account.`).run();
      } catch { /* best effort */ }
      return json({ error: 'This assessment has already been started on this account and can only be taken once. If you believe this is a mistake, contact your coordinator.' }, { status: 403 });
    }
    const cookie = await createCandidateSession(env, candidate.id);
    return withCookie(json({ ok: true, name: candidate.name }), cookie);
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
    });
  }

  const candidate = await requireCandidate(env, request);
  if (!candidate) return json({ error: 'Not logged in' }, { status: 401 });

  if (path === '/api/candidate/me' && request.method === 'GET') {
    const attempt = await getAttempt(env, candidate.id);
    return json({ candidate: { name: candidate.name, email: candidate.email, status: candidate.status }, attempt });
  }

  // Loaded once per request, and only by the routes that need them.
  let cfgCache: DocsConfig | null = null;
  const config = async () => (cfgCache ??= await getDocsConfig(env));
  const at = (await getAttempt(env, candidate.id)) as Attempt;

  // Clock sync for a running part, optionally saving the answer being typed in the
  // same request. Returns the seconds left (0 = the part's time is up).
  const beat = async (part: 'part1' | 'part2'): Promise<Response> => {
    if (!at || !at[`${part}_started_at`] || at[`${part}_submitted_at`]) return json({ remainingSeconds: 0, closed: true });
    const body = await request.json<{ questionId?: unknown; answerText?: unknown }>().catch(() => ({} as { questionId?: unknown; answerText?: unknown }));
    const remaining = Number(at[`${part}_remaining_seconds`] ?? 0);
    const last = at[`${part}_last_heartbeat_at`] ? Date.parse(String(at[`${part}_last_heartbeat_at`])) : Date.now();
    const elapsed = Math.min(Math.max(0, (Date.now() - last) / 1000), HEARTBEAT_CAP_SECONDS);
    const next = Math.max(0, Math.round(remaining - elapsed));
    const stmts = [
      env.DB.prepare(`UPDATE attempts SET ${part}_remaining_seconds = ?, ${part}_last_heartbeat_at = ? WHERE candidate_id = ? AND ${part}_submitted_at IS NULL`)
        .bind(next, nowIso(), candidate.id),
    ];
    let saved = false;
    if (typeof body.questionId === 'string' && body.questionId && typeof body.answerText === 'string' && remaining > 0) {
      const owned = part === 'part1'
        ? await env.DB.prepare('SELECT qb.word_limit FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id WHERE pa.candidate_id = ? AND pa.question_id = ?')
            .bind(candidate.id, body.questionId).first<{ word_limit: number | null }>()
        : await env.DB.prepare('SELECT word_limit FROM part2_questions WHERE candidate_id = ? AND id = ?')
            .bind(candidate.id, body.questionId).first<{ word_limit: number | null }>();
      if (owned) {
        const text = body.answerText.slice(0, answerCap(owned.word_limit || (await config()).wordLimit));
        stmts.push(env.DB.prepare(
          `INSERT INTO ${part}_answers (candidate_id, question_id, answer_text) VALUES (?, ?, ?)
           ON CONFLICT (candidate_id, question_id) DO UPDATE SET answer_text = excluded.answer_text, updated_at = datetime('now')`
        ).bind(candidate.id, body.questionId, text));
        saved = true;
      }
    }
    await env.DB.batch(stmts);
    if (next <= 0) {
      if (part === 'part1') await closePart(env, candidate.id, 'part1'); // Part 1 closes; Part 2 is next
      else await finishAssessment(env, candidate.id);
    }
    return json({ remainingSeconds: next, saved });
  };

  // ---------------- Part 1: closed book ----------------
  if (path === '/api/candidate/part1/prepare' && request.method === 'POST') {
    if (at?.part1_submitted_at) return json({ error: 'Part 1 is closed.', closed: true }, { status: 409 });
    try { await assignDocsPart1(env, candidate.id); } catch (err) { return notReady(err); }
    return json({ questions: await part1Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if (path === '/api/candidate/part1/start' && request.method === 'POST') {
    if (at?.part1_submitted_at) return json({ error: 'Part 1 is closed.', closed: true }, { status: 409 });
    try { await assignDocsPart1(env, candidate.id); } catch (err) { return notReady(err); }
    await startPart(env, candidate.id, 'part1');
    await env.DB.prepare("UPDATE candidates SET status = 'in_progress' WHERE id = ? AND status = 'part2_ready'").bind(candidate.id).run();
    return json({ ok: true, durationSeconds: await durationSeconds(env, 'part1'), questions: await part1Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if (path === '/api/candidate/part1/questions' && request.method === 'GET') {
    return json({ questions: await part1Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if (path === '/api/candidate/part1/answer' && request.method === 'POST') {
    const { questionId, answerText } = await request.json<{ questionId: string; answerText: string }>().catch(() => ({} as any));
    if (typeof questionId !== 'string' || !questionId) return json({ error: 'questionId required' }, { status: 400 });
    const owned = await env.DB.prepare(
      'SELECT qb.word_limit FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id WHERE pa.candidate_id = ? AND pa.question_id = ?'
    ).bind(candidate.id, questionId).first<{ word_limit: number | null }>();
    if (!owned) return json({ error: 'This question is not part of your assessment.' }, { status: 403 });
    if (!partOpen(at, 'part1')) return json({ error: 'Part 1 is closed. Your saved answers were kept.', closed: true }, { status: 409 });
    const text = String(answerText ?? '').slice(0, answerCap(owned.word_limit || (await config()).wordLimit));
    await env.DB.prepare(
      `INSERT INTO part1_answers (candidate_id, question_id, answer_text) VALUES (?, ?, ?)
       ON CONFLICT (candidate_id, question_id) DO UPDATE SET answer_text = excluded.answer_text, updated_at = datetime('now')`
    ).bind(candidate.id, questionId, text).run();
    return json({ ok: true });
  }

  if (path === '/api/candidate/part1/heartbeat' && request.method === 'POST') return beat('part1');

  if (path === '/api/candidate/part1/tab-switch' && request.method === 'POST') {
    const body = await request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    await logEvent(env, candidate.id, 1, body);
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
    return json({ questions: await part2Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if (path === '/api/candidate/part2/start' && request.method === 'POST') {
    const blocked = part2Gate(); if (blocked) return blocked;
    try { await assignDocsPart2(env, candidate.id); } catch (err) { return notReady(err); }
    await startPart(env, candidate.id, 'part2');
    await env.DB.prepare("UPDATE candidates SET status = 'in_progress' WHERE id = ? AND status = 'part2_ready'").bind(candidate.id).run();
    return json({ ok: true, durationSeconds: await durationSeconds(env, 'part2'), questions: await part2Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if (path === '/api/candidate/part2/questions' && request.method === 'GET') {
    if (!at?.part1_submitted_at) return json({ error: 'Finish Part 1 first.' }, { status: 409 });
    return json({ questions: await part2Questions(env, candidate.id, (await config()).wordLimit) });
  }

  if (path === '/api/candidate/part2/answer' && request.method === 'POST') {
    const { questionId, answerText } = await request.json<{ questionId: string; answerText: string }>().catch(() => ({} as any));
    if (typeof questionId !== 'string' || !questionId) return json({ error: 'questionId required' }, { status: 400 });
    const owned = await env.DB.prepare('SELECT word_limit FROM part2_questions WHERE candidate_id = ? AND id = ?')
      .bind(candidate.id, questionId).first<{ word_limit: number | null }>();
    if (!owned) return json({ error: 'This question is not part of your assessment.' }, { status: 403 });
    if (!partOpen(at, 'part2')) return json({ error: 'Part 2 is closed. Your saved answers were kept.', closed: true }, { status: 409 });
    const text = String(answerText ?? '').slice(0, answerCap(owned.word_limit || (await config()).wordLimit));
    await env.DB.prepare(
      `INSERT INTO part2_answers (candidate_id, question_id, answer_text) VALUES (?, ?, ?)
       ON CONFLICT (candidate_id, question_id) DO UPDATE SET answer_text = excluded.answer_text, updated_at = datetime('now')`
    ).bind(candidate.id, questionId, text).run();
    return json({ ok: true });
  }

  if (path === '/api/candidate/part2/heartbeat' && request.method === 'POST') return beat('part2');

  if (path === '/api/candidate/part2/tab-switch' && request.method === 'POST') {
    const body = await request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    await logEvent(env, candidate.id, 2, body); // logged only — Part 2 never blocks
    return json({ ok: true });
  }

  // Ends the whole test: used by "Submit Part 2", and by the page when a reload or
  // leaving full screen in Part 1 closes the assessment early.
  if (path === '/api/candidate/part2/submit' && request.method === 'POST') {
    await finishAssessment(env, candidate.id);
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, { status: 404 });
}
