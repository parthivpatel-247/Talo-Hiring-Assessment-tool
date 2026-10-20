import type { Env } from '../types';
import { getAttempt, nowIso } from './db';

/**
 * Server-truth timer with pause-on-disconnect / resume-on-reconnect.
 *
 * Rather than a fixed wall-clock deadline (which would keep ticking while a
 * student is disconnected), each part stores a `remaining_seconds` snapshot
 * and a `last_heartbeat_at` timestamp. The client calls /heartbeat every
 * ~5 seconds while the test page is open. Each heartbeat:
 *   1. subtracts (now - last_heartbeat_at) from remaining_seconds, capped at
 *      a small grace window so a slow request can't silently burn extra time
 *   2. updates last_heartbeat_at to now
 * If the student disconnects, no heartbeats arrive, so remaining_seconds is
 * simply not decremented — the clock is "paused" — and resumes correctly
 * from wherever it left off on reconnect.
 */

const HEARTBEAT_GRACE_CAP_SECONDS = 15; // treat gaps longer than this as "was disconnected", not "lost time"

type Part = 'part1' | 'part2' | 'part3';

// The assessment length is customizable from the admin portal. If nothing has
// been set there, fall back to the env default, then to 60 minutes.
const DEFAULT_ASSESSMENT_MINUTES = 60;
const MIN_ASSESSMENT_MINUTES = 5;
const MAX_ASSESSMENT_MINUTES = 240;

/**
 * Configured assessment length in minutes. Precedence:
 *   1. admin-set value in settings (key 'assessment_minutes')
 *   2. env PART1_DURATION_MINUTES
 *   3. DEFAULT_ASSESSMENT_MINUTES (60)
 * Always clamped to a sane 5–240 min range.
 */
export async function getAssessmentMinutes(env: Env): Promise<number> {
  let minutes = Number(env.PART1_DURATION_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) minutes = DEFAULT_ASSESSMENT_MINUTES;
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'assessment_minutes'").first<{ value: string }>();
    if (row?.value != null && String(row.value).trim() !== '') {
      const n = Number(row.value);
      if (Number.isFinite(n) && n > 0) minutes = n;
    }
  } catch { /* settings table may not exist yet (pre-migration) */ }
  return Math.min(MAX_ASSESSMENT_MINUTES, Math.max(MIN_ASSESSMENT_MINUTES, Math.round(minutes)));
}

export async function durationSeconds(env: Env, part: Part): Promise<number> {
  if (part === 'part1') return (await getAssessmentMinutes(env)) * 60;
  const minutes = part === 'part2' ? Number(env.PART2_DURATION_MINUTES) : Number(env.PART3_DURATION_MINUTES ?? 15);
  return minutes * 60;
}

export async function startPart(env: Env, candidateId: string, part: Part) {
  const startedAtCol = `${part}_started_at`;
  const remainingCol = `${part}_remaining_seconds`;
  const heartbeatCol = `${part}_last_heartbeat_at`;
  const attempt = await getAttempt(env, candidateId);
  const alreadyStarted = attempt && (attempt as Record<string, unknown>)[startedAtCol];
  if (alreadyStarted) return; // idempotent — reconnect calls this too, don't reset the clock

  const now = nowIso();
  const seconds = await durationSeconds(env, part);
  await env.DB.prepare(
    `UPDATE attempts SET ${startedAtCol} = ?, ${remainingCol} = ?, ${heartbeatCol} = ? WHERE candidate_id = ?`
  )
    .bind(now, seconds, now, candidateId)
    .run();
}

/** Returns remaining seconds after applying elapsed time since the last heartbeat. Never goes below 0. */
export async function heartbeat(env: Env, candidateId: string, part: Part): Promise<number> {
  const remainingCol = `${part}_remaining_seconds`;
  const heartbeatCol = `${part}_last_heartbeat_at`;
  const submittedCol = `${part}_submitted_at`;

  const attempt = (await getAttempt(env, candidateId)) as Record<string, unknown> | null;
  if (!attempt || attempt[submittedCol]) return 0;

  const remaining = Number(attempt[remainingCol] ?? 0);
  const lastHeartbeat = attempt[heartbeatCol] ? new Date(String(attempt[heartbeatCol])).getTime() : Date.now();
  const elapsedSeconds = Math.max(0, (Date.now() - lastHeartbeat) / 1000);
  const cappedElapsed = Math.min(elapsedSeconds, HEARTBEAT_GRACE_CAP_SECONDS);
  const nextRemaining = Math.max(0, Math.round(remaining - cappedElapsed));

  await env.DB.prepare(`UPDATE attempts SET ${remainingCol} = ?, ${heartbeatCol} = ? WHERE candidate_id = ?`)
    .bind(nextRemaining, nowIso(), candidateId)
    .run();

  return nextRemaining;
}

export async function markSubmitted(env: Env, candidateId: string, part: Part) {
  const submittedCol = `${part}_submitted_at`;
  await env.DB.prepare(`UPDATE attempts SET ${submittedCol} = ? WHERE candidate_id = ?`)
    .bind(nowIso(), candidateId)
    .run();
}

export async function logTabSwitch(
  env: Env,
  candidateId: string,
  part: Part,
  type: string,
  meta?: { chars?: number; questionId?: string; typed?: number; pasted?: number; pastes?: number; ms?: number }
) {
  if (part === 'part1' || part === 'part3') {
    // Part 1 and Part 3 are locked down client-side; a switch getting through at
    // all is notable, so just count it for the admin to see.
    await env.DB.prepare(
      `UPDATE attempts SET ${part}_tab_switch_count = ${part}_tab_switch_count + 1 WHERE candidate_id = ?`
    )
      .bind(candidateId)
      .run();
    return;
  }
  // Part 2 explicitly allows leaving the tab to search — log every event,
  // never block, so the admin has a record without penalizing candidates
  // for doing exactly what the test permits. Paste events are logged here too
  // (with the pasted size + question) as a signal for grading, but they are NOT
  // tab switches, so they don't increment the tab-switch count.
  const attempt = (await getAttempt(env, candidateId)) as Record<string, unknown> | null;
  // Defensive: a corrupt/non-array log must never break logging — fall back to [].
  let log: unknown[] = [];
  try {
    const parsed = attempt?.part2_tab_switch_log ? JSON.parse(String(attempt.part2_tab_switch_log)) : [];
    if (Array.isArray(parsed)) log = parsed;
  } catch { log = []; }
  const entry: Record<string, unknown> = { at: nowIso(), type };
  if (meta?.chars != null) entry.chars = meta.chars;
  if (meta?.questionId) entry.questionId = meta.questionId;
  if (meta?.typed != null) entry.typed = meta.typed;
  if (meta?.pasted != null) entry.pasted = meta.pasted;
  if (meta?.pastes != null) entry.pastes = meta.pastes;
  if (meta?.ms != null) entry.ms = meta.ms;
  log.push(entry);
  // 'paste', 'paste_blocked' and 'metrics' are authenticity/behavioral signals,
  // not tab switches — they must not inflate the tab-switch count the admin sees.
  const countsAsSwitch = type !== 'paste' && type !== 'paste_blocked' && type !== 'metrics';
  await env.DB.prepare(
    `UPDATE attempts SET part2_tab_switch_count = part2_tab_switch_count + ${countsAsSwitch ? 1 : 0}, part2_tab_switch_log = ? WHERE candidate_id = ?`
  )
    .bind(JSON.stringify(log), candidateId)
    .run();
}
