import { describe, it, expect, beforeEach } from 'vitest';
import { migrate, req, seedQuestions, seedCandidate, candidateCookie } from './helpers';

// Keys that must NEVER reach the candidate's browser (privacy requirement).
const FORBIDDEN = ['reference_answer', 'referenceAnswer', 'rubric', 'expected_output', 'expectedOutput', 'ai_score', 'max_marks', 'correct_index', 'is_correct', '"marks"'];

function assertNoLeak(text: string) {
  for (const k of FORBIDDEN) {
    expect(text.includes(k), `payload leaked "${k}": ${text.slice(0, 300)}`).toBe(false);
  }
}

describe('candidate login', () => {
  beforeEach(async () => {
    await migrate();
    await seedQuestions();
  });

  it('rejects an email not on the allowlist', async () => {
    const res = await req('/api/candidate/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'stranger@nowhere.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a candidate whose assessment is not ready yet', async () => {
    await seedCandidate('c-uploaded', 'up@x.com', 'uploaded');
    const res = await req('/api/candidate/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'up@x.com' }),
    });
    expect(res.status).toBe(409);
  });

  it('rejects a revoked candidate', async () => {
    await seedCandidate('c-rev', 'rev@x.com', 'part2_ready');
    const { env } = await import('cloudflare:test');
    await env.DB.prepare("UPDATE candidates SET access_revoked = 1 WHERE id = 'c-rev'").run();
    const res = await req('/api/candidate/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rev@x.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('logs in a ready candidate and returns their name', async () => {
    await seedCandidate('c-ok', 'ok@x.com', 'part2_ready');
    const { res } = await candidateCookie('ok@x.com');
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.ok).toBe(true);
    expect(body.name).toBe('Test User');
  });
});

describe('candidate Part 1 — privacy + flow', () => {
  let cookie: string;
  beforeEach(async () => {
    await migrate();
    await seedQuestions();
    await seedCandidate('c1', 'c1@x.com', 'part2_ready');
    cookie = (await candidateCookie('c1@x.com')).cookie;
  });

  it('requires a session (401 without cookie)', async () => {
    const res = await req('/api/candidate/part1/prepare', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('prepare assigns 2 SQL + 1 Python + 1 DSA + 1 Scenario and leaks no grading data', async () => {
    const res = await req('/api/candidate/part1/prepare', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const text = await res.text();
    assertNoLeak(text);
    const body = JSON.parse(text);
    expect(body.questions).toHaveLength(5);
    const cats = body.questions.map((q: any) => q.category).sort();
    expect(cats).toEqual(['dsa', 'python', 'scenario', 'sql', 'sql']);
    // each question carries only display fields
    for (const q of body.questions) {
      expect(Object.keys(q).sort()).toEqual(['answer', 'category', 'hint', 'id', 'prompt', 'sampleData'].sort());
    }
  });

  it('start returns duration + questions with no marks, and marks candidate in_progress', async () => {
    const res = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const text = await res.text();
    assertNoLeak(text);
    const body = JSON.parse(text);
    expect(body.durationSeconds).toBe(3600); // 60 min (default assessment length)
    expect(body.questions.length).toBe(5);
    const { env } = await import('cloudflare:test');
    const c = await env.DB.prepare("SELECT status FROM candidates WHERE id='c1'").first<any>();
    expect(c.status).toBe('in_progress');
  });

  it('part1/questions returns only display fields', async () => {
    await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const res = await req('/api/candidate/part1/questions', { method: 'GET', headers: { Cookie: cookie } });
    const text = await res.text();
    assertNoLeak(text);
  });

  it('saving an answer returns only {ok} and stores it', async () => {
    const start = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const qid = (await start.json<any>()).questions[0].id;
    const res = await req('/api/candidate/part1/answer', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: qid, answerText: 'SELECT 1' }),
    });
    const body = await res.json<any>();
    expect(body).toEqual({ ok: true });
    const { env } = await import('cloudflare:test');
    const row = await env.DB.prepare('SELECT answer_text FROM part1_answers WHERE candidate_id=? AND question_id=?').bind('c1', qid).first<any>();
    expect(row.answer_text).toBe('SELECT 1');
  });

  it('submit marks part1_submitted_at', async () => {
    await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const res = await req('/api/candidate/part1/submit', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const { env } = await import('cloudflare:test');
    const a = await env.DB.prepare("SELECT part1_submitted_at FROM attempts WHERE candidate_id='c1'").first<any>();
    expect(a.part1_submitted_at).toBeTruthy();
  });

  it('heartbeat counts the timer down and never goes below zero', async () => {
    await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const res = await req('/api/candidate/part1/heartbeat', { method: 'POST', headers: { Cookie: cookie } });
    const body = await res.json<any>();
    expect(body.remainingSeconds).toBeGreaterThan(0);
    expect(body.remainingSeconds).toBeLessThanOrEqual(3600);
  });
});
