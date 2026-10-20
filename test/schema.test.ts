import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { req, loadV1Schema, managerCookie, BOOT } from './helpers';
import { resetSchemaCache } from '../src/db/migrate';
import { invalidateSettings } from '../src/lib/settings';
import { SEED_QUESTIONS } from '../src/db/seed';
import m1 from '../db/legacy-v1/0001_init.sql?raw';
import m2 from '../db/legacy-v1/0002_written_answers.sql?raw';
import m3 from '../db/legacy-v1/0003_expected_output.sql?raw';
import m4 from '../db/legacy-v1/0004_audit_and_login.sql?raw';
import m5 from '../db/legacy-v1/0005_college.sql?raw';
import m6 from '../db/legacy-v1/0006_settings.sql?raw';
import m7 from '../db/legacy-v1/0007_admin_users.sql?raw';
import m8 from '../db/legacy-v1/0008_part3.sql?raw';
import m9 from '../db/legacy-v1/0009_part2_ai_pct.sql?raw';
import m10 from '../db/legacy-v1/0010_expand_categories.sql?raw';
import m11 from '../db/legacy-v1/0011_interview_answer.sql?raw';
import m12 from '../db/legacy-v1/0012_question_hint.sql?raw';
import m13 from '../db/legacy-v1/0013_question_soft_delete.sql?raw';
import m14 from '../db/legacy-v1/0014_question_checkpoints.sql?raw';
import m15 from '../db/legacy-v1/0015_perf.sql?raw';

const one = async (sql: string, ...p: unknown[]) => (await env.DB.prepare(sql).bind(...p).first<any>());

describe('schema v2', () => {
  beforeEach(() => { resetSchemaCache(); invalidateSettings(); });

  it('a fresh database gets the full v2 schema, indexes and the bundled question bank', async () => {
    expect((await req('/api/health')).status).toBe(200);
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()).results.map((r) => r.name);
    for (const t of ['candidates', 'attempts', 'answers', 'assignments', 'questions', 'colleges', 'drives', 'admin_users', 'admin_sessions', 'audit_log', 'backups', 'exports', 'usage_daily', 'rate_limits', 'similarity_flags', 'data_requests']) {
      expect(tables).toContain(t);
    }
    const idx = (await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").first<any>()).n;
    expect(idx).toBeGreaterThanOrEqual(30);
    expect((await one("SELECT value FROM schema_meta WHERE key='version'")).value).toBe('2');
    expect((await one('SELECT COUNT(*) AS n FROM questions')).n).toBe(SEED_QUESTIONS.length);
    expect(SEED_QUESTIONS.length).toBeGreaterThanOrEqual(178);
    for (const cat of ['sql', 'coding', 'dsa', 'scenario']) expect(SEED_QUESTIONS.filter((q) => q.category === cat).length).toBeGreaterThanOrEqual(25);
  });

  it('foreign keys cascade: deleting a candidate removes attempts, papers and answers', async () => {
    await req('/api/health');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO candidates (id, email, status) VALUES ('c1', 'c1@x.com', 'ready')"),
      env.DB.prepare("INSERT INTO attempts (candidate_id) VALUES ('c1')"),
      env.DB.prepare(`INSERT INTO assignments (candidate_id, question_id, position) VALUES ('c1', '${SEED_QUESTIONS[0].id}', 0)`),
      env.DB.prepare(`INSERT INTO answers (candidate_id, question_id, answer_text) VALUES ('c1', '${SEED_QUESTIONS[0].id}', 'x')`),
    ]);
    await env.DB.prepare("DELETE FROM candidates WHERE id = 'c1'").run();
    for (const t of ['attempts', 'assignments', 'answers']) expect((await one(`SELECT COUNT(*) AS n FROM ${t}`)).n).toBe(0);
  });

  it('rejects an answer for a question that is not on the paper (composite foreign key)', async () => {
    await req('/api/health');
    await env.DB.prepare("INSERT INTO candidates (id, email, status) VALUES ('c2', 'c2@x.com', 'ready')").run();
    await expect(env.DB.prepare(`INSERT INTO answers (candidate_id, question_id, answer_text) VALUES ('c2', '${SEED_QUESTIONS[0].id}', 'x')`).run()).rejects.toThrow();
  });

  it('upgrades a v1 database in place, keeping every record, after backing it up to R2', async () => {
    await loadV1Schema([m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15]);
    // Columns some v1 databases got via runtime self-heal:
    for (const ddl of ['ALTER TABLE candidates ADD COLUMN college TEXT', 'ALTER TABLE admin_users ADD COLUMN email TEXT']) {
      await env.DB.prepare(ddl).run().catch(() => {});
    }
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('colleges', '[\"VIIT\", \"MIT Pune\"]'), ('assessment_minutes', '45')"),
      env.DB.prepare("INSERT INTO candidates (id, email, name, resume_r2_key, status, college, retake_granted, created_at) VALUES ('v1a', 'asha@college.edu', 'Asha', 'resumes/v1a.pdf', 'evaluated', 'VIIT', 1, '2026-10-10 09:00:00')"),
      env.DB.prepare("INSERT INTO candidates (id, email, name, resume_r2_key, status, college) VALUES ('v1b', 'pending+v1b@unresolved.local', NULL, 'resumes/v1b.pdf', 'part2_ready', 'Legacy College')"),
      env.DB.prepare("INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qp1', 'python', ?, 'sum(a)', 4, 'easy', 'active', 1)").bind('## Sum\n> Arrays · Easy\n\nReturn the sum.'),
      env.DB.prepare("INSERT INTO question_bank (id, category, prompt, marks, status, active) VALUES ('qs1', 'sql', ?, 3, 'active', 1)").bind('Table: t\nWrite a SQL query that counts rows.'),
      env.DB.prepare("INSERT INTO attempts (candidate_id, part1_started_at, part1_submitted_at, part1_tab_switch_count, login_count) VALUES ('v1a', '2026-10-10 09:05:00', '2026-10-10 10:00:00', 2, 3)"),
      env.DB.prepare("INSERT INTO part1_assignments (candidate_id, question_id, position) VALUES ('v1a', 'qp1', 0), ('v1a', 'qs1', 1)"),
      env.DB.prepare("INSERT INTO part1_answers (candidate_id, question_id, answer_text, ai_score, max_marks, ai_reasoning, deductions, scored_at) VALUES ('v1a', 'qp1', 'return sum of a', 3.5, 4, 'good', '[{\"reason\":\"no edge case\",\"marks\":0.5}]', '2026-10-10 11:00:00')"),
      env.DB.prepare("INSERT INTO part1_seen (candidate_id, question_id) VALUES ('v1a', 'qp1'), ('v1a', 'qs1')"),
      env.DB.prepare("INSERT INTO question_usage (question_id, uses) VALUES ('qp1', 7)"),
      env.DB.prepare("INSERT INTO admin_audit (id, action, candidate_id, detail) VALUES ('au1', 'duplicate_login_blocked', 'v1a', 'blocked'), ('au2', 'shortlist', 'v1a', '')"),
      env.DB.prepare("INSERT INTO admin_users (id, username, email, pass_salt, pass_hash, role, active) VALUES ('u1', 'Panel One', 'panel1@hevodata.com', 'aa', 'bb', 'member', 1)"),
      env.DB.prepare("INSERT INTO interview_questions (id, candidate_id, position, question, model_answer) VALUES ('iq1', 'v1a', 0, 'Tell me about X', 'X is')"),
    ]);

    const res = await req('/api/health');
    expect(res.status).toBe(200);

    expect((await one("SELECT value FROM schema_meta WHERE key='version'")).value).toBe('2');
    const a = await one("SELECT * FROM candidates WHERE id = 'v1a'");
    expect(a.status).toBe('graded');
    expect(a.email_status).toBe('parsed');
    expect(a.created_at).toBe('2026-10-10T09:00:00Z');
    expect(a.score_awarded).toBe(3.5);
    expect((await one('SELECT name FROM colleges WHERE id = ?', a.college_id)).name).toBe('VIIT');
    const b = await one("SELECT * FROM candidates WHERE id = 'v1b'");
    expect(b.status).toBe('ready');
    expect(b.email_status).toBe('pending');
    expect((await one('SELECT name FROM colleges WHERE id = ?', b.college_id)).name).toBe('Legacy College');
    expect((await one('SELECT COUNT(*) AS n FROM colleges')).n).toBe(3);

    const at = await one("SELECT * FROM attempts WHERE candidate_id = 'v1a'");
    expect(at.attempt_no).toBe(2);
    expect(at.tab_switch_count).toBe(2);
    expect(at.login_count).toBe(3);
    expect(at.blocked_login_count).toBe(1);

    const qp = await one("SELECT * FROM questions WHERE id = 'qp1'");
    expect(qp.category).toBe('coding');
    expect(qp.assigned_count).toBe(7);
    expect(qp.title).toBe('Sum');
    expect(qp.topic).toBe('Arrays');
    const qs = await one("SELECT * FROM questions WHERE id = 'qs1'");
    expect(qs.title).toMatch(/Write a SQL query/);

    const ans = await one("SELECT * FROM answers WHERE candidate_id = 'v1a' AND question_id = 'qp1'");
    expect(ans.score).toBe(3.5);
    expect(JSON.parse(ans.deductions)[0].marks).toBe(0.5);
    expect((await one("SELECT COUNT(*) AS n FROM question_exposures WHERE candidate_id = 'v1a'")).n).toBe(2);
    expect((await one("SELECT COUNT(*) AS n FROM interview_questions")).n).toBe(1);

    const u = await one("SELECT * FROM admin_users WHERE id = 'u1'");
    expect(u.email).toBe('panel1@hevodata.com');
    expect(u.must_change_password).toBe(1);
    expect((await one("SELECT COUNT(*) AS n FROM audit_log WHERE actor_email = 'legacy'")).n).toBe(2);
    expect((await one("SELECT COUNT(*) AS n FROM attempt_events WHERE type = 'login_blocked'")).n).toBe(1);
    expect((await one("SELECT value FROM settings WHERE key = 'assessment_minutes'")).value).toBe('45');

    // No v1 table survives, and the pre-migration backup exists in R2.
    const legacy = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'v1_%' OR name IN ('question_bank','part1_answers','part3_questions'))").all()).results;
    expect(legacy.length).toBe(0);
    const bk = await one("SELECT * FROM backups WHERE kind = 'pre_migration'");
    expect(bk).toBeTruthy();
    const obj = await env.RESUMES.get(bk.r2_key);
    const dump = JSON.parse(await obj!.text());
    expect(dump.tables.candidates.length).toBe(2);
    expect(dump.tables.part1_answers.length).toBe(1);

    // The bundled bank was added on top of the migrated questions.
    expect((await one('SELECT COUNT(*) AS n FROM questions')).n).toBe(2 + SEED_QUESTIONS.length);

    // Second start is a no-op.
    resetSchemaCache();
    expect((await req('/api/health')).status).toBe(200);
    expect((await one('SELECT COUNT(*) AS n FROM candidates')).n).toBe(2);
  });

  it('after the upgrade the old bootstrap password only works for first-run setup', async () => {
    await req('/api/health');
    const cookie = await managerCookie();
    expect(cookie).toMatch(/__Host-talo_admin=/);
    const again = await req('/api/admin/auth/login', { method: 'POST', json: BOOT });
    expect(again.status).toBe(401);
  });
});
