import type { Db } from './db';
import seed from '../data/question-seed.json';

/**
 * Bundled question bank (reviewed SQL, coding, DSA and scenario questions; see
 * scripts/build-question-seed.py). Bump SEED_VERSION
 * whenever question-seed.json gains questions; the Worker then inserts the new
 * ones on its next start. INSERT OR IGNORE means existing questions (and admin
 * edits to them) are never overwritten, and deleted ones are not resurrected.
 */
export const SEED_VERSION = 2;

interface SeedQuestion {
  id: string;
  category: string;
  difficulty: string;
  marks: number;
  title: string | null;
  topic: string | null;
  prompt: string;
  sample_data: string | null;
  expected_output: string | null;
  reference_answer: string | null;
  hint: string | null;
  rubric: string | null;
  checkpoints: string | null;
  source: string | null;
}

export const SEED_QUESTIONS = seed as SeedQuestion[];

export async function seedQuestionBank(db: Db): Promise<number> {
  const current = Number((await db.value<string>("SELECT value FROM settings WHERE key = 'question_seed_version'")) ?? 0);
  if (current >= SEED_VERSION) return 0;
  const stmts = SEED_QUESTIONS.map((q) =>
    db.stmt(
      `INSERT OR IGNORE INTO questions (id, category, title, topic, difficulty, prompt, sample_data, hint, reference_answer,
         expected_output, rubric, checkpoints, marks, source, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      q.id, q.category, q.title, q.topic, q.difficulty, q.prompt, q.sample_data, q.hint, q.reference_answer,
      q.expected_output, q.rubric, q.checkpoints, q.marks, q.source
    )
  );
  let inserted = 0;
  for (let i = 0; i < stmts.length; i += 40) {
    const res = await db.batch(stmts.slice(i, i + 40));
    inserted += res.reduce((n, r) => n + Number(r.meta?.changes ?? 0), 0);
  }
  await db.run(
    `INSERT INTO settings (key, value, updated_by) VALUES ('question_seed_version', ?, 'system')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    String(SEED_VERSION)
  );
  return inserted;
}
