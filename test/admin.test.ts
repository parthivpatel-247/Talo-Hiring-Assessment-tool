import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import { fresh, req, managerCookie, memberCookie, createDrive, createCandidate, candidateLogin, seedPaperQuestions, openAiReply } from './helpers';
import { MAILTO_ONLY_PDF_B64, NO_EMAIL_PDF_B64 } from './fixtures/resumes';
import { runScheduled, retentionPurge } from '../src/cron';
import type { Db } from '../src/db/db';

let db: Db;
let mgr: string;

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const post = (path: string, json: unknown, cookie = mgr) => req(path, { method: 'POST', headers: { Cookie: cookie }, json });

async function submittedCandidate(id: string, email: string, driveCode: string, driveId: string, answer = 'SELECT * FROM t') {
  await createCandidate(db, id, email, { driveId });
  const { cookie } = await candidateLogin(email, driveCode);
  const st = await (await req('/api/candidate/start', { method: 'POST', headers: { Cookie: cookie } })).json<any>();
  for (const q of st.questions) await req(`/api/candidate/answers/${q.id}`, { method: 'PUT', headers: { Cookie: cookie }, json: { text: answer } });
  await req('/api/candidate/submit', { method: 'POST', headers: { Cookie: cookie }, json: {} });
  return st.questions as { id: string }[];
}

describe('admin candidates', () => {
  let drive: { id: string; code: string };
  beforeEach(async () => {
    db = await fresh();
    await seedPaperQuestions(db);
    mgr = await managerCookie();
    drive = await createDrive(mgr);
  });

  it('lists candidates with time used, answered count and integrity signals', async () => {
    await submittedCandidate('c1', 'asha@college.edu', drive.code, drive.id);
    const list = await (await req('/api/admin/candidates', { headers: { Cookie: mgr } })).json<any>();
    const c = list.candidates.find((x: any) => x.id === 'c1');
    expect(c.status).toBe('submitted');
    expect(c.answered).toBe(5);
    expect(c.questionCount).toBe(5);
    expect(c.timeUsedSeconds).toBeGreaterThanOrEqual(0);
    expect(c.signals.logins).toBe(1);
    expect(c.drive).toBe('Test College Drive');
  });

  it('detail view shows the paper with answer keys (admin only)', async () => {
    await submittedCandidate('c1', 'asha@college.edu', drive.code, drive.id);
    const d = await (await req('/api/admin/candidates/c1', { headers: { Cookie: mgr } })).json<any>();
    expect(d.paper.length).toBe(5);
    expect(d.paper[0]).toHaveProperty('reference_answer');
    expect(d.events.some((e: any) => e.type === 'submit')).toBe(true);
  });

  it('fix details: a parse-failed candidate becomes ready once the email is set', async () => {
    await createCandidate(db, 'p1', 'pending+p1@unresolved.local', { status: 'parse_failed', name: 'Gouri' });
    const r = await req('/api/admin/candidates/p1', { method: 'PATCH', headers: { Cookie: mgr }, json: { email: 'gouri@college.edu', name: 'Gouri Patil' } });
    expect(r.status).toBe(200);
    const c = await db.first<any>('SELECT status, email, email_status, name FROM candidates WHERE id = ?', 'p1');
    expect(c).toEqual({ status: 'ready', email: 'gouri@college.edu', email_status: 'confirmed', name: 'Gouri Patil' });
    await createCandidate(db, 'p2', 'taken@college.edu');
    expect((await req('/api/admin/candidates/p1', { method: 'PATCH', headers: { Cookie: mgr }, json: { email: 'taken@college.edu' } })).status).toBe(409);
  });

  it('bulk delete: needs typed confirmation, max 10, keeps a restorable backup', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `d${i}`);
    for (const id of ids) await createCandidate(db, id, `${id}@college.edu`, { driveId: drive.id });
    await env.RESUMES.put('resumes/d0.pdf', bytes(MAILTO_ONLY_PDF_B64));
    await db.run("UPDATE candidates SET resume_key = 'resumes/d0.pdf' WHERE id = 'd0'");
    expect((await post('/api/admin/candidates/bulk', { action: 'delete', ids, confirm: 'DELETE 11' })).status).toBe(400);
    expect((await post('/api/admin/candidates/bulk', { action: 'delete', ids: ['d0', 'd1'] })).status).toBe(400);
    const del = await (await post('/api/admin/candidates/bulk', { action: 'delete', ids: ['d0', 'd1'], confirm: 'DELETE 2' })).json<any>();
    expect(del.backupId).toBeTruthy();
    expect(await db.first('SELECT id FROM candidates WHERE id = ?', 'd0')).toBeNull();
    expect(await env.RESUMES.head('resumes/d0.pdf')).toBeNull();
    const restore = await post(`/api/admin/system/backups/${del.backupId}/restore`, {});
    expect(restore.status).toBe(200);
    expect(await db.first('SELECT id FROM candidates WHERE id = ?', 'd0')).toBeTruthy();
    expect(await env.RESUMES.head('resumes/d0.pdf')).toBeTruthy();
    expect((await post(`/api/admin/system/backups/${del.backupId}/restore`, {})).status).toBe(409);
  });

  it('members can shortlist and grade but cannot delete or retake', async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, openAiReply({ questions: [{ question: 'Walk me through your project', model_answer: 'A good answer covers…', follow_up: 'Why?', based_on: 'project' }] }));
    const mem = await memberCookie(mgr);
    await createCandidate(db, 'x1', 'x1@college.edu', { status: 'graded' });
    expect((await post('/api/admin/candidates/bulk', { action: 'shortlist', ids: ['x1'] }, mem)).status).toBe(200);
    expect((await post('/api/admin/candidates/bulk', { action: 'retake', ids: ['x1'] }, mem)).status).toBe(403);
    expect((await post('/api/admin/candidates/bulk', { action: 'delete', ids: ['x1'], confirm: 'DELETE 1' }, mem)).status).toBe(403);
    const c = await db.first<any>('SELECT status, decided_by FROM candidates WHERE id = ?', 'x1');
    expect(c.status).toBe('shortlisted');
    expect(c.decided_by).toBe('member@test.local');
    fetchMock.deactivate();
  });

  it('bulk actions handle more than 100 ids (no D1 bound-parameter limit)', async () => {
    const stmts = [];
    for (let i = 0; i < 150; i++) stmts.push(db.stmt("INSERT INTO candidates (id, email, email_status, name, status) VALUES (?, ?, 'parsed', ?, 'ready')", `b${i}`, `student${i}@college.edu`, `Student ${i}`));
    await db.batch(stmts);
    const ids = Array.from({ length: 150 }, (_, i) => `b${i}`);
    const r = await post('/api/admin/candidates/bulk', { action: 'generate_codes', ids });
    expect(r.status).toBe(200);
    const body = await r.json<any>();
    expect(body.codes.length).toBe(150);
    expect(body.codes.every((c: any) => /^\d{6}$/.test(c.code))).toBe(true);
    const moved = await post('/api/admin/candidates/bulk', { action: 'move_drive', ids, driveId: drive.id });
    expect(moved.status).toBe(200);
    expect(await db.value('SELECT COUNT(*) AS n FROM candidates WHERE drive_id = ?', drive.id)).toBe(150);
    // A personal code works for sign-in.
    const login = await req('/api/candidate/login', { method: 'POST', json: { email: 'student7@college.edu', code: body.codes.find((c: any) => c.id === 'b7').code } });
    expect(login.status).toBe(200);
  });

  it('delete all candidates: typed confirmation, snapshot first, restorable batches, exports removed', async () => {
    await submittedCandidate('c1', 'asha@college.edu', drive.code, drive.id);
    await createCandidate(db, 'c2', 'ravi@college.edu', { driveId: drive.id });
    await post('/api/admin/exports', { format: 'csv' });
    expect((await post('/api/admin/system/wipe', { confirm: 'nope' })).status).toBe(400);
    const member = await memberCookie(mgr);
    expect((await post('/api/admin/system/wipe', { confirm: 'DELETE ALL CANDIDATES' }, member)).status).toBe(403);
    const r = await (await post('/api/admin/system/wipe', { confirm: 'DELETE ALL CANDIDATES', step: 0 })).json<any>();
    expect(r.deleted).toBe(2);
    expect(r.remaining).toBe(0);
    expect(r.snapshotId).toBeTruthy();
    expect(await db.value('SELECT COUNT(*) AS n FROM candidates')).toBe(0);
    expect(await db.value('SELECT COUNT(*) AS n FROM exports')).toBe(0);
    expect(await db.value('SELECT COUNT(*) AS n FROM questions WHERE deleted_at IS NULL')).toBeGreaterThan(0);
    const restore = await post(`/api/admin/system/backups/${r.backupId}/restore`, {});
    expect(restore.status).toBe(200);
    expect(await db.value('SELECT COUNT(*) AS n FROM candidates')).toBe(2);
  });

  it('delete all candidates waits for running tests unless forced', async () => {
    await createCandidate(db, 'c1', 'asha@college.edu', { driveId: drive.id });
    const { cookie } = await candidateLogin('asha@college.edu', drive.code);
    await req('/api/candidate/start', { method: 'POST', headers: { Cookie: cookie } });
    const r = await post('/api/admin/system/wipe', { confirm: 'DELETE ALL CANDIDATES', step: 0 });
    expect(r.status).toBe(409);
    expect((await r.json<any>()).code).toBe('tests_running');
    const f = await (await post('/api/admin/system/wipe', { confirm: 'DELETE ALL CANDIDATES', step: 0, force: true })).json<any>();
    expect(f.deleted).toBe(1);
  });

  it('every admin action is in the audit log with the actor', async () => {
    await createCandidate(db, 'x1', 'x1@college.edu', { status: 'graded' });
    await post('/api/admin/candidates/bulk', { action: 'reject', ids: ['x1'] });
    const log = await (await req('/api/admin/system/audit', { headers: { Cookie: mgr } })).json<any>();
    const e = log.events.find((x: any) => x.action === 'bulk_reject');
    expect(e.actor).toBe('admin@test.local');
  });
});

describe('resume upload and parsing', () => {
  beforeEach(async () => {
    db = await fresh();
    mgr = await managerCookie();
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterEach(() => fetchMock.deactivate());

  async function upload(files: { name: string; data: Uint8Array }[]) {
    const form = new FormData();
    for (const f of files) form.append('files', new File([f.data], f.name, { type: 'application/pdf' }));
    return req('/api/admin/resumes/upload', { method: 'POST', headers: { Cookie: mgr }, body: form });
  }
  const mockAi = (obj: unknown) => fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' }).reply(200, openAiReply(obj));

  it('rejects files that are not really PDFs (checks the file signature, not the name)', async () => {
    const r = await (await upload([{ name: 'evil.pdf', data: new TextEncoder().encode('<html><script>alert(1)</script></html>'.repeat(20)) }, { name: 'ok.pdf', data: bytes(MAILTO_ONLY_PDF_B64) }])).json<any>();
    expect(r.uploaded.length).toBe(1);
    expect(r.skipped[0].reason).toMatch(/Not a PDF/);
  });

  it('uses the email hidden in a mailto link, drops invented names, and fails clearly when no email exists', async () => {
    await upload([{ name: 'asha.pdf', data: bytes(MAILTO_ONLY_PDF_B64) }]);
    mockAi({ name: 'John Doe', email: 'johndoe@example.com', skills: ['Python'], projects: [], college: 'VIIT Pune' });
    const p1 = await (await post('/api/admin/resumes/process', {})).json<any>();
    // "John Doe" is not on the resume -> no name -> parse_failed, but the real email was found.
    expect(p1.processed[0].ok).toBe(false);
    expect(p1.processed[0].error).toMatch(/No name/);

    await upload([{ name: 'asha2.pdf', data: bytes(MAILTO_ONLY_PDF_B64) }]);
    mockAi({ name: 'Asha Kulkarni', email: null, skills: ['SQL'], projects: [], college: 'VIIT Pune', graduation_year: 2027 });
    const p2 = await (await post('/api/admin/resumes/process', {})).json<any>();
    expect(p2.processed[0].error ?? 'ok').toBe('ok');
    const c = await db.first<any>("SELECT email, name, status, resume_college, graduation_year FROM candidates WHERE status = 'ready'");
    expect(c.email).toBe('asha.k@college.edu');
    expect(c.name).toBe('Asha Kulkarni');
    expect(c.resume_college).toBe('VIIT Pune');
    expect(c.graduation_year).toBe(2027);

    await upload([{ name: 'none.pdf', data: bytes(NO_EMAIL_PDF_B64) }]);
    mockAi({ name: 'Asha Kulkarni', email: 'invented@example.com', skills: [], projects: [] });
    const p3 = await (await post('/api/admin/resumes/process', {})).json<any>();
    expect(p3.processed[0].ok).toBe(false);
    expect(p3.processed[0].error).toMatch(/No email/);
  });
});

describe('security headers and request hygiene', () => {
  beforeEach(async () => { db = await fresh(); });

  it('API and pages carry CSP, frame, HSTS, nosniff and referrer headers', async () => {
    for (const path of ['/api/health', '/', '/admin/']) {
      const r = await req(path);
      expect(r.headers.get('Content-Security-Policy') || (path === '/api/health' ? 'x' : null)).toBeTruthy();
      expect(r.headers.get('X-Frame-Options')).toBe('DENY');
      expect(r.headers.get('Strict-Transport-Security')).toMatch(/max-age=31536000/);
      expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(r.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    }
    const csp = (await req('/api/health')).headers.get('Content-Security-Policy')!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect((await req('/api/health')).headers.get('X-Robots-Tag')).toMatch(/noindex/);
  });

  it('rejects cross-site POSTs and sends no CORS headers', async () => {
    const r = await req('/api/candidate/login', { method: 'POST', headers: { Origin: 'https://evil.example' }, json: { email: 'a@b.co' } });
    expect(r.status).toBe(403);
    const pre = await req('/api/candidate/login', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('every admin route needs a session', async () => {
    for (const [m, p] of [['GET', '/api/admin/candidates'], ['GET', '/api/admin/overview'], ['POST', '/api/admin/candidates/bulk'], ['GET', '/api/admin/exports'], ['GET', '/api/admin/system/audit'], ['PATCH', '/api/admin/settings']]) {
      expect((await req(p, { method: m, json: m === 'GET' ? undefined : {} })).status).toBe(401);
    }
  });

  it('unknown API routes return JSON 404; wrong method returns 405', async () => {
    const r = await req('/api/nope');
    expect(r.status).toBe(404);
    expect((await r.json<any>()).code).toBe('not_found');
    expect((await req('/api/candidate/login')).status).toBe(405);
  });
});

describe('exports, similarity and scheduled jobs', () => {
  let drive: { id: string; code: string };
  beforeEach(async () => {
    db = await fresh();
    await seedPaperQuestions(db);
    mgr = await managerCookie();
    drive = await createDrive(mgr);
  });

  it('versioned Excel and CSV exports (CSV neutralises formula injection)', async () => {
    await submittedCandidate('c1', 'asha@college.edu', drive.code, drive.id);
    await db.run("UPDATE candidates SET name = '=HYPERLINK(\"http://x\")' WHERE id = 'c1'");
    const x1 = await (await post('/api/admin/exports', { format: 'xlsx', scope: 'detailed' })).json<any>();
    const x2 = await (await post('/api/admin/exports', { format: 'csv', scope: 'summary' })).json<any>();
    expect(x1.version).toBe(1);
    expect(x2.version).toBe(2);
    const file = await req(x1.downloadUrl, { headers: { Cookie: mgr } });
    const head = new Uint8Array(await file.arrayBuffer()).slice(0, 2);
    expect(String.fromCharCode(...head)).toBe('PK');
    const csv = await (await req(x2.downloadUrl, { headers: { Cookie: mgr } })).text();
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    const hist = await (await req('/api/admin/exports', { headers: { Cookie: mgr } })).json<any>();
    expect(hist.exports.map((e: any) => e.version)).toEqual([2, 1]);
  });

  it('flags near-identical answers to the same question', async () => {
    const long = 'first we sort the array then we walk it with two pointers moving inward and we count every pair whose sum matches the target value exactly and finally we return the count of pairs that we found';
    await db.run("UPDATE settings SET value = value WHERE 1 = 0");
    await submittedCandidate('s1', 's1@college.edu', drive.code, drive.id, long);
    // Force the second student onto the same paper so the answers overlap.
    await createCandidate(db, 's2', 's2@college.edu', { driveId: drive.id, status: 'submitted' });
    await db.run("INSERT INTO assignments (candidate_id, question_id, position) SELECT 's2', question_id, position FROM assignments WHERE candidate_id = 's1'");
    await db.run("INSERT INTO answers (candidate_id, question_id, answer_text, word_count) SELECT 's2', question_id, answer_text, word_count FROM answers WHERE candidate_id = 's1'");
    const r = await (await post('/api/admin/integrity/similarity/run', {})).json<any>();
    expect(r.flagged).toBeGreaterThanOrEqual(5);
    const pairs = await (await req('/api/admin/integrity/similarity', { headers: { Cookie: mgr } })).json<any>();
    expect(pairs.pairs[0].score).toBe(1);
  });

  it('the 10-minute job closes attempts whose deadline has passed', async () => {
    await createCandidate(db, 'z1', 'z1@college.edu', { driveId: drive.id });
    const { cookie } = await candidateLogin('z1@college.edu', drive.code);
    await req('/api/candidate/start', { method: 'POST', headers: { Cookie: cookie } });
    await db.run('UPDATE attempts SET deadline_at = ? WHERE candidate_id = ?', new Date(Date.now() - 10 * 60_000).toISOString(), 'z1');
    await runScheduled('*/10 * * * *', env as never);
    const a = await db.first<any>('SELECT submit_reason FROM attempts WHERE candidate_id = ?', 'z1');
    expect(a.submit_reason).toBe('auto_close');
  });

  it('retention purge removes old candidates, their resumes and expired backups', async () => {
    await createCandidate(db, 'old', 'old@college.edu');
    await env.RESUMES.put('resumes/old.pdf', 'x');
    await db.run("UPDATE candidates SET created_at = '2020-01-01T00:00:00Z', resume_key = 'resumes/old.pdf' WHERE id = 'old'");
    await createCandidate(db, 'new', 'new@college.edu');
    const res = await retentionPurge(env as never, db, 15);
    expect(res.candidates).toBe(1);
    expect(await db.first('SELECT id FROM candidates WHERE id = ?', 'old')).toBeNull();
    expect(await db.first('SELECT id FROM candidates WHERE id = ?', 'new')).toBeTruthy();
    expect(await env.RESUMES.head('resumes/old.pdf')).toBeNull();
  });

  it('test-data cleanup only deletes records that look like test data', async () => {
    await createCandidate(db, 't1', 'load-0001@example.com');
    await createCandidate(db, 'real', 'priya@college.edu');
    const list = await (await req('/api/admin/system/test-data', { headers: { Cookie: mgr } })).json<any>();
    expect(list.candidates.map((c: any) => c.id)).toEqual(['t1']);
    const r = await (await post('/api/admin/system/test-data/delete', { ids: ['t1', 'real'], confirm: 'DELETE TEST DATA' })).json<any>();
    expect(r.deleted).toBe(1);
    expect(r.skipped).toBe(1);
    expect(await db.first('SELECT id FROM candidates WHERE id = ?', 'real')).toBeTruthy();
  });

  it('settings validate their values', async () => {
    const bad = await req('/api/admin/settings', { method: 'PATCH', headers: { Cookie: mgr }, json: { assessmentMinutes: 1000 } });
    expect(bad.status).toBe(400);
    const ok = await (await req('/api/admin/settings', { method: 'PATCH', headers: { Cookie: mgr }, json: { assessmentMinutes: 45, paper: [{ category: 'sql', difficulty: 'any', count: 1 }, { category: 'dsa', difficulty: 'medium', count: 1 }] } })).json<any>();
    expect(ok.settings.assessmentMinutes).toBe(45);
    expect(ok.settings.paper.length).toBe(2);
  });
});
