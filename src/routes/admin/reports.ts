import type { Router } from '../../router';
import type { Ctx } from '../../lib/context';
import type { Env } from '../../env';
import type { Db } from '../../db/db';
import { json, readJson, oneOf, str, pathId, bad, notFound, idList, HttpError } from '../../lib/http';
import { listCandidates, deleteCandidatesWithBackup, restoreBackup, isTestEmail, type CandidateSummary } from '../../lib/candidates';
import { getSettings, paperTotal, CATEGORY_LABEL, type Settings } from '../../lib/settings';
import { audit, auditStmt } from '../../lib/audit';
import { gradeCandidate, mapPool } from '../../lib/grading';
import { computeSimilarity } from '../../lib/similarity';
import { submitStatements } from '../../lib/exam';
import { buildXlsx, toCsv, type Cell } from '../../lib/xlsx';
import { emailConfigured } from '../../lib/email';
import { turnstileEnabled } from '../../lib/turnstile';
import { day } from '../../lib/telemetry';
import { newId, parseJson, IN_JSON } from '../../db/db';

/** Close attempts whose hard deadline has passed (abandoned tab, dead laptop). Runs every 10 minutes and before grading. */
export async function closeExpiredAttempts(env: Env, db: Db, s: Settings): Promise<number> {
  const graceMs = (Number(env.STALE_GRACE_MINUTES) || 2) * 60_000;
  const open = await db.all<{ candidate_id: string; attempt_no: number; started_at: string; deadline_at: string | null; duration_seconds: number | null }>(
    'SELECT candidate_id, attempt_no, started_at, deadline_at, duration_seconds FROM attempts WHERE submitted_at IS NULL AND started_at IS NOT NULL'
  );
  const now = Date.now();
  const stale = open.filter((a) => {
    const dl = a.deadline_at ? Date.parse(a.deadline_at) : Date.parse(a.started_at) + ((a.duration_seconds ?? s.assessmentMinutes * 60) + s.pauseAllowanceMinutes * 60) * 1000;
    return now > dl + graceMs;
  });
  if (!stale.length) return 0;
  await db.batch(stale.flatMap((a) => submitStatements(db, a.candidate_id, a.attempt_no, 'auto_close', { note: 'Deadline passed with no submission' })));
  return stale.length;
}

const minutes = (sec: number | null) => (sec == null ? null : Math.round((sec / 60) * 10) / 10);

function summaryRow(c: CandidateSummary): Cell[] {
  const pct = c.score != null && c.maxScore ? Math.round((c.score / c.maxScore) * 1000) / 10 : null;
  return [
    c.name, c.email, c.college, c.resumeCollege, c.drive, c.status, c.score, c.maxScore, pct, c.answered, c.questionCount,
    minutes(c.timeUsedSeconds), c.startedAt, c.submittedAt, c.submitReason, c.attemptNo, c.signals.logins, c.signals.blockedLogins,
    c.signals.tabSwitches, c.signals.offline, minutes(c.signals.offlineSeconds), c.signals.pasteBlocked, c.signals.similar, c.isTest ? 'yes' : '',
  ];
}
const SUMMARY_HEAD = [
  'Name', 'Email', 'College', 'College (from resume)', 'Drive', 'Status', 'Score', 'Max score', 'Score %', 'Answered', 'Questions',
  'Time used (min)', 'Started (UTC)', 'Submitted (UTC)', 'Submitted because', 'Attempt #', 'Logins', 'Blocked logins', 'Left the test (times)',
  'Went offline (times)', 'Offline (min)', 'Copy/paste blocked', 'Similar answers', 'Test record',
];

export function registerAdminReports(r: Router): void {
  /* ---------- overview ---------- */

  r.add('GET', '/api/admin/overview', 'admin', async (ctx) => {
    const s = await getSettings(ctx.env, ctx.db);
    const [statusRows, live, pool, today, recent, openRequests, errors24, drives, noAccess] = await Promise.all([
      ctx.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM candidates WHERE is_test = 0 GROUP BY status'),
      ctx.db.value<number>("SELECT COUNT(*) AS n FROM attempts WHERE submitted_at IS NULL AND started_at IS NOT NULL AND last_heartbeat_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-45 seconds')"),
      ctx.db.all<{ category: string; difficulty: string; n: number }>('SELECT category, difficulty, COUNT(*) AS n FROM questions WHERE active = 1 AND deleted_at IS NULL GROUP BY category, difficulty'),
      ctx.db.first<{ requests: number; rows_read: number; rows_written: number }>('SELECT SUM(requests) AS requests, SUM(rows_read) AS rows_read, SUM(rows_written) AS rows_written FROM usage_daily WHERE day = ?', day()),
      ctx.db.all('SELECT actor_email, action, target_type, target_id, at FROM audit_log ORDER BY id DESC LIMIT 8'),
      ctx.db.value<number>("SELECT COUNT(*) AS n FROM data_requests WHERE status = 'open'"),
      ctx.db.value<number>("SELECT COALESCE(SUM(count), 0) AS n FROM client_errors WHERE last_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')"),
      ctx.db.all("SELECT d.id, d.name, d.status, d.scheduled_on AS scheduledOn, c.name AS college FROM drives d LEFT JOIN colleges c ON c.id = d.college_id WHERE d.status != 'closed' ORDER BY d.scheduled_on LIMIT 5"),
      s.loginMode === 'code'
        ? ctx.db.value<number>(
            `SELECT COUNT(*) AS n FROM candidates c LEFT JOIN drives d ON d.id = c.drive_id
             WHERE c.status = 'ready' AND c.is_test = 0 AND c.invite_code_hash IS NULL
               AND (d.id IS NULL OR d.status = 'closed' OR (d.code_required = 1 AND d.access_code IS NULL))`
          )
        : Promise.resolve(0),
    ]);
    const counts: Record<string, number> = {};
    for (const r2 of statusRows) counts[r2.status] = Number(r2.n);
    const slots = s.paper.filter((p) => p.count > 0).map((p) => {
      const available = pool.filter((x) => x.category === p.category && (p.difficulty === 'any' || x.difficulty === p.difficulty)).reduce((n, x) => n + Number(x.n), 0);
      return { label: `${CATEGORY_LABEL[p.category]}${p.difficulty === 'any' ? '' : ` · ${p.difficulty}`}`, needed: p.count, available };
    });
    const checklist = [
      { id: 'email', ok: emailConfigured(ctx.env), label: 'Email delivery', detail: emailConfigured(ctx.env) ? 'Sign-in codes, invites and password resets can be emailed.' : 'Not set up. Add EMAIL_PROVIDER, EMAIL_API_KEY and EMAIL_FROM to send invites and two-step codes.' },
      { id: 'twofactor', ok: s.admin2fa === 'email' && emailConfigured(ctx.env), label: 'Two-step sign-in for admins', detail: s.admin2fa === 'email' ? (emailConfigured(ctx.env) ? 'On: admins confirm each sign-in with an emailed code.' : 'Turned on, but waiting for email delivery.') : 'Off. Turn it on in Settings → Security.' },
      { id: 'login', ok: s.loginMode !== 'email_only', label: 'Student sign-in protection', detail: s.loginMode === 'email_only' ? 'Students sign in with email only. Switch to access codes in Settings → Assessment.' : s.loginMode === 'otp' ? 'Students sign in with an emailed one-time code.' : 'Students sign in with email + an access code (hall code or personal code).' },
      { id: 'access', ok: !Number(noAccess), label: 'Every ready student can sign in', detail: Number(noAccess) ? `${noAccess} ready student(s) have no personal code and no drive with a hall code.` : 'All ready students have a hall code or a personal code.' },
      ...drives
        .filter((d) => d.status === 'scheduled' && d.scheduledOn === new Date().toISOString().slice(0, 10))
        .map((d) => ({ id: `live-${d.id}`, ok: false, label: `Set "${d.name}" live`, detail: 'It is scheduled for today. Students can sign in, but nobody can start until the drive is live (Drives & colleges → ⋯ → Set live).' })),
      { id: 'captcha', ok: turnstileEnabled(ctx.env), label: 'Bot protection on sign-in forms', detail: turnstileEnabled(ctx.env) ? 'Cloudflare Turnstile is on.' : 'Optional: add TURNSTILE_SITE_KEY and TURNSTILE_SECRET. Rate limits are on either way.' },
      { id: 'pool', ok: slots.every((x) => x.available >= x.needed * 3), label: 'Question pool depth', detail: slots.map((x) => `${x.label}: ${x.available} for ${x.needed} per paper`).join(' · ') },
    ];
    return json({
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      liveNow: Number(live ?? 0),
      paper: { questions: paperTotal(s), minutes: s.assessmentMinutes, slots },
      usageToday: { requests: Number(today?.requests ?? 0), rowsRead: Number(today?.rows_read ?? 0), rowsWritten: Number(today?.rows_written ?? 0) },
      recent,
      openDataRequests: Number(openRequests ?? 0),
      errorsLastDay: Number(errors24 ?? 0),
      drives,
      checklist,
    });
  });

  /* ---------- grading ---------- */

  r.add('GET', '/api/admin/grading/status', 'admin', async (ctx) => {
    const s = await getSettings(ctx.env, ctx.db);
    const closed = await closeExpiredAttempts(ctx.env, ctx.db, s);
    const rows = await ctx.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM candidates GROUP BY status');
    const c: Record<string, number> = {};
    for (const x of rows) c[x.status] = Number(x.n);
    return json({
      awaiting: (c.submitted ?? 0) + (c.grading ?? 0),
      graded: (c.graded ?? 0) + (c.shortlisted ?? 0) + (c.rejected ?? 0),
      inProgress: c.in_progress ?? 0,
      notStarted: (c.ready ?? 0) + (c.uploaded ?? 0) + (c.parse_failed ?? 0),
      autoClosed: closed,
    });
  });

  // Grade the next batch. Several calls can run at once: each atomically claims a disjoint set.
  r.add('POST', '/api/admin/grading/run', 'admin', async (ctx) => {
    const s = await getSettings(ctx.env, ctx.db);
    await closeExpiredAttempts(ctx.env, ctx.db, s);
    await ctx.db.run("UPDATE candidates SET status = 'submitted', grading_claim = NULL WHERE status = 'grading' AND (grading_claimed_at IS NULL OR grading_claimed_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 minutes'))");
    const token = newId('grade');
    const size = Number(ctx.env.GRADING_BATCH_SIZE) || 8;
    await ctx.db.run(
      `UPDATE candidates SET status = 'grading', grading_claim = ?, grading_claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id IN (SELECT id FROM candidates WHERE status = 'submitted' ORDER BY updated_at LIMIT ?)`,
      token, size
    );
    const batch = await ctx.db.all<{ id: string; name: string | null }>('SELECT id, name FROM candidates WHERE grading_claim = ?', token);
    const results = await mapPool(batch, Number(ctx.env.GRADING_CONCURRENCY) || 6, async (c) => {
      try {
        await gradeCandidate(ctx.env, ctx.db, c.id);
        await ctx.db.run("UPDATE candidates SET status = 'graded', grading_claim = NULL WHERE id = ?", c.id);
        return { id: c.id, name: c.name, ok: true };
      } catch (err) {
        console.error('grading failed', c.id, err);
        await ctx.db.run("UPDATE candidates SET status = 'submitted', grading_claim = NULL WHERE id = ?", c.id);
        return { id: c.id, name: c.name, ok: false, error: 'The AI grader is unavailable; this candidate will be retried.' };
      }
    });
    const remaining = Number((await ctx.db.value<number>("SELECT COUNT(*) AS n FROM candidates WHERE status IN ('submitted','grading')")) ?? 0);
    if (results.length) await audit(ctx, 'grading_batch', { type: 'candidates' }, { graded: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length });
    return json({ processed: results, remaining });
  });

  /* ---------- integrity ---------- */

  r.add('GET', '/api/admin/integrity/similarity', 'admin', async (ctx) => {
    const rows = await ctx.db.all(
      `SELECT sf.score, sf.computed_at AS computedAt, q.id AS questionId, q.title, a.id AS aId, a.name AS aName, a.email AS aEmail,
              b.id AS bId, b.name AS bName, b.email AS bEmail
       FROM similarity_flags sf JOIN questions q ON q.id = sf.question_id
       JOIN candidates a ON a.id = sf.candidate_a JOIN candidates b ON b.id = sf.candidate_b
       ORDER BY sf.score DESC LIMIT 200`
    );
    return json({ pairs: rows });
  });

  r.add('POST', '/api/admin/integrity/similarity/run', 'admin', async (ctx) => {
    const res = await computeSimilarity(ctx.db);
    await audit(ctx, 'similarity_computed', { type: 'answers' }, res);
    return json({ ok: true, ...res });
  });

  /* ---------- exports (versioned) ---------- */

  r.add('POST', '/api/admin/exports', 'admin', async (ctx) => {
    const b = await readJson(ctx.request, 4096);
    const format = oneOf(b, 'format', ['xlsx', 'csv'] as const)!;
    const scope = (oneOf(b, 'scope', ['summary', 'detailed'] as const, { optional: true }) ?? 'summary') as 'summary' | 'detailed';
    const collegeId = typeof b.collegeId === 'string' && b.collegeId ? b.collegeId : null;
    const driveId = typeof b.driveId === 'string' && b.driveId ? b.driveId : null;
    const status = typeof b.status === 'string' && b.status ? b.status : null;
    const includeTest = b.includeTest === true;
    let rows = await listCandidates(ctx.db);
    rows = rows.filter((c) => (includeTest || !c.isTest) && (!collegeId || c.collegeId === collegeId) && (!driveId || c.driveId === driveId) && (!status || c.status === status));
    rows.sort((a, b2) => (b2.score ?? -1) - (a.score ?? -1) || String(a.name).localeCompare(String(b2.name)));

    const detail = async () => {
      const ids = rows.map((c) => c.id);
      if (!ids.length) return { qa: [] as Record<string, unknown>[], iq: [] as Record<string, unknown>[] };
      const out: Record<string, unknown>[] = [];
      const iqs: Record<string, unknown>[] = [];
      for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        out.push(...(await ctx.db.all(
          `SELECT s.candidate_id, s.position, q.category, q.title, q.difficulty, a.language, a.answer_text, a.word_count, a.score, q.marks, a.deductions, a.reasoning
           FROM assignments s JOIN questions q ON q.id = s.question_id LEFT JOIN answers a ON a.candidate_id = s.candidate_id AND a.question_id = s.question_id
           WHERE s.candidate_id IN ${IN_JSON} ORDER BY s.candidate_id, s.position`, JSON.stringify(chunk))));
        iqs.push(...(await ctx.db.all(`SELECT candidate_id, position, question, follow_up, based_on, model_answer FROM interview_questions WHERE candidate_id IN ${IN_JSON} ORDER BY candidate_id, position`, JSON.stringify(chunk))));
      }
      return { qa: out, iq: iqs };
    };
    const byId = new Map(rows.map((c) => [c.id, c]));
    const ded = (raw: unknown) => parseJson<{ reason: string; marks: number }[]>(raw, []).map((d) => `-${d.marks}: ${d.reason}`).join(' | ');
    const detailHead = ['Name', 'Email', 'College', 'Status', 'Q#', 'Type', 'Question', 'Difficulty', 'Language', 'Answer', 'Words', 'Score', 'Max', 'Deductions', 'Grader notes'];

    const version = Number((await ctx.db.value<number>('SELECT COALESCE(MAX(version), 0) AS v FROM exports')) ?? 0) + 1;
    const stamp = new Date().toISOString().slice(0, 10);
    const id = newId('exp');
    let bytes: Uint8Array;
    let filename: string;
    let contentType: string;
    if (format === 'xlsx') {
      const sheets = [{ name: 'Summary', rows: [SUMMARY_HEAD, ...rows.map(summaryRow)] as Cell[][], widths: [24, 30, 26, 26, 22, 12, 8, 9, 8, 9, 9, 10, 20, 20, 16, 9, 7, 9, 11, 11, 10, 10, 10, 8] }];
      if (scope === 'detailed') {
        const { qa, iq } = await detail();
        sheets.push({
          name: 'Answers',
          rows: [detailHead, ...qa.map((a) => { const c = byId.get(String(a.candidate_id))!; return [c.name, c.email, c.college, c.status, Number(a.position) + 1, CATEGORY_LABEL[a.category as never] ?? a.category, a.title, a.difficulty, a.language, a.answer_text, a.word_count, a.score, a.marks, ded(a.deductions), a.reasoning] as Cell[]; })],
          widths: [24, 30, 22, 12, 5, 10, 34, 10, 12, 60, 7, 7, 6, 40, 60],
        });
        sheets.push({
          name: 'Interview questions',
          rows: [['Name', 'Email', '#', 'Question', 'Follow-up', 'Based on', 'Model answer'], ...iq.map((x) => { const c = byId.get(String(x.candidate_id))!; return [c.name, c.email, Number(x.position) + 1, x.question, x.follow_up, x.based_on, x.model_answer] as Cell[]; })],
          widths: [24, 30, 4, 60, 40, 24, 60],
        });
      }
      sheets.push({
        name: 'About this export',
        rows: [['Field', 'Value'], ['Version', version], ['Created (UTC)', new Date().toISOString()], ['Created by', ctx.admin!.email], ['Candidates', rows.length], ['Filters', JSON.stringify({ collegeId, driveId, status, includeTest })], ['Note', 'Contains personal data. Share only with the hiring panel; delete when the drive is closed.']] as Cell[][],
        widths: [18, 80],
      });
      bytes = buildXlsx(sheets, { title: `Talo results v${version}`, author: ctx.admin!.email });
      filename = `talo-results-v${version}-${stamp}.xlsx`;
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      let table: Cell[][];
      if (scope === 'detailed') {
        const { qa } = await detail();
        table = [detailHead, ...qa.map((a) => { const c = byId.get(String(a.candidate_id))!; return [c.name, c.email, c.college, c.status, Number(a.position) + 1, a.category, a.title, a.difficulty, a.language, a.answer_text, a.word_count, a.score, a.marks, ded(a.deductions), a.reasoning] as Cell[]; })];
      } else table = [SUMMARY_HEAD, ...rows.map(summaryRow)];
      bytes = new TextEncoder().encode(toCsv(table));
      filename = `talo-results-${scope}-v${version}-${stamp}.csv`;
      contentType = 'text/csv; charset=utf-8';
    }
    const key = `exports/${id}/${filename}`;
    await ctx.env.RESUMES.put(key, bytes, { httpMetadata: { contentType } });
    await ctx.db.batch([
      ctx.db.stmt('INSERT INTO exports (id, version, format, scope, filters, filename, r2_key, row_count, bytes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, version, format, scope, JSON.stringify({ collegeId, driveId, status, includeTest }), filename, key, rows.length, bytes.length, ctx.admin!.email),
      auditStmt(ctx, 'export_created', { type: 'export', id }, { version, format, scope, rows: rows.length }),
    ]);
    return json({ ok: true, id, version, filename, rows: rows.length, downloadUrl: `/api/admin/exports/${id}/download` });
  });

  r.add('GET', '/api/admin/exports', 'admin', async (ctx) => {
    const rows = await ctx.db.all('SELECT id, version, format, scope, filters, filename, row_count AS rows, bytes, created_by AS createdBy, created_at AS createdAt FROM exports ORDER BY version DESC LIMIT 100');
    return json({ exports: rows.map((x) => ({ ...x, filters: parseJson(x.filters, {}) })) });
  });

  r.add('GET', '/api/admin/exports/:id/download', 'admin', async (ctx) => {
    const id = pathId(ctx.params.id);
    const e = await ctx.db.first<{ r2_key: string; filename: string; format: string }>('SELECT r2_key, filename, format FROM exports WHERE id = ?', id);
    if (!e) throw notFound('Export not found.');
    const obj = await ctx.env.RESUMES.get(e.r2_key);
    if (!obj) throw new HttpError(410, 'This export has expired (exports are kept for the data-retention period).', 'gone');
    await audit(ctx, 'export_downloaded', { type: 'export', id });
    return new Response(obj.body, {
      headers: {
        'Content-Type': e.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${e.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });

  /* ---------- system: usage, audit, errors, analytics ---------- */

  r.add('GET', '/api/admin/system/usage', 'admin', async (ctx) => {
    const days = await ctx.db.all('SELECT day, SUM(requests) AS requests, SUM(rows_read) AS rowsRead, SUM(rows_written) AS rowsWritten FROM usage_daily GROUP BY day ORDER BY day DESC LIMIT 30');
    const selected = ctx.url.searchParams.get('day') || day();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selected)) throw bad('Use a date like 2026-10-16.');
    const routes = await ctx.db.all('SELECT route, requests, rows_read AS rowsRead, rows_written AS rowsWritten FROM usage_daily WHERE day = ? ORDER BY rows_read DESC LIMIT 40', selected);
    const analytics = await ctx.db.all('SELECT day, event, SUM(count) AS count FROM analytics_daily WHERE day >= ? GROUP BY day, event ORDER BY day DESC, event', new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10));
    return json({ days, day: selected, routes, analytics, limits: { note: 'Workers Paid includes 25 billion D1 rows read and 50 million rows written per month; the free plan allows 5 million rows read per day.' } });
  });

  r.add('GET', '/api/admin/system/audit', 'admin', async (ctx) => {
    const limit = Math.min(200, Math.max(10, Number(ctx.url.searchParams.get('limit')) || 100));
    const before = Number(ctx.url.searchParams.get('before')) || null;
    const action = ctx.url.searchParams.get('action');
    const actorQ = ctx.url.searchParams.get('actor');
    const where: string[] = [];
    const vals: unknown[] = [];
    if (before) { where.push('id < ?'); vals.push(before); }
    if (action && /^[a-z_]{2,40}$/.test(action)) { where.push('action = ?'); vals.push(action); }
    if (actorQ) { where.push('actor_email = ?'); vals.push(actorQ.slice(0, 254)); }
    const rows = await ctx.db.all(
      `SELECT id, actor_email AS actor, actor_role AS role, action, target_type AS targetType, target_id AS targetId, detail, ip, at
       FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
      ...vals, limit
    );
    return json({ events: rows.map((e) => ({ ...e, detail: parseJson(e.detail, e.detail) })), nextBefore: rows.length === limit ? rows[rows.length - 1].id : null });
  });

  r.add('GET', '/api/admin/system/errors', 'admin', async (ctx) => {
    const rows = await ctx.db.all('SELECT id, surface, message, source, stack, url, user_agent AS userAgent, count, first_at AS firstAt, last_at AS lastAt FROM client_errors ORDER BY last_at DESC LIMIT 100');
    return json({ errors: rows });
  });

  r.add('DELETE', '/api/admin/system/errors', 'manager', async (ctx) => {
    const res = await ctx.db.run('DELETE FROM client_errors');
    await audit(ctx, 'errors_cleared', { type: 'system' }, { count: res.changes });
    return json({ ok: true });
  });

  /* ---------- backups ---------- */

  r.add('GET', '/api/admin/system/backups', 'admin', async (ctx) => {
    const rows = await ctx.db.all('SELECT id, kind, summary, candidate_count AS candidates, bytes, restored_at AS restoredAt, created_by AS createdBy, created_at AS createdAt, expires_at AS expiresAt FROM backups ORDER BY created_at DESC LIMIT 100');
    return json({ backups: rows });
  });

  r.add('POST', '/api/admin/system/backups', 'manager', async (ctx) => {
    const id = await fullBackup(ctx.env, ctx.db, 'manual', ctx.admin!.email);
    await audit(ctx, 'backup_created', { type: 'backup', id });
    return json({ ok: true, id });
  });

  r.add('GET', '/api/admin/system/backups/:id/download', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const b = await ctx.db.first<{ r2_key: string; kind: string }>('SELECT r2_key, kind FROM backups WHERE id = ?', id);
    if (!b) throw notFound('Backup not found.');
    const obj = await ctx.env.RESUMES.get(b.r2_key);
    if (!obj) throw new HttpError(410, 'The backup file has expired.', 'gone');
    await audit(ctx, 'backup_downloaded', { type: 'backup', id });
    return new Response(obj.body, { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="talo-${b.kind}-${id}.json"`, 'Cache-Control': 'private, no-store' } });
  });

  r.add('POST', '/api/admin/system/backups/:id/restore', 'manager', async (ctx) => {
    const res = await restoreBackup(ctx, pathId(ctx.params.id));
    return json({ ok: true, ...res, message: `Restored ${res.restored} candidate(s).` });
  });

  /* ---------- data requests (privacy) ---------- */

  r.add('GET', '/api/admin/system/data-requests', 'admin', async (ctx) => {
    const rows = await ctx.db.all('SELECT id, email, kind, message, status, created_at AS createdAt, resolved_at AS resolvedAt, resolved_by AS resolvedBy FROM data_requests ORDER BY status, created_at DESC LIMIT 200');
    return json({ requests: rows });
  });

  r.add('PATCH', '/api/admin/system/data-requests/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const b = await readJson(ctx.request, 1024);
    const status = oneOf(b, 'status', ['open', 'done', 'rejected'] as const)!;
    const res = await ctx.db.run(
      `UPDATE data_requests SET status = ?, resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END, resolved_by = ? WHERE id = ?`,
      status, status, status === 'open' ? null : ctx.admin!.email, id
    );
    if (!res.changes) throw notFound('Request not found.');
    await audit(ctx, 'data_request_updated', { type: 'data_request', id }, { status });
    return json({ ok: true });
  });

  /* ---------- delete every candidate (new season / full reset) ---------- */

  // Runs in steps of 50 so each request stays well inside Worker limits; the
  // portal calls it until `remaining` is 0. Step 0 takes a full snapshot first,
  // and every step writes a restorable backup (rows + resume copies).
  r.add('POST', '/api/admin/system/wipe', 'manager', async (ctx) => {
    const b = await readJson(ctx.request, 2048);
    if (b.confirm !== 'DELETE ALL CANDIDATES') throw bad('Type DELETE ALL CANDIDATES to confirm.', 'confirm_required');
    const s = await getSettings(ctx.env, ctx.db);
    const first = b.step === 0 || b.step == null;
    let snapshotId: string | null = null;
    if (first) {
      const open = Number((await ctx.db.value<number>('SELECT COUNT(*) AS n FROM attempts WHERE started_at IS NOT NULL AND submitted_at IS NULL')) ?? 0);
      if (open && b.force !== true) throw new HttpError(409, `${open} candidate(s) are taking the test right now. Wait for them to finish, or confirm again to delete anyway.`, 'tests_running', { running: open });
      snapshotId = await fullBackup(ctx.env, ctx.db, 'manual', ctx.admin!.email);
      await audit(ctx, 'wipe_started', { type: 'backup', id: snapshotId });
    }
    const ids = (await ctx.db.all<{ id: string }>('SELECT id FROM candidates ORDER BY created_at LIMIT 50')).map((x) => x.id);
    let backupId: string | null = null;
    if (ids.length) backupId = (await deleteCandidatesWithBackup(ctx, ids, { retentionDays: s.retentionDays, reason: 'Delete all candidates' })).backupId;
    const remaining = Number((await ctx.db.value<number>('SELECT COUNT(*) AS n FROM candidates')) ?? 0);
    if (!remaining) {
      // Exports hold names, emails and scores: remove them with the candidates.
      const exps = await ctx.db.all<{ id: string; r2_key: string }>('SELECT id, r2_key FROM exports');
      for (const e of exps) await ctx.env.RESUMES.delete(e.r2_key).catch(() => {});
      await ctx.db.batch([
        ctx.db.stmt('DELETE FROM exports'),
        ctx.db.stmt('DELETE FROM similarity_flags'),
        ctx.db.stmt('UPDATE questions SET assigned_count = 0'),
        auditStmt(ctx, 'wipe_completed', { type: 'system' }, { exportsRemoved: exps.length }),
      ]);
    }
    return json({ ok: true, deleted: ids.length, remaining, snapshotId, backupId });
  });

  /* ---------- test data cleanup ---------- */

  r.add('GET', '/api/admin/system/test-data', 'manager', async (ctx) => {
    const rows = await ctx.db.all<{ id: string; name: string | null; email: string; status: string; is_test: number; created_at: string }>(
      'SELECT id, name, email, status, is_test, created_at FROM candidates ORDER BY created_at'
    );
    const matches = rows.filter((c) => c.is_test || isTestEmail(c.email)).map((c) => ({ id: c.id, name: c.name, email: c.email.startsWith('pending+') ? null : c.email, status: c.status, markedTest: !!c.is_test, createdAt: c.created_at }));
    return json({ candidates: matches });
  });

  r.add('POST', '/api/admin/system/test-data/delete', 'manager', async (ctx) => {
    const b = await readJson(ctx.request, 64 * 1024);
    if (b.confirm !== 'DELETE TEST DATA') throw bad('Type DELETE TEST DATA to confirm.', 'confirm_required');
    const ids = idList(b, 'ids', { max: 200, label: 'Candidates' });
    const rows = await ctx.db.all<{ id: string; email: string; is_test: number }>(`SELECT id, email, is_test FROM candidates WHERE id IN ${IN_JSON}`, JSON.stringify(ids));
    const safe = rows.filter((c) => c.is_test || isTestEmail(c.email)).map((c) => c.id);
    if (!safe.length) throw bad('None of those are test records.');
    const s = await getSettings(ctx.env, ctx.db);
    const res = await deleteCandidatesWithBackup(ctx, safe, { retentionDays: s.retentionDays, reason: 'Test data cleanup' });
    return json({ ok: true, deleted: res.deleted, skipped: ids.length - safe.length, backupId: res.backupId });
  });
}

/** Snapshot every table (except high-volume telemetry) to R2. Used daily by the cron and on demand. */
export async function fullBackup(env: Env, db: Db, kind: 'daily' | 'manual', by: string): Promise<string> {
  const tables = ['settings', 'colleges', 'drives', 'candidates', 'attempts', 'questions', 'question_exposures', 'assignments', 'answers', 'interview_questions', 'admin_users', 'data_requests'];
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) {
    dump[t] = await db.all(`SELECT * FROM ${t}`);
    if (t === 'admin_users') dump[t] = (dump[t] as Record<string, unknown>[]).map(({ pass_hash, pass_salt, ...rest }) => ({ ...rest, pass_hash: pass_hash ? '[redacted]' : null }));
  }
  const id = newId('bak');
  const body = JSON.stringify({ kind, at: new Date().toISOString(), by, tables: dump });
  const key = `backups/${id}/full.json`;
  await env.RESUMES.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  const s = await getSettings(env, db);
  await db.run(
    'INSERT INTO backups (id, kind, r2_key, summary, candidate_count, bytes, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, kind, key, `${kind === 'daily' ? 'Daily' : 'Manual'} snapshot of ${tables.length} tables`, (dump.candidates ?? []).length, body.length, by,
    new Date(Date.now() + s.retentionDays * 86_400_000).toISOString()
  );
  return id;
}

export type { Ctx };
