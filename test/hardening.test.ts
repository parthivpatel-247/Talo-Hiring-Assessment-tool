import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import { migrate, req, seedQuestions, seedCandidate, adminCookie, candidateCookie, openAiReply } from './helpers';

describe('answer hardening', () => {
  let cookie: string;
  beforeEach(async () => {
    await migrate();
    await seedQuestions();
    await seedCandidate('h1', 'h1@x.com', 'part2_ready');
    cookie = (await candidateCookie('h1@x.com')).cookie;
    await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
  });

  it('rejects an answer for a question not assigned to the candidate (ownership)', async () => {
    const res = await req('/api/candidate/part1/answer', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: 'not-mine', answerText: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('caps answer length server-side at 15000 chars', async () => {
    const start = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const qid = (await start.json<any>()).questions[0].id;
    await req('/api/candidate/part1/answer', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: qid, answerText: 'a'.repeat(30000) }),
    });
    const row = await env.DB.prepare('SELECT length(answer_text) n FROM part1_answers WHERE candidate_id=? AND question_id=?').bind('h1', qid).first<any>();
    expect(row.n).toBe(15000);
  });
});

describe('force-submit + auto-close', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('force-submit finalizes a candidate immediately', async () => {
    await seedCandidate('f1', 'f1@x.com', 'part2_ready');
    const cookie = (await candidateCookie('f1@x.com')).cookie;
    await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const admin = await adminCookie();
    const res = await req('/api/admin/candidates/f1/force-submit', { method: 'POST', headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    const c = await env.DB.prepare("SELECT status FROM candidates WHERE id='f1'").first<any>();
    expect(c.status).toBe('submitted');
    const a = await env.DB.prepare("SELECT part1_submitted_at, part2_submitted_at FROM attempts WHERE candidate_id='f1'").first<any>();
    expect(a.part1_submitted_at).toBeTruthy();
    expect(a.part2_submitted_at).toBeTruthy();
  });

  it('analysis/status auto-closes an abandoned attempt so grading can proceed', async () => {
    await seedCandidate('f2', 'f2@x.com', 'part2_ready');
    const cookie = (await candidateCookie('f2@x.com')).cookie;
    await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    // Simulate an attempt started long ago (well beyond 30min + 30min grace) that never submitted.
    await env.DB.prepare("UPDATE attempts SET part1_started_at = datetime('now','-3 hours') WHERE candidate_id='f2'").run();
    await env.DB.prepare("UPDATE candidates SET status='in_progress' WHERE id='f2'").run();

    const admin = await adminCookie();
    const res = await req('/api/admin/analysis/status', { method: 'GET', headers: { Cookie: admin } });
    const s = await res.json<any>();
    expect(s.autoClosed).toBeGreaterThanOrEqual(1);
    const c = await env.DB.prepare("SELECT status FROM candidates WHERE id='f2'").first<any>();
    expect(c.status).toBe('submitted');
  });
});

describe('login tracking + manual fix', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('counts logins and surfaces the count to admin', async () => {
    await seedCandidate('l1', 'l1@x.com', 'part2_ready');
    await candidateCookie('l1@x.com');
    await candidateCookie('l1@x.com'); // a second login (suspicious)
    const admin = await adminCookie();
    const { candidates } = await (await req('/api/admin/candidates', { method: 'GET', headers: { Cookie: admin } })).json<any>();
    const c = candidates.find((x: any) => x.id === 'l1');
    expect(c.loginCount).toBe(2);
  });

  it('blocks a second login once the test has started, and alerts the manager', async () => {
    await seedCandidate('one', 'one@x.com', 'part2_ready');
    const cookie = (await candidateCookie('one@x.com')).cookie;
    // start the test on the first session
    await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    // a second person opens the same link and logs in with the same email → blocked
    const second = await req('/api/candidate/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'one@x.com' }),
    });
    expect(second.status).toBe(403);
    // the manager's activity log records the blocked attempt with the email
    const admin = await adminCookie();
    const { events } = await (await req('/api/admin/audit', { method: 'GET', headers: { Cookie: admin } })).json<any>();
    const alert = events.find((e: any) => e.action === 'duplicate_login_blocked' && e.candidate_id === 'one');
    expect(alert).toBeTruthy();
    expect(alert.detail).toContain('one@x.com');
  });

  it('manual fix sets email and makes a parse_failed candidate able to log in', async () => {
    // A parse-failed candidate with a placeholder email cannot log in.
    await env.DB.prepare("INSERT INTO candidates (id, email, resume_r2_key, status) VALUES ('pf', 'pending+pf@unresolved.local', 'resumes/pf.pdf', 'parse_failed')").run();
    const admin = await adminCookie();
    const res = await req('/api/admin/candidates/pf/manual', {
      method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'real@x.com', name: 'Real Name' }),
    });
    expect(res.status).toBe(200);
    const login = await req('/api/candidate/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'real@x.com' }),
    });
    expect(login.status).toBe(200);
  });

  it('manual fix rejects an email already used by another candidate', async () => {
    await seedCandidate('c-a', 'taken@x.com', 'part2_ready');
    await env.DB.prepare("INSERT INTO candidates (id, email, resume_r2_key, status) VALUES ('c-b', 'pending+cb@unresolved.local', 'resumes/cb.pdf', 'parse_failed')").run();
    const admin = await adminCookie();
    const res = await req('/api/admin/candidates/c-b/manual', {
      method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taken@x.com' }),
    });
    expect(res.status).toBe(409);
  });
});

describe('CSV export + audit log', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('exports a CSV with a header and a row per candidate', async () => {
    await seedCandidate('e1', 'e1@x.com', 'submitted');
    const admin = await adminCookie();
    const res = await req('/api/admin/export.csv', { method: 'GET', headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const text = await res.text();
    expect(text.split('\n')[0]).toContain('Email');
    expect(text).toContain('e1@x.com');
  });

  it('records admin actions in the audit log', async () => {
    await seedCandidate('a1', 'a1@x.com', 'part2_ready');
    const admin = await adminCookie();
    await req('/api/admin/candidates/a1/revoke', { method: 'POST', headers: { Cookie: admin } });
    const { events } = await (await req('/api/admin/audit', { method: 'GET', headers: { Cookie: admin } })).json<any>();
    expect(events.some((e: any) => e.action === 'revoke' && e.candidate_id === 'a1')).toBe(true);
  });
});

describe('grading resilience', () => {
  beforeEach(async () => {
    await migrate(); await seedQuestions();
    fetchMock.activate(); fetchMock.disableNetConnect();
  });
  afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } catch {} });

  async function submittedCandidate(id: string) {
    await seedCandidate(id, `${id}@x.com`, 'part2_ready');
    const cookie = (await candidateCookie(`${id}@x.com`)).cookie;
    const start = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    for (const q of (await start.json<any>()).questions) {
      await req('/api/candidate/part1/answer', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: q.id, answerText: 'ans' }) });
    }
    await req('/api/candidate/part1/submit', { method: 'POST', headers: { Cookie: cookie } });
  }

  it('recomputes the score from the deductions shown to the candidate', async () => {
    await submittedCandidate('gr1');
    // Model returns an INCONSISTENT score (says 3) but lists a 1-mark deduction.
    // The stored score must equal maxMarks - sum(deductions), not the model's 3.
    fetchMock.get('https://api.openai.com')
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, openAiReply({ score: 9, reasoning: 'x', deductions: [{ reason: 'missing condition', marks: 1 }] }))
      .persist();
    const admin = await adminCookie();
    await req('/api/admin/candidates/gr1/grade', { method: 'POST', headers: { Cookie: admin } });
    const rows = await env.DB.prepare("SELECT ai_score, max_marks FROM part1_answers WHERE candidate_id='gr1'").all<any>();
    for (const r of rows.results) {
      expect(r.ai_score).toBe(r.max_marks - 1); // consistent with the shown deduction
    }
  });

  it('retries a 429 rate limit and still grades', async () => {
    await submittedCandidate('gr2');
    const pool = fetchMock.get('https://api.openai.com');
    // First call 429, then all subsequent calls succeed.
    pool.intercept({ path: '/v1/chat/completions', method: 'POST' }).reply(429, 'rate limited').times(1);
    pool.intercept({ path: '/v1/chat/completions', method: 'POST' }).reply(200, openAiReply({ score: 2, reasoning: 'ok', deductions: [] })).persist();
    const admin = await adminCookie();
    const res = await req('/api/admin/candidates/gr2/grade', { method: 'POST', headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    const graded = await env.DB.prepare("SELECT COUNT(*) n FROM part1_answers WHERE candidate_id='gr2' AND scored_at IS NOT NULL").first<any>();
    expect(graded.n).toBe(5);
  });
});

describe('integrity flags (manager portal)', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('flags a started candidate that gets a blocked duplicate login', async () => {
    await seedCandidate('fl', 'fl@x.com', 'part2_ready');
    const cookie = (await candidateCookie('fl@x.com')).cookie; // login #1
    await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    // a second person logs in with the same email → blocked + recorded
    await req('/api/candidate/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'fl@x.com' }) });

    const admin = await adminCookie();
    const { flags } = await (await req('/api/admin/flags', { headers: { Cookie: admin } })).json<any>();
    const f = flags.find((x: any) => x.email === 'fl@x.com');
    expect(f).toBeTruthy();
    expect(f.severity).toBe('high');
    expect(f.items.some((i: any) => i.type === 'duplicate_login')).toBe(true);
  });

  it('does not flag a clean candidate (single login, no violations)', async () => {
    await seedCandidate('ok', 'ok@x.com', 'part2_ready');
    await candidateCookie('ok@x.com'); // one login, never started
    const admin = await adminCookie();
    const { flags } = await (await req('/api/admin/flags', { headers: { Cookie: admin } })).json<any>();
    expect(flags.find((x: any) => x.email === 'ok@x.com')).toBeFalsy();
  });
});
