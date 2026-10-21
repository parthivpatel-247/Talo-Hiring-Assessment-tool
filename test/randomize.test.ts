import { describe, it, expect, beforeEach } from 'vitest';
import { migrate, req, seedQuestions, seedCandidate, candidateCookie, adminCookie } from './helpers';

// Fairness: a retake must NOT re-serve a question the candidate already saw.
// The test bank has 2 DSA + 2 Scenario, so a retake should draw the OTHER one of
// each (zero overlap) — guarding the part1_seen exclusion in randomize.ts.
describe('randomization — no repeats across a retake', () => {
  beforeEach(async () => {
    await migrate();
    await seedQuestions();
    await seedCandidate('rk', 'rk@x.com', 'part2_ready');
  });

  async function assignedByCat(cookie: string): Promise<Record<string, string>> {
    const res = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    const byCat: Record<string, string> = {};
    for (const q of body.questions) {
      if (q.category === 'dsa' || q.category === 'scenario') byCat[q.category] = q.id;
    }
    return byCat;
  }

  it('a retake gives a different DSA and Scenario question than the first attempt', async () => {
    const cookie1 = (await candidateCookie('rk@x.com')).cookie;
    const first = await assignedByCat(cookie1);
    expect(first.dsa).toBeTruthy();
    expect(first.scenario).toBeTruthy();

    // Manager grants a retake (clears the active assignment, keeps the seen history).
    const mgr = await adminCookie();
    const retake = await req('/api/admin/candidates/rk/retake', { method: 'POST', headers: { Cookie: mgr } });
    expect(retake.status).toBe(200);

    // Candidate re-enters and gets a fresh paper.
    const cookie2 = (await candidateCookie('rk@x.com')).cookie;
    const second = await assignedByCat(cookie2);

    expect(second.dsa).not.toBe(first.dsa);
    expect(second.scenario).not.toBe(first.scenario);
  });

  it('rotates across students: with 2 DSA and 2 Scenario, two students get distinct ones (no repeat until the pool cycles)', async () => {
    await seedCandidate('s1', 's1@x.com', 'part2_ready');
    await seedCandidate('s2', 's2@x.com', 'part2_ready');
    const a = await assignedByCat((await candidateCookie('s1@x.com')).cookie);
    const b = await assignedByCat((await candidateCookie('s2@x.com')).cookie);
    // The bank has exactly 2 DSA + 2 Scenario, so least-used rotation must hand
    // the two students different questions in each category.
    expect(a.dsa).not.toBe(b.dsa);
    expect(a.scenario).not.toBe(b.scenario);
  });
});

describe('resume keeps the same questions and restores answers', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); await seedCandidate('rs', 'rs@x.com', 'part2_ready'); });

  it('after a drop + admin Resume, the candidate gets the SAME questions with saved answers filled in', async () => {
    const cookie = (await candidateCookie('rs@x.com')).cookie;
    const start = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const q1 = (await start.json<any>()).questions;
    const ids1 = q1.map((x: any) => x.id).sort();

    // candidate saves an answer to the first question, then gets cut off (submitted)
    await req('/api/candidate/part1/answer', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q1[0].id, answerText: 'MY SAVED ANSWER' }),
    });
    const { env } = await import('cloudflare:test');
    await env.DB.prepare("UPDATE attempts SET part1_submitted_at = datetime('now') WHERE candidate_id = 'rs'").run();

    // admin grants Resume
    const mgr = await adminCookie();
    const res = await req('/api/admin/candidates/rs/resume', { method: 'POST', headers: { Cookie: mgr } });
    expect(res.status).toBe(200);

    // attempt is re-opened (not submitted, clock reset)
    const at = await env.DB.prepare("SELECT part1_submitted_at, part1_started_at FROM attempts WHERE candidate_id = 'rs'").first<any>();
    expect(at.part1_submitted_at).toBeNull();
    expect(at.part1_started_at).toBeNull();

    // same questions, and the saved answer is returned to the candidate when they start again
    const q2 = (await (await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } })).json<any>()).questions;
    expect(q2.map((x: any) => x.id).sort()).toEqual(ids1);
    expect(q2.find((x: any) => x.id === q1[0].id).answer).toBe('MY SAVED ANSWER');
  });
});
