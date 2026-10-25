import type { Env } from '../types';

/**
 * Which hiring team this deployment serves.
 *
 * Talo is deployed once per team, from the same code (see wrangler.toml):
 *   - `talo`      → support hiring (TEAM unset or "support"): the original single-part test.
 *   - `talo-docs` → documentation / writers hiring (TEAM = "docs"): a two-part writing test.
 * Each deployment has its own D1 database, R2 bucket, admin accounts and URL, so the
 * teams' data never meets. Everything in this file only matters on the writers site;
 * the support site never takes a docs code path.
 */
export function isDocs(env: Env): boolean {
  return (env.TEAM || '').trim().toLowerCase() === 'docs';
}

export type DocsPart = 'part1' | 'part2';

export interface DocsPartConfig {
  questions: number; // questions each candidate gets in this part
  minutes: number; // this part's clock
  marks: number; // default marks for a new question in this part
}
export interface DocsConfig {
  part1: DocsPartConfig;
  part2: DocsPartConfig;
  wordLimit: number; // default word limit when a question doesn't set its own
}

export const DOCS_LIMITS = {
  minMinutes: 5,
  maxMinutes: 240,
  minQuestions: 1,
  maxQuestions: 40,
  minWords: 50,
  maxWords: 3000,
};

const DEFAULTS = {
  part1: { questions: 4, minutes: 30, marks: 5 },
  part2: { questions: 2, minutes: 45, marks: 10 },
  wordLimit: 1000,
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Settings keys the manager can change from Admin → Resumes → Assessment length. */
export const DOCS_SETTING_KEYS = ['part1_questions', 'part1_minutes', 'part2_questions', 'part2_minutes'] as const;

/**
 * The writers' test shape. Precedence for each value:
 *   1. what the manager saved in admin (settings table)
 *   2. the wrangler.toml var for the docs environment
 *   3. the built-in default (Part 1: 4 questions / 30 min, Part 2: 2 questions / 45 min)
 */
export async function getDocsConfig(env: Env): Promise<DocsConfig> {
  const saved = new Map<string, string>();
  try {
    const rows = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN (${DOCS_SETTING_KEYS.map(() => '?').join(',')})`
    )
      .bind(...DOCS_SETTING_KEYS)
      .all<{ key: string; value: string }>();
    for (const r of rows.results ?? []) saved.set(r.key, r.value);
  } catch { /* settings table missing — fall back to config */ }

  const L = DOCS_LIMITS;
  const part = (p: DocsPart, envQ: string | undefined, envMin: string | undefined, envMarks: string | undefined): DocsPartConfig => ({
    questions: clamp(num(saved.get(`${p}_questions`), num(envQ, DEFAULTS[p].questions)), L.minQuestions, L.maxQuestions),
    minutes: clamp(num(saved.get(`${p}_minutes`), num(envMin, DEFAULTS[p].minutes)), L.minMinutes, L.maxMinutes),
    marks: num(envMarks, DEFAULTS[p].marks),
  });
  return {
    part1: part('part1', env.DOCS_PART1_QUESTIONS, env.PART1_DURATION_MINUTES, env.DOCS_PART1_MARKS),
    part2: part('part2', env.DOCS_PART2_QUESTIONS, env.PART2_DURATION_MINUTES, env.DOCS_PART2_MARKS),
    wordLimit: clamp(num(env.DOCS_WORD_LIMIT, DEFAULTS.wordLimit), L.minWords, L.maxWords),
  };
}

/** Active (not disabled, not deleted) questions in each part of the bank. */
export async function docsPoolCounts(env: Env): Promise<{ part1: number; part2: number }> {
  const out = { part1: 0, part2: 0 };
  try {
    const rows = await env.DB.prepare(
      "SELECT category, COUNT(*) AS n FROM question_bank WHERE active = 1 AND deleted_at IS NULL AND category IN ('part1','part2') GROUP BY category"
    ).all<{ category: DocsPart; n: number }>();
    for (const r of rows.results ?? []) out[r.category] = Number(r.n) || 0;
  } catch { /* bank not ready */ }
  return out;
}

/** Thrown when a part's bank has fewer active questions than each candidate needs. */
export class DocsPoolTooSmall extends Error {
  constructor(public part: DocsPart, public need: number, public have: number) {
    super(`The ${part === 'part1' ? 'Part 1' : 'Part 2'} question bank has ${have} active question(s); each candidate needs ${need}.`);
  }
}

export function partLabel(p: DocsPart): string {
  return p === 'part1' ? 'Part 1' : 'Part 2';
}
