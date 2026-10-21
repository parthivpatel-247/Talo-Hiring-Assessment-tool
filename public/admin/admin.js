const $ = (id) => document.getElementById(id);

/* ---- Icons (inline, stroke-based) ---- */
const IC = {
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  hourglass: '<path d="M5 22h14M5 2h14M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  dots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
};
const svg = (name, w = 16) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${IC[name] || ''}</svg>`;

/* ---- Theme ---- */
(function initTheme() {
  const btn = $('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('talo-theme', next); } catch (e) {}
  });
})();

async function api(path, opts = {}, tries = 0) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'include',
    cache: 'no-store', // never serve a cached candidate/question list after a change
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    // A short per-request ceiling (429, kind 'ceiling'): wait a few seconds and send
    // the same request again, up to 3 times. A sign-in pause is shown as is, never
    // retried (that would resend a password).
    if (res.status === 429 && b.kind === 'ceiling' && tries < 3) {
      await new Promise((r) => setTimeout(r, (Number(b.retryAfter) || 5) * 1000));
      return api(path, opts, tries + 1);
    }
    // On a 500 the detail carries the real cause — surface it so failures are diagnosable.
    const msg = (res.status >= 500 && b.detail) ? `${b.error || 'Server error'}: ${b.detail}` : (b.error || `Request failed (${res.status})`);
    throw new Error(msg);
  }
  return res.json();
}
// Escapes text for HTML content AND attribute values (quotes included).
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// Candidate-accurate renderer — IDENTICAL logic to the exam portal's renderRich
// (public/app.js), so the admin "shown to candidate" preview matches exactly what
// a student sees. Kept in sync by copy; both must change together.
function renderInline(s) {
  let h = escapeHtml(s);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return h;
}
function renderRich(md) {
  if (!md) return '';
  const lines = md.split('\n');
  let html = '', i = 0, inExample = false;
  const closeEx = () => { if (inExample) { html += '</div>'; inExample = false; } };
  const DIFF = { easy: 'diff-easy', medium: 'diff-medium', hard: 'diff-hard' };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (/^```/.test(t)) {
      let code = ''; i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code += lines[i] + '\n'; i++; }
      i++; html += `<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`; continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      closeEx();
      const head = line.split('|').map((c) => c.trim()).filter((c, idx, a) => !(idx === 0 && c === '') && !(idx === a.length - 1 && c === ''));
      i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i].split('|').map((c) => c.trim());
        if (cells[0] === '') cells.shift(); if (cells[cells.length - 1] === '') cells.pop();
        rows.push(cells); i++;
      }
      html += '<table class="mini"><thead><tr>' + head.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }
    if (/^##\s+/.test(t)) { closeEx(); html += `<div class="q-title">${renderInline(t.replace(/^##\s+/, ''))}</div>`; i++; continue; }
    if (/^###\s+/.test(t)) { closeEx(); html += `<div class="q-subhead">${renderInline(t.replace(/^###\s+/, ''))}</div>`; i++; continue; }
    if (/^>\s+/.test(t)) {
      closeEx();
      let topic = t.replace(/^>\s+/, ''); let pill = '';
      const m = topic.match(/\s·\s*(Easy|Medium|Hard)\s*$/i);
      if (m) { topic = topic.slice(0, m.index).trim(); pill = `<span class="badge ${DIFF[m[1].toLowerCase()]}">${escapeHtml(m[1])}</span>`; }
      html += `<div class="q-topicrow"><span class="q-topic">${escapeHtml(topic)}</span>${pill}</div>`;
      i++; continue;
    }
    const exm = t.match(/^\*\*((?:Example|Buggy pseudocode|Buggy program|Pseudocode|Sample)[^*]*)\*\*$/i);
    if (exm) { closeEx(); html += `<div class="example"><div class="ex-head">${escapeHtml(exm[1])}</div>`; inExample = true; i++; continue; }
    const lab = t.match(/^(Input|Output|Expected Output|Actual Output|Explanation|Note|Constraints)\s*:\s*(.*)$/i);
    if (lab) {
      const label = lab[1], val = lab[2];
      const mono = /^(input|output|expected output|actual output)$/i.test(label);
      const valHtml = mono ? `<code class="ex-val">${escapeHtml(val)}</code>` : `<span class="ex-exp">${renderInline(val)}</span>`;
      html += `<div class="ex-row"><span class="ex-label">${escapeHtml(label)}</span>${valHtml}</div>`;
      i++; continue;
    }
    if (/^[-*]\s+/.test(t)) {
      closeEx(); html += '<ul>';
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { html += `<li>${renderInline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`; i++; }
      html += '</ul>'; continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      closeEx(); html += '<ol>';
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) { html += `<li>${renderInline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`; i++; }
      html += '</ol>'; continue;
    }
    if (!t) { i++; continue; }
    closeEx();
    html += `<p>${renderInline(t)}</p>`; i++;
  }
  closeEx();
  return html;
}
function setNotice(id, msg, kind = '') { const el = $(id); if (!el) return; el.textContent = msg; el.className = 'notice' + (kind ? ' ' + kind : ''); el.classList.remove('hidden'); }

/* ---- Nav / views ---- */
const VIEWS = {
  overview: { title: 'Overview', sub: 'Campus drive · Batch 2026' },
  questions: { title: 'Question bank', sub: 'SQL & Python problems' },
  resumes: { title: 'Resumes', sub: 'Upload & parse candidate resumes' },
  access: { title: 'Access', sub: 'Panel members & roles' },
  activity: { title: 'Activity log', sub: 'Recent admin actions' },
};
document.querySelectorAll('.nav-item').forEach((it) => {
  const icon = it.dataset.icon;
  if (icon) it.insertAdjacentHTML('afterbegin', svg(icon, 17));
  it.addEventListener('click', () => showView(it.dataset.view));
});
function currentView() {
  const v = document.querySelector('.view:not(.hidden)');
  return v ? v.id.replace(/^view-/, '') : 'overview';
}
function showView(name) {
  const switching = currentView() !== name; // reload data only on an actual view change
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('on', n.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${name}`));
  if (name === 'access' && IS_MANAGER) loadMembers();
  if (switching && name === 'activity') { refreshFlags().catch(() => {}); refreshAudit().catch(() => {}); }
  if (switching && name === 'questions') refreshQuestions().catch(() => {});
  if (switching && name === 'overview') refreshCandidates().catch(() => {});
  const meta = VIEWS[name] || VIEWS.overview;
  $('page-title').textContent = meta.title;
  $('page-sub').textContent = meta.sub;
  $('shell').classList.remove('nav-open');
  window.scrollTo({ top: 0 });
}
$('nav-toggle').addEventListener('click', () => $('shell').classList.toggle('nav-open'));
$('scrim').addEventListener('click', () => $('shell').classList.remove('nav-open'));

/* ---- Role + colleges (loaded from /config) ---- */
let ROLE = 'manager';
let IS_MANAGER = true;
let COLLEGES = [];
// Question sections for the "Add a question" dropdown — loaded from /config so new
// sections (DSA, Scenario, or any future type) appear automatically.
let CATEGORIES = [
  { value: 'sql', label: 'SQL', marks: 3 },
  { value: 'python', label: 'Python', marks: 4 },
  { value: 'dsa', label: 'DSA', marks: 5 },
  { value: 'scenario', label: 'Scenario', marks: 5 },
];
// Candidate list filter/sort state.
let allCandidates = [];
let filterCollege = 'all';
let filterStatus = 'all';
let sortBy = 'total';
let ASSESSMENT_MINUTES = 60;
// Writers site (TEAM = "docs"): two-part writing test. Set from /config.
let IS_DOCS = false;
let DOCS = null; // { part1: {questions, minutes, marks}, part2: {...}, wordLimit, pool: {part1, part2}, limits }
const PART_LABELS = { part1: 'Part 1', part2: 'Part 2' };
function categoryLabel(cat) { return IS_DOCS ? (PART_LABELS[cat] || cat) : String(cat || '').toUpperCase(); }

// True if the manager has unsaved edits in the college editor (renamed/added/
// removed a row but not yet clicked Save). A background refresh must not wipe them.
function isCollegeEditorDirty() {
  const box = $('college-editor'); if (!box) return false;
  const rows = Array.from(box.querySelectorAll('.college-row'));
  if (rows.length !== COLLEGES.length) return true;
  return rows.some((r) => {
    const inp = r.querySelector('.college-input');
    return inp && inp.value.trim() !== (inp.dataset.orig || '').trim();
  });
}

// preserveEdits: on a background/auto refresh, keep whatever the user is mid-editing
// (college editor, focused duration field) instead of clobbering it with server state.
async function loadConfig({ preserveEdits = false } = {}) {
  try {
    const cfg = await api('/api/admin/config');
    ROLE = cfg.role || 'manager';
    COLLEGES = Array.isArray(cfg.colleges) ? cfg.colleges : [];
    if (Array.isArray(cfg.questionCategories) && cfg.questionCategories.length) CATEGORIES = cfg.questionCategories;
    if (cfg.assessmentMinutes) ASSESSMENT_MINUTES = cfg.assessmentMinutes;
    IS_DOCS = cfg.team === 'docs';
    DOCS = IS_DOCS ? cfg.docs : null;
    SIGNIN_PAUSES = Number(cfg.signinPauses) || 0;
  } catch { ROLE = 'manager'; COLLEGES = []; }
  IS_MANAGER = ROLE === 'manager';
  document.body.classList.toggle('member', !IS_MANAGER);
  document.body.classList.toggle('team-docs', IS_DOCS);
  renderPauses();
  if (IS_DOCS && $('bulk-json')) $('bulk-json').placeholder = '{"questions":[{"part":1,"prompt":"...","marks":5,"wordLimit":150},{"part":2,"prompt":"..."}]}';
  const driveName = IS_DOCS ? 'Writers drive' : 'Campus drive';
  $('page-sub').textContent = IS_MANAGER ? `${driveName} · Batch 2026 · Manager` : `${driveName} · Batch 2026 · Panel member`;
  if (IS_DOCS) {
    document.title = 'Talo Admin — Writers hiring';
    VIEWS.overview.sub = 'Writers drive · Batch 2026';
    VIEWS.questions.sub = 'Writing questions for Part 1 and Part 2';
    const qp = $('q-prompt'); if (qp) qp.placeholder = 'e.g. Rewrite this error message so a first-time user understands what went wrong and what to do next: …';
    renderDocsLength(preserveEdits);
    renderDocsOpen();
    const addBtn = $('q-add-btn'); if (addBtn && !addBtn.disabled) addBtn.textContent = 'Add question';
    const note = $('analysis-note');
    if (note && !analyzing && note.dataset.docsDefault !== '1') { note.dataset.docsDefault = '1'; note.textContent = 'AI reads each submitted answer as a whole and gives marks with a short reason. Export the results to CSV to review them.'; }
    const th = document.querySelector('#question-table thead th:nth-child(4)'); if (th) th.textContent = 'Word limit';
    const pb = $('process-btn'); if (pb && !pb.disabled) pb.textContent = 'Parse resumes';
  }
  const who = document.querySelector('.who'); if (who) who.textContent = IS_MANAGER ? 'Manager' : 'Panel member';
  populateCollegeControls();
  if (!(preserveEdits && isCollegeEditorDirty())) renderCollegeEditor();
  populateCategorySelect();
  const durInput = $('duration-input');
  if (durInput && ASSESSMENT_MINUTES) {
    const userBusy = preserveEdits && (durInput === document.activeElement || Number(durInput.value) !== ASSESSMENT_MINUTES);
    if (!userBusy) durInput.value = ASSESSMENT_MINUTES;
  }
}

// ---- Flags (integrity alerts) in the manager portal ----
async function refreshFlags() {
  const list = $('flags-list'); if (!list) return;
  let data;
  try { data = await api('/api/admin/flags'); }
  catch { list.innerHTML = '<p class="muted" style="margin:0">Could not load flags.</p>'; return; }
  const flags = data.flags || [];
  if (!flags.length) { list.innerHTML = '<p class="muted" style="margin:0">No flags — nothing suspicious so far.</p>'; return; }
  list.innerHTML = flags.map((f) => {
    const sev = f.severity === 'high' ? 'danger' : 'warn';
    const items = f.items.map((it) => `<li><span class="pill ${it.severity === 'high' ? 'danger' : 'warn'}">${escapeHtml(it.label)}</span> ${escapeHtml(it.detail)}</li>`).join('');
    const who = escapeHtml(f.name || '(no name)') + ' · ' + escapeHtml(f.email) + (f.college ? ' · ' + escapeHtml(f.college) : '');
    return `<div class="flag-card ${sev}" style="border:1px solid var(--line);border-left:4px solid var(--${f.severity === 'high' ? 'danger' : 'warn'});border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="font-weight:600;margin-bottom:4px">${who}</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">${items}</ul>
    </div>`;
  }).join('');
}

// Fill the "Add a question" Type dropdown from CATEGORIES (loaded from /config),
// so DSA, Scenario and any future section show up without a code change.
function populateCategorySelect() {
  const sel = $('q-category'); if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = CATEGORIES.map((c) => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`).join('');
  if (CATEGORIES.some((c) => c.value === prev)) sel.value = prev;
  updateMarksPlaceholder();
}
function updateMarksPlaceholder() {
  const sel = $('q-category'), marks = $('q-marks'); if (!sel || !marks) return;
  const c = CATEGORIES.find((x) => x.value === sel.value);
  marks.placeholder = c ? `auto (${c.label} ${c.marks})` : 'auto';
}

/* ---- College editor (manager, on Resumes tab) ---- */
function collegeRowHtml(name) {
  return `<div class="college-row"><input class="college-input" data-orig="${escapeHtml(name)}" value="${escapeHtml(name)}" maxlength="80" placeholder="College name" /><button class="icon-btn college-del" type="button" aria-label="Remove">${svg('x', 15)}</button></div>`;
}
function wireCollegeDelButtons() {
  const box = $('college-editor'); if (!box) return;
  box.querySelectorAll('.college-del').forEach((b) => {
    b.onclick = () => {
      const row = b.closest('.college-row');
      const name = (row.querySelector('.college-input').dataset.orig || '').trim();
      // Existing college: warn before removing so no one drops one by accident —
      // and tell them how many candidates it will unassign.
      if (name) {
        const inIt = (allCandidates || []).filter((c) => c.college === name).length;
        const msg = inIt
          ? `Remove the college "${name}"?\n\n${inIt} candidate(s) are in it — they will become Unassigned when you click "Save colleges". This cannot be undone.`
          : `Remove the college "${name}"? It takes effect when you click "Save colleges".`;
        if (!confirm(msg)) return;
      }
      row.remove();
    };
  });
}
function renderCollegeEditor() {
  const box = $('college-editor'); if (!box) return;
  box.innerHTML = COLLEGES.map(collegeRowHtml).join('');
  wireCollegeDelButtons();
}
if ($('college-add-btn')) $('college-add-btn').addEventListener('click', () => {
  $('college-editor').insertAdjacentHTML('beforeend', collegeRowHtml(''));
  wireCollegeDelButtons();
});
if ($('college-save-btn')) $('college-save-btn').addEventListener('click', async () => {
  const rows = Array.from($('college-editor').querySelectorAll('.college-row'));
  const colleges = [], renames = [], seen = new Set();
  for (const row of rows) {
    const inp = row.querySelector('.college-input');
    const val = inp.value.trim();
    const orig = inp.dataset.orig || '';
    if (!val) continue;
    if (seen.has(val.toLowerCase())) { setNotice('college-status', `Duplicate name: "${val}". College names must be unique.`, 'warn'); return; }
    seen.add(val.toLowerCase());
    colleges.push(val);
    if (orig && orig !== val) renames.push({ from: orig, to: val });
  }
  // Zero colleges is allowed — colleges are optional. Confirm clearing them all,
  // since every candidate will be moved to Unassigned.
  if (!colleges.length && !confirm('Remove ALL colleges? Every candidate will become Unassigned, and new uploads won\'t have a college. Continue?')) return;
  try {
    const r = await api('/api/admin/colleges', { method: 'POST', body: JSON.stringify({ colleges, renames }) });
    COLLEGES = r.colleges || colleges;
    // If the active filter pointed at a college that was just removed, reset it.
    if (filterCollege !== 'all' && filterCollege !== '__none' && !COLLEGES.includes(filterCollege)) filterCollege = 'all';
    populateCollegeControls();
    renderCollegeEditor();
    await refreshCandidates();
    const unassigned = r.unassigned || 0;
    setNotice('college-status',
      `Saved ${COLLEGES.length} college(s).`
      + (renames.length ? ` Renamed ${renames.length} — existing candidates updated.` : '')
      + (unassigned ? ` ${unassigned} candidate(s) moved to Unassigned.` : ''),
      'ok');
  } catch (e) { setNotice('college-status', `Error: ${e.message}`, 'warn'); }
});

// ---- Assessment length (manager only) ----
if ($('duration-save-btn')) $('duration-save-btn').addEventListener('click', async () => {
  const mins = Math.round(Number($('duration-input').value));
  if (!Number.isFinite(mins) || mins < 5 || mins > 240) {
    setNotice('duration-status', 'Enter a whole number of minutes between 5 and 240.', 'warn');
    return;
  }
  try {
    const r = await api('/api/admin/assessment-duration', { method: 'POST', body: JSON.stringify({ minutes: mins }) });
    ASSESSMENT_MINUTES = r.assessmentMinutes || mins;
    $('duration-input').value = ASSESSMENT_MINUTES;
    setNotice('duration-status', `Saved — the assessment is now ${ASSESSMENT_MINUTES} minutes. Candidates who start from now get this length.`, 'ok');
  } catch (e) { setNotice('duration-status', `Error: ${e.message}`, 'warn'); }
});

// ---- Writers site: questions + minutes for each part (manager only) ----
// Sign-in pauses (both sites): shown on Overview only while one is active.
let SIGNIN_PAUSES = 0;
function renderPauses() {
  const card = $('pauses-card'); if (!card) return;
  card.classList.toggle('hidden', !SIGNIN_PAUSES);
  $('pauses-pill').textContent = String(SIGNIN_PAUSES);
  const btn = $('pauses-lift-btn');
  btn.disabled = !IS_MANAGER;
  btn.title = IS_MANAGER ? '' : 'Only a manager can lift sign-in pauses';
}
if ($('pauses-lift-btn')) $('pauses-lift-btn').addEventListener('click', async () => {
  if (!confirm('Lift every sign-in pause now? Anyone paused can sign in again straight away, and all wrong-sign-in counts start from zero.')) return;
  const btn = $('pauses-lift-btn'); btn.disabled = true;
  try { await api('/api/admin/signin-pauses/clear', { method: 'POST' }); SIGNIN_PAUSES = 0; }
  catch (e) { alert('Could not lift the pauses: ' + e.message); }
  finally { renderPauses(); }
});

function renderDocsOpen() {
  if (!DOCS) return;
  const open = !!DOCS.startOpen;
  const pill = $('docs-open-pill'), btn = $('docs-open-btn');
  if (pill) { pill.textContent = open ? 'Open' : 'Closed'; pill.className = 'pill ' + (open ? 'ok' : 'warn'); }
  if (btn) {
    btn.textContent = open ? 'Close the test' : 'Open the test';
    btn.className = open ? 'secondary' : 'primary';
    btn.disabled = !IS_MANAGER;
    btn.title = IS_MANAGER ? '' : 'Only a manager can open or close the test';
  }
}
if ($('docs-open-btn')) $('docs-open-btn').addEventListener('click', async () => {
  if (!DOCS) return;
  const next = !DOCS.startOpen;
  if (!confirm(next ? 'Open the test? Candidates who have signed in can then start Part 1.' : 'Close the test? Candidates already in the test carry on; nobody new can start Part 1.')) return;
  const btn = $('docs-open-btn'); btn.disabled = true;
  try {
    const r = await api('/api/admin/start-open', { method: 'POST', body: JSON.stringify({ open: next }) });
    DOCS.startOpen = r.startOpen;
  } catch (e) { alert('Could not change the test status: ' + e.message); }
  finally { renderDocsOpen(); }
});

function renderDocsLength(preserveEdits) {
  if (!DOCS) return;
  const fields = [['docs-p1-q', DOCS.part1.questions], ['docs-p1-min', DOCS.part1.minutes], ['docs-p2-q', DOCS.part2.questions], ['docs-p2-min', DOCS.part2.minutes]];
  const busy = preserveEdits && fields.some(([id, v]) => { const el = $(id); return el && (el === document.activeElement || Number(el.value) !== v) && el.value !== ''; });
  if (!busy) fields.forEach(([id, v]) => { const el = $(id); if (el) el.value = v; });
  for (const p of ['part1', 'part2']) {
    const cell = $(p === 'part1' ? 'docs-p1-pool' : 'docs-p2-pool'); if (!cell) continue;
    const have = (DOCS.pool && DOCS.pool[p]) || 0, need = DOCS[p].questions;
    cell.innerHTML = have >= need
      ? `<span class="pool-ok">${have} active</span>`
      : `<span class="pool-low">${have} active · needs at least ${need}</span>`;
  }
  const tot = $('docs-length-total');
  if (tot) tot.textContent = `Total time per candidate: ${DOCS.part1.minutes + DOCS.part2.minutes} min`;
  ['docs-p1-q', 'docs-p1-min', 'docs-p2-q', 'docs-p2-min'].forEach((id) => { const el = $(id); if (el) el.disabled = !IS_MANAGER; });
  const btn = $('docs-length-save-btn'); if (btn) btn.disabled = !IS_MANAGER;
}
if ($('docs-length-save-btn')) $('docs-length-save-btn').addEventListener('click', async () => {
  const v = (id) => Math.round(Number($(id).value));
  const body = { part1: { questions: v('docs-p1-q'), minutes: v('docs-p1-min') }, part2: { questions: v('docs-p2-q'), minutes: v('docs-p2-min') } };
  try {
    const r = await api('/api/admin/assessment-length', { method: 'POST', body: JSON.stringify(body) });
    DOCS = r.docs; renderDocsLength(false);
    setNotice('docs-length-status', `Saved. Part 1: ${DOCS.part1.questions} questions in ${DOCS.part1.minutes} min. Part 2: ${DOCS.part2.questions} questions in ${DOCS.part2.minutes} min. Candidates who start from now get this.`, 'ok');
  } catch (e) { setNotice('docs-length-status', e.message, 'warn'); }
});

/* ---- Members / access (manager) ---- */
async function loadMembers() {
  const tb = document.querySelector('#member-table tbody');
  try {
    const { members } = await api('/api/admin/members');
    renderMembers(members || []);
  } catch (e) { if (tb) tb.innerHTML = `<tr><td colspan="6" class="empty">Could not load members: ${escapeHtml(e.message)}</td></tr>`; }
}
function renderMembers(members) {
  const tb = document.querySelector('#member-table tbody');
  if (!tb) return;
  if (!members.length) { tb.innerHTML = '<tr><td colspan="6" class="empty">No named members yet — add one above. (The manager bootstrap password still works.)</td></tr>'; return; }
  tb.innerHTML = members.map((m) => `<tr>
      <td><strong>${escapeHtml(m.username)}</strong></td>
      <td style="font-size:12.5px;color:var(--faint)">${escapeHtml(m.email || '—')}</td>
      <td><span class="pill ${m.role === 'manager' ? 'ok' : 'info'}">${escapeHtml(m.role)}</span></td>
      <td>${m.active ? '<span class="pill ok">active</span>' : '<span class="pill muted">disabled</span>'}</td>
      <td class="tnum" style="font-size:12px;color:var(--faint)">${escapeHtml((m.created_at || '').replace('T', ' ').slice(0, 10))}</td>
      <td><div class="rowmenu">
        <button class="secondary sm" data-mrole="${m.id}" data-cur="${escapeHtml(m.role)}">${m.role === 'manager' ? 'Make member' : 'Make manager'}</button>
        <button class="secondary sm" data-mtoggle="${m.id}" data-active="${m.active ? 1 : 0}">${m.active ? 'Disable' : 'Enable'}</button>
        <button class="secondary sm" data-mpass="${m.id}">Reset password</button>
        <button class="danger sm" data-mdel="${m.id}" data-user="${escapeHtml(m.username)}">Delete</button>
      </div></td>
    </tr>`).join('');
  tb.querySelectorAll('[data-mrole]').forEach((b) => b.addEventListener('click', () => memberUpdate(b.dataset.mrole, { role: b.dataset.cur === 'manager' ? 'member' : 'manager' })));
  tb.querySelectorAll('[data-mtoggle]').forEach((b) => b.addEventListener('click', () => memberUpdate(b.dataset.mtoggle, { active: b.dataset.active !== '1' })));
  tb.querySelectorAll('[data-mpass]').forEach((b) => b.addEventListener('click', () => {
    const pw = prompt('New password for this member (at least 6 characters):');
    if (!pw) return;
    memberUpdate(b.dataset.mpass, { password: pw });
  }));
  tb.querySelectorAll('[data-mdel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete member "${b.dataset.user}"? They will no longer be able to log in.`)) return;
    try { await api(`/api/admin/members/${b.dataset.mdel}`, { method: 'DELETE' }); await loadMembers(); }
    catch (e) { alert(e.message); }
  }));
}
async function memberUpdate(id, body) {
  try { await api(`/api/admin/members/${id}`, { method: 'POST', body: JSON.stringify(body) }); setNotice('m-status', 'Updated.', 'ok'); await loadMembers(); }
  catch (e) { setNotice('m-status', e.message, 'warn'); }
}
if ($('m-add-btn')) $('m-add-btn').addEventListener('click', async () => {
  const name = $('m-name').value.trim();
  const email = $('m-email').value.trim();
  const password = $('m-password').value;
  const role = $('m-role').value;
  if (!name) { setNotice('m-status', 'Enter a name.', 'warn'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setNotice('m-status', 'Enter a valid email address.', 'warn'); return; }
  if (password.length < 6) { setNotice('m-status', 'Password must be at least 6 characters.', 'warn'); return; }
  try {
    await api('/api/admin/members', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
    setNotice('m-status', `Created "${name}" <${email}> (${role}). They can log in with this email + password.`, 'ok');
    $('m-name').value = ''; $('m-email').value = ''; $('m-password').value = '';
    await loadMembers();
  } catch (e) { setNotice('m-status', e.message, 'warn'); }
});

function populateCollegeControls() {
  // Upload college dropdown — keep the current selection across a refresh.
  const up = $('upload-college');
  if (up) {
    const prevSel = up.value;
    up.innerHTML = `<option value="">— Select college —</option>` + COLLEGES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (prevSel && COLLEGES.includes(prevSel)) up.value = prevSel;
  }
  // College filter chips
  const fc = $('filter-college');
  if (fc) {
    fc.innerHTML = [`<button class="fchip ${filterCollege === 'all' ? 'on' : ''}" data-college="all" data-label="All">All</button>`]
      .concat(COLLEGES.map((c) => `<button class="fchip ${filterCollege === c ? 'on' : ''}" data-college="${escapeHtml(c)}" data-label="${escapeHtml(c)}">${escapeHtml(c)}</button>`))
      .concat([`<button class="fchip ${filterCollege === '__none' ? 'on' : ''}" data-college="__none" data-label="Unassigned">Unassigned</button>`])
      .join('');
    fc.querySelectorAll('[data-college]').forEach((b) => b.addEventListener('click', () => { filterCollege = b.dataset.college; renderCandidateTable(); }));
  }
}

/* ---- Login ---- */
$('login-btn').addEventListener('click', doLogin);
$('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
if ($('login-email')) $('login-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

// Logout — clears the session and returns to the login screen, so you can sign
// back in with a different role (manager <-> panel member).
async function doLogout() {
  stopAutoRefresh();
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {}
  $('shell').classList.add('hidden');
  $('login-section').classList.remove('hidden');
  if ($('login-email')) $('login-email').value = '';
  if ($('login-password')) $('login-password').value = '';
  if ($('login-error')) $('login-error').textContent = '';
  window.scrollTo({ top: 0 });
}
const logoutBtn = $('logout-btn');
if (logoutBtn) {
  logoutBtn.insertAdjacentHTML('afterbegin', svg('logout', 17));
  logoutBtn.addEventListener('click', doLogout);
}
async function doLogin() {
  const email = $('login-email') ? $('login-email').value.trim() : '';
  const password = $('login-password').value;
  if (!email || !password) { $('login-error').textContent = 'Enter both your email and password.'; return; }
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await enterDashboard();
  } catch (err) { $('login-error').textContent = err.message; }
}
async function enterDashboard() {
  $('login-section').classList.add('hidden');
  $('shell').classList.remove('hidden');
  await loadConfig();
  buildStatusFilter();
  refreshAll();
  startAutoRefresh();
}
// Status filter chips.
const STATUS_FILTERS = [
  ['all', 'All'], ['in_progress', 'In progress'], ['submitted', 'Submitted'],
  ['evaluated', 'Evaluated'], ['shortlisted', 'Shortlisted'], ['rejected', 'Rejected'], ['part2_ready', 'Not started'],
];
function buildStatusFilter() {
  const fs = $('filter-status');
  if (!fs) return;
  fs.innerHTML = STATUS_FILTERS.map(([v, l]) => `<button class="fchip ${filterStatus === v ? 'on' : ''}" data-status="${v}" data-label="${l}">${l}</button>`).join('');
  fs.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => { filterStatus = b.dataset.status; renderCandidateTable(); }));
  const sb = $('sort-by');
  if (sb && !sb._wired) { sb._wired = true; sb.addEventListener('change', () => { sortBy = sb.value; renderCandidateTable(); }); }
}
$('refresh-btn').addEventListener('click', () => refreshAll());
$('detail-close').addEventListener('click', () => $('detail-section').classList.add('hidden'));

/* ---- Resumes ---- */
$('upload-btn').addEventListener('click', async () => {
  const files = $('resume-files').files;
  if (!files.length) { setNotice('upload-status', 'Choose one or more PDF files first.', 'warn'); return; }
  const form = new FormData(); for (const f of files) form.append('files', f);
  // College is OPTIONAL: if none is picked (or none exist), the batch uploads as
  // "Unassigned". Only prompt when colleges DO exist but none was selected, so the
  // admin doesn't forget to group a batch by accident.
  const col = $('upload-college') ? $('upload-college').value : '';
  if (!col && COLLEGES.length && !confirm('No college selected — upload this batch as "Unassigned"?')) return;
  form.append('college', col);
  setNotice('upload-status', `Uploading ${files.length} file(s) for ${col}…`);
  try {
    let r;
    if (IS_DOCS) {
      // Writers' site: send 10 files per request so each request stays small
      // (Workers Free per-request limits); the results are combined.
      r = { uploaded: [], skipped: [] };
      const list = Array.from(files);
      for (let i = 0; i < list.length; i += 10) {
        const part = new FormData();
        for (const f of list.slice(i, i + 10)) part.append('files', f);
        part.append('college', col);
        setNotice('upload-status', `Uploading ${Math.min(i + 10, list.length)} of ${list.length} file(s)…`);
        const rr = await api('/api/admin/resumes/upload', { method: 'POST', body: part });
        r.uploaded.push(...(rr.uploaded || [])); r.skipped.push(...(rr.skipped || []));
      }
    } else {
      r = await api('/api/admin/resumes/upload', { method: 'POST', body: form });
    }
    const skipped = r.skipped || [];
    const base = `Uploaded ${r.uploaded.length} resume(s) — they appear below as "(unparsed)". Now click "Parse resumes" to fill in each name & email.`;
    const skipTail = skipped.length ? ` Skipped ${skipped.length}: ${skipped.map((s) => `${s.filename} (${s.reason})`).join('; ')}.` : '';
    setNotice('upload-status', base + skipTail, skipped.length ? 'warn' : 'ok');
    await refreshCandidates();
  } catch (err) { setNotice('upload-status', `Error: ${err.message}`, 'warn'); }
});
// Parse requests sent at once each round. The writers site keeps each request small
// (2 resumes), so it sends more of them; support sends 2 requests of up to 20.
const parseWave = () => (IS_DOCS ? 5 : 2); // read at click time: IS_DOCS is set once the config loads
let _parsing = false;
$('process-btn').addEventListener('click', async () => {
  if (_parsing) return;
  _parsing = true;
  const btn = $('process-btn');
  const prevLabel = btn.innerHTML;
  btn.disabled = true;
  try {
    // Auto-loop through every waiting resume so a cohort of 100 is ONE click. Each
    // round sends parseWave() requests at once; the server gives each request its own
    // claimed set of resumes, so none is parsed twice. A round where every waiting
    // resume is already being parsed elsewhere (another admin, or a request that
    // died and is waiting to be taken over) just waits a few seconds.
    let totalProcessed = 0, totalFailed = 0, rounds = 0, idleRounds = 0;
    const failures = [];
    while (true) {
      rounds++;
      btn.innerHTML = '<span class="spinner"></span> Parsing…';
      setNotice('upload-status', totalProcessed || totalFailed
        ? `Parsing… ${totalProcessed} done so far${totalFailed ? ` (${totalFailed} failed)` : ''}. Working through the rest…`
        : 'Parsing resumes — several at once…');
      // While waiting on resumes another request holds, one request a round is enough.
      const settled = await Promise.allSettled(Array.from({ length: idleRounds ? 1 : parseWave() }, () => api('/api/admin/resumes/process', { method: 'POST' })));
      const rs = settled.filter((x) => x.status === 'fulfilled').map((x) => x.value);
      if (!rs.length) throw settled[0].reason;
      let remaining = 0, claimed = 0, inFlight = 0;
      for (const r of rs) {
        const done = (r.processed || []).filter((p) => !p.skipped); // skipped: another request took it over
        const failed = done.filter((p) => !p.ok);
        totalProcessed += done.length - failed.length;
        totalFailed += failed.length;
        for (const f of failed) failures.push(`${f.filename}: ${f.error}`);
        claimed += r.claimed ?? (r.processed || []).length;
        remaining = Math.max(remaining, r.remainingToProcess || 0);
        inFlight = Math.max(inFlight, r.inFlight || 0);
      }
      await refreshCandidates(); // show progress filling into the table each round
      if (rounds === 1 && claimed === 0 && remaining === 0) {
        setNotice('upload-status', 'No resumes waiting to be parsed. Upload PDFs first, or every uploaded resume is already processed.', 'ok');
        return;
      }
      if (remaining === 0) break;
      if (claimed === 0) {
        // Everything left is being parsed by another request. Wait, but not forever:
        // a request that died is taken over after 10 minutes.
        if (++idleRounds > 240) { setNotice('upload-status', `Stopped waiting — ${remaining} resume(s) are still marked as being parsed elsewhere. Click Parse resumes again in a few minutes.`, 'warn'); return; }
        setNotice('upload-status', `Parsing… ${totalProcessed} done here; ${inFlight || remaining} being parsed by another session or a request that will be retried. Waiting…`);
        await new Promise((r) => setTimeout(r, 3000));
      } else idleRounds = 0;
    }
    const failTail = failures.length ? ` Failures: ${failures.join('; ')}` : '';
    const msg = totalFailed
      ? `Done. Parsed ${totalProcessed} (${totalFailed} failed). Use "Fix email" on any failed candidate, then re-parse.` + failTail
      : `All done ✓ Parsed ${totalProcessed} resume(s). Candidates are ready in the table.`;
    setNotice('upload-status', msg, totalFailed ? 'warn' : 'ok');
  } catch (err) {
    setNotice('upload-status', `Error: ${err.message}`, 'warn');
  } finally {
    btn.disabled = false; btn.innerHTML = prevLabel; _parsing = false;
  }
});

/* ---- Question bank ---- */
$('q-category')?.addEventListener('change', updateMarksPlaceholder);
$('q-add-btn').addEventListener('click', async () => {
  const category = $('q-category').value;
  const prompt = $('q-prompt').value.trim();
  const referenceAnswer = $('q-answer').value.trim();
  const marksRaw = $('q-marks').value.trim();
  if (!prompt) { setNotice('qform-status', 'Enter the question text.', 'warn'); return; }
  const btn = $('q-add-btn'); btn.disabled = true; btn.innerHTML = IS_DOCS ? '<span class="spinner"></span> Adding…' : '<span class="spinner"></span> Enriching…';
  try {
    const body = IS_DOCS ? { category, prompt } : { category, prompt, referenceAnswer, difficulty: $('q-difficulty').value };
    if (marksRaw) body.marks = Number(marksRaw);
    if (IS_DOCS && $('q-wordlimit').value.trim()) body.wordLimit = Number($('q-wordlimit').value.trim());
    const r = await api('/api/admin/questions', { method: 'POST', body: JSON.stringify(body) });
    if (IS_DOCS) setNotice('qform-status', `Added to ${categoryLabel(category)}.`, 'ok');
    else setNotice('qform-status', r.enrichError ? `Added, but AI enrichment failed (${r.enrichError}).` : 'Added and enriched.', r.enrichError ? 'warn' : 'ok');
    $('q-prompt').value = ''; $('q-answer').value = ''; $('q-marks').value = '';
    if ($('q-wordlimit')) $('q-wordlimit').value = '';
    await refreshQuestions();
    if (IS_DOCS) loadConfig({ preserveEdits: true }); // refresh the "In the bank" counts
  } catch (err) { setNotice('qform-status', `Error: ${err.message}`, 'warn'); }
  finally { btn.disabled = false; btn.textContent = IS_DOCS ? 'Add question' : 'Add question & enrich with AI'; }
});
let enrichingAll = false;
$('enrich-all-btn').addEventListener('click', async () => {
  if (enrichingAll) return;
  enrichingAll = true;
  const btn = $('enrich-all-btn'); btn.disabled = true;
  try {
    let remaining = Infinity, totalOk = 0, lastErr = '';
    while (remaining > 0) {
      btn.innerHTML = '<span class="spinner"></span> Enriching…';
      const r = await api('/api/admin/questions/enrich-all', { method: 'POST' });
      remaining = r.remaining;
      const ok = r.processed.filter((p) => p.ok);
      const failed = r.processed.filter((p) => !p.ok);
      totalOk += ok.length;
      if (failed.length) lastErr = failed[failed.length - 1].error || 'unknown error';
      setNotice('enrich-all-status',
        `Enriched ${totalOk} so far, ${remaining} remaining.` + (failed.length ? ` ${failed.length} failed this round — e.g. "${lastErr}"` : ''),
        failed.length ? 'warn' : 'ok');
      await refreshQuestions();
      // Stop when done, when nothing was attempted, or when NO progress was made
      // this round (every attempt failed) — otherwise this loops forever.
      if (remaining === 0 || r.processed.length === 0 || ok.length === 0) break;
    }
    if (remaining === 0) {
      setNotice('enrich-all-status', 'All questions enriched — sample data, expected output and rubrics are ready.', 'ok');
    } else {
      setNotice('enrich-all-status',
        `Stopped with ${remaining} question(s) still not enriched — the AI enrichment call is failing. Last error: "${lastErr || 'unknown'}". This is almost always the OPENAI_API_KEY secret on the deployed Worker being missing, invalid, or out of quota/credit — check that, then click again.`,
        'warn');
    }
    await refreshQuestions();
  } catch (err) { setNotice('enrich-all-status', `Error: ${err.message}`, 'warn'); }
  finally { enrichingAll = false; btn.disabled = false; btn.textContent = 'Enrich all with AI'; }
});
// Shared importer: accepts {questions:[...]} OR a bare [...] array; gives clear
// messages for an empty box or malformed JSON instead of a raw parser error.
async function importQuestionsFromText(text) {
  const raw = (text || '').trim();
  if (!raw) { setNotice('bank-status', 'Nothing to import — choose a .json file or paste the JSON first.', 'warn'); return; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { setNotice('bank-status', "That doesn't look like valid JSON. Pick the .json file instead, or paste its full contents (it should start with { and end with }).", 'warn'); return; }
  const questions = Array.isArray(parsed) ? parsed : parsed.questions;
  if (!Array.isArray(questions) || !questions.length) {
    setNotice('bank-status', 'No questions found in that JSON. It should be {"questions":[ … ]} with at least one entry.', 'warn'); return;
  }
  try {
    let r;
    if (IS_DOCS) {
      // The writers site takes at most 30 per request (Workers Free query limit), so
      // send the file in chunks of 30 and add up the results.
      r = { imported: 0, duplicates: 0, skipped: 0 };
      for (let i = 0; i < questions.length; i += 30) {
        setNotice('bank-status', `Importing ${Math.min(i + 30, questions.length)} of ${questions.length}…`);
        const part = await api('/api/admin/questions/bulk-import', { method: 'POST', body: JSON.stringify({ questions: questions.slice(i, i + 30) }) });
        r.imported += part.imported || 0; r.duplicates += part.duplicates || 0; r.skipped += part.skipped || 0;
      }
      const tail = (r.duplicates ? ` Skipped ${r.duplicates} already in the bank.` : '') + (r.skipped ? ` Skipped ${r.skipped} with a missing or invalid part, prompt, marks or word limit.` : '');
      setNotice('bank-status', r.imported ? `Imported ${r.imported} question(s).${tail}` : `Nothing new imported.${tail}`, r.imported && !r.skipped ? 'ok' : 'warn');
      $('bulk-json').value = ''; const f = $('bulk-json-file'); if (f) f.value = '';
      await refreshQuestions();
      loadConfig({ preserveEdits: true }); // refresh the "In the bank" counts
      return;
    }
    r = await api('/api/admin/questions/bulk-import', { method: 'POST', body: JSON.stringify({ questions }) });
    const dupTail = r.duplicates ? ` Skipped ${r.duplicates} already in the bank (no duplicates added).` : '';
    const msg = r.imported
      ? `Imported ${r.imported} question(s).${dupTail} Now click "Enrich all with AI" to generate their sample data and rubrics.`
      : `Nothing new imported — all ${r.duplicates || 0} were already in the bank.`;
    setNotice('bank-status', msg, r.imported ? 'ok' : 'warn');
    $('bulk-json').value = ''; const f = $('bulk-json-file'); if (f) f.value = '';
    await refreshQuestions();
  } catch (err) { setNotice('bank-status', `Error: ${err.message}`, 'warn'); }
}
$('bulk-import-btn').addEventListener('click', () => importQuestionsFromText($('bulk-json').value));
// Choosing a .json file imports it directly (no copy-paste needed).
const bulkFileInput = $('bulk-json-file');
if (bulkFileInput) {
  bulkFileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setNotice('bank-status', `Reading ${file.name}…`);
    try {
      const text = await file.text();
      $('bulk-json').value = text; // show it too, so they can see what loaded
      await importQuestionsFromText(text);
    } catch (err) { setNotice('bank-status', `Could not read file: ${err.message}`, 'warn'); }
  });
}

let showingDeletedQuestions = false;
async function refreshQuestions() {
  const { questions, deletedCount } = await api('/api/admin/questions' + (showingDeletedQuestions ? '?deleted=1' : ''));
  // nav badge always reflects the LIVE bank size, even while viewing the deleted bin.
  if (!showingDeletedQuestions) $('nav-q').textContent = questions.length;

  // "Show deleted (N)" / "Back to active bank" toggle — only shown when a bin exists.
  const tb = $('toggle-deleted-q');
  if (tb) {
    if (showingDeletedQuestions) {
      tb.hidden = false;
      tb.textContent = '← Back to active bank';
    } else if (deletedCount > 0) {
      tb.hidden = false;
      tb.textContent = `View deleted (${deletedCount})`;
    } else {
      tb.hidden = true;
    }
    if (!tb._wired) {
      tb._wired = true;
      tb.addEventListener('click', async () => { showingDeletedQuestions = !showingDeletedQuestions; await refreshQuestions(); });
    }
  }

  const tbody = document.querySelector('#question-table tbody');
  if (!questions.length) {
    tbody.innerHTML = showingDeletedQuestions
      ? '<tr><td colspan="6" class="empty">No deleted questions. Anything you delete lands here and can be restored.</td></tr>'
      : '<tr><td colspan="6" class="empty">No questions yet — add one above.</td></tr>';
    return;
  }

  if (showingDeletedQuestions) {
    // Deleted bin: show when it was removed, with a Restore action.
    tbody.innerHTML = questions.map((q) => `<tr class="deleted-row">
        <td><span class="badge muted">${escapeHtml(categoryLabel(q.category))}</span></td>
        <td>${escapeHtml(q.prompt).slice(0, 96)}${q.prompt.length > 96 ? '…' : ''}</td>
        <td class="tnum">${q.marks}</td>
        <td>${questionExtraCell(q)}</td>
        <td><span class="pill muted">deleted</span></td>
        <td><div class="rowmenu"><button class="secondary sm" data-view="${q.id}">View</button><button class="primary sm" data-qrestore="${q.id}">Restore</button></div></td>
      </tr>`).join('');
    wireQuestionDetail(tbody, questions);
    tbody.querySelectorAll('[data-qrestore]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Restoring…';
      try { await api(`/api/admin/questions/${b.dataset.qrestore}/restore`, { method: 'POST' }); await refreshQuestions(); }
      catch (e) { alert('Restore failed: ' + e.message); b.disabled = false; b.textContent = 'Restore'; }
    }));
    return;
  }

  tbody.innerHTML = questions.map((q) => `<tr>
      <td><span class="badge muted">${escapeHtml(categoryLabel(q.category))}</span></td>
      <td>${escapeHtml(q.prompt).slice(0, 96)}${q.prompt.length > 96 ? '…' : ''}</td>
      <td class="tnum">${q.marks}</td>
      <td>${questionExtraCell(q)}</td>
      <td>${q.active ? '<span class="pill ok">active</span>' : '<span class="pill muted">off</span>'}</td>
      <td><div class="rowmenu"><button class="secondary sm" data-view="${q.id}">View</button><button class="secondary sm" data-toggle="${q.id}">${q.active ? 'Disable' : 'Enable'}</button><button class="danger sm" data-qdel="${q.id}">Delete</button></div></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/admin/questions/${b.dataset.toggle}/toggle-active`, { method: 'POST' }); await refreshQuestions(); if (IS_DOCS) loadConfig({ preserveEdits: true }); }));
  wireQuestionDetail(tbody, questions);
  tbody.querySelectorAll('[data-qdel]').forEach((b) => b.addEventListener('click', async () => {
    const q = questions.find((x) => x.id === b.dataset.qdel);
    const preview = (q?.prompt || '').replace(/\s+/g, ' ').slice(0, 90);
    if (!confirm(`Delete this ${q ? categoryLabel(q.category) : ''} question?\n\n"${preview}…"\n\nIt moves to the deleted bin and is no longer assigned to candidates. You can restore it anytime from "View deleted".`)) return;
    try { await api(`/api/admin/questions/${b.dataset.qdel}`, { method: 'DELETE' }); await refreshQuestions(); }
    catch (e) { alert('Delete failed: ' + e.message); }
  }));
}

// Shared: wire up the inline "View" expand/collapse for a question table.
function wireQuestionDetail(tbody, questions) {
  tbody.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('tr');
    const next = row.nextElementSibling;
    const alreadyOpen = next && next.classList.contains('qdetail-row');
    tbody.querySelectorAll('.qdetail-row').forEach((r) => r.remove()); // close any open one
    if (alreadyOpen) { b.textContent = 'View'; return; }              // toggle closed
    tbody.querySelectorAll('[data-view]').forEach((x) => (x.textContent = 'View'));
    const q = questions.find((x) => x.id === b.dataset.view);
    const tr = document.createElement('tr');
    tr.className = 'qdetail-row';
    tr.innerHTML = `<td colspan="6">${questionDetailHtml(q)}</td>`;
    row.insertAdjacentElement('afterend', tr);
    b.textContent = 'Hide';
    tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
}

async function refreshPart3Questions() {
  const table = document.querySelector('#part3-table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  let questions = [];
  try { questions = (await api('/api/admin/part3/questions')).questions || []; }
  catch (e) { tbody.innerHTML = `<tr><td colspan="5" class="empty">Could not load Part 3 bank: ${escapeHtml(e.message)}</td></tr>`; return; }
  if (!questions.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No Part 3 questions yet — click "Load / refresh built-in Part 3 bank" above.</td></tr>'; return; }
  tbody.innerHTML = questions.map((q) => `<tr>
      <td><span class="badge ${q.kind === 'buggy_fix' ? 'muted' : ''}">${q.kind === 'buggy_fix' ? 'Buggy fix' : 'Scenario'}</span></td>
      <td>${escapeHtml((q.title ? q.title + ' — ' : '') + q.prompt).slice(0, 96)}${((q.title ? q.title + ' — ' : '') + q.prompt).length > 96 ? '…' : ''}</td>
      <td class="tnum">${q.marks}</td>
      <td>${q.active ? '<span class="pill ok">active</span>' : '<span class="pill muted">off</span>'}</td>
      <td><div class="rowmenu"><button class="secondary sm" data-p3view="${q.id}">View</button></div></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-p3view]').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('tr');
    const next = row.nextElementSibling;
    const alreadyOpen = next && next.classList.contains('qdetail-row');
    tbody.querySelectorAll('.qdetail-row').forEach((r) => r.remove());
    tbody.querySelectorAll('[data-p3view]').forEach((x) => (x.textContent = 'View'));
    if (alreadyOpen) { b.textContent = 'View'; return; }
    const q = questions.find((x) => x.id === b.dataset.p3view);
    const tr = document.createElement('tr');
    tr.className = 'qdetail-row';
    tr.innerHTML = `<td colspan="5"><div class="qdetail">
      <h3 style="font-family:'Fraunces';font-size:15px;margin:0 0 8px">${q.kind === 'buggy_fix' ? 'Buggy-code fix' : 'Break-fix scenario'} · ${q.marks} marks</h3>
      ${q.title ? `<p style="margin:0 0 6px"><strong>${escapeHtml(q.title)}</strong></p>` : ''}
      <p style="margin:0 0 8px">${escapeHtml(q.prompt)}</p>
      ${q.code_snippet ? `<pre class="softpre" style="background:#0f172a;color:#e2e8f0">${escapeHtml(q.code_snippet)}</pre>` : ''}
      ${q.reference_answer ? `<p class="muted" style="margin:8px 0 0"><strong>Reference (admin only):</strong> ${escapeHtml(q.reference_answer)}</p>` : ''}
    </div></td>`;
    row.insertAdjacentElement('afterend', tr);
    b.textContent = 'Hide';
    tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
}

const part3SeedBtn = document.getElementById('part3-seed-btn');
if (part3SeedBtn) part3SeedBtn.addEventListener('click', async () => {
  part3SeedBtn.disabled = true;
  try {
    const r = await api('/api/admin/part3/seed', { method: 'POST' });
    setNotice('part3-seed-status', `Part 3 bank ready — ${r.total} question(s) in the bank${r.inserted ? ` (${r.inserted} newly added)` : ' (already loaded)'}.`, 'ok');
    await refreshPart3Questions();
  } catch (e) { setNotice('part3-seed-status', `Error: ${e.message}`, 'warn'); }
  finally { part3SeedBtn.disabled = false; }
});

// Detail markup for a question, shown inline (expanded row) right under the
// question in the Question bank — not on the Overview page.
// 4th column of the question table: sample data (support) or word limit (writers).
function questionExtraCell(q) {
  if (IS_DOCS) return q.word_limit ? `<span class="tnum">${q.word_limit}</span>` : `<span class="muted">default (${DOCS ? DOCS.wordLimit : 1000})</span>`;
  return q.sample_data ? '<span style="color:var(--ok)">✓</span>' : '—';
}
function questionDetailHtml(q) {
  if (IS_DOCS) {
    return `<div class="qdetail">
    <h3 style="font-family:'Fraunces';font-size:15px;margin:0 0 8px">${escapeHtml(categoryLabel(q.category))} · ${q.marks} marks · word limit ${q.word_limit || (DOCS ? DOCS.wordLimit + ' (default)' : 'default')}</h3>
    <div class="detail-block" style="border:0;margin:0;padding:0"><h3>Question <span class="muted" style="font-weight:400;font-size:12px">— exactly as the candidate sees it</span></h3><div class="cand-preview">${renderRich(q.prompt)}</div></div>
  </div>`;
  }
  return `<div class="qdetail">
    <h3 style="font-family:'Fraunces';font-size:15px;margin:0 0 8px">${escapeHtml(q.category.toUpperCase())} · ${q.marks} marks</h3>
    <div class="detail-block" style="border:0;margin:0;padding:0"><h3>Question <span class="muted" style="font-weight:400;font-size:12px">— exactly as the candidate sees it</span></h3><div class="cand-preview">${renderRich(q.prompt)}</div></div>
    <div class="detail-block"><h3>Hint (shown to candidate on demand)</h3><pre class="softpre">${escapeHtml(q.hint || '(none — click Enrich all to generate)')}</pre></div>
    <div class="detail-block"><h3>Sample data (shown to candidate)</h3><div class="cand-preview">${q.sample_data ? renderRich(q.sample_data) : '<span class="muted">(none — click Enrich all to generate)</span>'}</div></div>
    <div class="detail-block"><h3>Expected output (used for grading)</h3><pre class="softpre">${escapeHtml(q.expected_output || '(none — click Enrich all to generate)')}</pre></div>
    <div class="detail-block"><h3>Reference answer (admin only)</h3><pre class="softpre">${escapeHtml(q.reference_answer || '(none)')}</pre></div>
    <div class="detail-block"><h3>Grading rubric (admin only)</h3><pre class="softpre">${escapeHtml(q.rubric || '(none)')}</pre></div>
    ${(q.category === 'dsa' || q.category === 'scenario') ? `<div class="detail-block"><h3>Marking checkpoints (admin only · used for grace-mark grading)</h3><pre class="softpre">${escapeHtml(q.checkpoints || '(none — click "Enrich all with AI" to generate)')}</pre></div>` : ''}
  </div>`;
}

/* ---- Avatars ---- */
const AV_GRADS = ['linear-gradient(135deg,#818cf8,#6366f1)','linear-gradient(135deg,#34d399,#10b981)','linear-gradient(135deg,#fbbf24,#f59e0b)','linear-gradient(135deg,#f472b6,#ec4899)','linear-gradient(135deg,#22d3ee,#06b6d4)','linear-gradient(135deg,#a78bfa,#8b5cf6)'];
function initials(name, email) {
  const n = (name || '').trim();
  if (n) { const p = n.split(/\s+/); return ((p[0][0] || '') + (p[1]?.[0] || '')).toUpperCase(); }
  return (email || '?').slice(0, 2).toUpperCase();
}
function avColor(seed) { let h = 0; for (const c of seed || '') h = (h * 31 + c.charCodeAt(0)) % AV_GRADS.length; return AV_GRADS[h]; }

/* ---- Candidates + stats + analysis ---- */
async function refreshCandidates() {
  const { candidates } = await api('/api/admin/candidates');
  allCandidates = candidates || [];
  renderCandidateTable();
  // Stats + analysis reflect the whole cohort (not the filter) and never block
  // the table — a failure here must not hide candidates.
  try { renderStats(allCandidates); } catch (e) {}
  try { await refreshAnalysis(); } catch (e) {}
}

const STATUS_ORDER = { in_progress: 0, submitted: 1, evaluated: 2, shortlisted: 3, part2_ready: 4, parsed: 5, uploaded: 6, rejected: 7, parse_failed: 8 };
function applyFilterSort(list) {
  let out = list.slice();
  out = out.filter((c) => matchesCollege(c, filterCollege) && matchesStatus(c, filterStatus));
  out.sort((a, b) => {
    if (sortBy === 'name') return (a.name || a.email || '').localeCompare(b.name || b.email || '');
    if (sortBy === 'status') return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (sortBy === 'college') return (a.college || '~~~').localeCompare(b.college || '~~~');
    const at = (a.part1.graded || a.part2.graded || (a.part3 && a.part3.graded)) ? a.totalAwarded : -1; // graded first, highest total
    const bt = (b.part1.graded || b.part2.graded || (b.part3 && b.part3.graded)) ? b.totalAwarded : -1;
    return bt - at;
  });
  return out;
}

function collegeCell(c) {
  if (IS_MANAGER) {
    const opts = [`<option value="">Unassigned</option>`]
      .concat(COLLEGES.map((x) => `<option value="${escapeHtml(x)}" ${c.college === x ? 'selected' : ''}>${escapeHtml(x)}</option>`))
      .join('');
    return `<select class="col-select" data-college-for="${c.id}">${opts}</select>`;
  }
  return `<span class="col-text">${escapeHtml(c.college || '—')}</span>`;
}

// Keep both chip rows in sync on EVERY table render: the active chip is highlighted
// immediately, and each chip shows how many candidates it would show given the
// OTHER filter (college counts respect the status filter and vice versa), so an
// empty combination is obviously empty rather than looking broken.
function matchesCollege(c, f) { return f === 'all' ? true : f === '__none' ? !c.college : c.college === f; }
function matchesStatus(c, f) { return f === 'all' ? true : c.status === f; }
function syncFilterChips() {
  const list = allCandidates || [];
  document.querySelectorAll('#filter-status [data-status]').forEach((b) => {
    const v = b.dataset.status;
    const n = list.filter((c) => matchesCollege(c, filterCollege) && matchesStatus(c, v)).length;
    b.classList.toggle('on', filterStatus === v);
    b.innerHTML = `${escapeHtml(b.dataset.label || v)} <span class="fchip-n">${n}</span>`;
  });
  document.querySelectorAll('#filter-college [data-college]').forEach((b) => {
    const v = b.dataset.college;
    const n = list.filter((c) => matchesStatus(c, filterStatus) && matchesCollege(c, v)).length;
    b.classList.toggle('on', filterCollege === v);
    b.innerHTML = `${escapeHtml(b.dataset.label || v)} <span class="fchip-n">${n}</span>`;
  });
}
function clearFilters() { filterCollege = 'all'; filterStatus = 'all'; renderCandidateTable(); }

function renderCandidateTable() {
  const tbody = document.querySelector('#candidate-table tbody');
  if (!tbody) return;
  syncFilterChips();
  const rows = applyFilterSort(allCandidates);
  const countEl = $('filter-count');
  if (countEl) countEl.textContent = allCandidates.length ? `${rows.length} of ${allCandidates.length} shown` : '';
  if (!allCandidates.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No candidates yet — upload resumes in the Resumes tab.</td></tr>'; return; }
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No candidates match this filter. <button class="secondary sm" id="clear-filters-btn" style="margin-left:8px">Clear filters</button></td></tr>';
    const cb = $('clear-filters-btn'); if (cb) cb.addEventListener('click', clearFilters);
    return;
  }
  tbody.innerHTML = rows.map((c) => {
    const nm = c.name || '(unparsed)';
    const em = c.email || '(pending)';
    const flags = (c.accessRevoked ? '<span class="flag">revoked</span>' : '') + (c.loginCount > 1 ? `<span class="flag" title="${c.loginCount} logins — check for a second person">⚠ ${c.loginCount} logins</span>` : '');
    const fix = IS_MANAGER && (c.status === 'parse_failed' || !c.email) ? `<button data-fix="${c.id}">${svg('mail', 15)} Fix email</button>` : '';
    const mgrItems = IS_MANAGER ? `
              <button data-force="${c.id}">${svg('send', 15)} Force submit</button>
              <button data-resume="${c.id}">${svg('rotate', 15)} Resume (same Qs + answers)</button>
              <button data-retake="${c.id}">${svg('rotate', 15)} Retake (new questions)</button>
              <button data-toggle-access="${c.id}">${svg('ban', 15)} ${c.accessRevoked ? 'Restore access' : 'Revoke access'}</button>
              ${fix}` : '';
    const delItem = IS_MANAGER ? `<button class="danger" data-delete="${c.id}">${svg('trash', 15)} Delete</button>` : '';
    return `<tr>
      <td><div class="cand"><span class="avatar" style="background:${avColor(c.id)}">${escapeHtml(initials(c.name, c.email))}</span><div><div class="nm">${escapeHtml(nm)}</div><div class="em">${escapeHtml(em)}</div></div></div></td>
      <td>${collegeCell(c)}</td>
      <td><span class="pill ${statusPill(c.status)}">${escapeHtml(statusLabel(c.status))}</span>${flags}</td>
      <td>${IS_DOCS
        ? (c.part1.graded || c.part2.graded ? `<span class="score" title="Part 1">${c.part1.awarded}<small>/${c.part1.max}</small></span> <span class="score" title="Part 2">${c.part2.awarded}<small>/${c.part2.max}</small></span>` : '<span class="muted">—</span>')
        : (c.part1.graded ? `<span class="score">${c.part1.awarded}<small>/${c.part1.max}</small></span>` : '<span class="muted">—</span>')}</td>
      <td>${c.part1.graded || (IS_DOCS && c.part2.graded) ? `<span class="score">${c.totalAwarded}<small>/${c.totalMax}</small></span>` : '<span class="muted">—</span>'}</td>
      <td>
        <div class="rowmenu">
          <button class="secondary sm" data-view="${c.id}">${svg('eye', 14)} View</button>
          <div class="kebab-wrap">
            <button class="kebab" data-kebab aria-label="More actions">${svg('dots', 16)}</button>
            <div class="menu" hidden>
              <button data-grade="${c.id}">${svg('bolt', 15)} Grade now</button>${mgrItems}
              <div class="sep"></div>
              <button data-shortlist="${c.id}">${svg('star', 15)} Shortlist</button>
              <button class="danger" data-reject="${c.id}">${svg('x', 15)} Reject</button>
              ${delItem}
            </div>
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');
  wireCandidateRows(tbody);
}

function wireCandidateRows(tb) {
  wireKebabs(tb);
  tb.querySelectorAll('[data-college-for]').forEach((sel) => sel.addEventListener('change', async () => {
    const id = sel.dataset.collegeFor;
    try {
      await api(`/api/admin/candidates/${id}/college`, { method: 'POST', body: JSON.stringify({ college: sel.value }) });
      const c = allCandidates.find((x) => x.id === id); if (c) c.college = sel.value || null;
      if (filterCollege !== 'all') renderCandidateTable(); // may move out of the current filter
    } catch (e) { alert('Could not set college: ' + e.message); }
  }));
  tb.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showDetail(b.dataset.view)));
  tb.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', async () => {
    b.innerHTML = '<span class="spinner"></span> Grading…';
    try { await api(`/api/admin/candidates/${b.dataset.grade}/grade`, { method: 'POST' }); await refreshCandidates(); showDetail(b.dataset.grade); }
    catch (e) { alert('Grading failed: ' + e.message); await refreshCandidates(); }
  }));
  // Every row action reports failures (e.g. "needs manager access") instead of failing silently.
  const act = async (label, fn) => {
    try { await fn(); } catch (e) { alert(`${label} failed: ${e.message}`); }
    finally { await refreshCandidates().catch(() => {}); }
  };
  tb.querySelectorAll('[data-force]').forEach((b) => b.addEventListener('click', () => {
    const c = allCandidates.find((x) => x.id === b.dataset.force);
    if (!confirm(`Force-submit ${(c && (c.name || c.email)) || 'this candidate'}? Their timer stops and saved answers are submitted for grading.`)) return;
    act('Force submit', () => api(`/api/admin/candidates/${b.dataset.force}/force-submit`, { method: 'POST' }));
  }));
  tb.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', () => {
    const email = prompt("Enter this candidate's email (from their resume). They'll be able to log in once set:");
    if (!email) return;
    act('Fix email', () => api(`/api/admin/candidates/${b.dataset.fix}/manual`, { method: 'POST', body: JSON.stringify({ email: email.trim() }) }));
  }));
  tb.querySelectorAll('[data-retake]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Reset this candidate to retake? Their answers will be cleared and questions reshuffled.')) return;
    act('Retake', () => api(`/api/admin/candidates/${b.dataset.retake}/retake`, { method: 'POST' }));
  }));
  tb.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(IS_DOCS ? 'Re-open the part this candidate was cut off in? They keep the SAME questions and every saved answer, with a fresh clock for that part.' : 'Re-open this candidate\'s test? They keep the SAME questions, and every answer they already typed is restored. Use this when a connection drop submitted them early.')) return;
    act('Resume', async () => { const r = await api(`/api/admin/candidates/${b.dataset.resume}/resume`, { method: 'POST' }); if (IS_DOCS && r && r.message) alert(r.message); });
  }));
  tb.querySelectorAll('[data-toggle-access]').forEach((b) => b.addEventListener('click', () => {
    const c = allCandidates.find((x) => x.id === b.dataset.toggleAccess);
    if (!c) return;
    if (!c.accessRevoked && !confirm(`Revoke access for ${c.name || c.email}? Their test is submitted now with the answers saved so far.`)) return;
    act(c.accessRevoked ? 'Restore access' : 'Revoke access', () => api(`/api/admin/candidates/${b.dataset.toggleAccess}/${c.accessRevoked ? 'unrevoke' : 'revoke'}`, { method: 'POST' }));
  }));
  tb.querySelectorAll('[data-shortlist]').forEach((b) => b.addEventListener('click', () => {
    b.innerHTML = '<span class="spinner"></span> Shortlisting…';
    act('Shortlist', () => api(`/api/admin/candidates/${b.dataset.shortlist}/shortlist`, { method: 'POST' }));
  }));
  tb.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Reject this candidate?')) return;
    act('Reject', () => api(`/api/admin/candidates/${b.dataset.reject}/reject`, { method: 'POST' }));
  }));
  tb.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => {
    const c = allCandidates.find((x) => x.id === b.dataset.delete);
    const who = (c && (c.name || c.email)) || 'this entry';
    if (!confirm(`Delete ${who}? This permanently removes the candidate, their answers, scores and resume. This cannot be undone.`)) return;
    act('Delete', async () => { await api(`/api/admin/candidates/${b.dataset.delete}`, { method: 'DELETE' }); $('detail-section').classList.add('hidden'); });
  }));
}

// The menu is position:fixed (so it can't be clipped by the table's
// overflow-x container). Place it just under the kebab, right-aligned, and
// flip above / clamp to the viewport when there isn't room below.
function positionMenu(btn, menu) {
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth || 190;
  const h = menu.offsetHeight || 0;
  let left = Math.round(r.right - w);
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = Math.round(r.bottom + 6);
  if (top + h > window.innerHeight - 8) top = Math.max(8, Math.round(r.top - 6 - h));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.right = 'auto';
}
function closeMenus() { document.querySelectorAll('.menu').forEach((m) => (m.hidden = true)); }
function wireKebabs(scope) {
  scope.querySelectorAll('[data-kebab]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = b.nextElementSibling;
    const willOpen = menu.hidden;
    closeMenus();
    if (willOpen) { menu.hidden = false; positionMenu(b, menu); }
  }));
}
document.addEventListener('click', closeMenus);
// A fixed menu doesn't follow the page as it scrolls, so close it on scroll/resize.
window.addEventListener('scroll', closeMenus, true);
window.addEventListener('resize', closeMenus);

function renderStats(candidates) {
  const total = candidates.length;
  const submitted = candidates.filter((c) => ['submitted', 'evaluated', 'shortlisted', 'rejected'].includes(c.status)).length;
  const inProgress = candidates.filter((c) => c.status === 'in_progress').length;
  const shortlisted = candidates.filter((c) => c.status === 'shortlisted').length;
  const tile = (n, l, icon, col) => `<div class="stat"><div class="top"><div class="ic" style="background:${col}22;color:${col}">${svg(icon, 18)}</div></div><div class="n">${n}</div><div class="l">${l}</div></div>`;
  $('stats').innerHTML =
    tile(total, 'Total students', 'users', '#6d5ef0') +
    tile(submitted, 'Completed', 'check', '#10b981') +
    tile(inProgress, 'In progress', 'hourglass', '#e0a34e') +
    tile(shortlisted, 'Shortlisted', 'star', '#8b5cf6');
}

let analyzing = false;
async function refreshAnalysis() {
  const s = await api('/api/admin/analysis/status');
  const btn = $('analyze-btn');
  if (analyzing) return;
  if (s.total === 0) { btn.disabled = true; $('analysis-note').textContent = 'No candidates yet.'; return; }
  // Analyze whoever has SUBMITTED so far — no need to wait for everyone. Re-running
  // later picks up students who submitted in the meantime.
  if (s.awaitingGrade > 0) {
    btn.disabled = false;
    $('analysis-note').textContent = s.pending > 0
      ? `${s.awaitingGrade} submitted and ready to analyze now. ${s.pending} still in progress — analyze these now and run again later for the rest.`
      : `All ${s.total} students have submitted. ${s.awaitingGrade} awaiting grading.`;
  } else if (s.pending > 0) {
    btn.disabled = true;
    $('analysis-note').textContent = `No submissions to analyze yet — ${s.pending} still in progress.`;
  } else {
    btn.disabled = true;
    $('analysis-note').textContent = `All ${s.graded} students graded. Results are in the table below.`;
  }
}
// How many grading calls to fire AT ONCE each round. The server hands each call a
// disjoint batch (atomic claim), so this multiplies throughput — grading a 100-
// student cohort drops from many minutes to under a minute — without double-grading.
const GRADE_WAVE = 5;
$('analyze-btn').addEventListener('click', async () => {
  analyzing = true;
  const btn = $('analyze-btn'); btn.disabled = true;
  try {
    let remaining = Infinity, prev = Infinity, stalls = 0, totalFailed = 0;
    while (remaining > 0) {
      btn.innerHTML = '<span class="spinner"></span> Grading…';
      // Fire a wave of grading calls in parallel; each grades its own batch.
      // allSettled: one failed call (a dropped connection, say) doesn't stop the run;
      // its candidates are released and picked up by a later call.
      const settled = await Promise.allSettled(Array.from({ length: GRADE_WAVE }, () => api('/api/admin/analysis/run', { method: 'POST' })));
      const rs = settled.filter((x) => x.status === 'fulfilled').map((x) => x.value);
      if (!rs.length) throw settled[0].reason;
      let roundOk = 0;
      remaining = 0;
      const failures = [];
      for (const r of rs) {
        const failed = (r.processed || []).filter((p) => !p.ok);
        roundOk += (r.processed || []).length - failed.length;
        totalFailed += failed.length;
        for (const f of failed) failures.push(`${f.name}: ${f.error}`);
        remaining = Math.max(remaining, r.remaining || 0);
      }
      setNotice('analysis-status', `Grading… ${remaining} remaining.` + (failures.length ? ` Recent failures: ${failures.slice(0, 3).join('; ')}` : ''), failures.length ? 'warn' : 'ok');
      await refreshCandidatesSilent();
      if (remaining === 0) break;
      // No-progress guard so a batch that can't complete never spins forever.
      if (roundOk === 0 && remaining >= prev) { if (++stalls >= 2) { setNotice('analysis-status', `Stopped — ${remaining} could not be graded (e.g. OpenAI errors). Click Analyze again to retry them.`, 'warn'); break; } }
      else stalls = 0;
      prev = remaining;
    }
    if (remaining === 0) setNotice('analysis-status', 'All submissions graded. Open each candidate to see per-question marks and deduction reasons.', 'ok');
  } catch (err) { setNotice('analysis-status', `Error: ${err.message}`, 'warn'); }
  finally { analyzing = false; btn.textContent = 'Analyze all submissions'; await refreshCandidates(); }
});
async function refreshCandidatesSilent() { try { const { candidates } = await api('/api/admin/candidates'); renderStats(candidates); } catch {} }

function statusPill(s) {
  if (s === 'shortlisted' || s === 'evaluated') return 'ok';
  if (s === 'rejected' || s === 'parse_failed') return 'danger';
  if (s === 'submitted') return 'info';
  if (s === 'in_progress') return 'warn';
  return 'muted';
}
// Human-readable status labels. The assessment is now a SINGLE part, so the old
// internal 'part2_ready' (ready-to-start) shows as "Not started", not "part2 ready".
const STATUS_LABELS = {
  uploaded: 'Uploaded', parsed: 'Parsed', parse_failed: 'Parse failed',
  part2_ready: 'Not started', in_progress: 'In progress', grading: 'Grading…',
  submitted: 'Submitted', evaluated: 'Evaluated', shortlisted: 'Shortlisted', rejected: 'Rejected',
};
function statusLabel(s) { return STATUS_LABELS[s] || (s || '').replace(/_/g, ' '); }

function countWordsAdmin(t) { const w = (t || '').trim(); return w ? w.split(/\s+/).length : 0; }
// Writers site: Part 1 and Part 2 answers, each with its integrity notes.
function docsAnswerSections(data, answerBlock, pasteCount, pasteMax) {
  const at = data.attempt || {};
  const sum = (rows) => rows.reduce((s, a) => s + (a.ai_score != null ? Number(a.ai_score) : 0), 0);
  const max = (rows) => rows.reduce((s, a) => s + (Number(a.max_marks) || 0), 0);
  const head = (label, rows) => rows.some((a) => a.ai_score != null) ? `${label} <span class="pill ok" style="margin-left:6px">${sum(rows)}/${max(rows)}</span>` : label;
  return `<div class="detail-block"><h3>${head('Part 1 — closed book', data.part1Answers)}</h3>${data.part1Answers.map(answerBlock).join('') || '<p class="muted">Not started yet.</p>'}
      <p class="muted" style="margin-top:4px">Left the test (full-screen exit / tab switch): <strong>${at.part1_tab_switch_count ?? 0}</strong></p></div>
    <div class="detail-block"><h3>${head('Part 2 — open book', data.part2Answers)}</h3>${data.part2Answers.map(answerBlock).join('') || '<p class="muted">Not started yet.</p>'}
      <p class="muted" style="margin-top:4px">Tab switches: <strong>${at.part2_tab_switch_count ?? 0}</strong> · Pastes: <strong>${pasteCount}</strong>${pasteCount ? ` (largest ${pasteMax} characters)` : ''} — allowed in Part 2, shown for context.</p></div>`;
}

async function showDetail(id) {
  const data = await api(`/api/admin/candidates/${id}`);
  showView('overview');
  $('detail-section').classList.remove('hidden');
  $('detail-section').scrollIntoView({ behavior: 'smooth' });
  const c = data.candidate;
  // Paste activity in Part 2 (open-book): a wholesale paste is a sign of a
  // pasted/AI answer and is penalized in grading — surface it to the admin too.
  let pasteCount = 0, pasteMax = 0;
  if (IS_DOCS && data.integrity) { pasteCount = data.integrity.pastes || 0; pasteMax = data.integrity.maxPaste || 0; }
  else try {
    const log = data.attempt?.part2_tab_switch_log ? JSON.parse(data.attempt.part2_tab_switch_log) : [];
    for (const e of log) if (e && (e.type === 'paste' || e.type === 'paste_blocked')) { pasteCount++; pasteMax = Math.max(pasteMax, Number(e.chars) || 0); }
  } catch (_) {}
  const dedHtml = (raw) => {
    let arr = []; try { arr = raw ? JSON.parse(raw) : []; } catch {}
    if (!arr.length) return '';
    return '<ul class="deductions">' + arr.map((d) => `<li>−${escapeHtml(String(d.marks))}: ${escapeHtml(d.reason)}</li>`).join('') + '</ul>';
  };
  const answerBlock = (a, i) => `
    <div class="question">
      <div class="qhead"><span class="qnum">Q${i + 1}</span>${IS_DOCS ? `<span class="badge muted">${countWordsAdmin(a.answer_text)} words</span>` : `${a.category ? `<span class="badge muted">${escapeHtml(a.category)}</span>` : ''}${a.based_on_skill ? `<span class="badge">${escapeHtml(a.based_on_skill)}</span>` : ''}`}
        <span style="margin-left:auto" class="pill ${a.scored_at || a.ai_score != null ? 'ok' : 'muted'}">${a.ai_score != null ? `${a.ai_score}/${a.max_marks}` : 'not graded'}</span></div>
      <p class="qprompt"><strong>${escapeHtml(a.prompt)}</strong></p>
      <pre class="softpre">${escapeHtml(a.answer_text || '(no answer)')}</pre>
      ${a.ai_content_pct != null ? `<p class="muted" style="margin:8px 0 0"><strong>AI-likelihood (estimate):</strong> <span class="pill ${a.ai_content_pct >= 70 ? 'danger' : a.ai_content_pct >= 40 ? 'warn' : 'ok'}">${Math.round(a.ai_content_pct)}%</span> <span style="font-size:11px">how AI-generated the answer looks — a guide, not proof</span></p>` : ''}
      ${a.ai_reasoning ? `<p class="muted" style="margin:8px 0 0"><strong>Grading:</strong> ${escapeHtml(a.ai_reasoning)}</p>` : ''}
      ${dedHtml(a.deductions)}
    </div>`;
  const part3Block = (a, i) => `
    <div class="question">
      <div class="qhead"><span class="qnum">Q${i + 1}</span><span class="badge ${a.kind === 'buggy_fix' ? 'muted' : ''}">${a.kind === 'buggy_fix' ? 'Buggy-code fix' : 'Break-fix scenario'}</span>
        <span style="margin-left:auto" class="pill ${a.scored_at || a.ai_score != null ? 'ok' : 'muted'}">${a.ai_score != null ? `${a.ai_score}/${a.max_marks}` : 'not graded'}</span></div>
      <p class="qprompt"><strong>${a.title ? escapeHtml(a.title) + ' — ' : ''}${escapeHtml(a.prompt)}</strong></p>
      ${a.code_snippet ? `<pre class="softpre" style="background:#0f172a;color:#e2e8f0">${escapeHtml(a.code_snippet)}</pre>` : ''}
      <pre class="softpre">${escapeHtml(a.answer_text || '(no answer)')}</pre>
      ${a.ai_reasoning ? `<p class="muted" style="margin:8px 0 0"><strong>Grading:</strong> ${escapeHtml(a.ai_reasoning)}</p>` : ''}
      ${dedHtml(a.deductions)}
    </div>`;
  $('detail-content').innerHTML = `
    <div class="detail-split">
      <div class="resume-pane">
        <h3 style="margin-bottom:10px">Resume</h3>
        <iframe class="resume-frame" src="/api/admin/candidates/${id}/resume" title="Resume"></iframe>
        <p class="muted" style="font-size:.8rem;margin-top:6px">${escapeHtml(c.resume_filename || '')}</p>
      </div>
      <div class="detail-main">
        <h2 style="margin-top:0">${escapeHtml(c.name || '(unparsed)')}</h2>
        <div class="kv"><span class="k">Email</span><span>${escapeHtml(c.email)}</span></div>
        <div class="kv"><span class="k">College</span><span>${escapeHtml(c.college || '—')}</span></div>
        <div class="kv"><span class="k">Status</span><span><span class="pill ${statusPill(c.status)}">${escapeHtml(statusLabel(c.status))}</span></span></div>
        <div class="kv"><span class="k">Skills</span><span>${(c.skills || []).map(escapeHtml).join(', ') || '—'}</span></div>
        <div class="kv"><span class="k">Projects</span><span>${(c.projects || []).map((p) => escapeHtml(p.name)).join(', ') || '—'}</span></div>
        ${IS_DOCS ? docsAnswerSections(data, answerBlock, pasteCount, pasteMax) : `<div class="detail-block"><h3>Assessment answers — closed book</h3>${data.part1Answers.map(answerBlock).join('') || '<p class="muted">No answers yet (latest attempt).</p>'}
          <p class="muted" style="margin-top:4px">Left the test (full-screen exit / tab switch): <strong>${data.attempt?.part1_tab_switch_count ?? 0}</strong></p></div>`}
        <div class="detail-block support-only">
          <h3 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">Interview guide <button class="secondary sm" id="gen-interview-btn">${data.interviewQuestions.length ? 'Regenerate' : 'Generate'}</button></h3>
          <p class="muted" style="margin:0 0 12px;font-size:12.5px">Personalised questions from this candidate's own projects &amp; skills — why they made a choice and what would work better — each with a model answer so the interviewer has clarity. Built from the latest attempt.</p>
          ${data.interviewQuestions.length ? data.interviewQuestions.map((q, i) => `
            <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--line)">
              <p style="margin:0 0 6px"><strong>${i + 1}. ${escapeHtml(q.question)}</strong>${q.based_on ? ` <span class="badge muted">${escapeHtml(q.based_on)}</span>` : ''}</p>
              ${q.model_answer ? `<p style="margin:0 0 6px"><span class="pill ok">Model answer</span> ${escapeHtml(q.model_answer)}</p>` : ''}
              ${q.follow_up ? `<p class="muted" style="margin:0">Follow-up: ${escapeHtml(q.follow_up)}</p>` : ''}
            </div>`).join('') : '<p class="muted">No interview questions yet — click <strong>Generate</strong> to build them from the resume &amp; latest answers.</p>'}
        </div>
      </div>
    </div>`;
  const genBtn = $('gen-interview-btn');
  if (genBtn) genBtn.addEventListener('click', async () => {
    genBtn.disabled = true; genBtn.innerHTML = '<span class="spinner"></span> Generating…';
    try { await api(`/api/admin/candidates/${id}/interview`, { method: 'POST' }); await showDetail(id); }
    catch (e) { alert('Could not generate interview questions: ' + e.message); genBtn.disabled = false; genBtn.textContent = 'Generate'; }
  });
}

async function refreshAudit() {
  try {
    const { events } = await api('/api/admin/audit');
    const tbody = document.querySelector('#audit-table tbody');
    if (!tbody) return;
    if (!events.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No activity yet.</td></tr>'; return; }
    tbody.innerHTML = events.map((e) => `<tr>
        <td style="white-space:nowrap" class="tnum">${escapeHtml((e.created_at || '').replace('T', ' ').slice(0, 19))}</td>
        <td><span class="badge muted">${escapeHtml(e.action)}</span></td>
        <td style="font-size:.8rem;color:var(--faint)">${escapeHtml(e.candidate_id || '')}</td>
        <td style="font-size:.82rem">${auditDetailHtml(e)}</td>
      </tr>`).join('');
  } catch {}
}

// Delete actions store a full JSON snapshot in `detail` so a mistaken delete is
// recoverable. Render that as a compact, readable summary (with the raw snapshot
// tucked behind a details toggle) instead of dumping a long JSON blob in the cell.
function auditDetailHtml(e) {
  const raw = e.detail || '';
  if ((e.action === 'delete' || e.action === 'delete_question') && raw.trim().startsWith('{')) {
    try {
      const o = JSON.parse(raw);
      let summary = '';
      if (o.candidate) {
        const c = o.candidate;
        summary = `Candidate: ${escapeHtml(c.name || c.email || c.id)}${c.college ? ' · ' + escapeHtml(c.college) : ''} · ${escapeHtml(c.status || '')}`;
      } else if (o.snapshot) {
        const q = o.snapshot;
        summary = `Question: ${escapeHtml((q.category || '').toUpperCase())} · ${escapeHtml((q.prompt || '').replace(/\s+/g, ' ').slice(0, 70))}…`;
      }
      return `${summary} <details class="auditsnap"><summary>snapshot</summary><pre class="softpre">${escapeHtml(JSON.stringify(o, null, 2))}</pre></details>`;
    } catch { /* fall through to raw */ }
  }
  return escapeHtml(raw);
}

// allSettled so one panel failing (e.g. the question API) can never stop the
// others — the candidate table must always load even if another call errors.
let _refreshing = false;
// quiet: a background/auto refresh — skip the spinner and dimming so it isn't
// visually noisy every 15s. preserveEdits keeps anything the user is mid-typing.
async function refreshAll({ quiet = false } = {}) {
  if (_refreshing) return; // ignore rapid double-clicks / overlap with the auto-poll
  _refreshing = true;
  const btn = $('refresh-btn');
  const prev = btn ? btn.innerHTML : '';
  if (!quiet && btn) { btn.disabled = true; btn.classList.add('is-busy'); btn.innerHTML = '<span class="spinner"></span> Refreshing…'; }
  const shell = $('shell'); if (!quiet && shell) shell.classList.add('refreshing');
  try {
    // loadConfig re-pulls colleges, question categories and the assessment length
    // so a change another admin made (e.g. adding a college) shows up on refresh
    // without needing a full page reload.
    // A manual Refresh reloads everything. The background auto-refresh reloads only
    // the view you're looking at — reloading every panel on every tick, in every
    // open tab, was a big part of the drive-day database read volume.
    const tasks = [loadConfig({ preserveEdits: true })];
    if (!quiet) {
      tasks.push(refreshQuestions(), refreshCandidates(), refreshAudit(), refreshFlags());
    } else {
      const v = currentView();
      if (v === 'overview') tasks.push(refreshCandidates());
      else if (v === 'questions') tasks.push(refreshQuestions());
      else if (v === 'activity') tasks.push(refreshAudit(), refreshFlags());
    }
    await Promise.allSettled(tasks);
  } finally {
    if (!quiet && btn) { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = prev; }
    if (!quiet && shell) shell.classList.remove('refreshing');
    _refreshing = false;
  }
}

// ---- Auto-refresh: keep every open portal in sync without manual clicks. ----
// Polls every 60s (only the visible view) while the tab is visible and signed in. Quiet (no spinner),
// and preserves in-progress edits. Pauses on a hidden tab and does one immediate
// refresh when the tab comes back, so returning to the tab shows fresh data.
const AUTO_REFRESH_MS = 60000;
let _autoRefreshTimer = null;
function loggedIn() { const s = $('shell'); return s && !s.classList.contains('hidden'); }
function startAutoRefresh() {
  if (_autoRefreshTimer) return;
  _autoRefreshTimer = setInterval(() => {
    if (document.hidden || !loggedIn()) return;
    refreshAll({ quiet: true });
  }, AUTO_REFRESH_MS);
}
function stopAutoRefresh() { if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; } }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && loggedIn()) refreshAll({ quiet: true });
});

/* ---- Export (honors current college + status filter) ---- */
function exportCsv(format) {
  const params = new URLSearchParams({ format });
  if (filterCollege && filterCollege !== 'all') params.set('college', filterCollege);
  if (filterStatus && filterStatus !== 'all') params.set('status', filterStatus);
  const a = document.createElement('a');
  a.href = `/api/admin/export.csv?${params.toString()}`;
  document.body.appendChild(a); a.click(); a.remove();
}
$('export-summary') && $('export-summary').addEventListener('click', () => exportCsv('summary'));
$('export-full') && $('export-full').addEventListener('click', () => exportCsv('full'));

(async () => { try { await api('/api/admin/candidates'); await enterDashboard(); } catch {} })();
