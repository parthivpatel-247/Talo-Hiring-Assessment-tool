import type { Router } from '../router';
import type { Ctx } from '../lib/context';
import type { CandidateRow, AttemptRow } from '../env';
import { json, readJson, str, email as emailField, HttpError, bad, notFound, pathId, countWords, cleanText, conflict, oneOf } from '../lib/http';
import { getSettings, type Settings } from '../lib/settings';
import { enforce, hit, block, clear } from '../lib/ratelimit';
import { verifyTurnstile } from '../lib/turnstile';
import { hashCode, randomDigits, safeEqual } from '../lib/security';
import { createCandidateSession, clearCookie, CANDIDATE_COOKIE, newNonce, loadCandidate } from '../lib/sessions';
import { emailConfigured, sendEmail, candidateOtpEmail } from '../lib/email';
import { ensurePaper, paperForCandidate, remainingNow, pastSaveWindow, saveDecision, startStatements, submitStatements, eventStmt, deadlineMs, LANGUAGES, type SubmitReason } from '../lib/exam';
import { newId } from '../db/db';
import { track } from '../lib/telemetry';

const GENERIC_LOGIN_ERROR = "We couldn't sign you in with that email and code. Check both and try again, or ask your invigilator for help.";
const MAX_ANSWER_CHARS = 20_000;

/** Code check for the configured sign-in mode. Never reveals whether the email exists. */
async function codeMatches(ctx: Ctx, s: Settings, cand: CandidateRow, code: string): Promise<boolean> {
  if (s.loginMode === 'email_only') return true;
  const c = code.trim().toUpperCase();
  if (!c) return false;
  if (s.loginMode === 'otp') {
    const ch = await ctx.db.first<{ id: string; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts FROM auth_challenges
       WHERE purpose = 'candidate_login' AND subject_id = ? AND consumed_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
       ORDER BY created_at DESC LIMIT 1`,
      cand.id
    );
    if (!ch || ch.attempts >= 5) return false;
    const ok = safeEqual(await hashCode(ctx.env, 'candidate_login', cand.id, c), ch.code_hash);
    await ctx.db.run(
      ok ? "UPDATE auth_challenges SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?" : 'UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?',
      ch.id
    );
    // OTP mode proves the student owns the inbox, so no other code is accepted.
    return ok;
  }
  // A personal code, once issued, is the only code that works for that candidate:
  // classmates who know the hall code cannot sign in as them.
  if (cand.invite_code_hash) return safeEqual(await hashCode(ctx.env, 'invite', cand.id, c), cand.invite_code_hash);
  if (cand.drive_id) {
    const drive = await ctx.db.first<{ access_code: string | null; code_required: number; status: string }>(
      'SELECT access_code, code_required, status FROM drives WHERE id = ?', cand.drive_id
    );
    if (drive && drive.status !== 'closed') {
      if (drive.access_code && safeEqual(drive.access_code.toUpperCase(), c)) return true;
    }
  }
  return false;
}

async function driveAllowsNoCode(ctx: Ctx, cand: CandidateRow): Promise<boolean> {
  if (!cand.drive_id) return false;
  const d = await ctx.db.first<{ code_required: number; status: string }>('SELECT code_required, status FROM drives WHERE id = ?', cand.drive_id);
  return !!d && d.code_required === 0 && d.status !== 'closed';
}

/** A candidate in a drive can start only while the drive is live; candidates without a drive can start any time. */
async function driveLive(ctx: Ctx, cand: CandidateRow): Promise<boolean> {
  if (!cand.drive_id) return true;
  const d = await ctx.db.first<{ status: string }>('SELECT status FROM drives WHERE id = ?', cand.drive_id);
  return !d || d.status === 'live';
}

async function ensureAttemptRow(ctx: Ctx, candidateId: string): Promise<AttemptRow> {
  await ctx.db.run('INSERT OR IGNORE INTO attempts (candidate_id) VALUES (?)', candidateId);
  return (await ctx.db.first<AttemptRow>('SELECT * FROM attempts WHERE candidate_id = ?', candidateId))!;
}

function publicAttempt(a: AttemptRow, s: Settings) {
  const dl = deadlineMs(a, s);
  return {
    attemptNo: a.attempt_no,
    started: !!a.started_at,
    submitted: !!a.submitted_at,
    submitReason: a.submitted_at ? a.submit_reason : null,
    remainingSeconds: a.started_at && !a.submitted_at ? remainingNow(a, s) : null,
    deadlineAt: dl ? new Date(dl).toISOString() : null,
  };
}

async function candidateContext(ctx: Ctx, cand: CandidateRow) {
  const rows = await ctx.db.batch([
    ctx.db.stmt('SELECT name FROM colleges WHERE id = ?', cand.college_id ?? ''),
    ctx.db.stmt('SELECT name, scheduled_on FROM drives WHERE id = ?', cand.drive_id ?? ''),
  ]);
  const college = (rows[0].results?.[0] as { name?: string } | undefined)?.name ?? null;
  const drive = rows[1].results?.[0] as { name?: string; scheduled_on?: string } | undefined;
  return { college, driveName: drive?.name ?? null, driveDate: drive?.scheduled_on ?? null };
}

export function registerCandidate(r: Router): void {
  /* ---------- sign-in ---------- */

  r.add('POST', '/api/candidate/login', 'public', async (ctx) => {
    const body = await readJson(ctx.request, 4096);
    const email = emailField(body);
    const code = str(body, 'code', { optional: true, max: 12 });
    // A whole exam hall can share one campus IP, so the per-IP limit is generous;
    // the per-email limit counts FAILED attempts only, so junk requests can't lock a student out
    // unless they also guess wrong codes (and an invigilator can clear it by issuing a new code).
    await enforce(ctx.db, `cand-login-ip:${ctx.ip}`, 300, 600);
    const failBucket = `cand-login-fail:${email}`;
    const prior = await ctx.db.first<{ count: number; window_start: number; blocked_until: number | null }>('SELECT count, window_start, blocked_until FROM rate_limits WHERE bucket = ?', failBucket);
    const nowSec = Math.floor(Date.now() / 1000);
    if (prior?.blocked_until && prior.blocked_until > nowSec) {
      throw new HttpError(429, 'Too many wrong codes for this email. Please wait 10 minutes or ask your invigilator.', 'rate_limited', { retryAfter: prior.blocked_until - nowSec });
    }
    await verifyTurnstile(ctx.env, body.turnstileToken, ctx.ip);
    const s = await getSettings(ctx.env, ctx.db);

    const cand = await ctx.db.first<CandidateRow>('SELECT * FROM candidates WHERE email = ?', email);
    const generic = new HttpError(401, GENERIC_LOGIN_ERROR, 'invalid_login');
    const fail = async (candidateId: string | null) => {
      const f = await hit(ctx.db, failBucket, 10, 600);
      if (!f.ok || f.count >= 10) await block(ctx.db, failBucket, 600);
      if (candidateId) await ctx.db.run("INSERT INTO attempt_events (candidate_id, attempt_no, type, detail) VALUES (?, 1, 'login_failed', ?)", candidateId, JSON.stringify({ ip: ctx.ip }));
      throw generic;
    };
    if (!cand) {
      // Same work as the found path (an HMAC and a drive lookup) so timing doesn't reveal registered emails.
      await hashCode(ctx.env, 'invite', 'unknown', (code || '').toUpperCase());
      await ctx.db.first('SELECT access_code FROM drives WHERE id = ?', '');
      return fail(null);
    }
    const ok = (await codeMatches(ctx, s, cand, code)) || (s.loginMode === 'code' && !code && (await driveAllowsNoCode(ctx, cand)));
    if (!ok) return fail(cand.id);
    await clear(ctx.db, failBucket);

    // Identity verified: from here the messages can be specific.
    if (cand.access_revoked) throw new HttpError(403, 'Your access to this assessment has been withdrawn. Please speak to your invigilator.', 'revoked');
    if (cand.status === 'uploaded' || cand.status === 'parse_failed') {
      throw new HttpError(409, 'Your assessment is not ready yet. Please wait a moment and try again, or tell your invigilator.', 'not_ready');
    }
    const a = await ensureAttemptRow(ctx, cand.id);
    if (a.started_at && !a.submitted_at) {
      // One test per email: a second device or browser cannot join a running test.
      await ctx.db.batch([
        ctx.db.stmt("UPDATE attempts SET blocked_login_count = blocked_login_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE candidate_id = ?", cand.id),
        eventStmt(ctx.db, cand.id, a.attempt_no, 'login_blocked', { ip: ctx.ip, ua: ctx.ua.slice(0, 120) }),
      ]);
      throw new HttpError(
        403,
        'This assessment is already running on another device or browser, so a new sign-in is blocked. If your computer crashed, ask your invigilator to resume your test.',
        'already_started'
      );
    }
    const nonce = newNonce();
    const iso = new Date().toISOString();
    await ctx.db.batch([
      ctx.db.stmt(
        `UPDATE attempts SET session_nonce = ?, login_count = login_count + 1, first_login_at = COALESCE(first_login_at, ?), last_login_at = ?,
           last_ip = ?, user_agent = ?, updated_at = ? WHERE candidate_id = ?`,
        nonce, iso, iso, ctx.ip, ctx.ua, iso, cand.id
      ),
      eventStmt(ctx.db, cand.id, a.attempt_no, 'login', { ip: ctx.ip }),
    ]);
    ctx.cookies.push(await createCandidateSession(ctx.env, cand.id, nonce));
    await track(ctx.db, 'candidate_login');
    return json({ ok: true, name: cand.name });
  });

  // Email one-time code (only when the sign-in mode is "otp" and email is configured).
  r.add('POST', '/api/candidate/otp', 'public', async (ctx) => {
    const body = await readJson(ctx.request, 2048);
    const email = emailField(body);
    await enforce(ctx.db, `cand-otp-ip:${ctx.ip}`, 20, 600);
    await enforce(ctx.db, `cand-otp-email:${email}`, 3, 600, 'A code was sent recently. Check your inbox (and spam), or wait a few minutes before asking again.');
    await verifyTurnstile(ctx.env, body.turnstileToken, ctx.ip);
    const s = await getSettings(ctx.env, ctx.db);
    if (s.loginMode !== 'otp' || !emailConfigured(ctx.env)) throw bad('Email codes are not enabled. Use the access code you were given.', 'otp_disabled');
    const cand = await ctx.db.first<CandidateRow>('SELECT * FROM candidates WHERE email = ?', email);
    const generic = json({ ok: true, message: 'If this email is registered for the assessment, a 6-digit code is on its way. It expires in 10 minutes.' });
    if (!cand || cand.access_revoked || cand.status === 'uploaded' || cand.status === 'parse_failed') return generic;
    const code = randomDigits(6);
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await ctx.db.batch([
      ctx.db.stmt("UPDATE auth_challenges SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE purpose = 'candidate_login' AND subject_id = ? AND consumed_at IS NULL", cand.id),
      ctx.db.stmt('INSERT INTO auth_challenges (id, purpose, subject_id, code_hash, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?)',
        newId('ch'), 'candidate_login', cand.id, await hashCode(ctx.env, 'candidate_login', cand.id, code), expires, ctx.ip),
    ]);
    const mail = candidateOtpEmail(s.orgName, cand.name || 'there', code);
    const sent = await sendEmail(ctx.env, { to: cand.email, ...mail });
    if (!sent.ok) console.error('candidate otp send failed', sent.error);
    return generic;
  });

  r.add('POST', '/api/candidate/logout', 'public', async (ctx) => {
    ctx.cookies.push(clearCookie(CANDIDATE_COOKIE));
    // Invalidate the session server-side too, so a copied cookie stops working.
    const cur = await loadCandidate(ctx.env, ctx.db, ctx.request);
    if (cur) await ctx.db.run('UPDATE attempts SET session_nonce = NULL WHERE candidate_id = ?', cur.candidate.id);
    return json({ ok: true });
  });

  /* ---------- the assessment ---------- */

  r.add('GET', '/api/candidate/me', 'candidate', async (ctx) => {
    const { candidate: c, attempt: a } = ctx.candidate!;
    const s = await getSettings(ctx.env, ctx.db);
    const extra = await candidateContext(ctx, c);
    return json({
      candidate: { name: c.name, email: c.email, ...extra },
      attempt: publicAttempt(a, s),
      rules: {
        assessmentMinutes: Math.round((a.duration_seconds ?? s.assessmentMinutes * 60) / 60),
        wordLimit: s.wordLimit,
        awayGraceSeconds: s.awayGraceSeconds,
        requireFullscreenDevice: s.requireFullscreenDevice,
        questionCount: s.paper.reduce((n, x) => n + x.count, 0),
      },
    });
  });

  // Assign the paper and return it WITHOUT starting the clock (prefetch on the rules screen).
  r.add('POST', '/api/candidate/prepare', 'candidate', async (ctx) => {
    const { candidate: c, attempt: a } = ctx.candidate!;
    if (a.submitted_at) throw conflict('Your assessment has already been submitted.', 'submitted');
    const s = await getSettings(ctx.env, ctx.db);
    const res = await ensurePaper(ctx.db, c.id, s);
    if (res.shortfall.length) {
      console.error('question pool too small for', res.shortfall);
      throw new HttpError(503, 'The question paper could not be prepared. Please tell your invigilator (question bank too small).', 'pool_exhausted');
    }
    // Questions are only revealed once the clock is running (/start), never on the rules screen.
    const count = Number((await ctx.db.value<number>('SELECT COUNT(*) AS n FROM assignments WHERE candidate_id = ?', c.id)) ?? 0);
    return json({ ready: true, questionCount: count, driveLive: await driveLive(ctx, c) });
  });

  r.add('POST', '/api/candidate/start', 'candidate', async (ctx) => {
    const { candidate: c, attempt: a } = ctx.candidate!;
    if (a.submitted_at) throw conflict('Your assessment has already been submitted.', 'submitted');
    const s = await getSettings(ctx.env, ctx.db);
    if (!a.started_at && !(await driveLive(ctx, c))) {
      throw conflict("Your drive hasn't been opened yet. Wait for the invigilator to start it, then press Start again.", 'drive_not_live');
    }
    const res = await ensurePaper(ctx.db, c.id, s);
    if (res.shortfall.length) throw new HttpError(503, 'The question paper could not be prepared. Please tell your invigilator (question bank too small).', 'pool_exhausted');
    if (!a.started_at) {
      // duration_seconds is preset only when an admin resumed the attempt with its remaining time.
      await ctx.db.batch([
        ...startStatements(ctx.db, c.id, s, a.duration_seconds),
        eventStmt(ctx.db, c.id, a.attempt_no, 'start', { ip: ctx.ip }),
      ]);
      await track(ctx.db, 'candidate_start');
    }
    const fresh = (await ctx.db.first<AttemptRow>('SELECT * FROM attempts WHERE candidate_id = ?', c.id))!;
    return json({ attempt: publicAttempt(fresh, s), questions: await paperForCandidate(ctx.db, c.id) });
  });

  r.add('GET', '/api/candidate/questions', 'candidate', async (ctx) => {
    const { candidate: c, attempt: a } = ctx.candidate!;
    if (!a.started_at) throw conflict('Start the assessment to see the questions.', 'not_started');
    return json({ questions: await paperForCandidate(ctx.db, c.id) });
  });

  // Save one answer (autosave every 15s, on question switch and on submit).
  r.add('PUT', '/api/candidate/answers/:questionId', 'candidate', async (ctx) => {
    const { candidate: c, attempt: a } = ctx.candidate!;
    const qid = pathId(ctx.params.questionId);
    const s = await getSettings(ctx.env, ctx.db);
    if (!a.started_at) throw conflict('Start the assessment before answering.', 'not_started');
    const decision = saveDecision(a, s);
    if (!decision.ok) {
      if (!a.submitted_at) await ctx.db.batch(submitStatements(ctx.db, c.id, a.attempt_no, pastSaveWindow(a, s) ? 'deadline' : 'time_up'));
      throw conflict('Time is up. This assessment is closed, so answers can no longer be changed.', 'closed');
    }
    const body = await readJson(ctx.request, 96 * 1024);
    const raw = body.text ?? '';
    if (typeof raw !== 'string') throw bad('The answer must be text.');
    if (raw.length > MAX_ANSWER_CHARS) throw bad(`Answers can be at most ${MAX_ANSWER_CHARS.toLocaleString('en-US')} characters.`, 'too_long');
    const text = cleanText(raw);
    const words = countWords(text);
    if (words > s.wordLimit + 5) throw bad(`Answers can be at most ${s.wordLimit} words.`, 'too_many_words');
    const language = body.language == null || body.language === '' ? null : oneOf(body, 'language', LANGUAGES);
    const assigned = await ctx.db.first('SELECT 1 AS ok FROM assignments WHERE candidate_id = ? AND question_id = ?', c.id, qid);
    if (!assigned) throw notFound('This question is not part of your assessment.');
    const iso = new Date().toISOString();
    // The save also moves the clock forward (see saveDecision).
    await ctx.db.run('UPDATE attempts SET remaining_seconds = ?, last_heartbeat_at = ? WHERE candidate_id = ? AND submitted_at IS NULL', decision.remaining, decision.lastIso, c.id);
    const row = await ctx.db.first<{ revision: number; saved_at: string }>(
      `INSERT INTO answers (candidate_id, question_id, language, answer_text, word_count, revision, saved_at) VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT (candidate_id, question_id) DO UPDATE SET answer_text = excluded.answer_text, language = excluded.language,
         word_count = excluded.word_count, revision = answers.revision + 1, saved_at = excluded.saved_at
       RETURNING revision, saved_at`,
      c.id, qid, language, text, words, iso
    );
    return json({ ok: true, savedAt: row?.saved_at ?? iso, revision: row?.revision ?? 1 });
  });

  r.add('POST', '/api/candidate/heartbeat', 'candidate', async (ctx) => {
    const { candidate: c, attempt: a } = ctx.candidate!;
    const s = await getSettings(ctx.env, ctx.db);
    if (!a.started_at || a.submitted_at) return json({ remainingSeconds: 0, submitted: !!a.submitted_at, serverTime: new Date().toISOString() });
    const remaining = remainingNow(a, s);
    const iso = new Date().toISOString();
    if (remaining <= 0) {
      const dl = deadlineMs(a, s);
      const reason: SubmitReason = dl != null && Date.now() >= dl ? 'deadline' : 'time_up';
      await ctx.db.batch([
        ctx.db.stmt('UPDATE attempts SET remaining_seconds = 0, last_heartbeat_at = ? WHERE candidate_id = ?', iso, c.id),
        ...submitStatements(ctx.db, c.id, a.attempt_no, reason),
      ]);
      await track(ctx.db, 'candidate_submit');
      return json({ remainingSeconds: 0, submitted: true, serverTime: iso });
    }
    await ctx.db.run('UPDATE attempts SET remaining_seconds = ?, last_heartbeat_at = ? WHERE candidate_id = ? AND submitted_at IS NULL', remaining, iso, c.id);
    return json({ remainingSeconds: remaining, submitted: false, serverTime: iso });
  });

  // Proctoring and connection events from the browser (signals for the hiring team).
  r.add('POST', '/api/candidate/events', 'candidate', async (ctx) => {
    const { candidate: c, attempt: a } = ctx.candidate!;
    await enforce(ctx.db, `cand-ev:${c.id}`, 600, 3600, 'Too many events.');
    const body = await readJson(ctx.request, 4096);
    const type = oneOf(body, 'type', [
      'tab_hidden', 'window_blur', 'fullscreen_exit', 'returned', 'offline', 'online', 'reconnect_retry',
      'paste_blocked', 'copy_blocked', 'save_failed', 'device_unsupported', 'signal_weak', 'rules_viewed',
    ] as const)!;
    const d = (body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail) ? body.detail : {}) as Record<string, unknown>;
    const detail: Record<string, unknown> = {};
    for (const k of ['seconds', 'retries', 'questionIndex', 'rttMs', 'chars', 'reason']) {
      const v = d[k];
      if (typeof v === 'number' && Number.isFinite(v)) detail[k] = Math.max(0, Math.min(Math.round(v), 86_400));
      else if (typeof v === 'string') detail[k] = v.slice(0, 60);
    }
    const stmts = [eventStmt(ctx.db, c.id, a.attempt_no, type, Object.keys(detail).length ? detail : null)];
    if (a.started_at && !a.submitted_at) {
      if (type === 'tab_hidden' || type === 'window_blur' || type === 'fullscreen_exit') {
        stmts.push(ctx.db.stmt('UPDATE attempts SET tab_switch_count = tab_switch_count + 1 WHERE candidate_id = ?', c.id));
      } else if (type === 'offline') {
        stmts.push(ctx.db.stmt('UPDATE attempts SET offline_count = offline_count + 1 WHERE candidate_id = ?', c.id));
      } else if (type === 'online' && typeof detail.seconds === 'number') {
        stmts.push(ctx.db.stmt('UPDATE attempts SET offline_seconds = offline_seconds + ? WHERE candidate_id = ?', Math.min(Number(detail.seconds), 7200), c.id));
      } else if (type === 'paste_blocked' || type === 'copy_blocked') {
        stmts.push(ctx.db.stmt('UPDATE attempts SET paste_blocked_count = paste_blocked_count + 1 WHERE candidate_id = ?', c.id));
      }
    }
    await ctx.db.batch(stmts);
    return json({ ok: true });
  });

  r.add('POST', '/api/candidate/submit', 'candidate', async (ctx) => {
    const { candidate: c, attempt: a } = ctx.candidate!;
    const body = await readJson(ctx.request, 1024);
    const reason = (oneOf(body, 'reason', ['candidate', 'left_screen', 'reload', 'time_up'] as const, { optional: true }) ?? 'candidate') as SubmitReason;
    if (!a.started_at) throw conflict('The assessment has not started yet.', 'not_started');
    if (!a.submitted_at) {
      const s = await getSettings(ctx.env, ctx.db);
      const left = remainingNow(a, s);
      await ctx.db.batch([
        ctx.db.stmt('UPDATE attempts SET remaining_seconds = ? WHERE candidate_id = ?', left, c.id),
        ...submitStatements(ctx.db, c.id, a.attempt_no, reason, { remainingSeconds: left }),
      ]);
      await track(ctx.db, 'candidate_submit');
    }
    return json({ ok: true });
  });
}
