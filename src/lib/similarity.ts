import type { Db } from '../db/db';

/**
 * Post-drive answer-similarity check. For every question, compare each pair of
 * candidates who answered it using Jaccard similarity over 4-token shingles of
 * the normalised answer. Pairs at or above the threshold (with enough content
 * to be meaningful) are stored as flags for a human to review. A flag is a
 * reason to look, never a verdict.
 */
export const SIMILARITY_THRESHOLD = 0.8;
const MIN_TOKENS = 25;
const SHINGLE = 4;

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\/\/.*$|#.*$/gm, ' ') // drop line comments
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

export function shingles(toks: string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + SHINGLE <= toks.length; i++) s.add(toks.slice(i, i + SHINGLE).join(' '));
  return s;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function computeSimilarity(db: Db): Promise<{ questions: number; pairs: number; flagged: number }> {
  const rows = await db.all<{ question_id: string; candidate_id: string; answer_text: string }>(
    `SELECT a.question_id, a.candidate_id, a.answer_text FROM answers a
     JOIN candidates c ON c.id = a.candidate_id
     WHERE c.status IN ('submitted', 'grading', 'graded', 'shortlisted', 'rejected') AND c.is_test = 0 AND length(a.answer_text) > 80`
  );
  const byQ = new Map<string, { cid: string; sh: Set<string> }[]>();
  for (const r of rows) {
    const t = tokens(r.answer_text);
    if (t.length < MIN_TOKENS) continue;
    const list = byQ.get(r.question_id) ?? [];
    list.push({ cid: r.candidate_id, sh: shingles(t) });
    byQ.set(r.question_id, list);
  }
  let pairs = 0;
  const flags: { q: string; a: string; b: string; score: number }[] = [];
  for (const [q, list] of byQ) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        pairs++;
        const score = jaccard(list[i].sh, list[j].sh);
        if (score >= SIMILARITY_THRESHOLD) {
          const [a, b] = [list[i].cid, list[j].cid].sort();
          flags.push({ q, a, b, score: Math.round(score * 1000) / 1000 });
        }
      }
    }
  }
  const stmts = [db.stmt('DELETE FROM similarity_flags')];
  for (const f of flags) {
    stmts.push(db.stmt('INSERT OR REPLACE INTO similarity_flags (question_id, candidate_a, candidate_b, score) VALUES (?, ?, ?, ?)', f.q, f.a, f.b, f.score));
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return { questions: byQ.size, pairs, flagged: flags.length };
}
