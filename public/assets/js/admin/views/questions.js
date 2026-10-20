/* Question bank: pool health per paper slot, search and filters, preview exactly as
   candidates see it, edit with grading material, import, and AI-filled rubrics. */
import { $, $$, html, raw, setHtml, debounce, escapeHtml as esc } from '../../core/dom.js';
import { get, post, put, del } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { openDialog, openMenu, toast, setLoading } from '../../core/ui.js';
import { fmtNum, plural, fmtDate } from '../../core/format.js';
import { renderRich, questionTitle } from '../../core/markdown.js';
import { isManager, emptyState, applyWidths, trimNum } from '../shared.js';

const CAT = { sql: 'SQL', coding: 'Coding', dsa: 'Data structures', scenario: 'Scenario' };
const DIFF = { easy: 'success', medium: 'warning', hard: 'danger' };

export async function render(ctx) {
  const f = { q: '', cat: ctx.query.get('category') || '', diff: '', missing: false, deleted: false };
  let data = null;

  ctx.setHeader({
    title: 'Question bank',
    actions: isManager() ? html`<button class="btn btn-secondary btn-sm" id="q-import">${raw(icon('upload', { size: 16 }))} Import</button><button class="btn btn-secondary btn-sm" id="q-fill">${raw(icon('sparkles', { size: 16 }))} Fill missing rubrics</button><button class="btn btn-primary btn-sm" id="q-new">${raw(icon('plus', { size: 16 }))} New question</button>` : '',
  });

  setHtml(ctx.view, html`
    <section class="panel" aria-labelledby="pool-h"><div class="panel-head"><h2 id="pool-h">Pool health</h2><span class="hint">Each paper draws the least-used questions first, so a deeper pool means fewer repeats between students.</span></div><div class="pool-bars" id="pool"></div></section>
    <section class="panel" aria-label="Questions">
      <div class="toolbar">
        <div class="input-group">${raw(icon('search', { size: 16 }))}<input class="input" id="search" type="search" placeholder="Search title, topic or text" aria-label="Search questions"></div>
        <label class="sr-only" for="f-cat">Type</label><select class="select" id="f-cat"><option value="">All types</option>${raw(Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''))}</select>
        <label class="sr-only" for="f-diff">Difficulty</label><select class="select" id="f-diff"><option value="">Any difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
        <button class="chip" type="button" id="f-missing" aria-pressed="false">Missing rubric</button>
        <button class="chip" type="button" id="f-deleted" aria-pressed="false">${raw(icon('trash-2', { size: 14 }))} Deleted</button>
        <span class="count-note" id="count-note"></span>
      </div>
      <div class="table-wrap" id="qtable"></div>
    </section>`);
  $('#f-cat').value = f.cat;

  const load = async () => {
    data = await get(`/api/admin/questions${f.deleted ? '?deleted=1' : ''}`);
    drawPool();
    drawTable();
  };
  const drawPool = () => {
    const el = $('#pool');
    el.style.setProperty('--n', String(Math.max(1, data.pool.length)));
    setHtml(el, raw(data.pool.map((p) => {
      const ratio = p.count ? p.available / p.count : 0;
      const tone = ratio < 3 ? 'error-text' : ratio < 8 ? 'ck-no' : 'ck-ok';
      return `<div><span class="cell-secondary">${esc(p.label)}${p.difficulty !== 'any' ? ` · ${p.difficulty}` : ''}</span><div><b>${p.available}</b> <span class="muted">for ${p.count} per paper</span></div><div class="progress"><span data-w="${Math.min(100, ratio * 10)}"></span></div><span class="cell-secondary ${tone}">${ratio < 3 ? 'Too few: papers will repeat' : ratio < 8 ? 'Some repeats likely' : 'Healthy'}</span></div>`;
    }).join('')));
    applyWidths(el);
  };
  const rows = () => data.questions.filter((q) => {
    if (f.cat && q.category !== f.cat) return false;
    if (f.diff && q.difficulty !== f.diff) return false;
    if (f.missing && q.enriched) return false;
    if (f.q) {
      const hay = `${q.title || ''} ${q.topic || ''} ${q.prompt}`.toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const drawTable = () => {
    const list = rows();
    $('#count-note').textContent = `${fmtNum(list.length)} of ${fmtNum(data.questions.length)}${f.deleted ? ' deleted' : ''}`;
    if (!list.length) {
      setHtml($('#qtable'), emptyState({ ic: 'book-open', title: f.deleted ? 'No deleted questions' : 'No questions match', body: f.deleted ? 'Deleted questions appear here and can be restored.' : 'Change the filters or add a question.' }));
      return;
    }
    setHtml($('#qtable'), raw(`<table class="table"><thead><tr><th>Question</th><th>Type</th><th>Difficulty</th><th class="num">Marks</th><th class="num">Used</th><th>Grading</th><th>Status</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.map((q) => `
      <tr class="row-link" data-id="${q.id}" tabindex="0">
        <td><div class="q-row-title truncate">${esc(questionTitle(q))}</div>${q.topic ? `<div class="cell-secondary truncate">${esc(q.topic)}</div>` : ''}</td>
        <td><span class="badge neutral">${CAT[q.category] || q.category}</span></td>
        <td><span class="badge ${DIFF[q.difficulty] || 'neutral'}">${esc(q.difficulty)}</span></td>
        <td class="num">${trimNum(q.marks)}</td>
        <td class="num" title="Times assigned to a candidate">${q.assignedCount}</td>
        <td>${q.enriched ? `<span class="badge success">${icon('check', { size: 12 })} Rubric</span>` : '<span class="badge warning">Missing rubric</span>'}</td>
        <td>${q.deletedAt ? '<span class="badge outline">Deleted</span>' : q.active ? '<span class="badge success">Active</span>' : '<span class="badge outline">Paused</span>'}</td>
        <td class="actions"><button class="btn btn-ghost btn-icon btn-sm" data-qmenu="${q.id}" aria-label="Actions">${icon('ellipsis', { size: 16 })}</button></td>
      </tr>`).join('')}</tbody></table>`));
  };

  ctx.view.addEventListener('click', (e) => {
    const m = e.target.closest('[data-qmenu]');
    if (m) {
      e.stopPropagation();
      const q = data.questions.find((x) => x.id === m.dataset.qmenu);
      const items = [{ label: 'Preview', icon: 'eye', onClick: () => openQuestion(q, 'preview') }];
      if (isManager()) {
        if (q.deletedAt) items.push({ label: 'Restore', icon: 'archive-restore', onClick: () => restore(q) });
        else {
          items.push({ label: 'Edit', icon: 'pencil', onClick: () => openQuestion(q, 'edit') });
          items.push({ label: q.active ? 'Pause (keep out of new papers)' : 'Activate', icon: q.active ? 'pause' : 'play', onClick: () => setActive(q, !q.active) });
          items.push({ label: 'Generate rubric with AI', icon: 'sparkles', onClick: () => enrich(q) });
          items.push({ divider: true }, { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => remove(q) });
        }
      }
      return openMenu(m, items);
    }
    const row = e.target.closest('tr[data-id]');
    if (row) openQuestion(data.questions.find((x) => x.id === row.dataset.id), 'preview');
  });
  ctx.view.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openQuestion(data.questions.find((x) => x.id === row.dataset.id), 'preview'); }
  });
  $('#search').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); drawTable(); }, 120));
  $('#f-cat').addEventListener('change', (e) => { f.cat = e.target.value; drawTable(); });
  $('#f-diff').addEventListener('change', (e) => { f.diff = e.target.value; drawTable(); });
  $('#f-missing').addEventListener('click', (e) => { f.missing = !f.missing; e.currentTarget.setAttribute('aria-pressed', String(f.missing)); drawTable(); });
  $('#f-deleted').addEventListener('click', async (e) => { f.deleted = !f.deleted; e.currentTarget.setAttribute('aria-pressed', String(f.deleted)); await load(); });
  document.getElementById('q-new')?.addEventListener('click', () => openQuestion(null, 'edit'));
  document.getElementById('q-import')?.addEventListener('click', importDialog);
  document.getElementById('q-fill')?.addEventListener('click', (e) => fillMissing(e.currentTarget));

  async function setActive(q, active) {
    try { await put(`/api/admin/questions/${q.id}`, { active }); toast(active ? 'Question active.' : 'Question paused. Papers already assigned keep it.', { type: 'success' }); load(); } catch (err) { toast(err.message, { type: 'error' }); }
  }
  async function enrich(q) {
    const wait = toast('Writing the rubric…', { timeout: 30000 });
    try {
      await post(`/api/admin/questions/${q.id}/enrich`, { overwrite: false }, { timeoutMs: 60000 });
      toast('Rubric added. Review it before the next drive.', { type: 'success' });
      load();
    } catch (err) { toast(err.message, { type: 'error' }); } finally { wait(); }
  }
  async function remove(q) {
    const ok = await openDialog({ title: 'Delete this question?', icon: 'trash-2', danger: true, confirmLabel: 'Delete', body: html`<p>It stops appearing in new papers. Papers that already include it are not changed, and you can restore it from <b>Deleted</b>.</p><p class="muted">${questionTitle(q)}</p>`, onConfirm: () => del(`/api/admin/questions/${q.id}`) });
    if (ok) { toast('Question deleted.', { type: 'success' }); load(); }
  }
  async function restore(q) {
    try { await post(`/api/admin/questions/${q.id}/restore`); toast('Question restored.', { type: 'success' }); load(); } catch (err) { toast(err.message, { type: 'error' }); }
  }

  async function fillMissing(btn) {
    const ok = await openDialog({ title: 'Fill missing grading material?', icon: 'sparkles', confirmLabel: 'Start', body: html`<p>For every question without a rubric (and expected output or checkpoints), the AI drafts them. Existing material is never overwritten. Review the drafts before a drive.</p>` });
    if (!ok) return;
    setLoading(btn, true);
    let done = 0;
    try {
      for (let i = 0; i < 100; i++) {
        const r = await post('/api/admin/questions/enrich-missing', {}, { timeoutMs: 120000 });
        const good = r.processed.filter((x) => x.ok).length;
        done += good;
        if (!r.remaining || !r.processed.length || !good) {
          if (r.remaining && !good) toast('The AI is unavailable right now; try again later.', { type: 'error' });
          break;
        }
        toast(`${done} done, ${r.remaining} to go…`, { timeout: 2500 });
      }
      toast(`${plural(done, 'question')} updated.`, { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setLoading(btn, false);
      load();
    }
  }

  async function importDialog() {
    const ok = await openDialog({
      title: 'Import questions',
      icon: 'upload',
      wide: true,
      confirmLabel: 'Import',
      body: html`
        <p>Paste a JSON list, or choose a <code>.json</code> file. Duplicates (same question text) are skipped.</p>
        <div class="field"><label for="imp-file">File</label><input class="input" id="imp-file" type="file" accept="application/json,.json"></div>
        <div class="field"><label for="imp-json">JSON</label><textarea class="textarea json-input" id="imp-json" spellcheck="false" placeholder='[{"category":"dsa","difficulty":"medium","title":"…","prompt":"…","sampleData":"…","referenceAnswer":"…","rubric":"…","checkpoints":"…","marks":5}]'></textarea>
        <span class="hint">Fields: category (sql, coding, dsa, scenario), prompt, and optionally title, topic, difficulty, marks, sampleData, hint, referenceAnswer, expectedOutput, rubric, checkpoints.</span></div>`,
      onConfirm: async () => {
        let list;
        try {
          const parsed = JSON.parse($('#imp-json').value || '[]');
          list = Array.isArray(parsed) ? parsed : parsed.questions;
        } catch (_) {
          throw new Error('That is not valid JSON.');
        }
        if (!Array.isArray(list) || !list.length) throw new Error('Paste at least one question.');
        return post('/api/admin/questions/import', { questions: list }, { timeoutMs: 60000 });
      },
    });
    if (ok) {
      toast(`Imported ${ok.imported}. ${ok.duplicates} duplicate(s) skipped${ok.errors.length ? `, ${ok.errors.length} with errors (first: #${ok.errors[0].index + 1} ${ok.errors[0].error})` : ''}.`, { type: ok.errors.length ? 'warning' : 'success', timeout: 9000 });
      load();
    }
  }
  // file → textarea (the dialog is open while this runs)
  document.addEventListener('change', onImportFile);
  async function onImportFile(e) {
    if (e.target.id !== 'imp-file' || !e.target.files[0]) return;
    $('#imp-json').value = await e.target.files[0].text();
  }

  async function openQuestion(q, mode) {
    const editing = mode === 'edit' && isManager();
    const blank = { category: f.cat || 'dsa', difficulty: 'medium', marks: '', title: '', topic: '', prompt: '', sampleData: '', hint: '', referenceAnswer: '', expectedOutput: '', rubric: '', checkpoints: '' };
    const v = { ...blank, ...(q || {}) };
    const preview = html`<div class="preview-pane"><div class="exam-q-head"><span class="badge neutral">${CAT[v.category]}</span><span class="badge ${DIFF[v.difficulty] || 'neutral'}">${v.difficulty}</span><span class="muted">${trimNum(v.marks || 0)} marks</span></div><h3 class="q-title">${questionTitle(v)}</h3>${v.topic ? html`<p class="q-topic">${v.topic}</p>` : ''}<div class="q-body">${raw(renderRich(v.prompt, { skipTitle: true }))}</div>${v.sampleData ? html`<h4 class="q-sub">Examples</h4><div class="q-body">${raw(renderRich(v.sampleData))}</div>` : ''}${v.hint ? html`<p class="q-sub">Hint</p><p>${v.hint}</p>` : ''}</div>
      ${q ? html`<details class="q-hint"><summary>${raw(icon('lock', { size: 14 }))} Grading material (never shown to candidates)</summary>${v.referenceAnswer ? html`<p class="q-sub">Reference answer</p><pre class="answer-text">${v.referenceAnswer}</pre>` : ''}${v.expectedOutput ? html`<p class="q-sub">Expected output</p><pre class="answer-text">${v.expectedOutput}</pre>` : ''}${v.rubric ? html`<p class="q-sub">Rubric</p><pre class="answer-text prose">${v.rubric}</pre>` : html`<p class="muted">No rubric yet.</p>`}${v.checkpoints ? html`<p class="q-sub">Checkpoints</p><pre class="answer-text prose">${v.checkpoints}</pre>` : ''}</details><p class="cell-secondary">Version ${q.version} · used ${plural(q.assignedCount, 'time')} · updated ${fmtDate(q.updatedAt)} · source: ${q.source || 'admin'}</p>` : ''}`;
    if (!editing) {
      const r = await openDialog({ title: questionTitle(v), icon: 'eye', wide: true, hideCancel: !isManager() || !!q?.deletedAt, cancelLabel: 'Close', confirmLabel: isManager() && !q?.deletedAt ? 'Edit' : 'Close', body: preview });
      if (r && isManager() && !q?.deletedAt) openQuestion(q, 'edit');
      return;
    }
    const field = (name, label, { rows = 0, hint = '', required = false, max = 20000, mono = false } = {}) => rows
      ? html`<div class="field full"><label for="qf-${name}">${label}</label><textarea class="textarea${mono ? ' mono' : ''}" id="qf-${name}" name="${name}" rows="${rows}" maxlength="${max}" ${required ? 'required' : ''}>${v[name] || ''}</textarea>${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`
      : html`<div class="field"><label for="qf-${name}">${label}</label><input class="input" id="qf-${name}" name="${name}" maxlength="${max}" value="${v[name] || ''}">${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
    const saved = await openDialog({
      title: q ? 'Edit question' : 'New question',
      icon: 'pencil',
      wide: true,
      form: true,
      confirmLabel: q ? 'Save changes' : 'Add question',
      body: html`
        ${q && q.assignedCount ? html`<div class="alert info">${raw(icon('info'))}<div>Already in ${plural(q.assignedCount, 'paper')}. Edits apply to future grading of those papers too.</div></div>` : ''}
        <div class="form-grid">
          <div class="field"><label for="qf-category">Type</label><select class="select" id="qf-category" name="category">${raw(Object.entries(CAT).map(([k, l]) => `<option value="${k}" ${k === v.category ? 'selected' : ''}>${l}</option>`).join(''))}</select></div>
          <div class="field"><label for="qf-difficulty">Difficulty</label><select class="select" id="qf-difficulty" name="difficulty">${raw(['easy', 'medium', 'hard'].map((d) => `<option value="${d}" ${d === v.difficulty ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join(''))}</select></div>
          ${field('title', 'Title', { max: 160, hint: 'Short and specific, e.g. "Top error codes in a log".' })}
          <div class="field"><label for="qf-marks">Marks</label><input class="input" id="qf-marks" name="marks" type="number" min="0.5" max="100" step="0.5" value="${v.marks || ''}" placeholder="Default for the type"></div>
          ${field('topic', 'Topic', { max: 160, hint: 'Shown under the title, e.g. "Hash maps · counting".' })}
          ${field('prompt', 'Question', { rows: 10, required: true, hint: 'Markdown: **Example 1** cards with Input: / Output: / Explanation: lines, ``` code blocks, tables, lists.', mono: true })}
          ${field('sampleData', 'Sample data', { rows: 4, mono: true, hint: 'Tables, input files or logs the candidate needs.' })}
          ${field('hint', 'Hint', { rows: 2, max: 1000, hint: 'Optional nudge the candidate can open.' })}
          ${field('referenceAnswer', 'Reference answer', { rows: 6, mono: true })}
          ${field('expectedOutput', 'Expected output', { rows: 3, mono: true })}
          ${field('rubric', 'Rubric', { rows: 5, max: 8000, hint: 'How marks are given and taken away. The grader follows this.' })}
          ${field('checkpoints', 'Checkpoints', { rows: 3, max: 4000, hint: 'One per line: the ideas a good answer must contain.' })}
          ${!q ? html`<label class="check full"><input type="checkbox" name="enrich" value="1"> <span>Draft any missing rubric, expected output and checkpoints with AI</span></label>` : ''}
        </div>`,
      onConfirm: async (vals) => {
        const body = {
          category: vals.category, difficulty: vals.difficulty, title: vals.title, topic: vals.topic, prompt: vals.prompt,
          sampleData: vals.sampleData, hint: vals.hint, referenceAnswer: vals.referenceAnswer, expectedOutput: vals.expectedOutput,
          rubric: vals.rubric, checkpoints: vals.checkpoints,
        };
        if (vals.marks) body.marks = Number(vals.marks);
        if (!q && vals.enrich === '1') body.enrich = true;
        return q ? put(`/api/admin/questions/${q.id}`, body) : post('/api/admin/questions', body, { timeoutMs: 60000 });
      },
    });
    if (saved) {
      toast(q ? 'Question saved.' : saved.enrichError ? `Question added. ${saved.enrichError}` : 'Question added.', { type: saved.enrichError ? 'warning' : 'success' });
      load();
    }
  }

  await load();
  return () => document.removeEventListener('change', onImportFile);
}
