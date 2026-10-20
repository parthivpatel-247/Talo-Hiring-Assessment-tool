import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { fresh, req, managerCookie, createDrive, createCandidate, candidateLogin, seedPaperQuestions } from './helpers';
import type { Db } from '../src/db/db';

let db: Db;
let mgr: string;
let drive: { id: string; code: string };

async function setMode(mode: string) {
  await req('/api/admin/settings', { method: 'PATCH', headers: { Cookie: mgr }, json: { loginMode: mode } });
}

describe('candidate sign-in', () => {
  beforeEach(async () => {
    db = await fresh();
    await seedPaperQuestions(db);
    mgr = await managerCookie();
    drive = await createDrive(mgr);
    await createCandidate(db, 'c1', 'asha@college.edu', { driveId: drive.id });
  });

  it('once a personal code is issued, only that code works (classmates with the hall code cannot sign in as them)', async () => {
    const r = await (await req('/api/admin/candidates/bulk', { method: 'POST', headers: { Cookie: mgr }, json: { action: 'generate_codes', ids: ['c1'] } })).json<any>();
    const personal = r.codes[0].code;
    expect((await candidateLogin('asha@college.edu', drive.code)).res.status).toBe(401);
    expect((await candidateLogin('asha@college.edu', personal)).res.status).toBe(200);
  });

  it('signing out invalidates the session on the server, not just the cookie', async () => {
    const { cookie } = await candidateLogin('asha@college.edu', drive.code);
    expect((await req('/api/candidate/me', { headers: { Cookie: cookie } })).status).toBe(200);
    await req('/api/candidate/logout', { method: 'POST', headers: { Cookie: cookie } });
    expect((await req('/api/candidate/me', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('only wrong codes count toward the per-email lock, and the lock is per email', async () => {
    for (let i = 0; i < 10; i++) await candidateLogin('asha@college.edu', 'WRONG' + i);
    const locked = await candidateLogin('asha@college.edu', drive.code);
    expect(locked.res.status).toBe(429);
    await createCandidate(db, 'c2', 'ravi@college.edu', { driveId: drive.id });
    expect((await candidateLogin('ravi@college.edu', drive.code)).res.status).toBe(200);
  });

  it('malformed URL encoding is a 404, not a crash', async () => {
    const r = await req('/api/admin/candidates/%E0', { headers: { Cookie: mgr } });
    expect(r.status).toBe(404);
    expect(r.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('needs email + the hall code; unknown email and wrong code get the same answer', async () => {
    const noCode = await candidateLogin('asha@college.edu');
    const wrong = await candidateLogin('asha@college.edu', 'ZZZZZZ');
    const unknown = await candidateLogin('nobody@college.edu', drive.code);
    expect([noCode.res.status, wrong.res.status, unknown.res.status]).toEqual([401, 401, 401]);
    const msgs = await Promise.all([noCode.res.json<any>(), wrong.res.json<any>(), unknown.res.json<any>()]);
    expect(new Set(msgs.map((m) => m.error)).size).toBe(1);
    const ok = await candidateLogin('ASHA@college.edu', drive.code.toLowerCase());
    expect(ok.res.status).toBe(200);
    expect(ok.cookie).toMatch(/__Host-talo_cand=/);
  });

  it('a personal invite code works; plaintext codes are returned once and only hashes are stored', async () => {
    const gen = await (await req('/api/admin/candidates/bulk', { method: 'POST', headers: { Cookie: mgr }, json: { action: 'generate_codes', ids: ['c1'] } })).json<any>();
    const code = gen.codes[0].code;
    expect(code).toMatch(/^\d{6}$/);
    const row = await db.first<any>('SELECT invite_code_hash FROM candidates WHERE id = ?', 'c1');
    expect(row.invite_code_hash).not.toContain(code);
    expect((await candidateLogin('asha@college.edu', code)).res.status).toBe(200);
  });

  it('a closed drive stops accepting its hall code', async () => {
    await req(`/api/admin/drives/${drive.id}`, { method: 'PATCH', headers: { Cookie: mgr }, json: { status: 'closed' } });
    expect((await candidateLogin('asha@college.edu', drive.code)).res.status).toBe(401);
  });

  it('specific messages only after the code is right: not ready, revoked', async () => {
    await createCandidate(db, 'c2', 'ravi@college.edu', { driveId: drive.id, status: 'parse_failed' });
    expect((await candidateLogin('ravi@college.edu', 'WRONG1')).res.status).toBe(401);
    const nr = await candidateLogin('ravi@college.edu', drive.code);
    expect(nr.res.status).toBe(409);
    await req('/api/admin/candidates/bulk', { method: 'POST', headers: { Cookie: mgr }, json: { action: 'revoke', ids: ['c1'] } });
    expect((await candidateLogin('asha@college.edu', drive.code)).res.status).toBe(403);
  });

  it('one test per email: a second sign-in is blocked once the test has started', async () => {
    const a = await candidateLogin('asha@college.edu', drive.code);
    expect((await req('/api/candidate/start', { method: 'POST', headers: { Cookie: a.cookie } })).status).toBe(200);
    const b = await candidateLogin('asha@college.edu', drive.code);
    expect(b.res.status).toBe(403);
    expect((await b.res.json<any>()).code).toBe('already_started');
    const at = await db.first<any>('SELECT blocked_login_count FROM attempts WHERE candidate_id = ?', 'c1');
    expect(at.blocked_login_count).toBe(1);
    // The original session keeps working.
    expect((await req('/api/candidate/heartbeat', { method: 'POST', headers: { Cookie: a.cookie } })).status).toBe(200);
  });

  it('a new sign-in (before starting) invalidates the older cookie', async () => {
    const a = await candidateLogin('asha@college.edu', drive.code);
    const b = await candidateLogin('asha@college.edu', drive.code);
    expect((await req('/api/candidate/me', { headers: { Cookie: a.cookie } })).status).toBe(401);
    expect((await req('/api/candidate/me', { headers: { Cookie: b.cookie } })).status).toBe(200);
  });

  it('rate-limits repeated sign-in attempts for one email', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await candidateLogin('asha@college.edu', 'BAD' + i)).res.status;
    expect(last).toBe(429);
  });

  it('email-only mode still works if a manager chooses it', async () => {
    await setMode('email_only');
    expect((await candidateLogin('asha@college.edu')).res.status).toBe(200);
  });
});

describe('the assessment', () => {
  let cookie: string;
  beforeEach(async () => {
    db = await fresh();
    await seedPaperQuestions(db);
    mgr = await managerCookie();
    drive = await createDrive(mgr);
    await createCandidate(db, 'c1', 'asha@college.edu', { driveId: drive.id });
    cookie = (await candidateLogin('asha@college.edu', drive.code)).cookie;
  });

  const call = (path: string, init: any = {}) => req(path, { ...init, headers: { ...(init.headers || {}), Cookie: cookie } });

  it('serves a 5-question paper with no answer keys, rubrics or marks', async () => {
    // Preparing assigns the paper but reveals nothing until the clock starts.
    const prepared = await (await call('/api/candidate/prepare', { method: 'POST' })).json<any>();
    expect(prepared.questionCount).toBe(5);
    expect(prepared.questions).toBeUndefined();
    expect((await call('/api/candidate/questions')).status).toBe(409);
    const me0 = await (await call('/api/candidate/me')).json<any>();
    expect(me0.attempt.started).toBe(false);
    const prep = await (await call('/api/candidate/start', { method: 'POST' })).json<any>();
    expect(prep.questions.length).toBe(5);
    const cats = prep.questions.map((q: any) => q.category);
    expect(cats.filter((c: string) => c === 'sql').length).toBe(2);
    expect(cats).toContain('coding');
    expect(cats).toContain('dsa');
    expect(cats).toContain('scenario');
    // Only display fields leave the server (question text itself may mention words like "score").
    const allowed = ['id', 'category', 'title', 'topic', 'difficulty', 'prompt', 'sampleData', 'hint', 'answer', 'language', 'savedAt'];
    for (const q of prep.questions) expect(Object.keys(q).sort()).toEqual([...allowed].sort());
    const text = JSON.stringify(prep);
    for (const secret of ['reference_answer', 'referenceAnswer', 'checkpoints', 'expected_output', 'expectedOutput', '"ref"', '"rubric"']) {
      expect(text).not.toContain(secret);
    }
  });

  it('a drive that is not live yet cannot be started (questions stay hidden)', async () => {
    const d2 = await createDrive(mgr, 'Next week drive', false);
    await createCandidate(db, 'c9', 'early@college.edu', { driveId: d2.id });
    const { cookie: c9 } = await candidateLogin('early@college.edu', d2.code);
    const st = await req('/api/candidate/start', { method: 'POST', headers: { Cookie: c9 } });
    expect(st.status).toBe(409);
    expect((await st.json<any>()).code).toBe('drive_not_live');
    await req(`/api/admin/drives/${d2.id}`, { method: 'PATCH', headers: { Cookie: mgr }, json: { status: 'live' } });
    expect((await req('/api/candidate/start', { method: 'POST', headers: { Cookie: c9 } })).status).toBe(200);
  });

  it('saves answers with a language, restores them, and enforces the word limit', async () => {
    const st = await (await call('/api/candidate/start', { method: 'POST' })).json<any>();
    expect(st.attempt.remainingSeconds).toBeGreaterThan(3500);
    const q = st.questions[2];
    const save = await call(`/api/candidate/answers/${q.id}`, { method: 'PUT', json: { text: 'function f(a) { return a }', language: 'javascript' } });
    expect(save.status).toBe(200);
    const again = await (await call('/api/candidate/questions')).json<any>();
    const restored = again.questions.find((x: any) => x.id === q.id);
    expect(restored.answer).toBe('function f(a) { return a }');
    expect(restored.language).toBe('javascript');
    const tooMany = await call(`/api/candidate/answers/${q.id}`, { method: 'PUT', json: { text: 'word '.repeat(1100) } });
    expect(tooMany.status).toBe(400);
    const badLang = await call(`/api/candidate/answers/${q.id}`, { method: 'PUT', json: { text: 'x', language: 'cobol' } });
    expect(badLang.status).toBe(400);
    const notMine = await call('/api/candidate/answers/q-not-assigned', { method: 'PUT', json: { text: 'x' } });
    expect(notMine.status).toBe(404);
  });

  it('Gap A fixed: answers cannot be changed after submitting', async () => {
    const st = await (await call('/api/candidate/start', { method: 'POST' })).json<any>();
    const q = st.questions[0];
    await call(`/api/candidate/answers/${q.id}`, { method: 'PUT', json: { text: 'first version' } });
    expect((await call('/api/candidate/submit', { method: 'POST', json: { reason: 'candidate' } })).status).toBe(200);
    const late = await call(`/api/candidate/answers/${q.id}`, { method: 'PUT', json: { text: 'edited after submit' } });
    expect(late.status).toBe(409);
    const row = await db.first<any>('SELECT answer_text FROM answers WHERE candidate_id = ? AND question_id = ?', 'c1', q.id);
    expect(row.answer_text).toBe('first version');
  });

  it('Gap B fixed: a client that never sends heartbeats is still bound by the hard deadline', async () => {
    const st = await (await call('/api/candidate/start', { method: 'POST' })).json<any>();
    const q = st.questions[0];
    // Pretend the test started 2 hours ago and no heartbeat was ever sent.
    const past = new Date(Date.now() - 2 * 3600_000);
    await db.run('UPDATE attempts SET started_at = ?, last_heartbeat_at = ?, deadline_at = ? WHERE candidate_id = ?',
      past.toISOString(), past.toISOString(), new Date(past.getTime() + 70 * 60_000).toISOString(), 'c1');
    const save = await call(`/api/candidate/answers/${q.id}`, { method: 'PUT', json: { text: 'too late' } });
    expect(save.status).toBe(409);
    const at = await db.first<any>('SELECT submitted_at, submit_reason FROM attempts WHERE candidate_id = ?', 'c1');
    expect(at.submitted_at).toBeTruthy();
    expect(at.submit_reason).toBe('deadline');
  });

  it('the clock pauses during a short network gap but never runs past the deadline', async () => {
    await call('/api/candidate/start', { method: 'POST' });
    // A 5-minute gap since the last heartbeat counts only 15 seconds.
    const a = await db.first<any>('SELECT remaining_seconds FROM attempts WHERE candidate_id = ?', 'c1');
    await db.run('UPDATE attempts SET last_heartbeat_at = ? WHERE candidate_id = ?', new Date(Date.now() - 300_000).toISOString(), 'c1');
    const hb = await (await call('/api/candidate/heartbeat', { method: 'POST' })).json<any>();
    expect(a.remaining_seconds - hb.remainingSeconds).toBeLessThanOrEqual(16);
    // Remaining can never exceed time to the hard deadline.
    await db.run('UPDATE attempts SET deadline_at = ? WHERE candidate_id = ?', new Date(Date.now() + 90_000).toISOString(), 'c1');
    const hb2 = await (await call('/api/candidate/heartbeat', { method: 'POST' })).json<any>();
    expect(hb2.remainingSeconds).toBeLessThanOrEqual(90);
  });

  it('records proctoring and connection events with counters', async () => {
    await call('/api/candidate/start', { method: 'POST' });
    await call('/api/candidate/events', { method: 'POST', json: { type: 'tab_hidden' } });
    await call('/api/candidate/events', { method: 'POST', json: { type: 'offline' } });
    await call('/api/candidate/events', { method: 'POST', json: { type: 'online', detail: { seconds: 42, retries: 4 } } });
    await call('/api/candidate/events', { method: 'POST', json: { type: 'paste_blocked' } });
    expect((await call('/api/candidate/events', { method: 'POST', json: { type: 'evil' } })).status).toBe(400);
    const at = await db.first<any>('SELECT tab_switch_count, offline_count, offline_seconds, paste_blocked_count FROM attempts WHERE candidate_id = ?', 'c1');
    expect(at).toEqual({ tab_switch_count: 1, offline_count: 1, offline_seconds: 42, paste_blocked_count: 1 });
  });

  it('time up on the server submits the attempt', async () => {
    await call('/api/candidate/start', { method: 'POST' });
    await db.run('UPDATE attempts SET remaining_seconds = 3, last_heartbeat_at = ? WHERE candidate_id = ?', new Date(Date.now() - 10_000).toISOString(), 'c1');
    const hb = await (await call('/api/candidate/heartbeat', { method: 'POST' })).json<any>();
    expect(hb.submitted).toBe(true);
    const c = await db.first<any>('SELECT status FROM candidates WHERE id = ?', 'c1');
    expect(c.status).toBe('submitted');
  });
});

describe('paper rotation, retake and resume', () => {
  beforeEach(async () => {
    db = await fresh();
    await seedPaperQuestions(db);
    mgr = await managerCookie();
    drive = await createDrive(mgr);
  });

  const assigned = async (id: string) => (await db.all<{ question_id: string }>('SELECT question_id FROM assignments WHERE candidate_id = ? ORDER BY position', id)).map((r) => r.question_id);

  async function paperFor(id: string, email: string) {
    await createCandidate(db, id, email, { driveId: drive.id });
    const { cookie } = await candidateLogin(email, drive.code);
    await req('/api/candidate/prepare', { method: 'POST', headers: { Cookie: cookie } });
    return { cookie, ids: await assigned(id) };
  }

  it('least-used rotation spreads DSA questions evenly across students', async () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 12; i++) {
      const p = await paperFor(`s${i}`, `s${i}@college.edu`);
      for (const id of p.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const dsa = await db.all<{ id: string; assigned_count: number }>("SELECT id, assigned_count FROM questions WHERE category = 'dsa'");
    const used = dsa.map((q) => q.assigned_count);
    expect(Math.max(...used)).toBeLessThanOrEqual(1); // 12 students, 37 DSA questions: no repeats yet
  });

  it('a retake gives a fresh paper with no repeated questions', async () => {
    const first = await paperFor('r1', 'r1@college.edu');
    await req('/api/admin/candidates/bulk', { method: 'POST', headers: { Cookie: mgr }, json: { action: 'retake', ids: ['r1'] } });
    const { cookie } = await candidateLogin('r1@college.edu', drive.code);
    await req('/api/candidate/prepare', { method: 'POST', headers: { Cookie: cookie } });
    const second = await assigned('r1');
    const dsaScn = (ids: string[]) => ids.filter((x) => x.startsWith('qb-'));
    for (const id of dsaScn(second)) expect(dsaScn(first.ids)).not.toContain(id);
  });

  it('resume keeps the same questions and saved answers, with the time that was left', async () => {
    const p = await paperFor('m1', 'm1@college.edu');
    await req('/api/candidate/start', { method: 'POST', headers: { Cookie: p.cookie } });
    await req(`/api/candidate/answers/${p.ids[0]}`, { method: 'PUT', headers: { Cookie: p.cookie }, json: { text: 'my saved work' } });
    await db.run('UPDATE attempts SET remaining_seconds = 1200 WHERE candidate_id = ?', 'm1');
    await req('/api/candidate/submit', { method: 'POST', headers: { Cookie: p.cookie }, json: { reason: 'left_screen' } });
    const r = await req('/api/admin/candidates/bulk', { method: 'POST', headers: { Cookie: mgr }, json: { action: 'resume', ids: ['m1'] } });
    expect(r.status).toBe(200);
    const { cookie } = await candidateLogin('m1@college.edu', drive.code);
    const st = await (await req('/api/candidate/start', { method: 'POST', headers: { Cookie: cookie } })).json<any>();
    expect(st.questions.map((q: any) => q.id)).toEqual(p.ids);
    expect(st.questions[0].answer).toBe('my saved work');
    expect(st.attempt.remainingSeconds).toBeGreaterThan(1150);
    expect(st.attempt.remainingSeconds).toBeLessThanOrEqual(1200);
  });
});
