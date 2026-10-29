import type { Env } from '../types';
import { ensureRequiredCol } from './db';
import { isDocs, getDocsConfig, partLabel, type DocsPart } from './team';
import { getSupportCounts, SUPPORT_CATEGORIES, type SupportCategory } from './supportconfig';

/**
 * "Every candidate" questions (both sites) are always in a candidate's set, so a
 * category can't pin more questions than each candidate gets of it: the next
 * candidate to start would be refused. Assessment length enforces this when the
 * counts change; this is the same rule when one question is pinned, enabled,
 * restored or moved to another part.
 *
 * Returns an error message, or null when the question may be pinned and active in
 * `category` (questionId is left out of the current count).
 */
export async function pinnedLimitError(env: Env, category: string, questionId: string | null): Promise<string | null> {
  let limit: number | null = null;
  let label = category.toUpperCase();
  if (isDocs(env)) {
    if (category === 'part1' || category === 'part2') {
      limit = (await getDocsConfig(env))[category as DocsPart].questions;
      label = partLabel(category as DocsPart);
    }
  } else if ((SUPPORT_CATEGORIES as readonly string[]).includes(category)) {
    limit = (await getSupportCounts(env))[category as SupportCategory];
  }
  if (limit == null) return null;
  await ensureRequiredCol(env);
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM question_bank WHERE category = ? AND required = 1 AND active = 1 AND deleted_at IS NULL AND id != ?'
  ).bind(category, questionId ?? '').first<{ n: number }>();
  const pinned = Number(row?.n) || 0;
  if (pinned + 1 <= limit) return null;
  return `${label} already has ${pinned} question${pinned === 1 ? '' : 's'} every candidate gets, and each candidate gets only ${limit}. Raise the count in Assessment length first, or untick another question.`;
}
