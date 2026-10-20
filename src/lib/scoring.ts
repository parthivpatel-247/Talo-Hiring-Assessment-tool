import type { Env } from '../types';

/**
 * Marks-based summaries, admin-only. Part 1 and Part 2 are both AI-graded with
 * partial credit; these sum the awarded marks against the max.
 */

export async function part1Summary(env: Env, candidateId: string) {
  const rows = await env.DB.prepare(
    'SELECT ai_score, max_marks, scored_at FROM part1_answers WHERE candidate_id = ?'
  )
    .bind(candidateId)
    .all<{ ai_score: number | null; max_marks: number | null; scored_at: string | null }>();
  const answers = rows.results ?? [];
  const scored = answers.filter((a) => a.scored_at);
  const awarded = scored.reduce((s, a) => s + (a.ai_score ?? 0), 0);
  const max = answers.reduce((s, a) => s + (a.max_marks ?? 0), 0);
  return { awarded, max, graded: scored.length, total: answers.length };
}

export async function part2Summary(env: Env, candidateId: string) {
  const rows = await env.DB.prepare(
    'SELECT ai_score, max_marks, scored_at FROM part2_answers WHERE candidate_id = ?'
  )
    .bind(candidateId)
    .all<{ ai_score: number | null; max_marks: number | null; scored_at: string | null }>();
  const answers = rows.results ?? [];
  const scored = answers.filter((a) => a.scored_at);
  const awarded = scored.reduce((s, a) => s + (a.ai_score ?? 0), 0);
  const max = answers.reduce((s, a) => s + (a.max_marks ?? 0), 0);
  return { awarded, max, graded: scored.length, total: answers.length };
}

export async function part3Summary(env: Env, candidateId: string) {
  // part3_answers may not exist yet on a DB where migration 0008 / self-heal
  // hasn't run — tolerate that and report an empty summary.
  try {
    const rows = await env.DB.prepare(
      'SELECT ai_score, max_marks, scored_at FROM part3_answers WHERE candidate_id = ?'
    )
      .bind(candidateId)
      .all<{ ai_score: number | null; max_marks: number | null; scored_at: string | null }>();
    const answers = rows.results ?? [];
    const scored = answers.filter((a) => a.scored_at);
    const awarded = scored.reduce((s, a) => s + (a.ai_score ?? 0), 0);
    const max = answers.reduce((s, a) => s + (a.max_marks ?? 0), 0);
    return { awarded, max, graded: scored.length, total: answers.length };
  } catch {
    return { awarded: 0, max: 0, graded: 0, total: 0 };
  }
}

/* ------------------------------------------------------------------ *
 * Cohort-wide summaries — ONE aggregate query per answer table instead
 * of four queries per candidate. The dashboard "Refresh" used to fire
 * 4×N sequential queries (≈400 round-trips for 100 students); this turns
 * it into a handful of GROUP BY queries run in parallel, so refresh stays
 * fast no matter how large the cohort grows.
 * ------------------------------------------------------------------ */

export type Summary = { awarded: number; max: number; graded: number; total: number };

/** Aggregate one answer table into a candidate_id → Summary map in a single query. */
async function aggregateTable(env: Env, table: 'part1_answers' | 'part2_answers' | 'part3_answers'): Promise<Map<string, Summary>> {
  const map = new Map<string, Summary>();
  try {
    const rows = await env.DB.prepare(
      `SELECT candidate_id AS cid,
         COALESCE(SUM(CASE WHEN scored_at IS NOT NULL THEN ai_score ELSE 0 END), 0) AS awarded,
         COALESCE(SUM(max_marks), 0) AS max,
         SUM(CASE WHEN scored_at IS NOT NULL THEN 1 ELSE 0 END) AS graded,
         COUNT(*) AS total
       FROM ${table}
       GROUP BY candidate_id`
    ).all<{ cid: string; awarded: number; max: number; graded: number; total: number }>();
    for (const r of rows.results ?? []) {
      map.set(r.cid, {
        awarded: Number(r.awarded) || 0,
        max: Number(r.max) || 0,
        graded: Number(r.graded) || 0,
        total: Number(r.total) || 0,
      });
    }
  } catch {
    // table may not exist yet (e.g. part3 before self-heal) — leave the map empty
  }
  return map;
}

/** All per-candidate login counts in one query. */
async function loginCounts(env: Env): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const rows = await env.DB.prepare('SELECT candidate_id AS cid, login_count FROM attempts').all<{ cid: string; login_count: number }>();
    for (const r of rows.results ?? []) map.set(r.cid, Number(r.login_count) || 0);
  } catch { /* best effort */ }
  return map;
}

/** Everything the candidates dashboard needs, computed cohort-wide in parallel. */
export async function cohortSummaries(env: Env) {
  const [p1, p2, p3, logins] = await Promise.all([
    aggregateTable(env, 'part1_answers'),
    aggregateTable(env, 'part2_answers'),
    aggregateTable(env, 'part3_answers'),
    loginCounts(env),
  ]);
  return { p1, p2, p3, logins };
}

export const EMPTY_SUMMARY: Summary = { awarded: 0, max: 0, graded: 0, total: 0 };
