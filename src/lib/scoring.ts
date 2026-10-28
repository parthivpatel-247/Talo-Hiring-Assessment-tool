import type { Env } from '../types';

/**
 * Marks-based summaries, admin-only. Part 1 and Part 2 are both AI-graded with
 * partial credit; these sum the awarded marks against the max.
 */

/**
 * The marks an answer counts for: a manager's manual mark when there is one, else the
 * AI's. An answer counts as graded once either exists.
 */
export const EFFECTIVE_SCORE_SQL = 'COALESCE(manual_score, ai_score)';
const GRADED_SQL = '(scored_at IS NOT NULL OR manual_score IS NOT NULL)';

async function summaryFor(env: Env, table: 'part1_answers' | 'part2_answers' | 'part3_answers', candidateId: string): Promise<Summary> {
  try {
    const r = await env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN ${GRADED_SQL} THEN ${EFFECTIVE_SCORE_SQL} ELSE 0 END), 0) AS awarded,
              COALESCE(SUM(CASE WHEN ${GRADED_SQL} THEN max_marks ELSE 0 END), 0) AS max,
              SUM(CASE WHEN ${GRADED_SQL} THEN 1 ELSE 0 END) AS graded,
              COUNT(*) AS total
         FROM ${table} WHERE candidate_id = ?`
    ).bind(candidateId).first<{ awarded: number; max: number; graded: number | null; total: number }>();
    // max_marks is only meaningful once graded (an unsaved-grade row holds the column default).
    return { awarded: Number(r?.awarded) || 0, max: Number(r?.max) || 0, graded: Number(r?.graded) || 0, total: Number(r?.total) || 0 };
  } catch {
    // part3_answers may not exist yet on a DB where migration 0008 / self-heal hasn't run.
    return { awarded: 0, max: 0, graded: 0, total: 0 };
  }
}

export async function part1Summary(env: Env, candidateId: string) { return summaryFor(env, 'part1_answers', candidateId); }
export async function part2Summary(env: Env, candidateId: string) { return summaryFor(env, 'part2_answers', candidateId); }
export async function part3Summary(env: Env, candidateId: string) { return summaryFor(env, 'part3_answers', candidateId); }

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
         COALESCE(SUM(CASE WHEN ${GRADED_SQL} THEN ${EFFECTIVE_SCORE_SQL} ELSE 0 END), 0) AS awarded,
         COALESCE(SUM(CASE WHEN ${GRADED_SQL} THEN max_marks ELSE 0 END), 0) AS max,
         SUM(CASE WHEN ${GRADED_SQL} THEN 1 ELSE 0 END) AS graded,
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

/** Times a candidate left the test (tab switch / window switch / full-screen exit), per part. */
export type TabSwitches = { part1: number; part2: number; part3: number };

/** All per-candidate login counts and tab-switch counts in one query. */
async function attemptStats(env: Env): Promise<{ logins: Map<string, number>; tabs: Map<string, TabSwitches> }> {
  const logins = new Map<string, number>();
  const tabs = new Map<string, TabSwitches>();
  try {
    // SELECT * because the writers database has no Part 3 columns.
    const rows = await env.DB.prepare('SELECT * FROM attempts').all<Record<string, unknown>>();
    for (const r of rows.results ?? []) {
      const cid = String(r.candidate_id);
      logins.set(cid, Number(r.login_count) || 0);
      tabs.set(cid, {
        part1: Number(r.part1_tab_switch_count) || 0,
        part2: Number(r.part2_tab_switch_count) || 0,
        part3: Number(r.part3_tab_switch_count) || 0,
      });
    }
  } catch { /* best effort */ }
  return { logins, tabs };
}

/** Everything the candidates dashboard needs, computed cohort-wide in parallel. */
export async function cohortSummaries(env: Env) {
  const [p1, p2, p3, stats] = await Promise.all([
    aggregateTable(env, 'part1_answers'),
    aggregateTable(env, 'part2_answers'),
    aggregateTable(env, 'part3_answers'),
    attemptStats(env),
  ]);
  return { p1, p2, p3, logins: stats.logins, tabs: stats.tabs };
}

export const EMPTY_SUMMARY: Summary = { awarded: 0, max: 0, graded: 0, total: 0 };
