/* Activity log: every admin action, who did it, when and from where. */
import { $, html, raw, setHtml, escapeHtml as esc } from '../../core/dom.js';
import { get } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { fmtDateTime } from '../../core/format.js';
import { emptyState } from '../shared.js';

const GROUPS = {
  '': 'All actions',
  login: 'Sign-ins', login_failed: 'Failed sign-ins', account_locked: 'Account locks', settings_updated: 'Settings changes',
  candidates_deleted: 'Deletions', candidate_updated: 'Candidate edits', bulk_shortlist: 'Shortlists', bulk_reject: 'Rejections',
  bulk_retake: 'Retakes', bulk_resume: 'Resumes', export_created: 'Exports', export_downloaded: 'Export downloads', resume_viewed: 'Resume views',
  backup_restored: 'Backup restores', member_updated: 'Team changes', drive_code_rotated: 'Hall code changes', question_updated: 'Question edits',
};

export async function render(ctx) {
  ctx.setHeader({ title: 'Activity log' });
  const f = { action: '', actor: '' };
  let events = [];
  let next = null;
  setHtml(ctx.view, html`
    <p class="page-intro">An append-only record of admin actions, kept for 400 days. It records what changed, not candidates' personal details. Candidate test activity is on each candidate's timeline.</p>
    <section class="panel" aria-label="Activity">
      <div class="toolbar">
        <label class="sr-only" for="f-action">Action</label><select class="select" id="f-action">${raw(Object.entries(GROUPS).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''))}</select>
        <div class="input-group">${raw(icon('user-round-check', { size: 16 }))}<input class="input" id="f-actor" type="search" placeholder="Filter by exact email" aria-label="Filter by email"></div>
      </div>
      <div class="table-wrap" id="log"></div>
      <div class="table-foot" id="log-foot" hidden><button class="btn btn-secondary btn-sm" id="more">Load older</button></div>
    </section>`);

  const fmtDetail = (d) => {
    if (d == null || d === '') return '';
    if (typeof d === 'string') return d;
    const parts = Object.entries(d).slice(0, 6).map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} item(s)` : typeof v === 'object' && v ? JSON.stringify(v).slice(0, 80) : String(v)}`);
    return parts.join(' · ');
  };
  const draw = () => {
    setHtml($('#log'), events.length ? raw(`<table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead><tbody>${events.map((e) => `<tr><td class="nowrap cell-secondary">${fmtDateTime(e.at)}</td><td><div class="truncate">${esc(e.actor || 'system')}</div>${e.role ? `<div class="cell-secondary">${esc(e.role)}</div>` : ''}</td><td><span class="badge ${/fail|lock|delete/.test(e.action) ? 'danger' : 'neutral'}">${esc(e.action.replace(/_/g, ' '))}</span></td><td class="cell-secondary">${esc(e.targetType || '')}${e.targetId ? ` <span class="mono">${esc(String(e.targetId).slice(0, 18))}</span>` : ''}</td><td class="cell-secondary">${esc(fmtDetail(e.detail)).slice(0, 220)}</td><td class="cell-secondary mono">${esc(e.ip || '')}</td></tr>`).join('')}</tbody></table>`)
      : emptyState({ ic: 'history', title: 'Nothing here yet' }));
    $('#log-foot').hidden = !next;
  };
  const load = async (append = false) => {
    const p = new URLSearchParams({ limit: '100' });
    if (f.action) p.set('action', f.action);
    if (f.actor) p.set('actor', f.actor);
    if (append && next) p.set('before', String(next));
    const r = await get(`/api/admin/system/audit?${p}`);
    events = append ? events.concat(r.events) : r.events;
    next = r.nextBefore;
    draw();
  };
  $('#f-action').addEventListener('change', (e) => { f.action = e.target.value; load(); });
  $('#f-actor').addEventListener('change', (e) => { f.actor = e.target.value.trim().toLowerCase(); load(); });
  $('#more').addEventListener('click', () => load(true));
  await load();
}
