import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import m1 from '../migrations/0001_init.sql?raw';
import m2 from '../migrations/0002_written_answers.sql?raw';
import m3 from '../migrations/0003_expected_output.sql?raw';
import m4 from '../migrations/0004_audit_and_login.sql?raw';
import m5 from '../migrations/0005_college.sql?raw';
import m6 from '../migrations/0006_settings.sql?raw';
import m7 from '../migrations/0007_admin_users.sql?raw';
import m8 from '../migrations/0008_part3.sql?raw';
import m9 from '../migrations/0009_part2_ai_pct.sql?raw';
import m10 from '../migrations/0010_expand_categories.sql?raw';
import m11 from '../migrations/0011_interview_answer.sql?raw';
import m12 from '../migrations/0012_question_hint.sql?raw';
import m13 from '../migrations/0013_question_soft_delete.sql?raw';
import m14 from '../migrations/0014_question_checkpoints.sql?raw';
import m15 from '../migrations/0015_perf.sql?raw';
import { resetEnsureCache } from '../src/lib/db';

/** Apply the real migration files, in order, to the test D1. */
export async function migrate() {
  // Storage is reset between tests, so the once-per-instance schema cache must be too.
  resetEnsureCache();
  for (const sql of [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15]) {
    // Strip both full-line and inline "-- ..." comments before splitting on ';'
    // (some inline comments contain semicolons, which would break naive splitting).
    const clean = sql
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    for (const stmt of clean.split(';').map((s) => s.trim()).filter(Boolean)) {
      // PRAGMA foreign_keys toggles aren't needed in the test D1 (tables are empty
      // during migration) and miniflare's D1 rejects them — skip them.
      if (/^PRAGMA\s/i.test(stmt)) continue;
      await env.DB.prepare(stmt).run();
    }
  }
}

/** Drive the actual Worker with a Request and return the Response. */
export async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const request = new Request('https://test.local' + path, init);
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function cookieFrom(res: Response): string {
  const set = res.headers.get('Set-Cookie') || '';
  return set.split(';')[0]; // "name=value"
}

/** Log in as admin, return the Cookie header value to reuse. */
export async function adminCookie(): Promise<string> {
  const res = await req('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.local', password: 'test-admin-pass' }),
  });
  if (res.status !== 200) throw new Error('admin login failed: ' + res.status);
  return cookieFrom(res);
}

/** Log in as a panel member (limited role), return the Cookie header value. */
export async function panelCookie(): Promise<string> {
  const res = await req('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'panel@test.local', password: 'test-panel-pass' }),
  });
  if (res.status !== 200) throw new Error('panel login failed: ' + res.status);
  return cookieFrom(res);
}

/** Log in as a candidate by email, return the Cookie header value. */
export async function candidateCookie(email: string): Promise<{ cookie: string; res: Response }> {
  const res = await req('/api/candidate/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return { cookie: cookieFrom(res), res };
}

/** Seed an active question bank across all four sections (enough for a per-student
 *  set of 2 SQL + 1 Python + 1 DSA + 1 Scenario, with spare for weighted spread). */
export async function seedQuestions() {
  const rows: [string, string, string, string, string, string, string, number][] = [
    ['qb-sql-1', 'sql', 'Table: orders. Total per customer.', 'SELECT customer_id, SUM(amount) FROM orders GROUP BY customer_id', 'Table: orders\n| id | amount |', '| customer_id | sum |\n| 1 | 100 |', 'Groups correctly', 3],
    ['qb-sql-2', 'sql', 'Table: students. Marks > 80.', 'SELECT name FROM students WHERE marks > 80', 'Table: students', '| name |\n| A |', 'Filters correctly', 3],
    ['qb-sql-3', 'sql', 'Table: employees. Above avg salary.', 'SELECT name FROM employees WHERE salary > (SELECT AVG(salary) FROM employees)', 'Table: employees', '| name |\n| B |', 'Subquery correct', 3],
    ['qb-py-1', 'python', 'Remove duplicates keeping order.', 'def f(x): ...', '', '[1, 2, 3]', 'Preserves order', 4],
    ['qb-py-2', 'python', 'Count words in a string.', 'def f(s): return len(s.split())', '', '6', 'Correct count', 4],
    ['qb-dsa-1', 'dsa', 'Two Sum: indices adding to target.', 'def f(a,t): ...', '', '[0, 1]', 'Correct indices', 5],
    ['qb-dsa-2', 'dsa', 'Valid parentheses.', 'def f(s): ...', '', 'True', 'Stack logic', 5],
    ['qb-scn-1', 'scenario', 'Best day to buy and sell a share.', 'def f(p): ...', '', '5', 'Min-so-far logic', 5],
    ['qb-scn-2', 'scenario', 'Minimum railway platforms.', 'def f(a,d): ...', '', '3', 'Two-pointer sweep', 5],
  ];
  const stmt = env.DB.prepare(
    `INSERT INTO question_bank (id, category, prompt, reference_answer, sample_data, expected_output, rubric, marks, difficulty, status, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'medium', 'active', 1)`
  );
  await env.DB.batch(rows.map((r) => stmt.bind(...r)));
}

/** Insert a candidate ready to take the test. */
export async function seedCandidate(id: string, email: string, status = 'part2_ready', college: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO candidates (id, email, name, resume_r2_key, resume_filename, status, college)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, email, 'Test User', `resumes/${id}.pdf`, 'resume.pdf', status, college)
    .run();
}

/** Seed two Part 2 questions for a candidate. */
export async function seedPart2(candidateId: string) {
  const stmt = env.DB.prepare(
    `INSERT INTO part2_questions (id, candidate_id, position, prompt, based_on_skill, rubric, marks)
     VALUES (?, ?, ?, ?, ?, ?, 5)`
  );
  await env.DB.batch([
    stmt.bind('p2-1', candidateId, 0, 'Scenario about your project.', 'Python', '{"strong_answer_looks_like":"x","weak_answer_looks_like":"y"}'),
    stmt.bind('p2-2', candidateId, 1, 'Scenario about SQL tuning.', 'SQL', '{"strong_answer_looks_like":"x","weak_answer_looks_like":"y"}'),
  ]);
}

/** Build a fake OpenAI chat-completions JSON body. */
export function openAiReply(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}
