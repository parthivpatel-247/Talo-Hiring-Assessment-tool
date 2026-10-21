import type { Env, Candidate } from '../types';
import type { AdminRole } from '../lib/auth';
import { json } from '../lib/auth';
import { newId, nowIso } from '../lib/db';
import { gradeWritingAnswer } from '../lib/openai';
import { getDocsConfig, docsPoolCounts, DOCS_LIMITS, partLabel, type DocsPart } from '../lib/team';

/**
 * ADMIN API overrides for the writers site (TEAM = "docs").
 *
 * The writers site runs the same admin portal as support, on its own database.
 * Only the parts that differ for a two-part writing test live here:
 *   - Assessment length: questions and minutes for each part.
 *   - Question bank: questions belong to Part 1 or Part 2 and carry a word limit;
 *     no AI enrichment (there is no rubric or sample data for writing).
 *   - Grading: AI marks each answer as a whole, with 2-3 lines of reasoning.
 *   - Export: Part 1 / Part 2 / total, answers, word counts, reasoning, paste activity.
 *   - Retake / Resume follow the two-part flow; no AI interview questions.
 * Returns null for any route it doesn't handle, so admin.ts carries on as usual.
 */

const PARTS: DocsPart[] = ['part1', 'part2'];

async function audit(env: Env, action: string, candidateId: string | null, detail = ''): Promise<void> {
  try {
    await env.DB.prepare('INSERT INTO admin_audit (id, action, candidate_id, detail) VALUES (?, ?, ?, ?)')
      .bind(newId('aud'), action, candidateId, detail.slice(0, 500))
      .run();
  } catch { /* best effort */ }
}

function managerOnly(role: AdminRole): Response | null {
  return role === 'manager' ? null : json({ error: 'Manager access required.' }, { status: 403 });
}

function intIn(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.round(n) !== n || n < lo || n > hi) return null;
  return n;
}

/** Marks may be whole or half marks, 0.5–100. */
function marksIn(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0.5 || n > 100 || Math.round(n * 2) !== n * 2) return null;
  return n;
}

function wordLimitIn(v: unknown): number | null | undefined {
  if (v === undefined) return undefined; // not supplied
  if (v === null || v === '') return null; // use the default
  return intIn(v, DOCS_LIMITS.minWords, DOCS_LIMITS.maxWords) ?? undefined;
}

function partOf(v: unknown): DocsPart | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (s === 'part1' || s === '1' || s === 'p1') return 'part1';
  if (s === 'part2' || s === '2' || s === 'p2') return 'part2';
  return null;
}

/** Extra fields for GET /api/admin/config on the writers site. */
export async function docsAdminConfig(env: Env) {
  const cfg = await getDocsConfig(env);
  const pool = await docsPoolCounts(env);
  return {
    team: 'docs',
    questionCategories: PARTS.map((p) => ({ value: p, label: partLabel(p), marks: cfg[p].marks })),
    assessmentMinutes: cfg.part1.minutes + cfg.part2.minutes,
    docs: {
      part1: cfg.part1,
      part2: cfg.part2,
      wordLimit: cfg.wordLimit,
      pool,
      limits: DOCS_LIMITS,
    },
  };
}

export async function handleDocsAdminRoute(request: Request, env: Env, path: string, role: AdminRole): Promise<Response | null> {
  // ---- Assessment length: questions + minutes for each part (manager) ----
  if (path === '/api/admin/assessment-length' && request.method === 'POST') {
    const denied = managerOnly(role); if (denied) return denied;
    const b = await request.json<any>().catch(() => ({}));
    const L = DOCS_LIMITS;
    const values: [string, number][] = [];
    for (const p of PARTS) {
      const q = intIn(b?.[p]?.questions, L.minQuestions, L.maxQuestions);
      const m = intIn(b?.[p]?.minutes, L.minMinutes, L.maxMinutes);
      if (q == null) return json({ error: `${partLabel(p)}: questions must be a whole number from ${L.minQuestions} to ${L.maxQuestions}.` }, { status: 400 });
      if (m == null) return json({ error: `${partLabel(p)}: minutes must be a whole number from ${L.minMinutes} to ${L.maxMinutes}.` }, { status: 400 });
      values.push([`${p}_questions`, q], [`${p}_minutes`, m]);
    }
    const stmt = env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    await env.DB.batch(values.map(([k, v]) => stmt.bind(k, String(v))));
    const cfg = await getDocsConfig(env);
    await audit(env, 'edit_duration', null, `Part 1: ${cfg.part1.questions} questions, ${cfg.part1.minutes} min · Part 2: ${cfg.part2.questions} questions, ${cfg.part2.minutes} min`);
    return json({ ok: true, ...(await docsAdminConfig(env)) });
  }
  // The single-length control belongs to the support test.
  if (path === '/api/admin/assessment-duration' && request.method === 'POST') {
    return json({ error: 'Set each part\'s length under Assessment length.' }, { status: 400 });
  }

  // ---- Question bank ----
  if (path === '/api/admin/questions' && request.method === 'POST') {
    const denied = managerOnly(role); if (denied) return denied;
    const b = await request.json<any>().catch(() => ({}));
    const part = partOf(b.category ?? b.part);
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
    if (!part) return json({ error: 'Choose Part 1 or Part 2.' }, { status: 400 });
    if (!prompt) return json({ error: 'Enter the question text.' }, { status: 400 });
    if (prompt.length > 20000) return json({ error: 'The question is too long (20,000 characters at most).' }, { status: 400 });
    const cfg = await getDocsConfig(env);
    const marks = b.marks == null || b.marks === '' ? cfg[part].marks : marksIn(b.marks);
    if (marks == null) return json({ error: 'Marks must be between 0.5 and 100, in whole or half marks.' }, { status: 400 });
    const wl = wordLimitIn(b.wordLimit);
    if (wl === undefined && b.wordLimit !== undefined) return json({ error: `Word limit must be a whole number from ${DOCS_LIMITS.minWords} to ${DOCS_LIMITS.maxWords}, or empty for the default.` }, { status: 400 });
    const id = newId('q');
    await env.DB.prepare(
      `INSERT INTO question_bank (id, category, prompt, marks, word_limit, difficulty, status, active) VALUES (?, ?, ?, ?, ?, 'medium', 'active', 1)`
    ).bind(id, part, prompt, marks, wl ?? null).run();
    await audit(env, 'add_question', null, `${partLabel(part)} · ${prompt.slice(0, 120)}`);
    return json({ ok: true, id });
  }

  const editMatch = path.match(/^\/api\/admin\/questions\/([^/]+)$/);
  if (editMatch && request.method === 'PUT') {
    const denied = managerOnly(role); if (denied) return denied;
    const b = await request.json<any>().catch(() => ({}));
    const q = await env.DB.prepare('SELECT * FROM question_bank WHERE id = ?').bind(editMatch[1]).first<any>();
    if (!q) return json({ error: 'Not found' }, { status: 404 });
    const part = b.category != null || b.part != null ? partOf(b.category ?? b.part) : q.category;
    if (!part) return json({ error: 'Choose Part 1 or Part 2.' }, { status: 400 });
    const prompt = typeof b.prompt === 'string' && b.prompt.trim() ? b.prompt.trim().slice(0, 20000) : q.prompt;
    const marks = b.marks != null ? marksIn(b.marks) : q.marks;
    if (marks == null) return json({ error: 'Marks must be between 0.5 and 100, in whole or half marks.' }, { status: 400 });
    const wl = wordLimitIn(b.wordLimit);
    if (wl === undefined && b.wordLimit !== undefined) return json({ error: `Word limit must be a whole number from ${DOCS_LIMITS.minWords} to ${DOCS_LIMITS.maxWords}, or empty for the default.` }, { status: 400 });
    const active = b.active == null ? q.active : (b.active ? 1 : 0);
    await env.DB.prepare('UPDATE question_bank SET category = ?, prompt = ?, marks = ?, word_limit = ?, active = ? WHERE id = ?')
      .bind(part, prompt, marks, wl === undefined ? q.word_limit : wl, active, q.id)
      .run();
    await audit(env, 'edit_question', null, q.id);
    return json({ ok: true });
  }

  // Bulk import. The file format is still to be agreed with the writers team; this
  // accepts JSON rows of { part: 1|2, prompt, marks?, wordLimit? } (or category: "part1"/"part2").
  if (path === '/api/admin/questions/bulk-import' && request.method === 'POST') {
    const denied = managerOnly(role); if (denied) return denied;
    const body = await request.json<any>().catch(() => ({}));
    const list: any[] = Array.isArray(body?.questions) ? body.questions : [];
    if (list.length > 500) return json({ error: 'Import at most 500 questions at a time.' }, { status: 400 });
    const cfg = await getDocsConfig(env);
    const norm = (p: string) => p.trim().toLowerCase().replace(/\s+/g, ' ');
    const existing = new Set(((await env.DB.prepare('SELECT prompt FROM question_bank WHERE deleted_at IS NULL').all<{ prompt: string }>()).results ?? []).map((r) => norm(r.prompt)));
    const rows: { part: DocsPart; prompt: string; marks: number; wl: number | null }[] = [];
    let skipped = 0, duplicates = 0;
    for (const q of list) {
      const part = partOf(q?.part ?? q?.category);
      const prompt = typeof q?.prompt === 'string' ? q.prompt.trim().slice(0, 20000) : '';
      const marks = q?.marks == null || q?.marks === '' ? cfg[part ?? 'part1'].marks : marksIn(q.marks);
      const wl = wordLimitIn(q?.wordLimit ?? q?.word_limit);
      if (!part || !prompt || marks == null || (wl === undefined && (q?.wordLimit ?? q?.word_limit) !== undefined)) { skipped++; continue; }
      const key = norm(prompt);
      if (existing.has(key)) { duplicates++; continue; }
      existing.add(key);
      rows.push({ part, prompt, marks, wl: wl ?? null });
    }
    if (rows.length) {
      const stmt = env.DB.prepare(`INSERT INTO question_bank (id, category, prompt, marks, word_limit, difficulty, status, active) VALUES (?, ?, ?, ?, ?, 'medium', 'active', 1)`);
      for (let i = 0; i < rows.length; i += 50) {
        await env.DB.batch(rows.slice(i, i + 50).map((r) => stmt.bind(newId('q'), r.part, r.prompt, r.marks, r.wl)));
      }
      await audit(env, 'import_questions', null, `${rows.length} imported, ${duplicates} duplicates, ${skipped} skipped`);
    }
    return json({ ok: true, imported: rows.length, duplicates, skipped });
  }

  // Writing questions have no sample data or rubric to generate.
  if ((path === '/api/admin/questions/enrich-all' || /^\/api\/admin\/questions\/[^/]+\/enrich$/.test(path)) && request.method === 'POST') {
    return json({ error: 'AI enrichment is not used for writing questions.' }, { status: 400 });
  }

  // ---- Export (CSV for the hiring team) ----
  if (path === '/api/admin/export.csv' && request.method === 'GET') {
    return exportDocsCsv(env, new URL(request.url));
  }

  // ---- Retake: fresh questions for both parts, full clocks ----
  const retakeMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/retake$/);
  if (retakeMatch && request.method === 'POST') {
    const denied = managerOnly(role); if (denied) return denied;
    const id = retakeMatch[1];
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE attempts SET part1_started_at=NULL, part1_remaining_seconds=NULL, part1_last_heartbeat_at=NULL, part1_submitted_at=NULL, part1_tab_switch_count=0,
         part2_started_at=NULL, part2_remaining_seconds=NULL, part2_last_heartbeat_at=NULL, part2_submitted_at=NULL, part2_tab_switch_count=0, part2_tab_switch_log=NULL
         WHERE candidate_id = ?`
      ).bind(id),
      env.DB.prepare('DELETE FROM part1_assignments WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part1_answers WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part2_answers WHERE candidate_id = ?').bind(id),
      env.DB.prepare('DELETE FROM part2_questions WHERE candidate_id = ?').bind(id),
      env.DB.prepare("UPDATE candidates SET status = 'part2_ready', retake_granted = 1, access_revoked = 0 WHERE id = ?").bind(id),
    ]);
    await audit(env, 'retake', id);
    return json({ ok: true });
  }

  // ---- Resume: same questions and saved answers, a fresh clock for the part that was cut off ----
  const resumeMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/resume$/);
  if (resumeMatch && request.method === 'POST') {
    const denied = managerOnly(role); if (denied) return denied;
    const id = resumeMatch[1];
    const at = await env.DB.prepare('SELECT * FROM attempts WHERE candidate_id = ?').bind(id).first<any>();
    if (!at || !at.part1_started_at) return json({ ok: true, reopened: null, message: 'This candidate has not started yet. They can sign in as usual.' });
    let reopened: DocsPart | null;
    if (at.part2_started_at) {
      // Part 2 was cut off: reopen Part 2 only. Part 1 stays closed.
      reopened = 'part2';
      await env.DB.batch([
        env.DB.prepare('UPDATE attempts SET part2_started_at = NULL, part2_remaining_seconds = NULL, part2_last_heartbeat_at = NULL, part2_submitted_at = NULL WHERE candidate_id = ?').bind(id),
        env.DB.prepare("UPDATE candidates SET status = 'in_progress', retake_granted = 1, access_revoked = 0 WHERE id = ?").bind(id),
      ]);
    } else if (at.part1_submitted_at && !at.part2_submitted_at) {
      // Between the parts: nothing to reopen. They can sign in again and start Part 2.
      reopened = null;
      await env.DB.prepare('UPDATE candidates SET access_revoked = 0 WHERE id = ?').bind(id).run();
    } else {
      // Cut off during Part 1 (or the test was closed while in Part 1): reopen Part 1.
      reopened = 'part1';
      await env.DB.batch([
        env.DB.prepare('UPDATE attempts SET part1_started_at = NULL, part1_remaining_seconds = NULL, part1_last_heartbeat_at = NULL, part1_submitted_at = NULL, part2_submitted_at = NULL WHERE candidate_id = ?').bind(id),
        env.DB.prepare("UPDATE candidates SET status = 'part2_ready', retake_granted = 1, access_revoked = 0 WHERE id = ?").bind(id),
      ]);
    }
    await audit(env, 'resume', id, reopened ? `reopened ${partLabel(reopened)}` : 'between parts — can sign in again');
    return json({
      ok: true,
      reopened,
      message: reopened ? `${partLabel(reopened)} reopened with the same questions and saved answers. The candidate signs in again to continue.` : 'Part 1 is already closed and Part 2 has not started. The candidate can sign in again and start Part 2.',
    });
  }

  // ---- Shortlist / reject: no AI interview questions on the writers site ----
  const shortlistMatch = path.match(/^\/api\/admin\/candidates\/([^/]+)\/(shortlist|reject)$/);
  if (shortlistMatch && request.method === 'POST') {
    const [, id, action] = shortlistMatch;
    await env.DB.prepare('UPDATE candidates SET status = ? WHERE id = ?').bind(action === 'shortlist' ? 'shortlisted' : 'rejected', id).run();
    await audit(env, action, id);
    return json({ ok: true });
  }
  if (/^\/api\/admin\/candidates\/[^/]+\/interview$/.test(path)) {
    return json({ error: 'Interview questions are not used on the writers site.' }, { status: 404 });
  }
  if (path.startsWith('/api/admin/part3/')) return json({ error: 'Not found' }, { status: 404 });

  return null;
}

/* ------------------------------------------------------------------ *
 * Grading
 * ------------------------------------------------------------------ */

type Signals = { maxPaste: number; pasteEvents: number; typed: number; pasted: number; activeMs: number };

function pasteSignals(rawLog: string | null): Record<string, Signals> {
  const out: Record<string, Signals> = {};
  const sig = (qid: string) => (out[qid] || (out[qid] = { maxPaste: 0, pasteEvents: 0, typed: 0, pasted: 0, activeMs: 0 }));
  try {
    const log = rawLog ? JSON.parse(rawLog) : [];
    for (const e of Array.isArray(log) ? log : []) {
      if (!e || !e.questionId) continue;
      if (e.type === 'paste') {
        const s = sig(e.questionId);
        if (typeof e.chars === 'number') { s.maxPaste = Math.max(s.maxPaste, e.chars); }
        s.pasteEvents += 1;
      } else if (e.type === 'metrics') {
        const s = sig(e.questionId);
        if (typeof e.typed === 'number') s.typed = Math.max(s.typed, e.typed);
        if (typeof e.pasted === 'number') s.pasted = Math.max(s.pasted, e.pasted);
        if (typeof e.ms === 'number') s.activeMs = Math.max(s.activeMs, e.ms);
      }
    }
  } catch { /* best effort */ }
  return out;
}

/** Grade every answer of one writers' candidate (both parts) and store marks + reasoning. */
export async function gradeDocsCandidate(env: Env, candidateId: string): Promise<void> {
  const cfg = await getDocsConfig(env);
  const p1 = await env.DB.prepare(
    `SELECT qb.id AS question_id, qb.prompt, qb.marks, qb.word_limit, a.answer_text
     FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id
     LEFT JOIN part1_answers a ON a.question_id = pa.question_id AND a.candidate_id = pa.candidate_id
     WHERE pa.candidate_id = ?`
  ).bind(candidateId).all<{ question_id: string; prompt: string; marks: number; word_limit: number | null; answer_text: string | null }>();

  await Promise.all((p1.results ?? []).map(async (q) => {
    const g = await gradeWritingAnswer(env, { part: 'part1', prompt: q.prompt, maxMarks: q.marks, answerText: q.answer_text ?? '', wordLimit: q.word_limit || cfg.wordLimit });
    await env.DB.prepare(
      `INSERT INTO part1_answers (candidate_id, question_id, answer_text, ai_score, ai_reasoning, deductions, max_marks, scored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (candidate_id, question_id)
       DO UPDATE SET ai_score = excluded.ai_score, ai_reasoning = excluded.ai_reasoning, deductions = excluded.deductions, max_marks = excluded.max_marks, scored_at = excluded.scored_at`
    ).bind(candidateId, q.question_id, q.answer_text ?? '', g.score, g.reasoning, JSON.stringify(g.deductions), q.marks, nowIso()).run();
  }));

  const at = await env.DB.prepare('SELECT part2_tab_switch_log FROM attempts WHERE candidate_id = ?').bind(candidateId).first<{ part2_tab_switch_log: string | null }>();
  const signals = pasteSignals(at?.part2_tab_switch_log ?? null);
  const p2 = await env.DB.prepare(
    `SELECT pq.id AS question_id, pq.prompt, pq.marks, pq.word_limit, a.answer_text
     FROM part2_questions pq
     LEFT JOIN part2_answers a ON a.question_id = pq.id AND a.candidate_id = pq.candidate_id
     WHERE pq.candidate_id = ?`
  ).bind(candidateId).all<{ question_id: string; prompt: string; marks: number; word_limit: number | null; answer_text: string | null }>();

  await Promise.all((p2.results ?? []).map(async (q) => {
    const g = await gradeWritingAnswer(env, {
      part: 'part2', prompt: q.prompt, maxMarks: q.marks, answerText: q.answer_text ?? '',
      wordLimit: q.word_limit || cfg.wordLimit, authSignals: signals[q.question_id],
    });
    await env.DB.prepare(
      `INSERT INTO part2_answers (candidate_id, question_id, answer_text, ai_score, ai_reasoning, deductions, max_marks, ai_content_pct, scored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (candidate_id, question_id)
       DO UPDATE SET ai_score = excluded.ai_score, ai_reasoning = excluded.ai_reasoning, deductions = excluded.deductions, max_marks = excluded.max_marks, ai_content_pct = excluded.ai_content_pct, scored_at = excluded.scored_at`
    ).bind(candidateId, q.question_id, q.answer_text ?? '', g.score, g.reasoning, JSON.stringify(g.deductions), q.marks, g.aiContentPercent ?? null, nowIso()).run();
  }));
}

/**
 * Backstop for abandoned attempts on the writers site: a part left running past its
 * time plus the grace window, or a candidate who closed Part 1 and never started
 * Part 2, is finalised so grading can go ahead. Returns how many were closed.
 */
export async function closeTimedOutDocs(env: Env): Promise<number> {
  const cfg = await getDocsConfig(env);
  const grace = Number(env.STALE_GRACE_MINUTES ?? 30) * 60;
  const p1Cut = cfg.part1.minutes * 60 + grace;
  const p2Cut = cfg.part2.minutes * 60 + grace;
  const rows = await env.DB.prepare(
    `SELECT candidate_id, part1_started_at, part1_submitted_at, part2_started_at, part2_submitted_at FROM attempts
     WHERE part2_submitted_at IS NULL AND part1_started_at IS NOT NULL`
  ).all<Record<string, string | null>>();
  const now = Date.now();
  const age = (t: string | null) => (t ? (now - new Date(t.includes('T') ? t : t.replace(' ', 'T') + 'Z').getTime()) / 1000 : 0);
  let closed = 0;
  for (const a of rows.results ?? []) {
    const p1Stale = !a.part1_submitted_at && age(a.part1_started_at) > p1Cut;
    const p2Stale = !!a.part2_started_at && age(a.part2_started_at) > p2Cut;
    const betweenStale = !!a.part1_submitted_at && !a.part2_started_at && age(a.part1_submitted_at) > p2Cut;
    if (!p1Stale && !p2Stale && !betweenStale) continue;
    const cid = a.candidate_id as string;
    await env.DB.batch([
      env.DB.prepare("UPDATE attempts SET part1_submitted_at = COALESCE(part1_submitted_at, datetime('now')), part2_submitted_at = COALESCE(part2_submitted_at, datetime('now')) WHERE candidate_id = ?").bind(cid),
      env.DB.prepare("UPDATE candidates SET status = 'submitted' WHERE id = ? AND status IN ('part2_ready','in_progress')").bind(cid),
    ]);
    await audit(env, 'auto_close_timed_out', cid, betweenStale ? 'never started Part 2' : 'attempt exceeded allotted time + grace');
    closed++;
  }
  return closed;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

const csvEsc = (v: unknown) => {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formulas in free text (a candidate answer starting with "=").
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const words = (t: string | null) => { const w = (t || '').trim(); return w ? w.split(/\s+/).length : 0; };
const fmtDed = (raw: unknown) => {
  try { const a = raw ? JSON.parse(String(raw)) : []; return Array.isArray(a) ? a.map((d: any) => `-${d.marks}: ${d.reason}`).join(' | ') : ''; } catch { return ''; }
};

async function exportDocsCsv(env: Env, url: URL): Promise<Response> {
  const fmt = url.searchParams.get('format') === 'full' ? 'full' : 'summary';
  const collegeFilter = url.searchParams.get('college') || 'all';
  const statusFilter = url.searchParams.get('status') || 'all';
  const cfg = await getDocsConfig(env);

  let cands = (await env.DB.prepare('SELECT * FROM candidates ORDER BY college, created_at').all<Candidate>()).results ?? [];
  if (collegeFilter === '__none') cands = cands.filter((c) => !c.college);
  else if (collegeFilter !== 'all') cands = cands.filter((c) => (c.college || '') === collegeFilter);
  if (statusFilter !== 'all') cands = cands.filter((c) => c.status === statusFilter);
  const emailOut = (e: string) => (e.startsWith('pending+') ? '' : e);

  // Whole-cohort reads, grouped in memory (one query per table, not per candidate).
  const p1 = (await env.DB.prepare(
    `SELECT pa.candidate_id AS cid, pa.position, qb.prompt, qb.word_limit, a.answer_text, a.ai_score, a.max_marks, qb.marks, a.ai_reasoning, a.deductions
     FROM part1_assignments pa JOIN question_bank qb ON qb.id = pa.question_id
     LEFT JOIN part1_answers a ON a.question_id = pa.question_id AND a.candidate_id = pa.candidate_id
     ORDER BY pa.candidate_id, pa.position`
  ).all<any>()).results ?? [];
  const p2 = (await env.DB.prepare(
    `SELECT pq.candidate_id AS cid, pq.position, pq.prompt, pq.word_limit, a.answer_text, a.ai_score, a.max_marks, pq.marks, a.ai_reasoning, a.deductions, a.ai_content_pct
     FROM part2_questions pq
     LEFT JOIN part2_answers a ON a.question_id = pq.id AND a.candidate_id = pq.candidate_id
     ORDER BY pq.candidate_id, pq.position`
  ).all<any>()).results ?? [];
  const attempts = new Map(((await env.DB.prepare('SELECT * FROM attempts').all<any>()).results ?? []).map((a) => [a.candidate_id, a]));
  const group = (rows: any[]) => { const m = new Map<string, any[]>(); for (const r of rows) { if (!m.has(r.cid)) m.set(r.cid, []); m.get(r.cid)!.push(r); } return m; };
  const g1 = group(p1), g2 = group(p2);
  const sum = (rows: any[] = []) => ({
    awarded: rows.reduce((s, r) => s + (r.ai_score != null ? Number(r.ai_score) : 0), 0),
    max: rows.reduce((s, r) => s + Number(r.max_marks ?? r.marks ?? 0), 0),
    graded: rows.some((r) => r.ai_score != null),
  });
  const pasteStats = (raw: string | null) => {
    let pastes = 0, chars = 0;
    try { for (const e of JSON.parse(raw || '[]')) if (e && e.type === 'paste') { pastes++; chars += Number(e.chars) || 0; } } catch { /* ignore */ }
    return { pastes, chars };
  };

  const lines: string[] = [];
  if (fmt === 'summary') {
    lines.push(['College', 'Name', 'Email', 'Status', 'Logins', 'Part 1 score', 'Part 1 max', 'Part 2 score', 'Part 2 max', 'Total score', 'Total max', 'Graded', 'Part 1 left the test', 'Part 2 tab switches', 'Part 2 pastes', 'Part 2 pasted characters'].join(','));
    for (const c of cands) {
      const s1 = sum(g1.get(c.id)), s2 = sum(g2.get(c.id));
      const at = attempts.get(c.id) || {};
      const ps = pasteStats(at.part2_tab_switch_log);
      lines.push([
        csvEsc(c.college || ''), csvEsc(c.name), csvEsc(emailOut(c.email)), csvEsc(c.status), at.login_count ?? '',
        s1.awarded, s1.max, s2.awarded, s2.max, s1.awarded + s2.awarded, s1.max + s2.max, s1.graded || s2.graded ? 'yes' : 'no',
        at.part1_tab_switch_count ?? 0, at.part2_tab_switch_count ?? 0, ps.pastes, ps.chars,
      ].join(','));
    }
  } else {
    lines.push(['College', 'Name', 'Email', 'Status', 'Total score', 'Total max', 'Part', 'Q#', 'Question', 'Candidate answer', 'Words', 'Word limit', 'AI score', 'Q max', 'AI reasoning', 'Deductions', 'AI-likelihood % (Part 2, estimate)'].join(','));
    for (const c of cands) {
      const r1 = g1.get(c.id) || [], r2 = g2.get(c.id) || [];
      const s1 = sum(r1), s2 = sum(r2);
      const base = [csvEsc(c.college || ''), csvEsc(c.name), csvEsc(emailOut(c.email)), csvEsc(c.status), s1.awarded + s2.awarded, s1.max + s2.max];
      const row = (part: string, q: any, i: number) => [
        ...base, part, i + 1, csvEsc(q.prompt), csvEsc(q.answer_text || ''), words(q.answer_text), q.word_limit || cfg.wordLimit,
        q.ai_score ?? '', q.max_marks ?? q.marks ?? '', csvEsc(q.ai_reasoning || ''), csvEsc(fmtDed(q.deductions)),
        q.ai_content_pct != null ? Math.round(q.ai_content_pct) : '',
      ].join(',');
      r1.forEach((q, i) => lines.push(row('Part 1', q, i)));
      r2.forEach((q, i) => lines.push(row('Part 2', q, i)));
      if (!r1.length && !r2.length) lines.push([...base, '', '', '(not started)', '', '', '', '', '', '', '', ''].join(','));
    }
  }
  const fname = `talo-writers-${fmt}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response('﻿' + lines.join('\r\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname}"` },
  });
}
