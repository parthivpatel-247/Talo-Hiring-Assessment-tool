import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { migrate, req, adminCookie, panelCookie, candidateCookie, seedQuestions, seedCandidate, applySql } from './helpers';
import d16 from '../migrations-docs/0016_writers_two_part.sql?raw';
import d17 from '../migrations-docs/0017_writers_indexes.sql?raw';
import d18 from '../migrations-docs/0018_rate_limits.sql?raw';

// Both sites (2026-10-28): tab-switch counts on the candidate list, manual marks
// (per answer and the final total) and "Revoke access" that can also reject.

const post = (cookie: string, body: unknown = {}) => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---- writers-site request helpers (TEAM = docs) ----
const O = 'https://docs.test';
const docsEnv = { ...env, TEAM: 'docs' } as typeof env;
async function dreq(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(O + path, { ...init, headers: { Origin: O, ...(init.headers as any) } }), docsEnv as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const ck = (r: Response) => (r.headers.get('Set-Cookie') || '').split(';')[0];

type Site = {
  name: string;
  call: (path: string, init?: RequestInit) => Promise<Response>;
  setup: () => Promise<string>; // returns a manager cookie
  sit: (email: string) => Promise<void>; // candidate takes and submits Part 1
};

const support: Site = {
  name: 'support',
  call: req,
  async setup() { await migrate(); await seedQuestions(); return adminCookie(); },
  async sit(email) {
    const c = (await candidateCookie(email)).cookie;
    const qs = (await (await req('/api/candidate/part1/start', post(c))).json<any>()).questions;
    for (const q of qs) await req('/api/candidate/part1/answer', post(c, { questionId: q.id, answerText: 'my answer' }));
    await req('/api/candidate/part1/tab-switch', post(c, { reason: 'tab-switch' }));
    expect((await req('/api/candidate/part1/submit', post(c))).status).toBe(200);
  },
};

const writers: Site = {
  name: 'writers',
  call: dreq,
  async setup() {
    await migrate(); await applySql(d16); await applySql(d17); await applySql(d18);
    const a = ck(await dreq('/api/admin/login', post('', { email: 'admin@test.local', password: 'test-admin-pass' })));
    const bank = [1, 2, 3].map((i) => ({ part: 1, marks: 2, prompt: `Rewrite sentence ${i}.` }));
    bank.push({ part: 2, marks: 20, prompt: 'Outline the chapter.' } as any);
    await dreq('/api/admin/questions/bulk-import', post(a, { questions: bank }));
    await dreq('/api/admin/assessment-length', post(a, { part1: { questions: 3, minutes: 30 }, part2: { questions: 1, minutes: 45 } }));
    await dreq('/api/admin/start-open', post(a, { open: true }));
    return a;
  },
  async sit(email) {
    const c = ck(await dreq('/api/candidate/login', post('', { email })));
    const qs = (await (await dreq('/api/candidate/part1/start', post(c))).json<any>()).questions;
    for (const q of qs) await dreq('/api/candidate/part1/answer', post(c, { questionId: q.id, answerText: 'my answer' }));
    await dreq('/api/candidate/part1/tab-switch', post(c, { reason: 'tab-switch' }));
    await dreq('/api/candidate/part1/tab-switch', post(c, { reason: 'fullscreen-exit' }));
    expect((await dreq('/api/candidate/part1/submit', post(c))).status).toBe(200);
  },
};

/** Pretend the AI graded every Part 1 answer: score 1 out of the question's marks. */
async function fakeGrade(cid: string) {
  await env.DB.prepare(
    `UPDATE part1_answers SET ai_score = 1, ai_reasoning = 'ok', deductions = '[]', scored_at = datetime('now'),
       max_marks = (SELECT marks FROM question_bank WHERE id = part1_answers.question_id) WHERE candidate_id = ?`
  ).bind(cid).run();
}
const listRow = async (site: Site, a: string, cid: string) =>
  ((await (await site.call('/api/admin/candidates', { headers: { Cookie: a } })).json<any>()).candidates as any[]).find((c) => c.id === cid);

for (const site of [support, writers]) {
  describe(`${site.name}: tab switches on the candidate list`, () => {
    it('shows each candidate\'s count per part', async () => {
      const a = await site.setup();
      await seedCandidate('t1', 't1@x.com'); await seedCandidate('t2', 't2@x.com');
      await site.sit('t1@x.com');
      const row = await listRow(site, a, 't1');
      expect(row.tabSwitches.part1).toBeGreaterThanOrEqual(1);
      expect((await listRow(site, a, 't2')).tabSwitches).toEqual({ part1: 0, part2: 0, part3: 0 });
    });
  });

  describe(`${site.name}: manual marks`, () => {
    let a: string;
    beforeEach(async () => { a = await site.setup(); await seedCandidate('m1', 'm1@x.com'); });

    it('not before the candidate has submitted', async () => {
      const qid = (await env.DB.prepare("SELECT id FROM question_bank WHERE category IN ('sql','part1') LIMIT 1").first<any>()).id;
      const r = await site.call('/api/admin/candidates/m1/marks', post(a, { part: 'part1', questionId: qid, score: 1 }));
      expect(r.status).toBe(409);
    });

    it('a manager changes one answer\'s marks; totals, detail and export follow; grading again keeps it', async () => {
      await site.sit('m1@x.com');
      await fakeGrade('m1');
      const before = await listRow(site, a, 'm1');
      const qid = (await env.DB.prepare('SELECT question_id FROM part1_assignments WHERE candidate_id = ? ORDER BY position LIMIT 1').bind('m1').first<any>()).question_id;
      const max = (await env.DB.prepare('SELECT max_marks FROM part1_answers WHERE candidate_id = ? AND question_id = ?').bind('m1', qid).first<any>()).max_marks;

      expect((await site.call('/api/admin/candidates/m1/marks', post(a, { part: 'part1', questionId: qid, score: max + 1 }))).status).toBe(400);
      expect((await site.call('/api/admin/candidates/m1/marks', post(a, { part: 'part1', questionId: qid, score: 0.3 }))).status).toBe(400);
      expect((await site.call('/api/admin/candidates/m1/marks', post(a, { part: 'part1', questionId: 'nope', score: 1 }))).status).toBe(404);
      const ok = await site.call('/api/admin/candidates/m1/marks', post(a, { part: 'part1', questionId: qid, score: max, reason: 'AI missed the join' }));
      expect(ok.status).toBe(200);

      const after = await listRow(site, a, 'm1');
      expect(after.totalAwarded).toBe(before.totalAwarded - 1 + max);
      const detail = await (await site.call('/api/admin/candidates/m1', { headers: { Cookie: a } })).json<any>();
      const ans = detail.part1Answers.find((x: any) => x.question_id === qid);
      expect(ans).toMatchObject({ ai_score: 1, manual_score: max, manual_reason: 'AI missed the join' });
      expect(ans.manual_by).toBeTruthy();

      // Grading again rewrites ai_score only: the manual mark still counts.
      await env.DB.prepare('UPDATE part1_answers SET ai_score = 0 WHERE candidate_id = ?').bind('m1').run();
      expect((await listRow(site, a, 'm1')).totalAwarded).toBe(max);

      const csv = await (await site.call('/api/admin/export.csv?format=full', { headers: { Cookie: a } })).text();
      expect(csv).toContain('changed by manager: AI missed the join');

      const log = await env.DB.prepare("SELECT detail FROM admin_audit WHERE action = 'manual_marks'").first<any>();
      expect(log.detail).toContain('AI missed the join');

      // Back to the AI's marks.
      expect((await site.call('/api/admin/candidates/m1/marks', post(a, { part: 'part1', questionId: qid, score: null }))).status).toBe(200);
      expect((await listRow(site, a, 'm1')).totalAwarded).toBe(0);
    });

    it('a manager overrides the final total, and can clear it', async () => {
      await site.sit('m1@x.com');
      await fakeGrade('m1');
      const row = await listRow(site, a, 'm1');
      expect((await site.call('/api/admin/candidates/m1/total', post(a, { total: row.totalMax + 1 }))).status).toBe(400);
      expect((await site.call('/api/admin/candidates/m1/total', post(a, { total: 2.5, reason: 'panel decision' }))).status).toBe(200);
      const edited = await listRow(site, a, 'm1');
      expect(edited).toMatchObject({ totalAwarded: 2.5, manualTotal: 2.5, manualTotalReason: 'panel decision', aiTotal: row.totalAwarded });
      const csv = await (await site.call('/api/admin/export.csv?format=summary', { headers: { Cookie: a } })).text();
      expect(csv).toContain('panel decision');
      expect((await site.call('/api/admin/candidates/m1/total', post(a, { total: null }))).status).toBe(200);
      expect((await listRow(site, a, 'm1')).totalAwarded).toBe(row.totalAwarded);
    });

    it('Resume clears manual marks; panel members cannot change marks', async () => {
      await site.sit('m1@x.com');
      await fakeGrade('m1');
      const qid = (await env.DB.prepare('SELECT question_id FROM part1_assignments WHERE candidate_id = ? LIMIT 1').bind('m1').first<any>()).question_id;
      await site.call('/api/admin/candidates/m1/marks', post(a, { part: 'part1', questionId: qid, score: 0 }));
      await site.call('/api/admin/candidates/m1/total', post(a, { total: 1 }));
      const p = site === support
        ? await panelCookie()
        : ck(await dreq('/api/admin/login', post('', { email: 'panel@test.local', password: 'test-panel-pass' })));
      expect((await site.call('/api/admin/candidates/m1/marks', post(p, { part: 'part1', questionId: qid, score: 1 }))).status).toBe(403);
      expect((await site.call('/api/admin/candidates/m1/total', post(p, { total: 2 }))).status).toBe(403);
      expect((await site.call('/api/admin/candidates/m1/resume', post(a))).status).toBe(200);
      expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM part1_answers WHERE candidate_id = ? AND manual_score IS NOT NULL').bind('m1').first<any>()).n).toBe(0);
      expect((await env.DB.prepare('SELECT manual_total FROM candidates WHERE id = ?').bind('m1').first<any>()).manual_total).toBeNull();
    });
  });

  describe(`${site.name}: Revoke access can also reject`, () => {
    let a: string;
    beforeEach(async () => { a = await site.setup(); await seedCandidate('r1', 'r1@x.com'); await seedCandidate('r2', 'r2@x.com'); });

    it('revoke + reject marks Rejected; Restore access puts the status back', async () => {
      await site.sit('r1@x.com');
      const st = async (id: string) => (await env.DB.prepare('SELECT status, access_revoked FROM candidates WHERE id = ?').bind(id).first<any>());
      expect((await site.call('/api/admin/candidates/r1/revoke', post(a, { reject: true }))).status).toBe(200);
      expect(await st('r1')).toMatchObject({ status: 'rejected', access_revoked: 1 });
      expect((await env.DB.prepare("SELECT detail FROM admin_audit WHERE action = 'revoke'").first<any>()).detail).toContain('Rejected');
      expect((await site.call('/api/admin/candidates/r1/unrevoke', post(a))).status).toBe(200);
      // The revoke closed the test, so the status it goes back to is Submitted.
      expect(await st('r1')).toMatchObject({ status: 'submitted', access_revoked: 0 });
    });

    it('revoke without reject leaves the status; a candidate who never started stays Not started', async () => {
      expect((await site.call('/api/admin/candidates/r2/revoke', post(a, { reject: false }))).status).toBe(200);
      expect(await env.DB.prepare('SELECT status, access_revoked FROM candidates WHERE id = ?').bind('r2').first<any>()).toMatchObject({ status: 'part2_ready', access_revoked: 1 });
      await site.call('/api/admin/candidates/r2/unrevoke', post(a));
      await site.call('/api/admin/candidates/r2/revoke', post(a, { reject: true }));
      await site.call('/api/admin/candidates/r2/unrevoke', post(a));
      expect(await env.DB.prepare('SELECT status FROM candidates WHERE id = ?').bind('r2').first<any>()).toMatchObject({ status: 'part2_ready' });
    });
  });
}
