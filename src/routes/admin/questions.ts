import type { Router } from '../../router';
import type { QuestionRow, QuestionCategory } from '../../env';
import { QUESTION_CATEGORIES } from '../../env';
import { json, readJson, str, oneOf, num, bool, pathId, bad, notFound, HttpError } from '../../lib/http';
import { enrichQuestion } from '../../lib/openai';
import { audit, auditStmt } from '../../lib/audit';
import { defaultMarks, getSettings, CATEGORY_LABEL } from '../../lib/settings';
import { newId } from '../../db/db';
import { titleAndTopic } from '../../db/migrate';

const DIFFS = ['easy', 'medium', 'hard'] as const;
const TEXT_FIELDS: [string, string, number][] = [
  ['prompt', 'prompt', 20000], ['sampleData', 'sample_data', 20000], ['hint', 'hint', 1000], ['referenceAnswer', 'reference_answer', 20000],
  ['expectedOutput', 'expected_output', 20000], ['rubric', 'rubric', 8000], ['checkpoints', 'checkpoints', 4000], ['title', 'title', 160], ['topic', 'topic', 160],
];

function shape(q: QuestionRow & { answered?: number }) {
  return {
    id: q.id, category: q.category, title: q.title, topic: q.topic, difficulty: q.difficulty, prompt: q.prompt, sampleData: q.sample_data,
    hint: q.hint, referenceAnswer: q.reference_answer, expectedOutput: q.expected_output, rubric: q.rubric, checkpoints: q.checkpoints,
    marks: q.marks, source: q.source, active: !!q.active, assignedCount: q.assigned_count, version: q.version,
    createdAt: q.created_at, updatedAt: q.updated_at, deletedAt: q.deleted_at,
    enriched: !!(q.rubric && (q.expected_output || q.checkpoints)),
  };
}

export function registerAdminQuestions(r: Router): void {
  r.add('GET', '/api/admin/questions', 'admin', async (ctx) => {
    const deleted = ctx.url.searchParams.get('deleted') === '1';
    const rows = await ctx.db.all<QuestionRow>(
      `SELECT * FROM questions WHERE deleted_at IS ${deleted ? 'NOT ' : ''}NULL ORDER BY category, difficulty, title`
    );
    const deletedCount = Number((await ctx.db.value<number>('SELECT COUNT(*) AS n FROM questions WHERE deleted_at IS NOT NULL')) ?? 0);
    const s = await getSettings(ctx.env, ctx.db);
    // Pool health per paper slot: how many active questions can fill it.
    const pool = await ctx.db.all<{ category: string; difficulty: string; n: number; min_used: number; max_used: number }>(
      `SELECT category, difficulty, COUNT(*) AS n, MIN(assigned_count) AS min_used, MAX(assigned_count) AS max_used
       FROM questions WHERE active = 1 AND deleted_at IS NULL GROUP BY category, difficulty`
    );
    const slots = s.paper.map((slot) => {
      const matching = pool.filter((p) => p.category === slot.category && (slot.difficulty === 'any' || p.difficulty === slot.difficulty));
      return { ...slot, label: CATEGORY_LABEL[slot.category], available: matching.reduce((n, p) => n + Number(p.n), 0) };
    });
    return json({
      questions: rows.map(shape),
      deletedCount,
      categories: QUESTION_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c], defaultMarks: defaultMarks(ctx.env, c) })),
      pool: slots,
    });
  });

  r.add('POST', '/api/admin/questions', 'manager', async (ctx) => {
    const b = await readJson(ctx.request, 128 * 1024);
    const category = oneOf(b, 'category', QUESTION_CATEGORIES, { label: 'Question type' })! as QuestionCategory;
    const difficulty = (oneOf(b, 'difficulty', DIFFS, { optional: true }) ?? 'medium') as string;
    const prompt = str(b, 'prompt', { min: 10, max: 20000, trim: false, label: 'Question' }).trim();
    const marks = num(b, 'marks', { min: 0.5, max: 100, optional: true, label: 'Marks' }) ?? defaultMarks(ctx.env, category);
    const fields: Record<string, string | null> = {};
    for (const [k, col, max] of TEXT_FIELDS) if (k !== 'prompt') fields[col] = str(b, k, { max, optional: true, trim: false }).trim() || null;
    const derived = titleAndTopic(prompt);
    fields.title = fields.title || derived.title;
    fields.topic = fields.topic || derived.topic;
    let enrichError: string | null = null;
    if (b.enrich === true) {
      try {
        const e = await enrichQuestion(ctx.env, category, prompt, fields.reference_answer);
        fields.sample_data = fields.sample_data || e.sample_data;
        fields.expected_output = fields.expected_output || e.expected_output;
        fields.rubric = fields.rubric || e.rubric;
        fields.hint = fields.hint || e.hint;
        fields.checkpoints = fields.checkpoints || e.checkpoints;
      } catch (err) {
        enrichError = 'AI enrichment is unavailable right now; the question was saved without it.';
      }
    }
    const id = newId('q');
    await ctx.db.batch([
      ctx.db.stmt(
        `INSERT INTO questions (id, category, title, topic, difficulty, prompt, sample_data, hint, reference_answer, expected_output, rubric, checkpoints, marks, source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
        id, category, fields.title, fields.topic, difficulty, prompt, fields.sample_data, fields.hint, fields.reference_answer,
        fields.expected_output, fields.rubric, fields.checkpoints, marks, ctx.admin!.email
      ),
      auditStmt(ctx, 'question_created', { type: 'question', id }, { category, title: fields.title }),
    ]);
    const q = await ctx.db.first<QuestionRow>('SELECT * FROM questions WHERE id = ?', id);
    return json({ ok: true, question: shape(q!), enrichError });
  });

  r.add('PUT', '/api/admin/questions/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const q = await ctx.db.first<QuestionRow>('SELECT * FROM questions WHERE id = ?', id);
    if (!q) throw notFound('Question not found.');
    const b = await readJson(ctx.request, 128 * 1024);
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col, max] of TEXT_FIELDS) {
      if (!(k in b)) continue;
      const v = str(b, k, { max, optional: k !== 'prompt', trim: false, label: k }).trim();
      if (k === 'prompt' && v.length < 10) throw bad('The question text is too short.');
      let value: string | null = v || null;
      // A cleared title or topic falls back to one derived from the question text.
      if (!value && (k === 'title' || k === 'topic')) value = titleAndTopic(typeof b.prompt === 'string' ? b.prompt : q.prompt)[k as 'title' | 'topic'] ?? null;
      sets.push(`${col} = ?`);
      vals.push(value);
    }
    if ('category' in b) { sets.push('category = ?'); vals.push(oneOf(b, 'category', QUESTION_CATEGORIES)); }
    if ('difficulty' in b) { sets.push('difficulty = ?'); vals.push(oneOf(b, 'difficulty', DIFFS)); }
    if ('marks' in b) { sets.push('marks = ?'); vals.push(num(b, 'marks', { min: 0.5, max: 100, label: 'Marks' })); }
    if ('active' in b) { sets.push('active = ?'); vals.push(bool(b, 'active') ? 1 : 0); }
    if (!sets.length) throw bad('Nothing to update.');
    sets.push('version = version + 1', "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    await ctx.db.batch([
      ctx.db.stmt(`UPDATE questions SET ${sets.join(', ')} WHERE id = ?`, ...vals, id),
      auditStmt(ctx, 'question_updated', { type: 'question', id }, { fields: Object.keys(b) }),
    ]);
    const fresh = await ctx.db.first<QuestionRow>('SELECT * FROM questions WHERE id = ?', id);
    return json({ ok: true, question: shape(fresh!) });
  });

  r.add('POST', '/api/admin/questions/:id/enrich', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const q = await ctx.db.first<QuestionRow>('SELECT * FROM questions WHERE id = ?', id);
    if (!q) throw notFound('Question not found.');
    const b = await readJson(ctx.request, 1024);
    const overwrite = b.overwrite === true;
    let e;
    try {
      e = await enrichQuestion(ctx.env, q.category, q.prompt, q.reference_answer);
    } catch {
      throw new HttpError(502, 'AI enrichment is unavailable right now. Try again in a minute.', 'ai_unavailable');
    }
    const pick = (cur: string | null, next: string | null) => (overwrite ? next ?? cur : cur || next);
    await ctx.db.batch([
      ctx.db.stmt(
        `UPDATE questions SET sample_data = ?, expected_output = ?, rubric = ?, hint = ?, checkpoints = ?, version = version + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        pick(q.sample_data, e.sample_data), pick(q.expected_output, e.expected_output), pick(q.rubric, e.rubric), pick(q.hint, e.hint),
        pick(q.checkpoints, e.checkpoints), id
      ),
      auditStmt(ctx, 'question_enriched', { type: 'question', id }, { overwrite }),
    ]);
    const fresh = await ctx.db.first<QuestionRow>('SELECT * FROM questions WHERE id = ?', id);
    return json({ ok: true, question: shape(fresh!) });
  });

  // Fill missing grading material on a few questions per call (the UI loops until remaining = 0).
  r.add('POST', '/api/admin/questions/enrich-missing', 'manager', async (ctx) => {
    const needs = "(rubric IS NULL OR (category IN ('sql','coding') AND expected_output IS NULL) OR (category IN ('dsa','scenario') AND (checkpoints IS NULL OR checkpoints = '')))";
    const batch = await ctx.db.all<QuestionRow>(`SELECT * FROM questions WHERE deleted_at IS NULL AND ${needs} LIMIT 4`);
    const results: { id: string; ok: boolean }[] = [];
    for (const q of batch) {
      try {
        const e = await enrichQuestion(ctx.env, q.category, q.prompt, q.reference_answer);
        await ctx.db.run(
          `UPDATE questions SET sample_data = COALESCE(sample_data, ?), expected_output = COALESCE(expected_output, ?), rubric = COALESCE(rubric, ?),
             hint = COALESCE(hint, ?), checkpoints = COALESCE(NULLIF(checkpoints, ''), ?), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
          e.sample_data, e.expected_output, e.rubric, e.hint, e.checkpoints, q.id
        );
        results.push({ id: q.id, ok: true });
      } catch {
        results.push({ id: q.id, ok: false });
      }
    }
    const remaining = Number((await ctx.db.value<number>(`SELECT COUNT(*) AS n FROM questions WHERE deleted_at IS NULL AND ${needs}`)) ?? 0);
    if (results.length) await audit(ctx, 'questions_enriched', { type: 'questions' }, { ok: results.filter((x) => x.ok).length });
    return json({ processed: results, remaining });
  });

  r.add('DELETE', '/api/admin/questions/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const q = await ctx.db.first<QuestionRow>('SELECT * FROM questions WHERE id = ?', id);
    if (!q) throw notFound('Question not found.');
    if (q.deleted_at) return json({ ok: true });
    await ctx.db.batch([
      ctx.db.stmt("UPDATE questions SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), active = 0 WHERE id = ?", id),
      auditStmt(ctx, 'question_deleted', { type: 'question', id }, { snapshot: q }),
    ]);
    return json({ ok: true });
  });

  r.add('POST', '/api/admin/questions/:id/restore', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const res = await ctx.db.run('UPDATE questions SET deleted_at = NULL, active = 1 WHERE id = ? AND deleted_at IS NOT NULL', id);
    if (!res.changes) throw notFound('That question is not in the deleted list.');
    await audit(ctx, 'question_restored', { type: 'question', id });
    return json({ ok: true });
  });

  // Bulk import: { questions: [{ category, prompt, difficulty?, marks?, title?, topic?, sampleData?, hint?, referenceAnswer?, expectedOutput?, rubric?, checkpoints? }] }
  r.add('POST', '/api/admin/questions/import', 'manager', async (ctx) => {
    const b = await readJson(ctx.request, 2 * 1024 * 1024);
    const list = Array.isArray(b.questions) ? (b.questions as Record<string, unknown>[]) : null;
    if (!list || !list.length) throw bad('Provide a "questions" list.');
    if (list.length > 300) throw bad('Import at most 300 questions at a time.');
    const norm = (p: string) => p.trim().toLowerCase().replace(/\s+/g, ' ');
    const existing = new Set((await ctx.db.all<{ prompt: string }>('SELECT prompt FROM questions WHERE deleted_at IS NULL')).map((x) => norm(x.prompt)));
    const stmts: D1PreparedStatement[] = [];
    const errors: { index: number; error: string }[] = [];
    let duplicates = 0;
    list.forEach((raw, index) => {
      try {
        if (!raw || typeof raw !== 'object') throw bad('Not an object.');
        const category = String(raw.category) === 'python' ? 'coding' : String(raw.category);
        if (!QUESTION_CATEGORIES.includes(category as QuestionCategory)) throw bad(`Unknown category "${raw.category}".`);
        const prompt = str(raw, 'prompt', { min: 10, max: 20000, trim: false }).trim();
        if (existing.has(norm(prompt))) { duplicates++; return; }
        existing.add(norm(prompt));
        const difficulty = DIFFS.includes(String(raw.difficulty) as never) ? String(raw.difficulty) : 'medium';
        const marks = num(raw, 'marks', { min: 0.5, max: 100, optional: true }) ?? defaultMarks(ctx.env, category as QuestionCategory);
        const f = (k: string, max: number) => (typeof raw[k] === 'string' ? (raw[k] as string).slice(0, max).trim() || null : null);
        const derived = titleAndTopic(prompt);
        stmts.push(
          ctx.db.stmt(
            `INSERT INTO questions (id, category, title, topic, difficulty, prompt, sample_data, hint, reference_answer, expected_output, rubric, checkpoints, marks, source, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?)`,
            newId('q'), category, f('title', 160) ?? derived.title, f('topic', 160) ?? derived.topic, difficulty, prompt, f('sampleData', 20000),
            f('hint', 1000), f('referenceAnswer', 20000), f('expectedOutput', 20000), f('rubric', 8000), f('checkpoints', 4000), marks, ctx.admin!.email
          )
        );
      } catch (err) {
        errors.push({ index, error: err instanceof Error ? err.message : 'Invalid' });
      }
    });
    for (let i = 0; i < stmts.length; i += 50) await ctx.db.batch(stmts.slice(i, i + 50));
    await audit(ctx, 'questions_imported', { type: 'questions' }, { imported: stmts.length, duplicates, errors: errors.length });
    return json({ ok: true, imported: stmts.length, duplicates, errors });
  });
}
