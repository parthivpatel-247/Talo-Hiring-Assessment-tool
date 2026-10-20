/* Grading & exports: grade everyone who has submitted, then download versioned Excel/CSV results. */
import { $, html, raw, setHtml, escapeHtml as esc } from '../../core/dom.js';
import { get, post, download } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { openDialog, toast, setLoading } from '../../core/ui.js';
import { fmtDateTime, fmtBytes, fmtNum, plural } from '../../core/format.js';
import { state, loadLookups, STATUS, applyWidths, emptyState } from '../shared.js';

export async function render(ctx) {
  await loadLookups();
  ctx.setHeader({ title: 'Grading & exports' });
  let grading = false;

  setHtml(ctx.view, html`
    <div class="grid-2">
      <section class="panel" aria-labelledby="gr-h">
        <div class="panel-head"><h2 id="gr-h">Grading</h2><span class="spacer"></span><button class="btn btn-primary btn-sm" id="grade-all">${raw(icon('sparkles', { size: 16 }))} Grade all submitted</button></div>
        <div class="metric-row" id="gr-metrics"></div>
        <div class="panel-body stack" id="gr-body">
          <p class="muted">Each paper is graded question by question against its rubric. Empty answers score zero without an AI call. Tests past their deadline are closed first, so nobody is missed.</p>
        </div>
      </section>
      <section class="panel" aria-labelledby="ex-h">
        <div class="panel-head"><h2 id="ex-h">New export</h2></div>
        <form class="panel-body stack" id="ex-form">
          <div class="form-grid">
            <div class="field"><label for="ex-format">Format</label><select class="select" id="ex-format" name="format"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></select></div>
            <div class="field"><label for="ex-scope">Contents</label><select class="select" id="ex-scope" name="scope"><option value="summary">One row per candidate</option><option value="detailed">With every answer and interview questions</option></select></div>
            <div class="field"><label for="ex-college">College</label><select class="select" id="ex-college" name="collegeId"><option value="">All colleges</option>${raw((state.colleges || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join(''))}</select></div>
            <div class="field"><label for="ex-drive">Drive</label><select class="select" id="ex-drive" name="driveId"><option value="">All drives</option>${raw((state.drives || []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join(''))}</select></div>
            <div class="field"><label for="ex-status">Status</label><select class="select" id="ex-status" name="status"><option value="">Any status</option>${raw(Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join(''))}</select></div>
            <label class="check"><input type="checkbox" name="includeTest" value="1"> <span>Include test records</span></label>
          </div>
          <p class="cell-secondary">Every export gets the next version number and is kept for ${state.settings?.retentionDays ?? 15} days, so you can always go back to what was shared. Files contain personal data: share them only with the hiring panel.</p>
          <div class="row"><button class="btn btn-primary" type="submit" id="ex-btn">${raw(icon('download', { size: 16 }))} Create and download</button></div>
        </form>
      </section>
    </div>
    <section class="panel" aria-labelledby="hist-h">
      <div class="panel-head"><h2 id="hist-h">Export history</h2><span class="hint">Newest first</span></div>
      <div class="table-wrap" id="hist"></div>
    </section>`);

  const drawStatus = async () => {
    const s = await get('/api/admin/grading/status');
    setHtml($('#gr-metrics'), html`
      <div class="metric"><b>${fmtNum(s.awaiting)}</b><span>awaiting grade</span></div>
      <div class="metric"><b>${fmtNum(s.graded)}</b><span>graded</span></div>
      <div class="metric"><b>${fmtNum(s.inProgress)}</b><span>still writing</span></div>`);
    $('#grade-all').disabled = grading || !s.awaiting;
    if (s.autoClosed) toast(`${plural(s.autoClosed, 'test')} past the deadline ${s.autoClosed === 1 ? 'was' : 'were'} closed and queued for grading.`, { type: 'info' });
  };
  const drawHistory = async () => {
    const r = await get('/api/admin/exports');
    if (!r.exports.length) { setHtml($('#hist'), emptyState({ ic: 'file-spreadsheet', title: 'No exports yet', body: 'Create one above. Each export is versioned.' })); return; }
    const collegeName = (id) => state.colleges?.find((c) => c.id === id)?.name;
    const driveName = (id) => state.drives?.find((d) => d.id === id)?.name;
    setHtml($('#hist'), raw(`<table class="table"><thead><tr><th>Version</th><th>File</th><th>Contents</th><th>Filters</th><th class="num">Rows</th><th>Created</th><th class="actions"><span class="sr-only">Download</span></th></tr></thead><tbody>${r.exports.map((x) => {
      const fl = [x.filters.collegeId && (collegeName(x.filters.collegeId) || 'a college'), x.filters.driveId && (driveName(x.filters.driveId) || 'a drive'), x.filters.status && (STATUS[x.filters.status]?.label || x.filters.status), x.filters.includeTest && 'incl. test'].filter(Boolean).join(' · ') || 'Everyone';
      return `<tr><td><span class="badge ink">v${x.version}</span></td><td><div class="cell-primary truncate">${esc(x.filename)}</div><div class="cell-secondary">${x.format.toUpperCase()} · ${fmtBytes(x.bytes)}</div></td><td>${x.scope === 'detailed' ? 'Detailed' : 'Summary'}</td><td class="cell-secondary">${esc(fl)}</td><td class="num">${x.rows}</td><td><div>${fmtDateTime(x.createdAt)}</div><div class="cell-secondary">${esc((x.createdBy || '').split('@')[0])}</div></td><td class="actions"><button class="btn btn-secondary btn-sm" data-dl="${x.id}" data-name="${esc(x.filename)}">${icon('download', { size: 16 })} Download</button></td></tr>`;
    }).join('')}</tbody></table>`));
  };

  ctx.view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dl]');
    if (!b) return;
    setLoading(b, true);
    try { await download(`/api/admin/exports/${b.dataset.dl}/download`, b.dataset.name); } catch (err) { toast(err.message, { type: 'error' }); } finally { setLoading(b, false); }
  });

  $('#ex-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { format: fd.get('format'), scope: fd.get('scope'), collegeId: fd.get('collegeId') || null, driveId: fd.get('driveId') || null, status: fd.get('status') || null, includeTest: fd.get('includeTest') === '1' };
    const btn = $('#ex-btn');
    setLoading(btn, true);
    try {
      const r = await post('/api/admin/exports', body, { timeoutMs: 90000 });
      await download(r.downloadUrl, r.filename);
      toast(`Export v${r.version} downloaded (${plural(r.rows, 'candidate')}).`, { type: 'success' });
      drawHistory();
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setLoading(btn, false);
    }
  });

  $('#grade-all').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const s = await get('/api/admin/grading/status');
    const ok = await openDialog({ title: `Grade ${plural(s.awaiting, 'submitted paper')}?`, icon: 'sparkles', confirmLabel: 'Start grading', body: html`<p>Grading runs in batches while this page is open. You can keep working in other tabs; closing this page pauses it, and the rest can be graded later.</p>` });
    if (!ok) return;
    grading = true;
    setLoading(btn, true);
    const body = $('#gr-body');
    setHtml(body, html`<div class="progress"><span id="gr-bar" data-w="0"></span></div><p class="muted" id="gr-note">Starting…</p><ul class="list result-list" id="gr-fail" hidden></ul>`);
    const total = s.awaiting;
    let done = 0;
    let failed = 0;
    let stalls = 0;
    try {
      for (let i = 0; i < 500; i++) {
        const r = await post('/api/admin/grading/run', {}, { timeoutMs: 180000 });
        const good = r.processed.filter((x) => x.ok).length;
        done += good;
        const bad = r.processed.filter((x) => !x.ok);
        failed += bad.length;
        if (bad.length) {
          const fl = $('#gr-fail');
          fl.hidden = false;
          fl.insertAdjacentHTML('afterbegin', bad.map((x) => `<li><span class="error-text">${icon('circle-x', { size: 14 })}</span> ${esc(x.name || x.id)} <span class="muted">${esc(x.error || '')}</span></li>`).join(''));
        }
        $('#gr-bar').dataset.w = String(total ? Math.min(100, (done / total) * 100) : 100);
        applyWidths(body);
        $('#gr-note').textContent = `${done} graded${failed ? `, ${failed} failed (will retry)` : ''}, ${r.remaining} remaining`;
        if (!r.remaining || !r.processed.length) break;
        stalls = good ? 0 : stalls + 1;
        if (stalls >= 3) { $('#gr-note').textContent += '. The grader keeps failing; try again in a few minutes.'; break; }
      }
      toast(`Grading finished: ${done} graded.`, { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      grading = false;
      setLoading(btn, false);
      drawStatus();
    }
  });

  await Promise.all([drawStatus(), drawHistory()]);
  ctx.onRefresh(() => (grading ? null : drawStatus()));
  const beforeUnload = (e) => { if (grading) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return () => window.removeEventListener('beforeunload', beforeUnload);
}
