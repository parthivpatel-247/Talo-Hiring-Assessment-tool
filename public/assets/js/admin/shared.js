/* State and building blocks shared by the admin views. */
import { html, raw } from '../core/dom.js';
import { get } from '../core/api.js';
import { icon } from '../core/icons.js';
import { fmtDuration, fmtNum, pct } from '../core/format.js';

export const state = {
  me: null,
  auth: null, // /auth/status
  settings: null,
  integrations: null,
  colleges: null,
  drives: null,
  navCounts: {},
};

export const isManager = () => state.me?.role === 'manager';

export const STATUS = {
  uploaded: { label: 'Reading resume', tone: 'neutral', stage: 'attention' },
  parse_failed: { label: 'Needs details', tone: 'danger', stage: 'attention' },
  ready: { label: 'Not started', tone: 'neutral', stage: 'ready' },
  in_progress: { label: 'In progress', tone: 'info', stage: 'in_progress' },
  submitted: { label: 'Awaiting grade', tone: 'warning', stage: 'completed' },
  grading: { label: 'Grading', tone: 'warning', stage: 'completed' },
  graded: { label: 'Graded', tone: 'accent', stage: 'completed' },
  shortlisted: { label: 'Shortlisted', tone: 'success', stage: 'completed' },
  rejected: { label: 'Rejected', tone: 'danger', stage: 'completed' },
};

/** Pipeline stages: each one is a filter over one or more statuses. */
export const STAGES = [
  { id: 'all', label: 'All candidates', cls: '', statuses: null },
  { id: 'attention', label: 'Needs details', cls: 's-attention', statuses: ['uploaded', 'parse_failed'] },
  { id: 'ready', label: 'Not started', cls: '', statuses: ['ready'] },
  { id: 'in_progress', label: 'In progress', cls: 's-progress', statuses: ['in_progress'] },
  { id: 'completed', label: 'Completed', cls: 's-submitted', statuses: ['submitted', 'grading', 'graded', 'shortlisted', 'rejected'] },
  { id: 'shortlisted', label: 'Shortlisted', cls: 's-short', statuses: ['shortlisted'] },
  { id: 'rejected', label: 'Rejected', cls: 's-reject', statuses: ['rejected'] },
];
export const EXTRA_FILTERS = [
  { id: 'awaiting', label: 'Awaiting grade', statuses: ['submitted', 'grading'] },
  { id: 'graded', label: 'Graded', statuses: ['graded'] },
];
export const stageStatuses = (id) => [...STAGES, ...EXTRA_FILTERS].find((s) => s.id === id)?.statuses ?? null;

export function stageCounts(counts) {
  const n = (ids) => ids.reduce((a, s) => a + (counts[s] || 0), 0);
  const out = {};
  for (const st of STAGES) out[st.id] = st.statuses ? n(st.statuses) : Object.values(counts).reduce((a, b) => a + b, 0);
  out.awaiting = n(['submitted', 'grading']);
  out.graded = n(['graded']);
  return out;
}

/** The pipeline strip. `subs` adds a line under a stage; `onPick(id)` makes stages filters. */
export function pipelineStrip(counts, { active = null, subs = {}, href = null, compact = false } = {}) {
  const c = stageCounts(counts);
  return html`<div class="pipeline${compact ? ' compact' : ''}" role="${href ? 'navigation' : 'group'}" aria-label="Hiring pipeline">${raw(STAGES.map((st) => {
    const inner = `<span class="stage-label"><span class="dot" aria-hidden="true"></span>${st.label}</span><span class="stage-value">${fmtNum(c[st.id])}</span><span class="stage-sub">${subs[st.id] || '&nbsp;'}</span>`;
    return href
      ? `<a class="stage ${st.cls}" href="${href(st.id)}">${inner}</a>`
      : `<button type="button" class="stage ${st.cls}" data-stage="${st.id}" aria-pressed="${active === st.id}">${inner}</button>`;
  }).join(''))}</div>`;
}

export function statusBadge(status, extra = '') {
  const s = STATUS[status] || { label: status, tone: 'neutral' };
  return `<span class="badge ${s.tone}">${s.label}${extra}</span>`;
}

export function scoreCell(c) {
  if (c.score == null || !c.maxScore) return '<span class="muted">—</span>';
  const p = pct(c.score, c.maxScore);
  return `<div class="score"><b>${trimNum(c.score)}</b><span class="muted"> / ${trimNum(c.maxScore)}</span><span class="pct">${p}%</span><div class="scorebar"><i data-w="${p}"></i></div></div>`;
}
export const trimNum = (n) => (Math.round(Number(n) * 10) / 10).toString();

/** Apply data-w widths without inline styles (CSP-safe). */
export function applyWidths(root) {
  root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.w)))}%`; });
}

export function signalsCell(s) {
  const item = (n, ic, label, hotAt = 3) => {
    const cls = n >= hotAt ? 'hot' : n > 0 ? 'warm' : '';
    return `<span class="${cls}" data-tip="${label}: ${n}" aria-label="${label}: ${n}">${icon(ic, { size: 14 })}${n}</span>`;
  };
  return `<span class="signals">${item(s.tabSwitches, 'eye-off', 'Left the test')}${item(s.offline, 'wifi-off', 'Went offline', 4)}${item(s.pasteBlocked, 'copy', 'Copy/paste blocked')}${s.similar ? item(s.similar, 'scan-search', 'Similar answers', 1) : ''}</span>`;
}

export function timeTaken(c) {
  if (c.timeUsedSeconds == null) return '<span class="muted">—</span>';
  return `<span class="tabular">${fmtDuration(c.timeUsedSeconds)}</span>`;
}

export async function loadLookups(force = false) {
  const jobs = [];
  if (force || !state.colleges) jobs.push(get('/api/admin/colleges').then((r) => (state.colleges = r.colleges)));
  if (force || !state.drives) jobs.push(get('/api/admin/drives').then((r) => (state.drives = r.drives)));
  if (force || !state.settings) jobs.push(get('/api/admin/settings').then((r) => { state.settings = r.settings; state.integrations = r.integrations; }));
  await Promise.all(jobs);
}

export function collegeOptions(selected = '', { empty = 'No college' } = {}) {
  return [`<option value="">${empty}</option>`, ...(state.colleges || []).filter((c) => !c.archivedAt || c.id === selected).map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escape(c.name)}</option>`)].join('');
}
export function driveOptions(selected = '', { empty = 'No drive' } = {}) {
  return [`<option value="">${empty}</option>`, ...(state.drives || []).filter((d) => d.status !== 'closed' || d.id === selected).map((d) => `<option value="${d.id}" ${d.id === selected ? 'selected' : ''}>${escape(d.name)}${d.college ? ` · ${escape(d.college)}` : ''}</option>`)].join('');
}
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function emptyState({ ic = 'inbox', title, body = '', action = '' }) {
  return html`<div class="empty"><div class="empty-icon">${raw(icon(ic, { size: 22 }))}</div><h3>${title}</h3>${body ? html`<p>${body}</p>` : ''}${action}</div>`;
}

export function skeletonView() {
  return html`<div class="view-loading" aria-busy="true" aria-label="Loading"><span class="skeleton tall"></span><span class="skeleton wide"></span></div>`;
}

export const EVENT_LABEL = {
  login: ['Signed in', 'log-out', ''],
  login_failed: ['Sign-in failed (wrong code)', 'circle-x', 'warn'],
  login_blocked: ['Another sign-in was blocked while the test was running', 'shield-alert', 'bad'],
  rules_viewed: ['Read the rules', 'list-checks', ''],
  start: ['Started the test', 'play', 'good'],
  tab_hidden: ['Switched tab or minimised', 'eye-off', 'bad'],
  window_blur: ['Left the window', 'eye-off', 'bad'],
  fullscreen_exit: ['Left full screen', 'maximize', 'bad'],
  returned: ['Came back to the test', 'undo-2', 'warn'],
  offline: ['Lost connection', 'wifi-off', 'warn'],
  online: ['Reconnected', 'wifi', 'good'],
  reconnect_retry: ['Retried connection', 'refresh-cw', ''],
  paste_blocked: ['Paste blocked', 'copy', 'bad'],
  copy_blocked: ['Copy blocked', 'copy', 'warn'],
  save_failed: ['An answer failed to save', 'circle-alert', 'warn'],
  signal_weak: ['Weak connection', 'signal-low', 'warn'],
  device_unsupported: ['Device not supported', 'monitor', 'warn'],
  submit: ['Submitted', 'send', 'good'],
  admin_retake: ['Retake granted', 'rotate-ccw', ''],
  admin_resume: ['Resume granted', 'play', ''],
};

export const REASON_LABEL = {
  candidate: 'Submitted by candidate',
  time_up: 'Time ran out',
  deadline: 'Time ran out',
  left_screen: 'Left the test too long',
  reload: 'Page reloaded',
  admin: 'Submitted by admin',
  revoked: 'Access revoked',
  auto_close: 'Closed automatically',
};
