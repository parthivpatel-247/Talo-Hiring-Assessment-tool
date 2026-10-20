import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { migrate, req, seedQuestions, seedCandidate, candidateCookie, adminCookie } from './helpers';
import { resetEnsureCache } from '../src/lib/db';

async function hasIndex(name: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").bind(name).first());
}
async function usage(qid: string): Promise<number> {
  const r = await env.DB.prepare('SELECT uses FROM question_usage WHERE question_id = ?').bind(qid).first<{ uses: number }>();
  return r ? Number(r.uses) : 0;
}
async function assignedIds(cid: string): Promise<string[]> {
  const r = await env.DB.prepare('SELECT question_id FROM part1_assignments WHERE candidate_id = ?').bind(cid).all<{ question_id: string }>();
  return (r.results ?? []).map((x) => x.question_id);
}

describe('performance schema (read-volume fixes)', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); });

  it('the migration creates the audit and question-bank indexes', async () => {
    expect(await hasIndex('idx_audit_action_cand')).toBe(true);
    expect(await hasIndex('idx_qbank_deleted_cat')).toBe(true);
  });

  it('self-heals the indexes and tables if migration 0015 was never run', async () => {
    await env.DB.prepare('DROP INDEX idx_audit_action_cand').run();
    await env.DB.prepare('DROP TABLE question_usage').run();
    resetEnsureCache();
    const admin = await adminCookie(); // any authenticated admin request triggers it
    await req('/api/admin/flags', { headers: { Cookie: admin } });
    expect(await hasIndex('idx_audit_action_cand')).toBe(true);
    expect(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'question_usage'").first()).toBeTruthy();
  });

  it('counts one use per student per question, and gives it back when the candidate is deleted', async () => {
    await seedCandidate('u1', 'u1@x.com', 'part2_ready');
    const cookie = (await candidateCookie('u1@x.com')).cookie;
    await req('/api/candidate/part1/prepare', { method: 'POST', headers: { Cookie: cookie } });
    const ids = await assignedIds('u1');
    expect(ids).toHaveLength(5);
    for (const q of ids) expect(await usage(q)).toBe(1);

    // calling prepare again is idempotent — no double count
    await req('/api/candidate/part1/prepare', { method: 'POST', headers: { Cookie: cookie } });
    for (const q of ids) expect(await usage(q)).toBe(1);

    const admin = await adminCookie();
    const del = await req('/api/admin/candidates/u1', { method: 'DELETE', headers: { Cookie: admin } });
    expect(del.status).toBe(200);
    for (const q of ids) expect(await usage(q)).toBe(0);
  });

  it('backfills usage counts from existing history the first time', async () => {
    await env.DB.prepare("INSERT INTO part1_seen (candidate_id, question_id) VALUES ('a','qb-dsa-1'), ('b','qb-dsa-1'), ('a','qb-scn-1')").run();
    await env.DB.prepare('DELETE FROM question_usage').run();
    resetEnsureCache();
    const admin = await adminCookie();
    await req('/api/admin/flags', { headers: { Cookie: admin } });
    expect(await usage('qb-dsa-1')).toBe(2);
    expect(await usage('qb-scn-1')).toBe(1);
  });
});
