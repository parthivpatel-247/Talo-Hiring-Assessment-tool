import type { Env } from '../types';
import { ensureRequiredCol } from './db';

/**
 * Support site: how many questions of each type every candidate gets.
 *
 * A manager sets these in admin (Assessment length); until then the values come from
 * wrangler.toml (SQL_QUESTIONS_PER_STUDENT and friends). Stored in `settings` as
 * support_q_<category>. Like the writers site, a change applies to candidates who
 * start after it is saved.
 */
export const SUPPORT_CATEGORIES = ['sql', 'python', 'dsa', 'scenario'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export type SupportCounts = Record<SupportCategory, number>;

export const SUPPORT_LIMITS = { maxPerCategory: 20, maxTotal: 40 };

const ENV_KEYS: Record<SupportCategory, keyof Env> = {
  sql: 'SQL_QUESTIONS_PER_STUDENT',
  python: 'PYTHON_QUESTIONS_PER_STUDENT',
  dsa: 'DSA_QUESTIONS_PER_STUDENT',
  scenario: 'SCENARIO_QUESTIONS_PER_STUDENT',
};

const settingKey = (c: SupportCategory) => `support_q_${c}`;

function clampCount(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(SUPPORT_LIMITS.maxPerCategory, Math.round(n));
}

export function envSupportCounts(env: Env): SupportCounts {
  const out = {} as SupportCounts;
  for (const c of SUPPORT_CATEGORIES) out[c] = clampCount(env[ENV_KEYS[c]], 0);
  return out;
}

/** Questions per candidate for each type: admin setting first, then wrangler.toml. */
export async function getSupportCounts(env: Env): Promise<SupportCounts> {
  const out = envSupportCounts(env);
  try {
    const rows = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN (${SUPPORT_CATEGORIES.map(() => '?').join(',')})`
    ).bind(...SUPPORT_CATEGORIES.map(settingKey)).all<{ key: string; value: string }>();
    for (const r of rows.results ?? []) {
      const c = r.key.replace('support_q_', '') as SupportCategory;
      if (SUPPORT_CATEGORIES.includes(c) && String(r.value).trim() !== '') out[c] = clampCount(r.value, out[c]);
    }
  } catch { /* settings table missing: use wrangler.toml */ }
  return out;
}

export async function saveSupportCounts(env: Env, counts: SupportCounts): Promise<void> {
  const stmt = env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  await env.DB.batch(SUPPORT_CATEGORIES.map((c) => stmt.bind(settingKey(c), String(counts[c]))));
}

/** Active questions of each type in the bank, and how many of them every candidate gets. */
export async function supportPoolCounts(env: Env): Promise<{ active: SupportCounts; required: SupportCounts }> {
  const active = { sql: 0, python: 0, dsa: 0, scenario: 0 } as SupportCounts;
  const required = { sql: 0, python: 0, dsa: 0, scenario: 0 } as SupportCounts;
  try {
    await ensureRequiredCol(env);
    const rows = await env.DB.prepare(
      `SELECT category, COUNT(*) AS n, SUM(CASE WHEN required = 1 THEN 1 ELSE 0 END) AS r
         FROM question_bank WHERE active = 1 AND deleted_at IS NULL GROUP BY category`
    ).all<{ category: string; n: number; r: number }>();
    for (const row of rows.results ?? []) {
      if ((SUPPORT_CATEGORIES as readonly string[]).includes(row.category)) {
        active[row.category as SupportCategory] = Number(row.n) || 0;
        required[row.category as SupportCategory] = Number(row.r) || 0;
      }
    }
  } catch { /* bank not created yet */ }
  return { active, required };
}

export function totalQuestions(c: SupportCounts): number {
  return SUPPORT_CATEGORIES.reduce((s, k) => s + c[k], 0);
}
