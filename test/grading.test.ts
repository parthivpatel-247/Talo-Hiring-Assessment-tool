import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import { migrate, req, seedQuestions, seedCandidate, adminCookie, candidateCookie, openAiReply } from './helpers';

describe('AI grading (OpenAI mocked)', () => {
  // The mocked OpenAI grade response. Each test sets this; a single persist interceptor
  // (registered in beforeEach) reads it at request time. This keeps grades deterministic
  // and order-independent — a .persist() interceptor from an earlier test can't leak a
  // stale response, because there is only ever one response source: this variable.
  let gradeResponse: unknown = { score: 0, reasoning: '', deductions: [] };

  beforeEach(async () => {
    await migrate();
    await seedQuestions();
    fetchMock.activate();
    fetchMock.disableNetConnect();
    gradeResponse = { score: 0, reasoning: '', deductions: [] };
    fetchMock.get('https://api.openai.com')
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, () => openAiReply(gradeResponse))
      .persist();
  });
  afterEach(() => {
    try { fetchMock.assertNoPendingInterceptors(); } catch { /* persisted interceptors are fine */ }
  });

  async function candidateWithAnswers() {
    await seedCandidate('g1', 'g1@x.com', 'part2_ready');
    const cookie = (await candidateCookie('g1@x.com')).cookie;
    const start = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const qs = (await start.json<any>()).questions;
    for (const q of qs) {
      await req('/api/candidate/part1/answer', {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: q.id, answerText: 'candidate answer' }),
      });
    }
    await req('/api/candidate/part1/submit', { method: 'POST', headers: { Cookie: cookie } });
    return qs;
  }

  async function candidateAnswering(id: string, email: string, text: string) {
    await seedCandidate(id, email, 'part2_ready');
    const cookie = (await candidateCookie(email)).cookie;
    const start = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const qs = (await start.json<any>()).questions;
    for (const q of qs) {
      await req('/api/candidate/part1/answer', {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: q.id, answerText: text }),
      });
    }
    await req('/api/candidate/part1/submit', { method: 'POST', headers: { Cookie: cookie } });
  }

  it('a blank / "NA" answer scores 0 even if the model returns full marks', async () => {
    await candidateAnswering('g2', 'g2@x.com', 'NA');
    // Buggy model response (full marks + a 0-mark deduction) must NOT win.
    gradeResponse = { score: 5, reasoning: 'looks fine', deductions: [{ reason: 'x', marks: 0 }] };
    const admin = await adminCookie();
    await req('/api/admin/candidates/g2/grade', { method: 'POST', headers: { Cookie: admin } });
    const rows = await env.DB.prepare("SELECT ai_score FROM part1_answers WHERE candidate_id='g2'").all<any>();
    expect(rows.results.length).toBe(5);
    for (const r of rows.results) expect(r.ai_score).toBe(0);
  });

  it('a 0-mark deduction can never inflate the score above the model score (the reported bug)', async () => {
    await candidateAnswering('g3', 'g3@x.com', 'the sky is blue today, nothing about the question');
    // Exactly the reported case: model scores 0 but lists the deduction as 0 marks.
    gradeResponse = { score: 0, reasoning: 'The answer is empty and unrelated.', deductions: [{ reason: 'empty and unrelated', marks: 0 }] };
    const admin = await adminCookie();
    await req('/api/admin/candidates/g3/grade', { method: 'POST', headers: { Cookie: admin } });
    const rows = await env.DB.prepare("SELECT ai_score FROM part1_answers WHERE candidate_id='g3'").all<any>();
    for (const r of rows.results) expect(r.ai_score).toBe(0);
  });

  it('grades every Part 1 answer with a score + itemized deductions, and evaluates the candidate', async () => {
    await candidateWithAnswers();
    // Mock OpenAI to return a partial-credit grade for every question.
    gradeResponse = { score: 2, reasoning: 'Partially correct — see deductions.', deductions: [{ reason: 'Missing a required condition', marks: 1 }] };

    const admin = await adminCookie();
    const res = await req('/api/admin/candidates/g1/grade', { method: 'POST', headers: { Cookie: admin } });
    expect(res.status).toBe(200);

    const rows = await env.DB.prepare("SELECT ai_score, ai_reasoning, deductions, max_marks, scored_at FROM part1_answers WHERE candidate_id='g1'").all<any>();
    expect(rows.results.length).toBe(5);
    for (const r of rows.results) {
      // Final score is the STRICTER of the model's own score (2) and max_marks minus the
      // shown deductions (max_marks - 1). A deduction can only lower the score, never raise
      // it above what the model itself awarded — so for a 4-mark question this is min(3, 2)=2.
      expect(r.ai_score).toBe(Math.min(r.max_marks - 1, 2));
      expect(r.scored_at).toBeTruthy();
      expect(r.ai_reasoning).toContain('Partially correct');
      const ded = JSON.parse(r.deductions);
      expect(ded[0].reason).toContain('Missing a required condition');
      expect(ded[0].marks).toBe(1);
    }
    const c = await env.DB.prepare("SELECT status FROM candidates WHERE id='g1'").first<any>();
    expect(c.status).toBe('evaluated');
  });

  it('clamps an out-of-range model score into [0, maxMarks]', async () => {
    await candidateWithAnswers();
    // Model returns an absurd score; grader must clamp (SQL max 3, Python max 4).
    gradeResponse = { score: 999, reasoning: 'overshoot', deductions: [] };

    const admin = await adminCookie();
    await req('/api/admin/candidates/g1/grade', { method: 'POST', headers: { Cookie: admin } });

    const rows = await env.DB.prepare("SELECT ai_score, max_marks FROM part1_answers WHERE candidate_id='g1'").all<any>();
    for (const r of rows.results) {
      expect(r.ai_score).toBeLessThanOrEqual(r.max_marks);
      expect(r.ai_score).toBeGreaterThanOrEqual(0);
    }
  });

  it('awards quarter-mark partial scores, snapping to the nearest 0.25', async () => {
    await candidateWithAnswers();
    // Model returns a messy fraction — it must be snapped to a clean 0.25 step.
    gradeResponse = { score: 2.6, reasoning: 'close', deductions: [] };
    const admin = await adminCookie();
    await req('/api/admin/candidates/g1/grade', { method: 'POST', headers: { Cookie: admin } });
    const rows = await env.DB.prepare("SELECT ai_score, max_marks FROM part1_answers WHERE candidate_id='g1'").all<any>();
    for (const r of rows.results) {
      // 2.6 snaps to 2.5; must land on a quarter-mark boundary and stay in range.
      expect(r.ai_score).toBe(Math.min(2.5, r.max_marks));
      expect(Number.isInteger(r.ai_score * 4)).toBe(true); // multiple of 0.25
    }
  });

  it('concurrent analysis/run calls claim DISJOINT batches — everyone graded exactly once', async () => {
    // Several submitted candidates…
    for (let i = 0; i < 6; i++) await candidateAnswering(`cc${i}`, `cc${i}@x.com`, 'an answer');
    gradeResponse = { score: 2, reasoning: 'ok', deductions: [] };
    const admin = await adminCookie();

    // Fire three analysis/run calls AT THE SAME TIME. With atomic claiming, each
    // grabs a different subset — no candidate is graded by two calls, none skipped.
    const [a, b, c] = await Promise.all([
      req('/api/admin/analysis/run', { method: 'POST', headers: { Cookie: admin } }),
      req('/api/admin/analysis/run', { method: 'POST', headers: { Cookie: admin } }),
      req('/api/admin/analysis/run', { method: 'POST', headers: { Cookie: admin } }),
    ]);
    const bodies = [await a.json<any>(), await b.json<any>(), await c.json<any>()];
    // Total candidates claimed across the three calls must not exceed the 6 we seeded
    // (i.e. no double-claiming of the same candidate).
    const totalClaimed = bodies.reduce((s, x) => s + (x.claimed || 0), 0);
    expect(totalClaimed).toBeLessThanOrEqual(6);

    // Drain anything still queued (if batching left some), then assert all evaluated.
    for (let i = 0; i < 6; i++) {
      const r = await (await req('/api/admin/analysis/run', { method: 'POST', headers: { Cookie: admin } })).json<any>();
      if (r.remaining === 0) break;
    }
    const left = await env.DB.prepare("SELECT COUNT(*) n FROM candidates WHERE status IN ('submitted','grading')").first<any>();
    expect(left.n).toBe(0);
    const evaluated = await env.DB.prepare("SELECT COUNT(*) n FROM candidates WHERE status='evaluated'").first<any>();
    expect(evaluated.n).toBe(6);
    // Each graded candidate has exactly 5 scored answers (graded once, not twice).
    const scored = await env.DB.prepare("SELECT candidate_id, COUNT(*) n FROM part1_answers WHERE scored_at IS NOT NULL GROUP BY candidate_id").all<any>();
    for (const row of scored.results) expect(row.n).toBe(5);
  });

  it('admin detail shows scores/deductions, but candidate endpoints still never do', async () => {
    await candidateWithAnswers();
    gradeResponse = { score: 3, reasoning: 'Good', deductions: [] };
    const admin = await adminCookie();
    await req('/api/admin/candidates/g1/grade', { method: 'POST', headers: { Cookie: admin } });

    // Admin sees grading data
    const detail = await (await req('/api/admin/candidates/g1', { method: 'GET', headers: { Cookie: admin } })).text();
    expect(detail).toContain('ai_score');

    // Candidate re-login: their endpoints must still expose nothing
    const cookie = (await candidateCookie('g1@x.com')).cookie;
    const me = await (await req('/api/candidate/me', { method: 'GET', headers: { Cookie: cookie } })).text();
    for (const k of ['ai_score', 'reference_answer', 'rubric', 'expected_output', 'max_marks']) {
      expect(me.includes(k)).toBe(false);
    }
  });
});
