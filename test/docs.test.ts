import { describe, it, expect, beforeEach } from 'vitest';
import { env, fetchMock, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { migrate, seedCandidate, openAiReply, applySql } from './helpers';
import m16 from '../migrations-docs/0016_writers_two_part.sql?raw';
import m17 from '../migrations-docs/0017_writers_indexes.sql?raw';

/**
 * Writers / documentation site (TEAM = "docs"): the same Worker, run with the
 * writers' settings, against a database that has the writers-only migration.
 */

const docsEnv = {
  ...env,
  TEAM: 'docs',
  PART1_DURATION_MINUTES: '30',
  PART2_DURATION_MINUTES: '45',
  DOCS_PART1_QUESTIONS: '4',
  DOCS_PART2_QUESTIONS: '2',
  DOCS_PART1_MARKS: '5',
  DOCS_PART2_MARKS: '10',
  DOCS_WORD_LIMIT: '1000',
} as typeof env;

async function dreq(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request('https://docs.test' + path, init), docsEnv as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') || '').split(';')[0];
const jsonPost = (cookie: string, body: unknown = {}) => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function migrateDocs() {
  await migrate();
  await applySql(m16);
  await applySql(m17);
}

const P1_PROMPTS = Array.from({ length: 6 }, (_, i) => `Part one writing task ${i + 1}: rewrite this error message.`);
const P2_PROMPTS = Array.from({ length: 3 }, (_, i) => `Part two writing task ${i + 1}: write a setup guide.`);

async function seedDocsBank(p1 = 6, p2 = 3) {
  const stmt = env.DB.prepare(
    `INSERT INTO question_bank (id, category, prompt, marks, word_limit, status, active) VALUES (?, ?, ?, ?, ?, 'active', 1)`
  );
  await env.DB.batch([
    ...P1_PROMPTS.slice(0, p1).map((p, i) => stmt.bind(`d1-${i}`, 'part1', p, 5, 300)),
    ...P2_PROMPTS.slice(0, p2).map((p, i) => stmt.bind(`d2-${i}`, 'part2', p, 10, 800)),
  ]);
}

async function adminLogin(email = 'admin@test.local', password = 'test-admin-pass') {
  const res = await dreq('/api/admin/login', jsonPost('', { email, password }));
  expect(res.status).toBe(200);
  return cookieOf(res);
}
async function candidateLogin(email: string) {
  const res = await dreq('/api/candidate/login', jsonPost('', { email }));
  return { res, cookie: cookieOf(res) };
}

const FORBIDDEN = ['reference_answer', 'rubric', 'ai_score', 'max_marks', '"marks"', 'ai_reasoning'];
function assertNoLeak(text: string) {
  for (const k of FORBIDDEN) expect(text.includes(k), `leaked ${k}`).toBe(false);
}

describe('writers site — two-part flow', () => {
  beforeEach(async () => {
    await migrateDocs();
    await seedDocsBank();
    await seedCandidate('w1', 'w1@x.com', 'part2_ready');
  });

  it('public config shows two parts with the default lengths', async () => {
    const cfg = await (await dreq('/api/candidate/config')).json<any>();
    expect(cfg.team).toBe('docs');
    expect(cfg.parts.part1).toEqual({ questions: 4, minutes: 30 });
    expect(cfg.parts.part2).toEqual({ questions: 2, minutes: 45 });
    expect(cfg.assessmentMinutes).toBe(75);
  });

  it('runs Part 1, locks it, then runs Part 2 from the Part 2 bank', async () => {
    const { cookie } = await candidateLogin('w1@x.com');

    // Part 2 can't open before Part 1 is done; Part 1 can't be answered before it starts.
    expect((await dreq('/api/candidate/part2/prepare', jsonPost(cookie))).status).toBe(409);
    const prep = await dreq('/api/candidate/part1/prepare', jsonPost(cookie));
    const prepText = await prep.text();
    assertNoLeak(prepText);
    const p1 = JSON.parse(prepText).questions;
    expect(p1).toHaveLength(4);
    for (const q of p1) { expect(P1_PROMPTS).toContain(q.prompt); expect(q.wordLimit).toBe(300); }
    expect((await dreq('/api/candidate/part1/answer', jsonPost(cookie, { questionId: p1[0].id, answerText: 'early' }))).status).toBe(409);

    const start = await dreq('/api/candidate/part1/start', jsonPost(cookie));
    const s1 = await start.json<any>();
    expect(s1.durationSeconds).toBe(1800);
    expect(s1.questions.map((q: any) => q.id)).toEqual(p1.map((q: any) => q.id)); // same set as prepared
    expect((await dreq('/api/candidate/part1/answer', jsonPost(cookie, { questionId: p1[0].id, answerText: 'My Part 1 answer.' }))).status).toBe(200);

    // Submitting Part 1 does not end the assessment.
    expect((await dreq('/api/candidate/part1/submit', jsonPost(cookie))).status).toBe(200);
    const c1 = await env.DB.prepare("SELECT status FROM candidates WHERE id = 'w1'").first<any>();
    expect(c1.status).toBe('in_progress');

    // Part 1 is now locked.
    const late = await dreq('/api/candidate/part1/answer', jsonPost(cookie, { questionId: p1[0].id, answerText: 'changed' }));
    expect(late.status).toBe(409);
    expect((await dreq('/api/candidate/part1/start', jsonPost(cookie))).status).toBe(409);
    const kept = await env.DB.prepare("SELECT answer_text FROM part1_answers WHERE candidate_id = 'w1' AND question_id = ?").bind(p1[0].id).first<any>();
    expect(kept.answer_text).toBe('My Part 1 answer.');

    // Part 2: two questions copied from the Part 2 bank, 45 minutes.
    const s2res = await dreq('/api/candidate/part2/start', jsonPost(cookie));
    const s2text = await s2res.text();
    assertNoLeak(s2text);
    const s2 = JSON.parse(s2text);
    expect(s2.durationSeconds).toBe(2700);
    expect(s2.questions).toHaveLength(2);
    for (const q of s2.questions) { expect(P2_PROMPTS).toContain(q.prompt); expect(q.wordLimit).toBe(800); }
    const src = await env.DB.prepare("SELECT source_question_id FROM part2_questions WHERE candidate_id = 'w1'").all<any>();
    expect(src.results!.every((r: any) => String(r.source_question_id).startsWith('d2-'))).toBe(true);

    // Open book: pasting is logged, never blocked.
    expect((await dreq('/api/candidate/part2/tab-switch', jsonPost(cookie, { type: 'paste', chars: 420, questionId: s2.questions[0].id }))).status).toBe(200);
    expect((await dreq('/api/candidate/part2/answer', jsonPost(cookie, { questionId: s2.questions[0].id, answerText: 'Guide text.' }))).status).toBe(200);
    const ev = await env.DB.prepare("SELECT part, type, chars, question_id FROM attempt_events WHERE candidate_id = 'w1'").first<any>();
    expect(ev).toMatchObject({ part: 2, type: 'paste', chars: 420, question_id: s2.questions[0].id });

    expect((await dreq('/api/candidate/part2/submit', jsonPost(cookie))).status).toBe(200);
    const c2 = await env.DB.prepare("SELECT status FROM candidates WHERE id = 'w1'").first<any>();
    expect(c2.status).toBe('submitted');
    expect((await dreq('/api/candidate/part2/answer', jsonPost(cookie, { questionId: s2.questions[0].id, answerText: 'late' }))).status).toBe(409);
  });

  it('allows a new sign-in only between the parts', async () => {
    const { cookie } = await candidateLogin('w1@x.com');
    await dreq('/api/candidate/part1/start', jsonPost(cookie));
    expect((await candidateLogin('w1@x.com')).res.status).toBe(403); // Part 1 running
    await dreq('/api/candidate/part1/submit', jsonPost(cookie));
    expect((await candidateLogin('w1@x.com')).res.status).toBe(200); // between parts
    await dreq('/api/candidate/part2/start', jsonPost(cookie));
    expect((await candidateLogin('w1@x.com')).res.status).toBe(403); // Part 2 running
  });

  it('tells the candidate to fetch the invigilator when a part\'s bank is too small', async () => {
    await env.DB.prepare("UPDATE question_bank SET active = 0 WHERE id IN ('d1-0','d1-1','d1-2')").run();
    const { cookie } = await candidateLogin('w1@x.com');
    const res = await dreq('/api/candidate/part1/start', jsonPost(cookie));
    expect(res.status).toBe(409);
    expect((await res.json<any>()).error).toMatch(/not ready/i);
  });
});

describe('writers site — admin', () => {
  beforeEach(async () => {
    await migrateDocs();
    await seedDocsBank();
  });

  it('config reports the two parts and the bank size per part', async () => {
    const admin = await adminLogin();
    const cfg = await (await dreq('/api/admin/config', { headers: { Cookie: admin } })).json<any>();
    expect(cfg.team).toBe('docs');
    expect(cfg.questionCategories.map((c: any) => c.value)).toEqual(['part1', 'part2']);
    expect(cfg.docs.pool).toEqual({ part1: 6, part2: 3 });
  });

  it('saves questions and minutes per part (manager only, validated)', async () => {
    const admin = await adminLogin();
    const bad = await dreq('/api/admin/assessment-length', jsonPost(admin, { part1: { questions: 0, minutes: 30 }, part2: { questions: 2, minutes: 45 } }));
    expect(bad.status).toBe(400);
    const ok = await dreq('/api/admin/assessment-length', jsonPost(admin, { part1: { questions: 3, minutes: 20 }, part2: { questions: 1, minutes: 60 } }));
    expect(ok.status).toBe(200);
    const cfg = await (await dreq('/api/candidate/config')).json<any>();
    expect(cfg.parts.part1).toEqual({ questions: 3, minutes: 20 });
    expect(cfg.parts.part2).toEqual({ questions: 1, minutes: 60 });

    const panel = await adminLogin('panel@test.local', 'test-panel-pass');
    const denied = await dreq('/api/admin/assessment-length', jsonPost(panel, { part1: { questions: 4, minutes: 30 }, part2: { questions: 2, minutes: 45 } }));
    expect(denied.status).toBe(403);
  });

  it('adds Part 1 / Part 2 questions with a word limit; no AI enrichment', async () => {
    const admin = await adminLogin();
    const add = await dreq('/api/admin/questions', jsonPost(admin, { category: 'part2', prompt: 'Explain incremental loads to a new user.', marks: 10, wordLimit: 600 }));
    expect(add.status).toBe(200);
    const row = await env.DB.prepare('SELECT category, marks, word_limit FROM question_bank WHERE id = ?').bind((await add.json<any>()).id).first<any>();
    expect(row).toEqual({ category: 'part2', marks: 10, word_limit: 600 });
    expect((await dreq('/api/admin/questions', jsonPost(admin, { category: 'sql', prompt: 'x' }))).status).toBe(400);
    expect((await dreq('/api/admin/questions', jsonPost(admin, { category: 'part1', prompt: 'x', wordLimit: 5 }))).status).toBe(400);
    expect((await dreq('/api/admin/questions/enrich-all', jsonPost(admin))).status).toBe(400);
  });

  it('grades both parts without a rubric and exports per-part scores', async () => {
    await seedCandidate('w2', 'w2@x.com', 'part2_ready');
    const { cookie } = await candidateLogin('w2@x.com');
    const s1 = await (await dreq('/api/candidate/part1/start', jsonPost(cookie))).json<any>();
    for (const q of s1.questions) await dreq('/api/candidate/part1/answer', jsonPost(cookie, { questionId: q.id, answerText: 'A clear, short message for the user.' }));
    await dreq('/api/candidate/part1/submit', jsonPost(cookie));
    const s2 = await (await dreq('/api/candidate/part2/start', jsonPost(cookie))).json<any>();
    for (const q of s2.questions) await dreq('/api/candidate/part2/answer', jsonPost(cookie, { questionId: q.id, answerText: 'Step 1. Open the app. Step 2. Connect.' }));
    await dreq('/api/candidate/part2/submit', jsonPost(cookie));

    const prompts: string[] = [];
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get('https://api.openai.com')
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, (opts: any) => {
        const body = JSON.parse(String(opts.body));
        prompts.push(body.messages[0].content);
        const max = Number((/Max marks: (\d+)/.exec(body.messages[1].content) || [])[1]);
        return openAiReply({ score: max - 1, reasoning: 'Clear and on task.', deductions: [{ reason: 'Minor wording', marks: 1 }], ai_content_percent: 20 });
      })
      .persist();

    const admin = await adminLogin();
    const run = await dreq('/api/admin/analysis/run', jsonPost(admin));
    expect((await run.json<any>()).processed[0].ok).toBe(true);
    expect(prompts).toHaveLength(6);
    expect(prompts.every((p) => /WRITING test/.test(p) && /no rubric/i.test(p))).toBe(true);
    expect(prompts.filter((p) => /ai_content_percent/.test(p))).toHaveLength(2); // Part 2 only

    const p1 = await env.DB.prepare("SELECT ai_score, ai_reasoning FROM part1_answers WHERE candidate_id = 'w2'").all<any>();
    expect(p1.results!.every((r: any) => r.ai_score === 4 && r.ai_reasoning === 'Clear and on task.')).toBe(true);
    const p2 = await env.DB.prepare("SELECT ai_score, ai_content_pct FROM part2_answers WHERE candidate_id = 'w2'").all<any>();
    expect(p2.results!.every((r: any) => r.ai_score === 9 && r.ai_content_pct === 20)).toBe(true); // 10 - 1; AI estimate never deducts

    const summary = await (await dreq('/api/admin/export.csv?format=summary', { headers: { Cookie: admin } })).text();
    const [head, line] = summary.replace('﻿', '').split('\r\n');
    expect(head).toContain('Part 1 score,Part 1 max,Part 2 score,Part 2 max,Total score,Total max');
    expect(line).toContain(',16,20,18,20,34,40,');
    const full = await (await dreq('/api/admin/export.csv?format=full', { headers: { Cookie: admin } })).text();
    expect(full).toContain('AI reasoning');
    expect(full.split('\r\n').filter((l) => l.includes(',Part 2,')).length).toBe(2);
  });

  it('Retake draws new Part 2 questions; Resume reopens only the part that was cut off', async () => {
    await seedCandidate('w3', 'w3@x.com', 'part2_ready');
    const { cookie } = await candidateLogin('w3@x.com');
    await dreq('/api/candidate/part1/start', jsonPost(cookie));
    await dreq('/api/candidate/part1/submit', jsonPost(cookie));
    await dreq('/api/candidate/part2/start', jsonPost(cookie));
    await dreq('/api/candidate/part2/submit', jsonPost(cookie));
    const admin = await adminLogin();

    const resume = await (await dreq('/api/admin/candidates/w3/resume', jsonPost(admin))).json<any>();
    expect(resume.reopened).toBe('part2');
    const at = await env.DB.prepare("SELECT part1_submitted_at, part2_started_at, part2_submitted_at FROM attempts WHERE candidate_id = 'w3'").first<any>();
    expect(at.part1_submitted_at).not.toBeNull();
    expect(at.part2_started_at).toBeNull();
    expect(at.part2_submitted_at).toBeNull();
    expect((await candidateLogin('w3@x.com')).res.status).toBe(200);

    await dreq('/api/admin/candidates/w3/retake', jsonPost(admin));
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM part2_questions WHERE candidate_id = 'w3'").first<any>();
    expect(left.n).toBe(0);
    const c = await env.DB.prepare("SELECT status FROM candidates WHERE id = 'w3'").first<any>();
    expect(c.status).toBe('part2_ready');
  });

  it('has no interview-question generation', async () => {
    await seedCandidate('w4', 'w4@x.com', 'evaluated');
    const admin = await adminLogin();
    expect((await dreq('/api/admin/candidates/w4/interview', jsonPost(admin))).status).toBe(404);
    expect((await dreq('/api/admin/candidates/w4/shortlist', jsonPost(admin))).status).toBe(200);
  });
});

describe('writers site — database design rules', () => {
  beforeEach(async () => {
    await migrateDocs();
    await seedDocsBank();
    await seedCandidate('w9', 'w9@x.com', 'part2_ready');
  });

  it('keeps every integrity event when several arrive at once', async () => {
    const { cookie } = await candidateLogin('w9@x.com');
    await dreq('/api/candidate/part1/start', jsonPost(cookie));
    await dreq('/api/candidate/part1/submit', jsonPost(cookie));
    const s2 = await (await dreq('/api/candidate/part2/start', jsonPost(cookie))).json<any>();
    await Promise.all([
      ...s2.questions.map((q: any) => dreq('/api/candidate/part2/tab-switch', jsonPost(cookie, { type: 'metrics', questionId: q.id, typed: 500, pasted: 100, pastes: 1, ms: 60000 }))),
      ...Array.from({ length: 6 }, () => dreq('/api/candidate/part2/tab-switch', jsonPost(cookie, { type: 'tab_hidden' }))),
    ]);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempt_events WHERE candidate_id = 'w9'").first<any>();
    expect(n.n).toBe(s2.questions.length + 6);
    const at = await env.DB.prepare("SELECT part2_tab_switch_count AS c FROM attempts WHERE candidate_id = 'w9'").first<any>();
    expect(at.c).toBe(6); // metrics are signals, not tab switches
  });

  it('saves the typed answer with the clock sync, and never after the part closes', async () => {
    const { cookie } = await candidateLogin('w9@x.com');
    const s1 = await (await dreq('/api/candidate/part1/start', jsonPost(cookie))).json<any>();
    const hb = await (await dreq('/api/candidate/part1/heartbeat', jsonPost(cookie, { questionId: s1.questions[0].id, answerText: 'Saved by the clock sync.' }))).json<any>();
    expect(hb.saved).toBe(true);
    expect(hb.remainingSeconds).toBeGreaterThan(1790);
    const row = await env.DB.prepare('SELECT answer_text FROM part1_answers WHERE candidate_id = ? AND question_id = ?').bind('w9', s1.questions[0].id).first<any>();
    expect(row.answer_text).toBe('Saved by the clock sync.');
    // A question that isn't theirs is ignored.
    expect((await (await dreq('/api/candidate/part1/heartbeat', jsonPost(cookie, { questionId: 'd2-0', answerText: 'x' }))).json<any>()).saved).toBe(false);
    await dreq('/api/candidate/part1/submit', jsonPost(cookie));
    const after = await (await dreq('/api/candidate/part1/heartbeat', jsonPost(cookie, { questionId: s1.questions[0].id, answerText: 'changed' }))).json<any>();
    expect(after.closed).toBe(true);
    const still = await env.DB.prepare('SELECT answer_text FROM part1_answers WHERE candidate_id = ? AND question_id = ?').bind('w9', s1.questions[0].id).first<any>();
    expect(still.answer_text).toBe('Saved by the clock sync.');
  });

  it('rejects invalid data at the database level', async () => {
    await expect(env.DB.prepare("UPDATE candidates SET status = 'done' WHERE id = 'w9'").run()).rejects.toThrow(/invalid candidate status/);
    await expect(env.DB.prepare("INSERT INTO question_bank (id, category, prompt, marks) VALUES ('bad', 'part1', 'x', 0)").run()).rejects.toThrow(/invalid marks/);
    await expect(env.DB.prepare("INSERT INTO question_bank (id, category, prompt, marks) VALUES ('bad', 'essay', 'x', 5)").run()).rejects.toThrow(/CHECK/);
    await env.DB.prepare("INSERT INTO part2_questions (id, candidate_id, position, prompt, rubric) VALUES ('a', 'w9', 0, 'p', '')").run();
    await expect(env.DB.prepare("INSERT INTO part2_questions (id, candidate_id, position, prompt, rubric) VALUES ('b', 'w9', 0, 'p', '')").run()).rejects.toThrow(/UNIQUE/);
  });

  it('deleting a candidate removes their integrity events too', async () => {
    await env.DB.prepare("INSERT INTO attempt_events (candidate_id, part, type) VALUES ('w9', 2, 'paste')").run();
    const admin = await adminLogin();
    expect((await dreq('/api/admin/candidates/w9', { method: 'DELETE', headers: { Cookie: admin } })).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempt_events WHERE candidate_id = 'w9'").first<any>();
    expect(n.n).toBe(0);
  });

  it('expired admin sessions stop working', async () => {
    const admin = await adminLogin();
    expect((await dreq('/api/admin/config', { headers: { Cookie: admin } })).status).toBe(200);
    await env.DB.prepare("UPDATE admin_sessions SET expires_at = ?").bind(new Date(Date.now() - 60_000).toISOString()).run();
    expect((await dreq('/api/admin/config', { headers: { Cookie: admin } })).status).toBe(401);
  });
});

describe('writers site — same admin features and protections as the support site', () => {
  beforeEach(async () => {
    await migrateDocs();
    await seedDocsBank();
    await seedCandidate('a1', 'a1@x.com', 'part2_ready');
  });

  it('every admin route needs a signed-in admin', async () => {
    for (const [path, method] of [['/api/admin/config', 'GET'], ['/api/admin/candidates', 'GET'], ['/api/admin/export.csv', 'GET'], ['/api/admin/assessment-length', 'POST'], ['/api/admin/questions', 'POST'], ['/api/admin/candidates/a1', 'GET'], ['/api/admin/candidates/a1/retake', 'POST']] as const) {
      expect((await dreq(path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })).status, path).toBe(401);
    }
  });

  it('panel members can view and grade but not change setup or candidates', async () => {
    const panel = await adminLogin('panel@test.local', 'test-panel-pass');
    expect((await dreq('/api/admin/candidates', { headers: { Cookie: panel } })).status).toBe(200);
    expect((await dreq('/api/admin/candidates/a1', { headers: { Cookie: panel } })).status).toBe(200);
    for (const [path, method] of [
      ['/api/admin/questions', 'POST'], ['/api/admin/questions/d1-0', 'PUT'], ['/api/admin/questions/d1-0', 'DELETE'],
      ['/api/admin/questions/d1-0/toggle-active', 'POST'], ['/api/admin/questions/bulk-import', 'POST'],
      ['/api/admin/candidates/a1/retake', 'POST'], ['/api/admin/candidates/a1/resume', 'POST'], ['/api/admin/candidates/a1/force-submit', 'POST'],
      ['/api/admin/candidates/a1/revoke', 'POST'], ['/api/admin/candidates/a1', 'DELETE'], ['/api/admin/resumes/process', 'POST'],
      ['/api/admin/assessment-length', 'POST'], ['/api/admin/members', 'POST'],
    ] as const) {
      expect((await dreq(path, { method, headers: { Cookie: panel, 'Content-Type': 'application/json' }, body: '{}' })).status, `${method} ${path}`).toBe(403);
    }
  });

  it('force submit, revoke and restore access work on the two-part test', async () => {
    const admin = await adminLogin();
    const { cookie } = await candidateLogin('a1@x.com');
    await dreq('/api/candidate/part1/start', jsonPost(cookie));
    expect((await dreq('/api/admin/candidates/a1/force-submit', jsonPost(admin))).status).toBe(200);
    let at = await env.DB.prepare("SELECT part1_submitted_at, part2_submitted_at FROM attempts WHERE candidate_id = 'a1'").first<any>();
    expect(at.part1_submitted_at && at.part2_submitted_at).toBeTruthy();
    expect((await env.DB.prepare("SELECT status FROM candidates WHERE id = 'a1'").first<any>()).status).toBe('submitted');

    await seedCandidate('a2', 'a2@x.com', 'part2_ready');
    const c2 = (await candidateLogin('a2@x.com')).cookie;
    await dreq('/api/candidate/part1/start', jsonPost(c2));
    await dreq('/api/admin/candidates/a2/revoke', jsonPost(admin));
    expect((await dreq('/api/candidate/me', { headers: { Cookie: c2 } })).status).toBe(401); // session stops working at once
    expect((await candidateLogin('a2@x.com')).res.status).toBe(403);
    at = await env.DB.prepare("SELECT part1_submitted_at, part2_submitted_at FROM attempts WHERE candidate_id = 'a2'").first<any>();
    expect(at.part1_submitted_at && at.part2_submitted_at).toBeTruthy();
    expect((await dreq('/api/admin/candidates/a2/unrevoke', jsonPost(admin))).status).toBe(200);
  });

  it('flags a blocked second sign-in and leaving the test', async () => {
    const admin = await adminLogin();
    const { cookie } = await candidateLogin('a1@x.com');
    await dreq('/api/candidate/part1/start', jsonPost(cookie));
    await dreq('/api/candidate/part1/tab-switch', jsonPost(cookie, { type: 'fullscreen_exited' }));
    expect((await candidateLogin('a1@x.com')).res.status).toBe(403);
    const flags = await (await dreq('/api/admin/flags', { headers: { Cookie: admin } })).json<any>();
    const items = flags.flags.find((f: any) => f.candidateId === 'a1').items.map((i: any) => i.type);
    expect(items).toEqual(expect.arrayContaining(['duplicate_login', 'left_test']));
  });

  it('question soft-delete, restore and disable keep the bank counts right', async () => {
    const admin = await adminLogin();
    const pool = async () => (await (await dreq('/api/admin/config', { headers: { Cookie: admin } })).json<any>()).docs.pool;
    expect(await pool()).toEqual({ part1: 6, part2: 3 });
    await dreq('/api/admin/questions/d1-0', { method: 'DELETE', headers: { Cookie: admin } });
    await dreq('/api/admin/questions/d2-0/toggle-active', jsonPost(admin));
    expect(await pool()).toEqual({ part1: 5, part2: 2 });
    await dreq('/api/admin/questions/d1-0/restore', jsonPost(admin));
    const q = await env.DB.prepare("SELECT deleted_at FROM question_bank WHERE id = 'd1-0'").first<any>();
    expect(q.deleted_at).toBeNull();
  });

  it('the manager can add a writers panel member who then signs in', async () => {
    const admin = await adminLogin();
    expect((await dreq('/api/admin/members', jsonPost(admin, { name: 'Docs Lead', email: 'lead@docs.test', password: 'a-strong-pass', role: 'manager' }))).status).toBe(200);
    expect((await dreq('/api/admin/login', jsonPost('', { email: 'lead@docs.test', password: 'a-strong-pass' }))).status).toBe(200);
  });

  it('never shows the candidate marks, scores or reasoning, even after grading', async () => {
    const { cookie } = await candidateLogin('a1@x.com');
    await dreq('/api/candidate/part1/start', jsonPost(cookie));
    await env.DB.prepare("UPDATE part1_answers SET ai_score = 4, ai_reasoning = 'secret', max_marks = 5").run();
    for (const p of ['/api/candidate/me', '/api/candidate/part1/questions']) {
      const t = await (await dreq(p, { headers: { Cookie: cookie } })).text();
      for (const k of ['ai_score', 'ai_reasoning', 'max_marks', 'secret', '"marks"']) expect(t.includes(k), `${p} leaked ${k}`).toBe(false);
    }
  });
});
