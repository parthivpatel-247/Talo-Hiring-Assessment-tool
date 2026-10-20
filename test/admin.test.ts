import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { migrate, req, seedQuestions, seedCandidate, adminCookie, candidateCookie } from './helpers';

describe('admin auth', () => {
  beforeEach(async () => { await migrate(); });

  it('rejects a wrong password', async () => {
    const res = await req('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.local', password: 'nope' }),
    });
    expect(res.status).toBe(401);
  });

  it('blocks admin endpoints without a session', async () => {
    const res = await req('/api/admin/candidates', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('accepts the correct password and then serves candidates', async () => {
    const cookie = await adminCookie();
    const res = await req('/api/admin/candidates', { method: 'GET', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
});

describe('revoke auto-submits the assessment', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('stops the clock, submits both parts, and marks the candidate submitted', async () => {
    await seedCandidate('cr', 'cr@x.com', 'part2_ready');
    const cookie = (await candidateCookie('cr@x.com')).cookie;
    await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });

    const admin = await adminCookie();
    const res = await req('/api/admin/candidates/cr/revoke', { method: 'POST', headers: { Cookie: admin } });
    expect(res.status).toBe(200);

    const c = await env.DB.prepare("SELECT status, access_revoked FROM candidates WHERE id='cr'").first<any>();
    expect(c.access_revoked).toBe(1);
    expect(c.status).toBe('submitted');
    const a = await env.DB.prepare("SELECT part1_submitted_at, part2_submitted_at FROM attempts WHERE candidate_id='cr'").first<any>();
    expect(a.part1_submitted_at).toBeTruthy();
    expect(a.part2_submitted_at).toBeTruthy();
  });

  it('a revoked candidate can no longer use their session', async () => {
    await seedCandidate('cr2', 'cr2@x.com', 'part2_ready');
    const cookie = (await candidateCookie('cr2@x.com')).cookie;
    const admin = await adminCookie();
    await req('/api/admin/candidates/cr2/revoke', { method: 'POST', headers: { Cookie: admin } });
    const res = await req('/api/candidate/part1/prepare', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(401);
  });
});

describe('retake = fresh start + restore access (admin only)', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('clears answers/timers, reshuffles, and restores access after a revoke', async () => {
    await seedCandidate('rt', 'rt@x.com', 'part2_ready');
    const cookie = (await candidateCookie('rt@x.com')).cookie;
    const start = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const qid = (await start.json<any>()).questions[0].id;
    await req('/api/candidate/part1/answer', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: qid, answerText: 'draft' }),
    });

    const admin = await adminCookie();
    await req('/api/admin/candidates/rt/revoke', { method: 'POST', headers: { Cookie: admin } });
    const res = await req('/api/admin/candidates/rt/retake', { method: 'POST', headers: { Cookie: admin } });
    expect(res.status).toBe(200);

    const c = await env.DB.prepare("SELECT status, access_revoked, retake_granted FROM candidates WHERE id='rt'").first<any>();
    expect(c.status).toBe('part2_ready');
    expect(c.access_revoked).toBe(0); // access restored
    expect(c.retake_granted).toBe(1);
    const assigns = await env.DB.prepare("SELECT COUNT(*) n FROM part1_assignments WHERE candidate_id='rt'").first<any>();
    expect(assigns.n).toBe(0); // reshuffled next start
    const answers = await env.DB.prepare("SELECT COUNT(*) n FROM part1_answers WHERE candidate_id='rt'").first<any>();
    expect(answers.n).toBe(0);
    const a = await env.DB.prepare("SELECT part1_started_at, part1_submitted_at FROM attempts WHERE candidate_id='rt'").first<any>();
    expect(a.part1_started_at).toBeNull();
    expect(a.part1_submitted_at).toBeNull();
  });

  it('retake requires admin auth', async () => {
    await seedCandidate('rt2', 'rt2@x.com');
    const res = await req('/api/admin/candidates/rt2/retake', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('delete a candidate entry (cascade)', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('removes the candidate and all related rows', async () => {
    await seedCandidate('del', 'del@x.com', 'part2_ready');
    const cookie = (await candidateCookie('del@x.com')).cookie;
    const start = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    const qid = (await start.json<any>()).questions[0].id;
    await req('/api/candidate/part1/answer', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: qid, answerText: 'x' }),
    });

    const admin = await adminCookie();
    const res = await req('/api/admin/candidates/del', { method: 'DELETE', headers: { Cookie: admin } });
    expect(res.status).toBe(200);

    const c = await env.DB.prepare("SELECT COUNT(*) n FROM candidates WHERE id='del'").first<any>();
    expect(c.n).toBe(0);
    const a = await env.DB.prepare("SELECT COUNT(*) n FROM attempts WHERE candidate_id='del'").first<any>();
    expect(a.n).toBe(0);
    const ans = await env.DB.prepare("SELECT COUNT(*) n FROM part1_answers WHERE candidate_id='del'").first<any>();
    expect(ans.n).toBe(0);
    const asg = await env.DB.prepare("SELECT COUNT(*) n FROM part1_assignments WHERE candidate_id='del'").first<any>();
    expect(asg.n).toBe(0);
  });

  it('delete requires admin auth', async () => {
    await seedCandidate('del2', 'del2@x.com');
    const res = await req('/api/admin/candidates/del2', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('stores a recoverable snapshot of the deleted candidate in the audit log', async () => {
    await seedCandidate('snap', 'snap@x.com', 'part2_ready');
    const admin = await adminCookie();
    await req('/api/admin/candidates/snap', { method: 'DELETE', headers: { Cookie: admin } });
    const row = await env.DB.prepare("SELECT detail FROM admin_audit WHERE action='delete' AND candidate_id='snap'").first<any>();
    expect(row).toBeTruthy();
    const snap = JSON.parse(row.detail);
    expect(snap.candidate.email).toBe('snap@x.com');
    expect(snap.scores).toBeTruthy(); // part1/part2/part3 summaries captured
  });
});

describe('question soft-delete + restore', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('soft-deletes (keeps the row + snapshot), hides it from the live bank, and restores it', async () => {
    const admin = await adminCookie();
    // Delete one seeded SQL question.
    const del = await req('/api/admin/questions/qb-sql-1', { method: 'DELETE', headers: { Cookie: admin } });
    expect(del.status).toBe(200);

    // Row is still in the DB, stamped deleted_at (recoverable), not gone.
    const row = await env.DB.prepare("SELECT deleted_at, active FROM question_bank WHERE id='qb-sql-1'").first<any>();
    expect(row).toBeTruthy();
    expect(row.deleted_at).toBeTruthy();
    expect(row.active).toBe(0);

    // A full snapshot is in the audit log.
    const aud = await env.DB.prepare("SELECT detail FROM admin_audit WHERE action='delete_question'").first<any>();
    expect(JSON.parse(aud.detail).snapshot.id).toBe('qb-sql-1');

    // Live bank list excludes it; deleted bin includes it.
    const live = await (await req('/api/admin/questions', { headers: { Cookie: admin } })).json<any>();
    expect(live.questions.some((q: any) => q.id === 'qb-sql-1')).toBe(false);
    expect(live.deletedCount).toBe(1);
    const bin = await (await req('/api/admin/questions?deleted=1', { headers: { Cookie: admin } })).json<any>();
    expect(bin.questions.some((q: any) => q.id === 'qb-sql-1')).toBe(true);

    // Restore brings it back to the live bank.
    const res = await req('/api/admin/questions/qb-sql-1/restore', { method: 'POST', headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    const back = await env.DB.prepare("SELECT deleted_at FROM question_bank WHERE id='qb-sql-1'").first<any>();
    expect(back.deleted_at).toBeNull();
    const live2 = await (await req('/api/admin/questions', { headers: { Cookie: admin } })).json<any>();
    expect(live2.questions.some((q: any) => q.id === 'qb-sql-1')).toBe(true);
  });

  it('a soft-deleted question is never assigned to a new candidate', async () => {
    const admin = await adminCookie();
    // Seed has 3 SQL; a student needs 2. Delete one so the remaining two are the
    // only assignable SQL questions — the deleted one must never appear.
    await req('/api/admin/questions/qb-sql-3', { method: 'DELETE', headers: { Cookie: admin } });
    await seedCandidate('asg', 'asg@x.com', 'part2_ready');
    const cookie = (await candidateCookie('asg@x.com')).cookie;
    const start = await req('/api/candidate/part1/start', { method: 'POST', headers: { Cookie: cookie } });
    expect(start.status).toBe(200);
    const qs = (await start.json<any>()).questions;
    const sqlIds = qs.filter((q: any) => q.category === 'sql').map((q: any) => q.id);
    expect(sqlIds).toHaveLength(2);
    expect(sqlIds).not.toContain('qb-sql-3'); // the deleted question was skipped
  });

  it('restore requires manager auth', async () => {
    const res = await req('/api/admin/questions/qb-sql-1/restore', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('analysis gating', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('is not ready while a candidate is still pending, ready once all submitted', async () => {
    await seedCandidate('an', 'an@x.com', 'part2_ready');
    const admin = await adminCookie();

    let res = await req('/api/admin/analysis/status', { method: 'GET', headers: { Cookie: admin } });
    let s = await res.json<any>();
    expect(s.total).toBe(1);
    expect(s.allSubmitted).toBe(false);

    await env.DB.prepare("UPDATE candidates SET status='submitted' WHERE id='an'").run();
    res = await req('/api/admin/analysis/status', { method: 'GET', headers: { Cookie: admin } });
    s = await res.json<any>();
    expect(s.allSubmitted).toBe(true);
    expect(s.awaitingGrade).toBe(1);
  });
});
