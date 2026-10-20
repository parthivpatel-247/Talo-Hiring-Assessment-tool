import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { migrate, req, adminCookie, panelCookie, seedQuestions, seedCandidate } from './helpers';

const jsonHeaders = (cookie: string) => ({ Cookie: cookie, 'Content-Type': 'application/json' });

describe('roles (manager vs panel member)', () => {
  beforeEach(async () => { await migrate(); });

  it('login returns the role and /config reflects it + colleges', async () => {
    const mgr = await adminCookie();
    const cfg = await (await req('/api/admin/config', { headers: { Cookie: mgr } })).json<any>();
    expect(cfg.role).toBe('manager');
    expect(cfg.colleges).toContain('College Name 1');
    expect(cfg.colleges.length).toBe(4);

    const pan = await panelCookie();
    const cfg2 = await (await req('/api/admin/config', { headers: { Cookie: pan } })).json<any>();
    expect(cfg2.role).toBe('member');
  });

  it('login requires BOTH email and password (no password-only, email must match)', async () => {
    const hdr = { 'Content-Type': 'application/json' };
    // password only, no email → rejected
    expect((await req('/api/admin/login', { method: 'POST', headers: hdr, body: JSON.stringify({ password: 'test-admin-pass' }) })).status).toBe(400);
    // right password but wrong email → rejected
    expect((await req('/api/admin/login', { method: 'POST', headers: hdr, body: JSON.stringify({ email: 'nope@test.local', password: 'test-admin-pass' }) })).status).toBe(401);
    // correct email + password → manager
    const ok = await req('/api/admin/login', { method: 'POST', headers: hdr, body: JSON.stringify({ email: 'admin@test.local', password: 'test-admin-pass' }) });
    expect(ok.status).toBe(200);
    expect((await ok.json<any>()).role).toBe('manager');
    // panel bootstrap: correct email + password → member
    const pan = await req('/api/admin/login', { method: 'POST', headers: hdr, body: JSON.stringify({ email: 'panel@test.local', password: 'test-panel-pass' }) });
    expect((await pan.json<any>()).role).toBe('member');
  });

  it('logout invalidates the session so you can sign back in as a different role', async () => {
    const mgr = await adminCookie();
    expect((await req('/api/admin/config', { headers: { Cookie: mgr } })).status).toBe(200);
    const out = await req('/api/admin/logout', { method: 'POST', headers: { Cookie: mgr } });
    expect(out.status).toBe(200);
    // the old cookie's session is gone — it can no longer act as admin
    expect((await req('/api/admin/config', { headers: { Cookie: mgr } })).status).toBe(401);
  });

  it('panel member is blocked from destructive/config actions (403); manager allowed', async () => {
    await seedCandidate('c1', 'a@x.com');
    await seedQuestions();
    const pan = await panelCookie();

    // Member: delete candidate, delete question, upload, revoke, set college → 403
    expect((await req('/api/admin/candidates/c1', { method: 'DELETE', headers: { Cookie: pan } })).status).toBe(403);
    expect((await req('/api/admin/questions/qb-sql-1', { method: 'DELETE', headers: { Cookie: pan } })).status).toBe(403);
    expect((await req('/api/admin/candidates/c1/revoke', { method: 'POST', headers: { Cookie: pan } })).status).toBe(403);
    expect((await req('/api/admin/candidates/c1/college', { method: 'POST', headers: jsonHeaders(pan), body: JSON.stringify({ college: 'College Name 1' }) })).status).toBe(403);
    expect((await req('/api/admin/questions/bulk-import', { method: 'POST', headers: jsonHeaders(pan), body: JSON.stringify({ questions: [{ category: 'sql', prompt: 'x' }] }) })).status).toBe(403);

    // Manager: same delete works
    const mgr = await adminCookie();
    expect((await req('/api/admin/candidates/c1', { method: 'DELETE', headers: { Cookie: mgr } })).status).toBe(200);
  });

  it('panel member CAN view and run evaluation actions (reject)', async () => {
    await seedCandidate('c2', 'b@x.com', 'evaluated');
    const pan = await panelCookie();
    expect((await req('/api/admin/candidates', { headers: { Cookie: pan } })).status).toBe(200);
    expect((await req('/api/admin/candidates/c2/reject', { method: 'POST', headers: { Cookie: pan } })).status).toBe(200);
  });
});

describe('college segregation', () => {
  beforeEach(async () => { await migrate(); });

  it('set-college assigns a valid college and it shows in the list; unknown is rejected', async () => {
    await seedCandidate('c3', 'c@x.com');
    const mgr = await adminCookie();

    const ok = await req('/api/admin/candidates/c3/college', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ college: 'College Name 2' }) });
    expect(ok.status).toBe(200);
    const list = await (await req('/api/admin/candidates', { headers: { Cookie: mgr } })).json<any>();
    expect(list.candidates.find((x: any) => x.id === 'c3').college).toBe('College Name 2');

    const bad = await req('/api/admin/candidates/c3/college', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ college: 'Nope University' }) });
    expect(bad.status).toBe(400);

    // clearing (empty) is allowed
    const clear = await req('/api/admin/candidates/c3/college', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ college: '' }) });
    expect(clear.status).toBe(200);
    const list2 = await (await req('/api/admin/candidates', { headers: { Cookie: mgr } })).json<any>();
    expect(list2.candidates.find((x: any) => x.id === 'c3').college).toBeNull();
  });

  it('manager can rename colleges and it cascades to existing candidates', async () => {
    await seedCandidate('r1', 'r1@x.com', 'evaluated', 'College Name 1');
    const mgr = await adminCookie();
    const save = await req('/api/admin/colleges', {
      method: 'POST', headers: jsonHeaders(mgr),
      body: JSON.stringify({ colleges: ['IIT Bombay', 'College Name 2', 'College Name 3', 'College Name 4'], renames: [{ from: 'College Name 1', to: 'IIT Bombay' }] }),
    });
    expect(save.status).toBe(200);
    const cfg = await (await req('/api/admin/config', { headers: { Cookie: mgr } })).json<any>();
    expect(cfg.colleges[0]).toBe('IIT Bombay');
    const list = await (await req('/api/admin/candidates', { headers: { Cookie: mgr } })).json<any>();
    expect(list.candidates.find((x: any) => x.id === 'r1').college).toBe('IIT Bombay');
    // The renamed college is now valid for set-college; the old name isn't.
    await seedCandidate('r2', 'r2@x.com');
    expect((await req('/api/admin/candidates/r2/college', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ college: 'IIT Bombay' }) })).status).toBe(200);
    expect((await req('/api/admin/candidates/r2/college', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ college: 'College Name 1' }) })).status).toBe(400);
  });

  it('member cannot edit colleges; duplicate names rejected', async () => {
    const pan = await panelCookie();
    expect((await req('/api/admin/colleges', { method: 'POST', headers: jsonHeaders(pan), body: JSON.stringify({ colleges: ['A'] }) })).status).toBe(403);
    const mgr = await adminCookie();
    expect((await req('/api/admin/colleges', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ colleges: ['A', 'a'] }) })).status).toBe(400);
    // An EMPTY list is now allowed — colleges are optional.
    expect((await req('/api/admin/colleges', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ colleges: [] }) })).status).toBe(200);
  });

  it('colleges are optional: removing all unassigns everyone, and config returns an empty list', async () => {
    await seedCandidate('o1', 'o1@x.com', 'evaluated', 'College Name 1');
    const mgr = await adminCookie();
    const res = await req('/api/admin/colleges', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ colleges: [] }) });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).unassigned).toBe(1);
    const cfg = await (await req('/api/admin/config', { headers: { Cookie: mgr } })).json<any>();
    expect(cfg.colleges).toEqual([]);
    const list = await (await req('/api/admin/candidates', { headers: { Cookie: mgr } })).json<any>();
    expect(list.candidates.find((x: any) => x.id === 'o1').college).toBeNull();
  });

  it('removing a college unassigns its candidates (no orphaned college values)', async () => {
    // Two candidates in "College Name 2".
    await seedCandidate('u1', 'u1@x.com', 'evaluated', 'College Name 2');
    await seedCandidate('u2', 'u2@x.com', 'submitted', 'College Name 2');
    await seedCandidate('u3', 'u3@x.com', 'evaluated', 'College Name 3'); // kept
    const mgr = await adminCookie();

    // Save a list that DROPS "College Name 2" (not renamed — removed).
    const save = await req('/api/admin/colleges', {
      method: 'POST', headers: jsonHeaders(mgr),
      body: JSON.stringify({ colleges: ['College Name 1', 'College Name 3', 'College Name 4'] }),
    });
    expect(save.status).toBe(200);
    const body = await save.json<any>();
    expect(body.unassigned).toBe(2); // the two in the removed college

    const list = await (await req('/api/admin/candidates', { headers: { Cookie: mgr } })).json<any>();
    const byId = Object.fromEntries(list.candidates.map((c: any) => [c.id, c]));
    expect(byId['u1'].college).toBeNull(); // removed college -> Unassigned
    expect(byId['u2'].college).toBeNull();
    expect(byId['u3'].college).toBe('College Name 3'); // kept college untouched
  });
});

describe('assessment length (configurable duration)', () => {
  beforeEach(async () => { await migrate(); });

  it('defaults to the env length, and a manager can change it; it persists in config', async () => {
    const mgr = await adminCookie();
    // Default comes from PART1_DURATION_MINUTES in wrangler.toml (60).
    const cfg0 = await (await req('/api/admin/config', { headers: { Cookie: mgr } })).json<any>();
    expect(cfg0.assessmentMinutes).toBe(60);

    const save = await req('/api/admin/assessment-duration', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ minutes: 45 }) });
    expect(save.status).toBe(200);
    expect((await save.json<any>()).assessmentMinutes).toBe(45);

    const cfg1 = await (await req('/api/admin/config', { headers: { Cookie: mgr } })).json<any>();
    expect(cfg1.assessmentMinutes).toBe(45);
    // Public (pre-login) config reflects it too.
    const pub = await (await req('/api/candidate/config')).json<any>();
    expect(pub.assessmentMinutes).toBe(45);
  });

  it('rejects out-of-range values and blocks panel members', async () => {
    const mgr = await adminCookie();
    expect((await req('/api/admin/assessment-duration', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ minutes: 2 }) })).status).toBe(400);
    expect((await req('/api/admin/assessment-duration', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ minutes: 500 }) })).status).toBe(400);
    const pan = await panelCookie();
    expect((await req('/api/admin/assessment-duration', { method: 'POST', headers: jsonHeaders(pan), body: JSON.stringify({ minutes: 45 }) })).status).toBe(403);
  });
});

describe('member/access management', () => {
  beforeEach(async () => { await migrate(); });

  it('manager creates a member; that member can log in and gets the right role', async () => {
    const mgr = await adminCookie();
    const create = await req('/api/admin/members', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ name: 'Priya', email: 'priya@company.com', password: 'secret1', role: 'member' }) });
    expect(create.status).toBe(200);

    // priya logs in with email + password
    const login = await req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'priya@company.com', password: 'secret1' }) });
    expect(login.status).toBe(200);
    expect((await login.json<any>()).role).toBe('member');

    // wrong password fails
    const bad = await req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'priya@company.com', password: 'nope' }) });
    expect(bad.status).toBe(401);

    // a member without a valid email is rejected
    const noEmail = await req('/api/admin/members', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ name: 'NoEmail', password: 'secret1', role: 'member' }) });
    expect(noEmail.status).toBe(400);
    const badEmail = await req('/api/admin/members', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ name: 'BadEmail', email: 'not-an-email', password: 'secret1', role: 'member' }) });
    expect(badEmail.status).toBe(400);
  });

  it('role change + disable take effect on login; members list never leaks hashes', async () => {
    const mgr = await adminCookie();
    await req('/api/admin/members', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ name: 'Sam', email: 'sam@company.com', password: 'secret1', role: 'member' }) });
    const list = await (await req('/api/admin/members', { headers: { Cookie: mgr } })).json<any>();
    const sam = list.members.find((m: any) => m.email === 'sam@company.com');
    expect(sam).toBeTruthy();
    expect(sam.username).toBe('Sam');
    expect(sam.pass_hash).toBeUndefined();
    expect(sam.pass_salt).toBeUndefined();

    // promote to manager
    expect((await req(`/api/admin/members/${sam.id}`, { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ role: 'manager' }) })).status).toBe(200);
    const login1 = await req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sam@company.com', password: 'secret1' }) });
    expect((await login1.json<any>()).role).toBe('manager');

    // disable → login blocked
    expect((await req(`/api/admin/members/${sam.id}`, { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ active: false }) })).status).toBe(200);
    expect((await req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sam@company.com', password: 'secret1' }) })).status).toBe(401);
  });

  it('a member cannot manage members; duplicate email rejected', async () => {
    const mgr = await adminCookie();
    await req('/api/admin/members', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ name: 'Dup', email: 'dup@company.com', password: 'secret1', role: 'member' }) });
    expect((await req('/api/admin/members', { method: 'POST', headers: jsonHeaders(mgr), body: JSON.stringify({ name: 'Dup Two', email: 'dup@company.com', password: 'secret1' }) })).status).toBe(409);
    const pan = await panelCookie();
    expect((await req('/api/admin/members', { headers: { Cookie: pan } })).status).toBe(403);
    expect((await req('/api/admin/members', { method: 'POST', headers: jsonHeaders(pan), body: JSON.stringify({ name: 'X', email: 'x@company.com', password: 'secret1' }) })).status).toBe(403);
  });
});

describe('CSV export (filtered + full detail)', () => {
  beforeEach(async () => { await migrate(); });

  it('summary export honors status and college filters and includes a College column', async () => {
    await seedCandidate('s1', 's1@x.com', 'shortlisted', 'College Name 1');
    await seedCandidate('s2', 's2@x.com', 'evaluated', 'College Name 2');
    const mgr = await adminCookie();

    const all = await (await req('/api/admin/export.csv', { headers: { Cookie: mgr } })).text();
    expect(all).toContain('College');
    expect(all).toContain('s1@x.com');
    expect(all).toContain('s2@x.com');

    const short = await (await req('/api/admin/export.csv?status=shortlisted', { headers: { Cookie: mgr } })).text();
    expect(short).toContain('s1@x.com');
    expect(short).not.toContain('s2@x.com');

    const col2 = await (await req('/api/admin/export.csv?college=College%20Name%202', { headers: { Cookie: mgr } })).text();
    expect(col2).toContain('s2@x.com');
    expect(col2).not.toContain('s1@x.com');
  });

  it('full export includes per-question rows with the candidate answer, score and deductions', async () => {
    await seedQuestions();
    await seedCandidate('f1', 'f1@x.com', 'evaluated', 'College Name 1');
    await env.DB.prepare('INSERT INTO part1_assignments (candidate_id, question_id, position) VALUES (?,?,0)').bind('f1', 'qb-sql-1').run();
    await env.DB.prepare(
      "INSERT INTO part1_answers (candidate_id, question_id, answer_text, ai_score, max_marks, deductions, scored_at) VALUES (?,?,?,?,?,?,datetime('now'))"
    ).bind('f1', 'qb-sql-1', 'SELECT my_answer', 2, 3, '[{"marks":1,"reason":"minor issue"}]').run();

    const mgr = await adminCookie();
    const full = await (await req('/api/admin/export.csv?format=full', { headers: { Cookie: mgr } })).text();
    expect(full).toContain('Section');
    expect(full).toContain('Part 1');
    expect(full).toContain('SELECT my_answer');
    expect(full).toContain('minor issue');
  });
});

describe('question sections (sql / python / dsa / scenario)', () => {
  beforeEach(async () => { await migrate(); });

  it('config lists all four sections and a DSA question adds with the right default marks', async () => {
    const admin = await adminCookie();
    const cfg = await (await req('/api/admin/config', { headers: { Cookie: admin } })).json<any>();
    const vals = (cfg.questionCategories || []).map((c: any) => c.value).sort();
    expect(vals).toEqual(['dsa', 'python', 'scenario', 'sql']);
    expect(cfg.questionCategories.find((c: any) => c.value === 'dsa').marks).toBe(5);
    expect(cfg.questionCategories.find((c: any) => c.value === 'scenario').marks).toBe(5);

    // Add a DSA question (skip AI enrichment) — it stores with category 'dsa' and marks 5.
    const res = await req('/api/admin/questions', {
      method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'dsa', prompt: 'Two Sum: return indices adding to target.', referenceAnswer: 'hash map', enrich: false }),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT category, marks FROM question_bank WHERE category='dsa'").first<any>();
    expect(row.category).toBe('dsa');
    expect(row.marks).toBe(5);
  });

  it('rejects an unknown question type', async () => {
    const admin = await adminCookie();
    const res = await req('/api/admin/questions', {
      method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'banana', prompt: 'nope', enrich: false }),
    });
    expect(res.status).toBe(400);
  });
});
