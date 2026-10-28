import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { migrate, req, adminCookie, panelCookie, candidateCookie, seedQuestions, seedCandidate } from './helpers';

// Support site: the writers-site features that apply to it too (2026-10-28):
// questions per type in Assessment length, "Every candidate" questions, and editing a
// question's marks from the question bank.

const post = (cookie: string, body: unknown = {}) => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const put = (cookie: string, body: unknown = {}) => ({ method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('support: questions per type in Assessment length', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('starts from wrangler.toml and shows the bank counts', async () => {
    const a = await adminCookie();
    const cfg = await (await req('/api/admin/config', { headers: { Cookie: a } })).json<any>();
    expect(cfg.questionCounts).toEqual({ sql: 2, python: 1, dsa: 1, scenario: 1 });
    expect(cfg.pool.active).toEqual({ sql: 3, python: 2, dsa: 2, scenario: 2 });
    expect((await (await req('/api/candidate/config')).json<any>()).questions).toBe(5);
  });

  it('a manager changes the counts and minutes; new candidates get that set', async () => {
    const a = await adminCookie();
    const r = await req('/api/admin/assessment-length', post(a, { counts: { sql: 3, python: 2, dsa: 0, scenario: 1 }, minutes: 45 }));
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body.counts).toEqual({ sql: 3, python: 2, dsa: 0, scenario: 1 });
    expect(body.assessmentMinutes).toBe(45);
    expect((await (await req('/api/candidate/config')).json<any>())).toMatchObject({ questions: 6, assessmentMinutes: 45 });

    await seedCandidate('c1', 'c1@x.com');
    const c = (await candidateCookie('c1@x.com')).cookie;
    const st = await (await req('/api/candidate/part1/start', post(c))).json<any>();
    expect(st.questions.map((q: any) => q.category).sort()).toEqual(['python', 'python', 'scenario', 'sql', 'sql', 'sql']);
    expect(st.durationSeconds).toBe(45 * 60);
  });

  it('rejects bad counts and panel members', async () => {
    const a = await adminCookie();
    expect((await req('/api/admin/assessment-length', post(a, { counts: { sql: 0, python: 0, dsa: 0, scenario: 0 } }))).status).toBe(400);
    expect((await req('/api/admin/assessment-length', post(a, { counts: { sql: 21, python: 0, dsa: 0, scenario: 0 } }))).status).toBe(400);
    expect((await req('/api/admin/assessment-length', post(a, { counts: { sql: 1.5, python: 0, dsa: 0, scenario: 0 } }))).status).toBe(400);
    const p = await panelCookie();
    expect((await req('/api/admin/assessment-length', post(p, { counts: { sql: 1, python: 1, dsa: 1, scenario: 1 } }))).status).toBe(403);
  });
});

describe('support: "Every candidate" questions', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('a pinned question goes to every candidate, inside its type\'s share', async () => {
    const a = await adminCookie();
    expect((await req('/api/admin/questions/qb-sql-3', put(a, { required: true }))).status).toBe(200);
    const cfg = await (await req('/api/admin/config', { headers: { Cookie: a } })).json<any>();
    expect(cfg.pool.required.sql).toBe(1);
    for (let n = 1; n <= 4; n++) {
      await seedCandidate(`p${n}`, `p${n}@x.com`);
      const c = (await candidateCookie(`p${n}@x.com`)).cookie;
      const qs = (await (await req('/api/candidate/part1/start', post(c))).json<any>()).questions;
      expect(qs).toHaveLength(5);
      expect(qs.filter((q: any) => q.category === 'sql')).toHaveLength(2);
      expect(qs.some((q: any) => q.id === 'qb-sql-3')).toBe(true);
    }
  });

  it('refuses a count smaller than the pinned questions of that type', async () => {
    const a = await adminCookie();
    await req('/api/admin/questions/qb-sql-1', put(a, { required: true }));
    await req('/api/admin/questions/qb-sql-2', put(a, { required: true }));
    const r = await req('/api/admin/assessment-length', post(a, { counts: { sql: 1, python: 1, dsa: 1, scenario: 1 } }));
    expect(r.status).toBe(400);
    expect((await r.json<any>()).error).toMatch(/every candidate must get/);
  });

  it('add and bulk import accept the flag', async () => {
    const a = await adminCookie();
    const add = await req('/api/admin/questions', post(a, { category: 'python', prompt: 'Reverse a list.', enrich: false, required: true }));
    expect(add.status).toBe(200);
    const id = (await add.json<any>()).id;
    expect((await env.DB.prepare('SELECT required FROM question_bank WHERE id = ?').bind(id).first<any>()).required).toBe(1);
    const imp = await (await req('/api/admin/questions/bulk-import', post(a, { questions: [{ category: 'dsa', prompt: 'Binary search.', required: true }] }))).json<any>();
    expect(imp.imported).toBe(1);
    expect((await env.DB.prepare("SELECT required FROM question_bank WHERE prompt = 'Binary search.'").first<any>()).required).toBe(1);
  });
});

describe('support: edit a question\'s marks', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('a manager changes marks; it is audited; panel members cannot', async () => {
    const a = await adminCookie();
    expect((await req('/api/admin/questions/qb-py-1', put(a, { marks: 7 }))).status).toBe(200);
    expect((await env.DB.prepare("SELECT marks FROM question_bank WHERE id = 'qb-py-1'").first<any>()).marks).toBe(7);
    const log = await env.DB.prepare("SELECT detail FROM admin_audit WHERE action = 'edit_question'").first<any>();
    expect(log.detail).toContain('marks 4 → 7');
    expect((await req('/api/admin/questions/qb-py-1', put(a, { marks: 0 }))).status).toBe(400);
    const p = await panelCookie();
    expect((await req('/api/admin/questions/qb-py-1', put(p, { marks: 9 }))).status).toBe(403);
  });
});
