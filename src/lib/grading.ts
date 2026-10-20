import type { Env, QuestionCategory } from '../env';
import type { Db } from '../db/db';
import { gradeWrittenAnswer } from './openai';

/**
 * Grade every question on one candidate's paper with the AI grader (rubric,
 * expected output and marking checkpoints; logic over language). Questions are
 * graded concurrently. Totals are written back to the candidate row so the
 * dashboard never has to re-aggregate answers.
 */
export async function gradeCandidate(env: Env, db: Db, candidateId: string): Promise<{ awarded: number; max: number }> {
  const items = await db.all<{
    question_id: string; category: QuestionCategory; prompt: string; sample_data: string | null; reference_answer: string | null;
    expected_output: string | null; rubric: string | null; checkpoints: string | null; marks: number; answer_text: string | null;
  }>(
    `SELECT q.id AS question_id, q.category, q.prompt, q.sample_data, q.reference_answer, q.expected_output, q.rubric, q.checkpoints,
            q.marks, a.answer_text
     FROM assignments s JOIN questions q ON q.id = s.question_id
     LEFT JOIN answers a ON a.candidate_id = s.candidate_id AND a.question_id = s.question_id
     WHERE s.candidate_id = ? ORDER BY s.position`,
    candidateId
  );
  const results = await Promise.all(
    items.map(async (q) => {
      const text = (q.answer_text ?? '').trim();
      const g = text
        ? await gradeWrittenAnswer(env, {
            kind: q.category,
            prompt: q.prompt,
            referenceAnswer: q.reference_answer,
            sampleData: q.sample_data,
            expectedOutput: q.expected_output,
            rubric: q.rubric,
            checkpoints: q.checkpoints,
            maxMarks: q.marks,
            answerText: text,
          })
        : { score: 0, reasoning: 'No answer was submitted for this question.', deductions: [{ reason: 'No answer', marks: q.marks }] };
      return { q, g };
    })
  );
  const iso = new Date().toISOString();
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const stmts = results.map(({ q, g }) =>
    db.stmt(
      `INSERT INTO answers (candidate_id, question_id, answer_text, word_count, score, max_marks, reasoning, deductions, graded_at, grader)
       VALUES (?, ?, '', 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (candidate_id, question_id) DO UPDATE SET score = excluded.score, max_marks = excluded.max_marks,
         reasoning = excluded.reasoning, deductions = excluded.deductions, graded_at = excluded.graded_at, grader = excluded.grader`,
      candidateId, q.question_id, g.score, q.marks, g.reasoning, JSON.stringify(g.deductions ?? []), iso, model
    )
  );
  const awarded = results.reduce((n, r) => n + Number(r.g.score || 0), 0);
  const max = results.reduce((n, r) => n + Number(r.q.marks || 0), 0);
  stmts.push(db.stmt('UPDATE candidates SET score_awarded = ?, score_max = ?, graded_at = ?, updated_at = ? WHERE id = ?', awarded, max, iso, iso, candidateId));
  await db.batch(stmts);
  return { awarded, max };
}

/** Run `fn` over items with at most `limit` in flight, preserving order. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
