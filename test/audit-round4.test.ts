import { describe, it, expect, beforeEach } from 'vitest';
import { env, fetchMock, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { migrate, req, adminCookie, panelCookie, candidateCookie, seedQuestions, seedCandidate, openAiReply, applySql } from './helpers';
import { gradeAnyForTests } from '../src/routes/admin';
import { ensureGradingClaimCols } from '../src/lib/db';
import d16 from '../migrations-docs/0016_writers_two_part.sql?raw';
import d17 from '../migrations-docs/0017_writers_indexes.sql?raw';
import d18 from '../migrations-docs/0018_rate_limits.sql?raw';

// Security audit round 4 (Cloudflare security-audit skill, quick profile, run 1)
// plus the follow-up review of the deferred units. Each block is the regression
// case for one lead or bug.

const O = 'https://test.local';
const post = (cookie: string, body: unknown = {}) => ({ method: 'POST', headers: { Cookie: cookie, Origin: O, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function call(e: any, path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(O + path, init), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedBigPool(perCat = 10) {
  const stmt = env.DB.prepare(
    `INSERT INTO question_bank (id, category, prompt, reference_answer, rubric, marks, difficulty, status, active)
     VALUES (?, ?, ?, 'ref', 'rubric', 3, 'medium', 'active', 1)`
  );
  const rows = [];
  for (const cat of ['sql', 'python', 'dsa', 'scenario']) for (let i = 0; i < perCat; i++) rows.push(stmt.bind(`big-${cat}-${i}`, cat, `${cat} question ${i}`));
  await env.DB.batch(rows);
}

describe('lead: support Part 1 assignment race (randomize.ts assignPart1Questions)', () => {
  beforeEach(async () => { await migrate(); await seedBigPool(); await seedCandidate('r1', 'r1@x.com'); });

  it('overlapping prepare/start calls never give one candidate two sets', async () => {
    const { cookie } = await candidateCookie('r1@x.com');
    for (let round = 0; round < 15; round++) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM part1_assignments WHERE candidate_id = 'r1'"),
        env.DB.prepare("DELETE FROM part1_seen WHERE candidate_id = 'r1'"),
        env.DB.prepare('DELETE FROM question_usage'),
      ]);
      await Promise.all(Array.from({ length: 8 }, () => req('/api/candidate/part1/prepare', post(cookie))));
      const r = await env.DB.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT position) AS p FROM part1_assignments WHERE candidate_id = 'r1'").first<any>();
      expect(r).toEqual({ n: 5, p: 5 });
    }
  }, 60_000);
});

describe('lead: bootstrap admin sessions end when the config credential changes', () => {
  beforeEach(async () => { await migrate(); });

  it('a manager session minted before ADMIN_PASSWORD rotation is refused after it', async () => {
    const mgr = await adminCookie();
    expect((await call(env, '/api/admin/config', { headers: { Cookie: mgr } })).status).toBe(200);
    const rotated = { ...env, ADMIN_PASSWORD: 'rotated-pass-123' };
    expect((await call(rotated, '/api/admin/config', { headers: { Cookie: mgr } })).status).toBe(401);
    expect((await call({ ...env, ADMIN_EMAIL: '' }, '/api/admin/config', { headers: { Cookie: mgr } })).status).toBe(401);
    const make = await call(rotated, '/api/admin/members', post(mgr, { name: 'x', email: 'x@test.local', password: '0123456789', role: 'manager' }));
    expect(make.status).toBe(401);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE email = 'x@test.local'").first<any>()).toEqual({ n: 0 });
  });

  it('a panel session ends when PANEL_PASSWORD rotates, and the manager one is unaffected', async () => {
    const pan = await panelCookie();
    const mgr = await adminCookie();
    const rotated = { ...env, PANEL_PASSWORD: 'rotated-panel-1' };
    expect((await call(rotated, '/api/admin/config', { headers: { Cookie: pan } })).status).toBe(401);
    expect((await call(rotated, '/api/admin/config', { headers: { Cookie: mgr } })).status).toBe(200);
  });
});

describe('lead: sign-in counters group IPv6 by /48', () => {
  beforeEach(async () => { await migrate(); });

  it('rotating /64s inside one /48 shares one unknown-email budget', async () => {
    let last = 0;
    for (let i = 0; i < 205; i++) {
      const ip = `2001:db8:7:${(i % 50).toString(16)}::1`; // 50 different /64s, one /48
      const r = await req('/api/candidate/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: O }, body: JSON.stringify({ email: `nobody${i}@x.test` }) });
      last = r.status;
    }
    expect(last).toBe(429);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE bucket LIKE 'cand-ip:%'").first<any>();
    expect(rows.n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Follow-up review: admin lifecycle and grading state machine
// ---------------------------------------------------------------------------

async function finishedSupportCandidate(id = 'g1', email = 'g1@x.com') {
  await seedCandidate(id, email, 'part2_ready');
  const { cookie } = await candidateCookie(email);
  const qs = (await (await req('/api/candidate/part1/start', post(cookie))).json<any>()).questions;
  for (const q of qs) await req('/api/candidate/part1/answer', post(cookie, { questionId: q.id, answerText: 'my answer' }));
  await req('/api/candidate/part1/submit', post(cookie));
  return qs;
}

describe('support grading and lifecycle', () => {
  beforeEach(async () => {
    await migrate(); await seedQuestions();
    fetchMock.activate(); fetchMock.disableNetConnect();
    fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, () => openAiReply({ score: 2, reasoning: 'ok', deductions: [{ reason: 'minor', marks: 1 }] })).persist();
  });

  it('a grader whose claim was dropped (Retake meanwhile) writes no scores and no rows', async () => {
    await finishedSupportCandidate();
    const admin = await adminCookie();
    await req('/api/admin/candidates/g1/retake', post(admin));
    await gradeAnyForTests(env, 'g1', 'grade_stale_claim');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM part1_answers WHERE candidate_id = 'g1'").first<any>()).toEqual({ n: 0 });
  });

  it('a grader holding the claim does write its scores', async () => {
    await finishedSupportCandidate();
    await ensureGradingClaimCols(env);
    await env.DB.prepare("UPDATE candidates SET grading_claim = 'grade_live' WHERE id = 'g1'").run();
    await gradeAnyForTests(env, 'g1', 'grade_live');
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM part1_answers WHERE candidate_id = 'g1' AND scored_at IS NOT NULL").first<any>();
    expect(r.n).toBe(5);
  });

  it('shortlist/reject only apply to a graded candidate', async () => {
    await seedCandidate('s1', 's1@x.com', 'in_progress');
    const pan = await panelCookie();
    expect((await req('/api/admin/candidates/s1/shortlist', post(pan))).status).toBe(409);
    expect((await req('/api/admin/candidates/s1/reject', post(pan))).status).toBe(409);
    expect((await env.DB.prepare("SELECT status FROM candidates WHERE id = 's1'").first<any>()).status).toBe('in_progress');
    await env.DB.prepare("UPDATE candidates SET status = 'evaluated' WHERE id = 's1'").run();
    expect((await req('/api/admin/candidates/s1/reject', post(pan))).status).toBe(200);
  });

  it('Analyze does not overwrite a shortlist made while grading', async () => {
    await finishedSupportCandidate();
    const admin = await adminCookie();
    await req('/api/admin/analysis/run', post(admin));
    await env.DB.prepare("UPDATE candidates SET status = 'shortlisted', grading_claim = 'g' WHERE id = 'g1'").run();
    await req('/api/admin/candidates/g1/grade', post(admin)); // claim is fresh, so this is 409 or keeps status
    expect((await env.DB.prepare("SELECT status FROM candidates WHERE id = 'g1'").first<any>()).status).toBe('shortlisted');
  });

  it('Manual fix of a finished candidate keeps them finished', async () => {
    await finishedSupportCandidate();
    const admin = await adminCookie();
    expect((await req('/api/admin/candidates/g1/manual', post(admin, { email: 'fixed@x.com' }))).status).toBe(200);
    expect(await env.DB.prepare("SELECT email, status FROM candidates WHERE id = 'g1'").first<any>()).toEqual({ email: 'fixed@x.com', status: 'submitted' });
    await seedCandidate('pf', 'pf-placeholder@x.com', 'parse_failed');
    await req('/api/admin/candidates/pf/manual', post(admin, { email: 'pf@x.com' }));
    expect((await env.DB.prepare("SELECT status FROM candidates WHERE id = 'pf'").first<any>()).status).toBe('part2_ready');
  });

  it('shortening the duration mid-test does not let the sweep close running attempts early', async () => {
    await seedCandidate('d1', 'd1@x.com');
    const { cookie } = await candidateCookie('d1@x.com');
    await req('/api/candidate/part1/start', post(cookie));
    // Started 70 minutes ago on a 120-minute test; the manager now sets 30 minutes.
    await env.DB.prepare("UPDATE attempts SET part1_started_at = datetime('now','-70 minutes'), part1_deadline_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','+60 minutes') WHERE candidate_id = 'd1'").run();
    const admin = await adminCookie();
    await req('/api/admin/assessment-duration', post(admin, { minutes: 30 }));
    await req('/api/admin/analysis/status', { headers: { Cookie: admin } });
    expect((await env.DB.prepare("SELECT part1_submitted_at FROM attempts WHERE candidate_id = 'd1'").first<any>()).part1_submitted_at).toBeNull();
  });

  it('after Resume, old marks are dropped and an edited answer is not shown as graded', async () => {
    const qs = await finishedSupportCandidate();
    await env.DB.prepare("UPDATE part1_answers SET ai_score = 3, scored_at = datetime('now') WHERE candidate_id = 'g1'").run();
    await env.DB.prepare("UPDATE candidates SET status = 'evaluated' WHERE id = 'g1'").run();
    const admin = await adminCookie();
    await req('/api/admin/candidates/g1/resume', post(admin));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM part1_answers WHERE candidate_id = 'g1' AND scored_at IS NOT NULL").first<any>()).n).toBe(0);
    const { cookie } = await candidateCookie('g1@x.com');
    await req('/api/candidate/part1/start', post(cookie));
    expect((await req('/api/candidate/part1/answer', post(cookie, { questionId: qs[0].id, answerText: 'better answer' }))).status).toBe(200);
    expect((await env.DB.prepare('SELECT answer_text, ai_score FROM part1_answers WHERE candidate_id = ? AND question_id = ?').bind('g1', qs[0].id).first<any>())).toEqual({ answer_text: 'better answer', ai_score: null });
  });

  it('grade-one refuses a reopened attempt even if it was finished a moment ago', async () => {
    await finishedSupportCandidate();
    const admin = await adminCookie();
    await req('/api/admin/candidates/g1/resume', post(admin));
    expect((await req('/api/admin/candidates/g1/grade', post(admin))).status).toBe(409);
    expect((await env.DB.prepare("SELECT status FROM candidates WHERE id = 'g1'").first<any>()).status).toBe('part2_ready');
  });
});

const docsEnv = { ...env, TEAM: 'docs', PART1_DURATION_MINUTES: '30', PART2_DURATION_MINUTES: '45', DOCS_PART1_QUESTIONS: '1', DOCS_PART2_QUESTIONS: '1' } as typeof env;
const dreq = (path: string, init: RequestInit = {}) => call(docsEnv, path, { ...init, headers: { ...(init.headers as any), Origin: O } });
const ck = (r: Response) => (r.headers.get('Set-Cookie') || '').split(';')[0];
async function docsSetup() {
  await migrate(); await applySql(d16); await applySql(d17); await applySql(d18);
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('docs_start_open', '1')").run();
  const stmt = env.DB.prepare("INSERT INTO question_bank (id, category, prompt, marks, word_limit, status, active) VALUES (?, ?, ?, ?, 300, 'active', 1)");
  await env.DB.batch([stmt.bind('w1', 'part1', 'Part one task.', 5), stmt.bind('w2', 'part2', 'Part two task.', 10)]);
  await seedCandidate('w', 'w@x.com', 'part2_ready');
}
const dLogin = async (email: string) => ck(await dreq('/api/candidate/login', post('', { email })));
const dAdmin = async () => ck(await dreq('/api/admin/login', post('', { email: 'admin@test.local', password: 'test-admin-pass' })));

describe('writers lifecycle', () => {
  beforeEach(docsSetup);

  it('Resume reopens a Part 1 that was closed by its deadline (an outage), not "between parts"', async () => {
    const c = await dLogin('w@x.com');
    await dreq('/api/candidate/part1/start', post(c));
    // The browser was away past the pause allowance; its next sync closes Part 1 at the deadline.
    await env.DB.prepare("UPDATE attempts SET part1_deadline_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 seconds') WHERE candidate_id = 'w'").run();
    await dreq('/api/candidate/part1/heartbeat', post(c));
    expect((await env.DB.prepare("SELECT part1_submitted_at FROM attempts WHERE candidate_id = 'w'").first<any>()).part1_submitted_at).not.toBeNull();
    const admin = await dAdmin();
    const r = await (await dreq('/api/admin/candidates/w/resume', post(admin))).json<any>();
    expect(r.reopened).toBe('part1');
  });

  it('shortlist is refused for a candidate who has not been graded', async () => {
    const admin = await dAdmin();
    expect((await dreq('/api/admin/candidates/w/shortlist', post(admin))).status).toBe(409);
  });

  it('the writers sweep uses the part deadline, not the current setting', async () => {
    const c = await dLogin('w@x.com');
    await dreq('/api/candidate/part1/start', post(c));
    await env.DB.prepare("UPDATE attempts SET part1_started_at = datetime('now','-50 minutes'), part1_deadline_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','+20 minutes') WHERE candidate_id = 'w'").run();
    const admin = await dAdmin();
    await dreq('/api/admin/analysis/status', { headers: { Cookie: admin } });
    expect((await env.DB.prepare("SELECT part1_submitted_at FROM attempts WHERE candidate_id = 'w'").first<any>()).part1_submitted_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Follow-up review: one browser per sitting
// ---------------------------------------------------------------------------

describe('support site — one browser per sitting', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); await seedCandidate('b1', 'b1@x.com'); });

  it('two sign-ins before Start: only the one that started can continue', async () => {
    const a = (await candidateCookie('b1@x.com')).cookie;
    const b = (await candidateCookie('b1@x.com')).cookie;
    const qs = (await (await req('/api/candidate/part1/start', post(a))).json<any>()).questions;
    for (const [path, body] of [['/api/candidate/part1/answer', { questionId: qs[0].id, answerText: 'helper' }], ['/api/candidate/part1/heartbeat', {}], ['/api/candidate/part1/submit', {}], ['/api/candidate/part1/start', {}]] as const) {
      const r = await req(path, post(b, body));
      expect(r.status).toBe(401);
      expect((await r.json<any>()).code).toBe('other_session');
    }
    expect((await req('/api/candidate/me', { headers: { Cookie: b } })).status).toBe(401);
    // The browser that started keeps working, including after a reload (same cookie).
    expect((await req('/api/candidate/me', { headers: { Cookie: a } })).status).toBe(200);
    expect((await req('/api/candidate/part1/answer', post(a, { questionId: qs[0].id, answerText: 'mine' }))).status).toBe(200);
    expect(await env.DB.prepare("SELECT answer_text FROM part1_answers WHERE candidate_id = 'b1'").first<any>()).toEqual({ answer_text: 'mine' });
  });

  it('the page never sees the sitting ids', async () => {
    const a = (await candidateCookie('b1@x.com')).cookie;
    await req('/api/candidate/part1/start', post(a));
    const me = await (await req('/api/candidate/me', { headers: { Cookie: a } })).json<any>();
    expect(me.attempt.part1_sid).toBeUndefined();
    expect(me.attempt.sessions_valid_after).toBeUndefined();
  });

  it('Retake and Restore access void earlier sign-ins', async () => {
    const a = (await candidateCookie('b1@x.com')).cookie;
    await req('/api/candidate/part1/start', post(a));
    const admin = await adminCookie();
    await req('/api/admin/candidates/b1/retake', post(admin));
    const r = await req('/api/candidate/me', { headers: { Cookie: a } });
    expect(r.status).toBe(401);
    expect((await r.json<any>()).code).toBe('session_ended');
    const a2 = (await candidateCookie('b1@x.com')).cookie;
    expect((await req('/api/candidate/part1/start', post(a2))).status).toBe(200);
    await req('/api/admin/candidates/b1/revoke', post(admin));
    await req('/api/admin/candidates/b1/unrevoke', post(admin));
    expect((await req('/api/candidate/me', { headers: { Cookie: a2 } })).status).toBe(401);
  });
});

describe('writers site — one browser per sitting', () => {
  beforeEach(docsSetup);

  it('Part 1 belongs to the starter; between parts a re-login may start Part 2, which then belongs to it', async () => {
    const a = await dLogin('w@x.com');
    const b = await dLogin('w@x.com');
    await dreq('/api/candidate/part1/start', post(a));
    expect((await dreq('/api/candidate/part1/heartbeat', post(b))).status).toBe(401);
    expect((await dreq('/api/candidate/part2/submit', post(b))).status).toBe(401);
    await dreq('/api/candidate/part1/submit', post(a));
    const c = await dLogin('w@x.com'); // the one re-login between the parts
    expect((await dreq('/api/candidate/part2/start', post(c))).status).toBe(200);
    const r = await dreq('/api/candidate/part2/heartbeat', post(a));
    expect(r.status).toBe(401);
    expect((await r.json<any>()).code).toBe('other_session');
    expect((await dreq('/api/candidate/part2/heartbeat', post(c))).status).toBe(200);
  });

  it('part2/submit cannot end a test that has not started', async () => {
    const a = await dLogin('w@x.com');
    expect((await dreq('/api/candidate/part2/submit', post(a))).status).toBe(409);
    expect((await env.DB.prepare("SELECT status FROM candidates WHERE id = 'w'").first<any>()).status).toBe('part2_ready');
  });
});

// ---------------------------------------------------------------------------
// Hardening notes from the audit
// ---------------------------------------------------------------------------
import { normalizeParsed } from '../src/lib/openai';

describe('hardening', () => {
  beforeEach(async () => { await migrate(); });

  it('a token with anything appended after the signature is refused', async () => {
    await seedCandidate('h1', 'h1@x.com');
    const { cookie } = await candidateCookie('h1@x.com');
    expect((await req('/api/candidate/me', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await req('/api/candidate/me', { headers: { Cookie: cookie + '.extra' } })).status).toBe(401);
  });

  it('two admin sign-ins never share a token, and signing in again ends this browser\'s previous session', async () => {
    const a = await adminCookie();
    const b = await adminCookie();
    expect(a).not.toBe(b);
    const login = await req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: a }, body: JSON.stringify({ email: 'panel@test.local', password: 'test-panel-pass' }) });
    expect(login.status).toBe(200);
    expect((await req('/api/admin/config', { headers: { Cookie: a } })).status).toBe(401);
    expect((await req('/api/admin/config', { headers: { Cookie: b } })).status).toBe(200);
  });

  it('OPENAI_BASE_URL is ignored unless it is https or a local address', async () => {
    fetchMock.activate(); fetchMock.disableNetConnect();
    fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, () => openAiReply({ score: 1, reasoning: 'x', deductions: [] }));
    const { gradeWrittenAnswer } = await import('../src/lib/openai');
    const g = await gradeWrittenAnswer({ ...env, OPENAI_BASE_URL: 'http://evil.example' } as any, { kind: 'sql', prompt: 'p', maxMarks: 3, answerText: 'a' } as any);
    expect(typeof g.score).toBe('number');
  });

  it('malformed resume output is coerced into a safe shape', () => {
    const p = normalizeParsed({ name: 42, email: '', skills: 'SQL, Python', projects: ['Dashboard', { name: 'Bot', technologies: 'x' }, null] });
    expect(p.name).toBe('42');
    expect(p.email).toBeNull();
    expect(p.skills).toEqual(['SQL', 'Python']);
    expect(p.projects.map((x) => x.name)).toEqual(['Dashboard', 'Bot']);
    expect(p.projects[1].technologies).toEqual(['x']);
    expect(normalizeParsed(null)).toEqual({ name: '', email: null, skills: [], projects: [] });
  });
});

describe('review of round 4 (regressions caught before release)', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); await seedCandidate('v1', 'v1@x.com'); });

  it('support: the final save sent as time runs out is stored', async () => {
    const { cookie } = await candidateCookie('v1@x.com');
    const qs = (await (await req('/api/candidate/part1/start', post(cookie))).json<any>()).questions;
    // 3 s left at the last sync, 3.2 s ago: the clock reaches zero on this save.
    await env.DB.prepare("UPDATE attempts SET part1_remaining_seconds = 3, part1_last_heartbeat_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-3.2 seconds') WHERE candidate_id = 'v1'").run();
    const r = await req('/api/candidate/part1/answer', post(cookie, { questionId: qs[0].id, answerText: 'last words' }));
    expect(r.status).toBe(200);
    expect((await env.DB.prepare("SELECT answer_text FROM part1_answers WHERE candidate_id = 'v1'").first<any>()).answer_text).toBe('last words');
    expect((await env.DB.prepare("SELECT part1_submitted_at FROM attempts WHERE candidate_id = 'v1'").first<any>()).part1_submitted_at).not.toBeNull();
  });

  it('Restore access on a candidate who is testing (stale screen) does not strand them', async () => {
    const { cookie } = await candidateCookie('v1@x.com');
    await req('/api/candidate/part1/start', post(cookie));
    const admin = await adminCookie();
    expect((await req('/api/admin/candidates/v1/unrevoke', post(admin))).status).toBe(200);
    expect((await req('/api/candidate/part1/heartbeat', post(cookie))).status).toBe(200);
  });

  it('a sign-in from before sittings were tracked (no sid) still starts and continues', async () => {
    await req('/api/candidate/login', post('', { email: 'v1@x.com' }));
    // Hand-make an old-style token {cid, iat} signed with the test secret.
    const body = btoa(JSON.stringify({ cid: 'v1', iat: Date.now() }));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const legacy = `chs_candidate=${body}.${sig}`;
    expect((await req('/api/candidate/part1/start', post(legacy))).status).toBe(200);
    expect((await req('/api/candidate/part1/heartbeat', post(legacy))).status).toBe(200);
  });
});
