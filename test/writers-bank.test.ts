import { describe, it, expect, beforeEach } from 'vitest';
import { env, fetchMock, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { migrate, seedCandidate, openAiReply, applySql } from './helpers';
import d16 from '../migrations-docs/0016_writers_two_part.sql?raw';
import d17 from '../migrations-docs/0017_writers_indexes.sql?raw';
import d18 from '../migrations-docs/0018_rate_limits.sql?raw';

// The writers team's question bank (2026-10-25): 20 one-mark grammar sentences and two
// editing exercises in Part 1, one long writing task in Part 2. Every candidate gets all
// Part 1 items in their own order; model answers and marking guidance reach only the grader.

const O = 'https://docs.test';
const docsEnv = { ...env, TEAM: 'docs' } as typeof env;
async function dreq(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(O + path, { ...init, headers: { Origin: O, ...(init.headers as any) } }), docsEnv as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const post = (cookie: string, body: unknown = {}) => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ck = (r: Response) => (r.headers.get('Set-Cookie') || '').split(';')[0];
const login = async (email: string) => ck(await dreq('/api/candidate/login', post('', { email })));
const admin = async () => ck(await dreq('/api/admin/login', post('', { email: 'admin@test.local', password: 'test-admin-pass' })));

const SECRET_MODEL = 'MODEL-ANSWER-do-not-leak';
const SECRET_GUIDE = 'GUIDANCE-do-not-leak';
function bank() {
  const qs: any[] = [];
  for (let i = 1; i <= 20; i++) {
    qs.push({ part: 1, marks: 1, wordLimit: 50, prompt: `### 1. Grammar & Language\n\nShorten and correct.\n\n| Sentence |\n| --- |\n| Sentence number ${i}. |`, referenceAnswer: `${SECRET_MODEL} ${i}`, guidance: `${SECRET_GUIDE} ${i}` });
  }
  qs.push({ part: 1, marks: 5, wordLimit: 50, prompt: '### 2. Editing\n\n**Exercise I: Rewrite a tooltip** (5 marks)', referenceAnswer: `${SECRET_MODEL} tooltip`, guidance: `${SECRET_GUIDE} tooltip` });
  qs.push({ part: 1, marks: 5, wordLimit: 100, prompt: '### 2. Editing\n\n**Exercise II: Write an alert message** (5 marks)', referenceAnswer: `${SECRET_MODEL} alert`, guidance: `${SECRET_GUIDE} alert` });
  qs.push({ part: 2, marks: 20, wordLimit: 2000, prompt: '**PART B**\n\n### 3. Writing (20 marks)\n\nOutline the Alerts chapter.', guidance: `${SECRET_GUIDE} writing` });
  return qs;
}

async function setup() {
  await migrate(); await applySql(d16); await applySql(d17); await applySql(d18);
  const a = await admin();
  const imp = await (await dreq('/api/admin/questions/bulk-import', post(a, { questions: bank() }))).json<any>();
  expect(imp).toMatchObject({ ok: true, imported: 23 });
  expect((await dreq('/api/admin/assessment-length', post(a, { part1: { questions: 22, minutes: 30 }, part2: { questions: 1, minutes: 45 } }))).status).toBe(200);
  await dreq('/api/admin/start-open', post(a, { open: true }));
  for (const n of [1, 2, 3, 4]) await seedCandidate(`wc${n}`, `wc${n}@x.com`, 'part2_ready');
  return a;
}

describe('writers question bank: import, order, privacy, grading', () => {
  beforeEach(async () => { await setup(); });

  it('stores the model answer and guidance for the grader only', async () => {
    const rows = (await env.DB.prepare("SELECT reference_answer, rubric FROM question_bank WHERE category = 'part1' AND prompt LIKE '%number 7.%'").all<any>()).results!;
    expect(rows).toEqual([{ reference_answer: `${SECRET_MODEL} 7`, rubric: `${SECRET_GUIDE} 7` }]);
    const c = await login('wc1@x.com');
    const start = await dreq('/api/candidate/part1/start', post(c));
    const text = await start.text();
    expect(start.status).toBe(200);
    expect(text).not.toContain(SECRET_MODEL);
    expect(text).not.toContain(SECRET_GUIDE);
    expect(JSON.parse(text).questions).toHaveLength(22);
    await dreq('/api/candidate/part1/submit', post(c));
    const p2 = await (await dreq('/api/candidate/part2/start', post(c))).text();
    expect(p2).not.toContain(SECRET_GUIDE);
    expect(JSON.parse(p2).questions).toHaveLength(1);
  });

  it('every candidate gets all 22 Part 1 items, each in their own order', async () => {
    const orders: string[][] = [];
    for (const n of [1, 2, 3, 4]) {
      const c = await login(`wc${n}@x.com`);
      const qs = (await (await dreq('/api/candidate/part1/start', post(c))).json<any>()).questions;
      expect(new Set(qs.map((q: any) => q.id)).size).toBe(22);
      orders.push(qs.map((q: any) => q.prompt));
    }
    // same set for everyone, never the same sequence
    for (const o of orders) expect([...o].sort()).toEqual([...orders[0]].sort());
    expect(new Set(orders.map((o) => o.join('§'))).size).toBe(4);
    const pos = await env.DB.prepare("SELECT candidate_id, COUNT(*) AS n, COUNT(DISTINCT position) AS p FROM part1_assignments GROUP BY candidate_id").all<any>();
    for (const r of pos.results!) expect(r).toMatchObject({ n: 22, p: 22 });
  });

  it('the grader receives the model answer and guidance, and is told other wordings are fine', async () => {
    const prompts: string[] = [];
    fetchMock.activate(); fetchMock.disableNetConnect();
    fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, (opts: any) => { prompts.push(String(opts.body)); return openAiReply({ score: 1, reasoning: 'ok', deductions: [] }); }).persist();
    const c = await login('wc1@x.com');
    const qs = (await (await dreq('/api/candidate/part1/start', post(c))).json<any>()).questions;
    for (const q of qs) await dreq('/api/candidate/part1/answer', post(c, { questionId: q.id, answerText: 'A corrected sentence written my own way.' }));
    await dreq('/api/candidate/part1/submit', post(c));
    const p2 = (await (await dreq('/api/candidate/part2/start', post(c))).json<any>()).questions;
    await dreq('/api/candidate/part2/answer', post(c, { questionId: p2[0].id, answerText: 'An outline with sections and questions for the PM.' }));
    await dreq('/api/candidate/part2/submit', post(c));
    const a = await admin();
    expect((await dreq('/api/admin/candidates/wc1/grade', post(a))).status).toBe(200);
    expect(prompts).toHaveLength(23);
    const sentence7 = prompts.find((p) => p.includes('Sentence number 7.'))!;
    expect(sentence7).toContain(`${SECRET_MODEL} 7`);
    expect(sentence7).toContain(`${SECRET_GUIDE} 7`);
    expect(sentence7).toContain('ONE acceptable version');
    const writing = prompts.find((p) => p.includes('3. Writing'))!;
    expect(writing).toContain(`${SECRET_GUIDE} writing`);
    const scored = await env.DB.prepare("SELECT COUNT(*) AS n FROM part1_answers WHERE candidate_id = 'wc1' AND scored_at IS NOT NULL").first<any>();
    expect(scored.n).toBe(22);
  });

  it('Assessment length accepts up to 40 questions a part', async () => {
    const a = await admin();
    expect((await dreq('/api/admin/assessment-length', post(a, { part1: { questions: 40, minutes: 30 }, part2: { questions: 1, minutes: 45 } }))).status).toBe(200);
    expect((await dreq('/api/admin/assessment-length', post(a, { part1: { questions: 41, minutes: 30 }, part2: { questions: 1, minutes: 45 } }))).status).toBe(400);
  });
});

describe('writers Part 1: questions every candidate gets, plus a random draw', () => {
  beforeEach(async () => {
    await migrate(); await applySql(d16); await applySql(d17); await applySql(d18);
    const a = await admin();
    const qs = bank().map((q) => (q.prompt.includes('Exercise') || q.part === 2 ? { ...q, required: true } : q));
    expect((await (await dreq('/api/admin/questions/bulk-import', post(a, { questions: qs }))).json<any>()).imported).toBe(23);
    expect((await dreq('/api/admin/assessment-length', post(a, { part1: { questions: 12, minutes: 30 }, part2: { questions: 1, minutes: 45 } }))).status).toBe(200);
    await dreq('/api/admin/start-open', post(a, { open: true }));
    for (let n = 1; n <= 6; n++) await seedCandidate(`rq${n}`, `rq${n}@x.com`, 'part2_ready');
  });

  it('each candidate gets both editing exercises and 10 of the 20 sentences, in their own order', async () => {
    const sets: string[][] = [];
    for (let n = 1; n <= 6; n++) {
      const c = await login(`rq${n}@x.com`);
      const qs = (await (await dreq('/api/candidate/part1/start', post(c))).json<any>()).questions as any[];
      expect(qs).toHaveLength(12);
      expect(qs.filter((q) => q.prompt.includes('Exercise I:'))).toHaveLength(1);
      expect(qs.filter((q) => q.prompt.includes('Exercise II:'))).toHaveLength(1);
      expect(qs.filter((q) => q.prompt.includes('| Sentence |'))).toHaveLength(10);
      sets.push(qs.map((q) => q.prompt));
    }
    // the random ten differ between candidates, and so does the order
    expect(new Set(sets.map((s) => [...s].sort().join('§'))).size).toBeGreaterThan(1);
    expect(new Set(sets.map((s) => s.join('§'))).size).toBe(6);
    // least-used rotation: after 6 candidates x 10 draws from 20, every sentence was used 3 times
    const uses = await env.DB.prepare("SELECT u.uses FROM question_usage u JOIN question_bank q ON q.id = u.question_id WHERE q.prompt LIKE '%| Sentence |%'").all<any>();
    expect(uses.results!.map((r: any) => r.uses).sort()).toEqual(Array(20).fill(3));
  });

  it('refuses a Part 1 length smaller than the questions everyone must get', async () => {
    const a = await admin();
    const r = await dreq('/api/admin/assessment-length', post(a, { part1: { questions: 1, minutes: 30 }, part2: { questions: 1, minutes: 45 } }));
    expect(r.status).toBe(400);
    expect((await r.json<any>()).error).toMatch(/every candidate must get/);
  });

  it('a manager can switch a question between "every candidate" and "drawn at random"', async () => {
    const a = await admin();
    const q = (await env.DB.prepare("SELECT id FROM question_bank WHERE prompt LIKE '%number 3.%'").first<any>()).id;
    expect((await dreq(`/api/admin/questions/${q}`, { method: 'PUT', headers: { Cookie: a, 'Content-Type': 'application/json' }, body: JSON.stringify({ required: true }) })).status).toBe(200);
    expect((await env.DB.prepare('SELECT required FROM question_bank WHERE id = ?').bind(q).first<any>()).required).toBe(1);
    const cfg = await (await dreq('/api/admin/config', { headers: { Cookie: a } })).json<any>();
    expect(cfg.docs.pool.required.part1).toBe(3);
  });
});

describe('writers question bank: editing marks later', () => {
  beforeEach(async () => { await setup(); });

  it('a manager can change a question\'s marks and word limit; new candidates get the new marks', async () => {
    const a = await admin();
    const q = (await env.DB.prepare("SELECT id FROM question_bank WHERE prompt LIKE '%number 5.%'").first<any>()).id;
    const put = (body: unknown) => dreq(`/api/admin/questions/${q}`, { method: 'PUT', headers: { Cookie: a, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await put({ marks: 2, wordLimit: 80 })).status).toBe(200);
    expect(await env.DB.prepare('SELECT marks, word_limit, reference_answer FROM question_bank WHERE id = ?').bind(q).first<any>())
      .toEqual({ marks: 2, word_limit: 80, reference_answer: `${SECRET_MODEL} 5` });
    expect((await put({ wordLimit: '' })).status).toBe(200); // back to the default
    expect((await env.DB.prepare('SELECT word_limit FROM question_bank WHERE id = ?').bind(q).first<any>()).word_limit).toBeNull();
    expect((await put({ marks: 0.3 })).status).toBe(400);
  });
});

describe('Access lists the config sign-ins', () => {
  beforeEach(async () => { await migrate(); });
  it('members API returns the manager config sign-in, read-only', async () => {
    const a = await admin();
    const r = await (await dreq('/api/admin/members', { headers: { Cookie: a } })).json<any>();
    expect(r.config).toEqual([{ email: 'admin@test.local', role: 'manager' }, { email: 'panel@test.local', role: 'member' }]);
    expect(r.members).toEqual([]);
  });
});
