/* Candidates: the pipeline as filters, a sortable table, bulk actions and a detail drawer. */
import { $, $$, html, raw, setHtml, debounce, escapeHtml as esc } from '../../core/dom.js';
import { get } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { openMenu } from '../../core/ui.js';
import { fmtRelative, fmtNum, plural } from '../../core/format.js';
import { state, isManager, pipelineStrip, statusBadge, scoreCell, signalsCell, timeTaken, applyWidths, stageStatuses, loadLookups, emptyState, REASON_LABEL } from '../shared.js';
import { ACTIONS, LIMITS, allowed, runBulk } from '../bulk.js';
import { openCandidate, closeCandidate } from '../drawer.js';

const SORTS = {
  recent: { label: 'Recently added', fn: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) },
  name: { label: 'Name A–Z', fn: (a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')) },
  score: { label: 'Score: high to low', fn: (a, b) => pctOf(b) - pctOf(a) },
  score_asc: { label: 'Score: low to high', fn: (a, b) => pctOfAsc(a) - pctOfAsc(b) },
  time: { label: 'Time taken: longest', fn: (a, b) => (b.timeUsedSeconds ?? -1) - (a.timeUsedSeconds ?? -1) },
  time_asc: { label: 'Time taken: shortest', fn: (a, b) => (a.timeUsedSeconds ?? 1e9) - (b.timeUsedSeconds ?? 1e9) },
  flags: { label: 'Most integrity flags', fn: (a, b) => flagCount(b) - flagCount(a) },
  activity: { label: 'Last activity', fn: (a, b) => String(b.lastSeenAt || b.updatedAt).localeCompare(String(a.lastSeenAt || a.updatedAt)) },
};
const pctOf = (c) => (c.score != null && c.maxScore ? c.score / c.maxScore : -1);
const pctOfAsc = (c) => (c.score != null && c.maxScore ? c.score / c.maxScore : 2);
const flagCount = (c) => c.signals.tabSwitches + c.signals.pasteBlocked + c.signals.similar * 3 + (c.signals.blockedLogins || 0);
const COL_SORT = { name: ['name', 'name'], score: ['score', 'score_asc'], time: ['time', 'time_asc'], activity: ['activity', 'activity'] };
const PAGE = 150;

export async function render(ctx) {
  await loadLookups();
  const f = {
    stage: ctx.query.get('stage') || 'all',
    q: ctx.query.get('q') || '',
    college: ctx.query.get('college') || '',
    drive: ctx.query.get('drive') || '',
    sort: SORTS[ctx.query.get('sort')] ? ctx.query.get('sort') : 'recent',
    flagged: ctx.query.get('flagged') === '1',
    tests: ctx.query.get('tests') === '1',
  };
  let all = [];
  let shown = PAGE;
  const selected = new Set();

  ctx.setHeader({
    title: 'Candidates',
    actions: html`<a class="btn btn-secondary btn-sm" href="#/results">${raw(icon('download', { size: 16 }))} Export</a>${isManager() ? html`<a class="btn btn-primary btn-sm" href="#/resumes">${raw(icon('upload', { size: 16 }))} Add resumes</a>` : ''}`,
  });

  setHtml(ctx.view, html`
    <div id="pipe"></div>
    <section class="panel" aria-label="Candidate list">
      <div class="toolbar">
        <div class="input-group">${raw(icon('search', { size: 16 }))}<input class="input" id="search" type="search" placeholder="Search name, email, college" aria-label="Search candidates" autocomplete="off" value="${f.q}"></div>
        <label class="sr-only" for="f-college">College</label>
        <select class="select" id="f-college">${raw(['<option value="">All colleges</option>', ...(state.colleges || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`), '<option value="__none">No college</option>'].join(''))}</select>
        <label class="sr-only" for="f-drive">Drive</label>
        <select class="select" id="f-drive">${raw(['<option value="">All drives</option>', ...(state.drives || []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`), '<option value="__none">No drive</option>'].join(''))}</select>
        <label class="sr-only" for="f-sort">Sort</label>
        <select class="select" id="f-sort">${raw(Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join(''))}</select>
        <button class="chip" type="button" id="f-flagged" aria-pressed="${f.flagged}">${raw(icon('flag', { size: 14 }))} Flagged</button>
        <button class="chip" type="button" id="f-tests" aria-pressed="${f.tests}">Show test records</button>
        <button class="link-btn" type="button" id="f-clear" hidden>Clear filters</button>
        <span class="count-note" id="count-note"></span>
      </div>
      <div class="table-wrap" id="table"></div>
      <div class="table-foot" id="table-foot" hidden></div>
    </section>
    <div id="bulk"></div>`);
  $('#f-college').value = f.college;
  $('#f-drive').value = f.drive;
  $('#f-sort').value = f.sort;

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (f.stage !== 'all') p.set('stage', f.stage);
    if (f.q) p.set('q', f.q);
    if (f.college) p.set('college', f.college);
    if (f.drive) p.set('drive', f.drive);
    if (f.sort !== 'recent') p.set('sort', f.sort);
    if (f.flagged) p.set('flagged', '1');
    if (f.tests) p.set('tests', '1');
    const id = location.hash.match(/^#\/candidates\/([^?]+)/)?.[1];
    history.replaceState(null, '', `#/candidates${id ? `/${id}` : ''}${p.toString() ? `?${p}` : ''}`);
  };

  const base = () => all.filter((c) => {
    if (!f.tests && c.isTest) return false;
    if (f.college === '__none' ? c.collegeId : f.college && c.collegeId !== f.college) return false;
    if (f.drive === '__none' ? c.driveId : f.drive && c.driveId !== f.drive) return false;
    if (f.flagged && !flagCount(c) && !c.parseWarnings) return false;
    if (f.q) {
      const hay = `${c.name || ''} ${c.email || ''} ${c.college || ''} ${c.resumeCollege || ''} ${c.drive || ''} ${c.resumeFilename || ''}`.toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const filtered = () => {
    const st = stageStatuses(f.stage);
    return base().filter((c) => !st || st.includes(c.status)).sort(SORTS[f.sort].fn);
  };

  function drawPipe() {
    const counts = {};
    for (const c of base()) counts[c.status] = (counts[c.status] || 0) + 1;
    const live = all.filter((c) => c.online).length;
    setHtml($('#pipe'), pipelineStrip(counts, { active: f.stage, compact: true, subs: { in_progress: live ? `${live} live now` : '' } }));
  }

  function drawTable() {
    const rows = filtered();
    const page = rows.slice(0, shown);
    const any = f.stage !== 'all' || f.q || f.college || f.drive || f.flagged || f.tests;
    $('#f-clear').hidden = !any;
    $('#count-note').textContent = `${fmtNum(rows.length)} of ${fmtNum(all.filter((c) => f.tests || !c.isTest).length)}`;
    if (!rows.length) {
      setHtml($('#table'), all.length
        ? emptyState({ ic: 'filter', title: 'No candidates match', body: 'Try a different stage, college or search.', action: html`<button class="btn btn-secondary btn-sm" id="clear2">Clear filters</button>` })
        : emptyState({ ic: 'users', title: 'No candidates yet', body: 'Upload the resumes shortlisted for a drive. Talo reads each one and prepares the candidate.', action: isManager() ? html`<a class="btn btn-primary btn-sm" href="#/resumes">${raw(icon('upload', { size: 16 }))} Add resumes</a>` : '' }));
      $('#clear2')?.addEventListener('click', clearFilters);
      $('#table-foot').hidden = true;
      return;
    }
    const allOnPage = page.every((c) => selected.has(c.id));
    const someOnPage = page.some((c) => selected.has(c.id));
    const th = (key, label, cls = '') => {
      const pair = COL_SORT[key];
      if (!pair) return `<th class="${cls}">${label}</th>`;
      const on = pair.includes(f.sort);
      const dir = f.sort === pair[1] && pair[0] !== pair[1] ? 'ascending' : 'descending';
      return `<th class="sortable ${cls}" data-sort="${key}" ${on ? `aria-sort="${dir}"` : ''} tabindex="0">${label}<span class="sort">${icon(on && dir === 'ascending' ? 'chevron-up' : 'chevron-down', { size: 14 })}</span></th>`;
    };
    setHtml($('#table'), raw(`
      <table class="table">
        <thead><tr>
          <th class="col-check"><input type="checkbox" class="checkbox" id="sel-all" aria-label="Select all shown" ${allOnPage ? 'checked' : ''}></th>
          ${th('name', 'Candidate')}<th>College</th><th>Status</th>${th('score', 'Score')}${th('time', 'Time taken')}<th>Signals</th>${th('activity', 'Last activity')}<th class="actions"><span class="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>${page.map(rowHtml).join('')}</tbody>
      </table>`));
    const sa = $('#sel-all');
    if (sa) sa.indeterminate = someOnPage && !allOnPage;
    applyWidths($('#table'));
    const foot = $('#table-foot');
    foot.hidden = rows.length <= shown;
    if (rows.length > shown) setHtml(foot, html`<span>Showing ${fmtNum(shown)} of ${fmtNum(rows.length)}</span><button class="btn btn-secondary btn-sm" id="more">Show ${Math.min(PAGE, rows.length - shown)} more</button>`);
    $('#more')?.addEventListener('click', () => { shown += PAGE; drawTable(); });
  }

  function rowHtml(c) {
    const warn = c.parseError || c.parseWarnings;
    const reason = c.submitReason && !['candidate', 'time_up', 'deadline'].includes(c.submitReason) ? ` title="${esc(REASON_LABEL[c.submitReason] || c.submitReason)}"` : '';
    return `<tr class="row-link${selected.has(c.id) ? ' selected' : ''}${c.isTest ? ' is-test' : ''}" data-id="${c.id}" tabindex="0">
      <td class="col-check"><input type="checkbox" class="checkbox" data-sel="${c.id}" aria-label="Select ${esc(c.name || c.email || 'candidate')}" ${selected.has(c.id) ? 'checked' : ''}></td>
      <td><div class="cand-cell"><div class="who"><span class="cell-primary truncate">${c.online ? '<span class="live-dot" aria-label="Online now"></span>' : ''}${esc(c.name || 'Name missing')}${warn ? ` <span class="flag-ic" data-tip="${esc(c.parseError || c.parseWarnings).slice(0, 120)}">${icon('triangle-alert', { size: 14 })}</span>` : ''}${c.isTest ? ' <span class="badge outline">Test</span>' : ''}</span><span class="cell-secondary truncate">${esc(c.email || 'Email missing')}</span></div></div></td>
      <td><span class="truncate">${esc(c.college || c.resumeCollege || '—')}</span>${c.drive ? `<div class="cell-secondary truncate">${esc(c.drive)}</div>` : ''}</td>
      <td><span${reason}>${statusBadge(c.status)}</span>${c.accessRevoked ? ' <span class="badge danger">No access</span>' : ''}${c.attemptNo > 1 ? ` <span class="badge outline" title="Attempt ${c.attemptNo}">#${c.attemptNo}</span>` : ''}</td>
      <td>${scoreCell(c)}</td>
      <td>${timeTaken(c)}${c.status === 'in_progress' && c.remainingSeconds != null ? `<div class="cell-secondary">${Math.ceil(c.remainingSeconds / 60)} min left</div>` : ''}</td>
      <td>${signalsCell(c.signals)}</td>
      <td class="cell-secondary nowrap">${c.lastSeenAt ? fmtRelative(c.lastSeenAt) : '—'}</td>
      <td class="actions"><button class="btn btn-ghost btn-icon btn-sm" data-row-menu="${c.id}" aria-label="Actions for ${esc(c.name || c.email || 'candidate')}">${icon('ellipsis', { size: 16 })}</button></td>
    </tr>`;
  }

  function drawBulk() {
    const n = selected.size;
    const host = $('#bulk');
    if (!n) { setHtml(host, ''); return; }
    const cands = all.filter((c) => selected.has(c.id));
    const quick = ['grade', 'shortlist', 'reject'];
    setHtml(host, raw(`<div class="bulkbar" role="region" aria-label="Bulk actions">
      <span class="sel">${plural(n, 'selected', 'selected')}</span>
      <button class="btn btn-light" data-bulk="grade" ${n > LIMITS.grade ? `title="Grade up to ${LIMITS.grade} at a time"` : ''}>${icon('sparkles', { size: 16 })} Grade now</button>
      <button class="btn btn-ghost" data-bulk="shortlist">${icon('user-round-check', { size: 16 })} Shortlist</button>
      <button class="btn btn-ghost" data-bulk="reject">${icon('user-round-x', { size: 16 })} Reject</button>
      ${isManager() ? `<button class="btn btn-ghost" data-bulk="retake">${icon('rotate-ccw', { size: 16 })} Retake</button><button class="btn btn-ghost" data-bulk="delete">${icon('trash-2', { size: 16 })} Delete</button><button class="btn btn-ghost" id="bulk-more" aria-haspopup="menu">${icon('ellipsis', { size: 16 })} More</button>` : ''}
      <button class="btn btn-ghost btn-icon" id="bulk-clear" aria-label="Clear selection">${icon('x', { size: 16 })}</button>
    </div>`));
    $$('[data-bulk]', host).forEach((b) => b.addEventListener('click', () => act(b.dataset.bulk, cands)));
    $('#bulk-clear').addEventListener('click', () => { selected.clear(); drawTable(); drawBulk(); });
    $('#bulk-more')?.addEventListener('click', (e) => {
      const more = ['send_invites', 'generate_codes', 'resume', 'move_drive', 'set_college', 'force_submit', 'revoke', 'restore_access', 'mark_test', 'unmark_test'];
      openMenu(e.currentTarget, more.filter((a) => !quick.includes(a) && allowed(a)).map((a) => ({ label: ACTIONS[a].label, icon: ACTIONS[a].icon, onClick: () => act(a, cands) })));
    });
  }

  async function act(action, cands) {
    const changed = await runBulk(action, cands);
    if (changed) {
      if (action === 'delete') cands.forEach((c) => selected.delete(c.id));
      await load();
    }
  }

  function clearFilters() {
    Object.assign(f, { stage: 'all', q: '', college: '', drive: '', flagged: false, tests: false });
    $('#search').value = '';
    $('#f-college').value = '';
    $('#f-drive').value = '';
    $('#f-flagged').setAttribute('aria-pressed', 'false');
    $('#f-tests').setAttribute('aria-pressed', 'false');
    redraw();
  }

  function redraw() {
    shown = PAGE;
    syncUrl();
    drawPipe();
    drawTable();
    drawBulk();
  }

  async function load() {
    const r = await get('/api/admin/candidates');
    all = r.candidates;
    const ids = new Set(all.map((c) => c.id));
    for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
    drawPipe();
    drawTable();
    drawBulk();
  }

  // events
  ctx.view.addEventListener('click', (e) => {
    const stage = e.target.closest('[data-stage]');
    if (stage) { f.stage = stage.dataset.stage; return redraw(); }
    const sortTh = e.target.closest('th[data-sort]');
    if (sortTh) return toggleSort(sortTh.dataset.sort);
    const menuBtn = e.target.closest('[data-row-menu]');
    if (menuBtn) {
      e.stopPropagation();
      const c = all.find((x) => x.id === menuBtn.dataset.rowMenu);
      if (!c) return;
      const items = [{ label: 'Open details', icon: 'external-link', onClick: () => open(c.id) }];
      for (const a of ['grade', 'shortlist', 'reject', 'resume', 'retake', 'send_invites', 'generate_codes', 'force_submit', 'revoke', 'restore_access', 'delete']) {
        if (!allowed(a)) continue;
        if (a === 'restore_access' && !c.accessRevoked) continue;
        if (a === 'revoke' && c.accessRevoked) continue;
        if (a === 'force_submit' && c.status !== 'in_progress') continue;
        if (a === 'resume' && !['in_progress', 'submitted', 'graded', 'grading', 'shortlisted', 'rejected'].includes(c.status)) continue;
        if (a === 'delete') items.push({ divider: true });
        items.push({ label: ACTIONS[a].label, icon: ACTIONS[a].icon, danger: a === 'delete' || a === 'revoke', onClick: () => act(a, [c]) });
      }
      return openMenu(menuBtn, items);
    }
    const cb = e.target.closest('[data-sel]');
    if (cb) {
      e.stopPropagation();
      cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel);
      cb.closest('tr').classList.toggle('selected', cb.checked);
      const page = filtered().slice(0, shown);
      const sa = $('#sel-all');
      if (sa) { sa.checked = page.every((c) => selected.has(c.id)); sa.indeterminate = !sa.checked && page.some((c) => selected.has(c.id)); }
      return drawBulk();
    }
    if (e.target.id === 'sel-all') {
      const page = filtered().slice(0, shown);
      page.forEach((c) => (e.target.checked ? selected.add(c.id) : selected.delete(c.id)));
      drawTable();
      return drawBulk();
    }
    const row = e.target.closest('tr[data-id]');
    if (row && !e.target.closest('a, button, input')) open(row.dataset.id);
  });
  ctx.view.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const th = e.target.closest('th[data-sort]');
    if (th) { e.preventDefault(); return toggleSort(th.dataset.sort); }
    const row = e.target.closest('tr[data-id]');
    if (row && e.target === row) { e.preventDefault(); open(row.dataset.id); }
  });
  const toggleSort = (key) => {
    const [a, b] = COL_SORT[key];
    f.sort = f.sort === a && a !== b ? b : a;
    $('#f-sort').value = f.sort;
    redraw();
  };
  $('#search').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); redraw(); }, 150));
  $('#f-college').addEventListener('change', (e) => { f.college = e.target.value; redraw(); });
  $('#f-drive').addEventListener('change', (e) => { f.drive = e.target.value; redraw(); });
  $('#f-sort').addEventListener('change', (e) => { f.sort = e.target.value; redraw(); });
  $('#f-flagged').addEventListener('click', (e) => { f.flagged = !f.flagged; e.currentTarget.setAttribute('aria-pressed', String(f.flagged)); redraw(); });
  $('#f-tests').addEventListener('click', (e) => { f.tests = !f.tests; e.currentTarget.setAttribute('aria-pressed', String(f.tests)); redraw(); });
  $('#f-clear').addEventListener('click', clearFilters);

  const open = (id) => {
    const qs = location.hash.split('?')[1];
    history.replaceState(null, '', `#/candidates/${id}${qs ? `?${qs}` : ''}`);
    openCandidate(id, { onChange: load, onClose: () => {
      const q2 = location.hash.split('?')[1];
      history.replaceState(null, '', `#/candidates${q2 ? `?${q2}` : ''}`);
    } });
  };

  await load();
  ctx.onRefresh(load);
  if (ctx.rest[0]) open(ctx.rest[0]);

  return () => closeCandidate();
}
