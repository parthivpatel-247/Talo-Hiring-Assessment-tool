import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { migrate, req, adminCookie } from './helpers';
import { purgeExpiredCandidates } from '../src/index';

// Regression tests for the security-audit fixes.
describe('security regressions', () => {
  beforeEach(async () => { await migrate(); });

  it('rejects an admin cookie whose signature was tampered (MAC is verified, constant-time)', async () => {
    const good = await adminCookie(); // "chs_admin=<body>.<sig>"
    const last = good.slice(-1);
    const tampered = good.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect((await req('/api/admin/config', { headers: { Cookie: tampered } })).status).toBe(401);
    // A body with no valid signature at all is also rejected.
    expect((await req('/api/admin/config', { headers: { Cookie: 'chs_admin=eyJhZG1pbiI6dHJ1ZX0.forged' } })).status).toBe(401);
  });

  it('error responses do not leak internal detail to the client', async () => {
    const res = await req('/api/candidate/not-a-real-route', { method: 'GET' });
    const body = await res.json<any>();
    expect(body.detail).toBeUndefined();
  });

  it('retention purge deletes ALL of an expired candidate\'s data, including Part 3', async () => {
    const old = '2000-01-01T00:00:00Z'; // well before any retention cutoff
    await env.DB.prepare(
      'INSERT INTO candidates (id,email,name,resume_r2_key,resume_filename,status,created_at) VALUES (?,?,?,?,?,?,?)'
    ).bind('exp1', 'exp1@x.com', 'Old', 'resumes/exp1.pdf', 'r.pdf', 'evaluated', old).run();
    await env.DB.prepare('INSERT INTO attempts (candidate_id) VALUES (?)').bind('exp1').run();
    await env.DB.prepare("INSERT INTO part3_questions (id,kind,title,prompt,marks,active) VALUES ('pq1','scenario','t','p',5,1)").run();
    await env.DB.prepare('INSERT INTO part3_assignments (candidate_id,question_id,position) VALUES (?,?,0)').bind('exp1', 'pq1').run();
    await env.DB.prepare('INSERT INTO part3_answers (candidate_id,question_id,answer_text) VALUES (?,?,?)').bind('exp1', 'pq1', 'my part 3 answer').run();

    await purgeExpiredCandidates(env);

    for (const q of [
      "SELECT 1 FROM candidates WHERE id='exp1'",
      "SELECT 1 FROM attempts WHERE candidate_id='exp1'",
      "SELECT 1 FROM part3_answers WHERE candidate_id='exp1'",
      "SELECT 1 FROM part3_assignments WHERE candidate_id='exp1'",
    ]) {
      expect(await env.DB.prepare(q).first()).toBeNull();
    }
  });
});
