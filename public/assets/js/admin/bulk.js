/* Bulk actions on candidates, with a confirmation for every one and a result summary. */
import { html, raw, $, escapeHtml as esc } from '../core/dom.js';
import { post } from '../core/api.js';
import { icon } from '../core/icons.js';
import { openDialog, toast } from '../core/ui.js';
import { plural } from '../core/format.js';
import { state, isManager, driveOptions, collegeOptions, loadLookups } from './shared.js';

export const LIMITS = { delete: 10, grade: 10 };

export const ACTIONS = {
  grade: { label: 'Grade now', icon: 'sparkles', member: true },
  shortlist: { label: 'Shortlist', icon: 'user-round-check', member: true },
  reject: { label: 'Reject', icon: 'user-round-x', member: true },
  send_invites: { label: 'Email invite + code', icon: 'mail' },
  generate_codes: { label: 'Generate personal codes', icon: 'key-round' },
  retake: { label: 'Give a retake', icon: 'rotate-ccw' },
  resume: { label: 'Resume test', icon: 'play' },
  move_drive: { label: 'Move to drive', icon: 'calendar-days' },
  set_college: { label: 'Set college', icon: 'building-2' },
  force_submit: { label: 'Submit for them', icon: 'send' },
  revoke: { label: 'Revoke access', icon: 'lock' },
  restore_access: { label: 'Restore access', icon: 'undo-2' },
  mark_test: { label: 'Mark as test record', icon: 'flag' },
  unmark_test: { label: 'Not a test record', icon: 'flag' },
  delete: { label: 'Delete', icon: 'trash-2', danger: true },
};

export const allowed = (action) => isManager() || ACTIONS[action]?.member;

const nameList = (cands) => {
  const names = cands.slice(0, 8).map((c) => c.name || c.email || 'Unnamed');
  return names.join(', ') + (cands.length > 8 ? ` and ${cands.length - 8} more` : '');
};

/** Run a bulk action on `cands` (array of candidate summaries). Resolves true if anything changed. */
export async function runBulk(action, cands) {
  if (!cands.length) return false;
  if (!allowed(action)) { toast('Only a manager can do this.', { type: 'error' }); return false; }
  const n = cands.length;
  const ids = cands.map((c) => c.id);
  const limit = LIMITS[action];
  if (limit && n > limit) {
    await openDialog({ title: `Select at most ${limit}`, icon: 'info', hideCancel: true, confirmLabel: 'OK', body: html`<p>${ACTIONS[action].label} works on up to ${limit} candidates at a time, so a mistake can't touch the whole list. You selected ${n}.</p>${action === 'grade' ? html`<p>To grade everyone who has submitted, use <a href="#/results">Grading &amp; exports</a>.</p>` : ''}` });
    return false;
  }
  const who = html`<p class="muted">${nameList(cands)}</p>`;
  const body = { action, ids };
  let opts = null;
  switch (action) {
    case 'grade':
      opts = { title: `Grade ${plural(n, 'candidate')} now?`, icon: 'sparkles', confirmLabel: 'Grade now', body: html`<p>Each submitted paper is graded against the question rubric. Already-graded papers are graded again with the latest rubric.</p>${who}` };
      break;
    case 'shortlist':
      opts = { title: `Shortlist ${plural(n, 'candidate')}?`, icon: 'user-round-check', tone: 'accent', confirmLabel: 'Shortlist', body: html`<p>They move to the interview stage.${n <= 10 ? ' Interview questions are prepared from their resume and answers.' : ''}</p>${who}` };
      break;
    case 'reject':
      opts = { title: `Reject ${plural(n, 'candidate')}?`, icon: 'user-round-x', tone: 'warning', confirmLabel: 'Reject', body: html`<p>You can change this later. Candidates are not notified.</p>${who}` };
      break;
    case 'retake':
      opts = { title: `Give ${plural(n, 'candidate')} a retake?`, icon: 'rotate-ccw', tone: 'warning', confirmLabel: 'Give retake', body: html`<p>Each gets a <b>new paper</b> with different questions and a full clock. Their current answers, score and interview questions are cleared. Use <b>Resume test</b> instead to continue the same paper.</p>${who}` };
      break;
    case 'resume':
      opts = {
        title: `Resume ${plural(n, 'test')}?`, icon: 'play', confirmLabel: 'Resume', form: true,
        body: html`<p>Same questions and saved answers. They sign in again to continue.</p>
          <div class="stack"><label class="check"><input type="radio" name="mode" value="remaining" checked> <span><b>Time they had left</b> (at least 5 minutes)</span></label>
          <label class="check"><input type="radio" name="mode" value="full"> <span><b>A full ${state.settings?.assessmentMinutes ?? ''}-minute clock</b></span></label></div>${who}`,
      };
      break;
    case 'send_invites':
      if (!state.integrations?.email) {
        await openDialog({ title: 'Email is not set up', icon: 'mail', hideCancel: true, confirmLabel: 'OK', body: html`<p>Add an email provider (see Settings → Integrations) to email invites. Until then, use <b>Generate personal codes</b> and print the slips, or share the drive's hall code.</p>` });
        return false;
      }
      opts = { title: `Email ${plural(n, 'invite')}?`, icon: 'mail', confirmLabel: 'Send invites', body: html`<p>Each candidate gets the assessment link and a <b>new personal 6-digit code</b> (any earlier personal code stops working). The drive's hall code keeps working too.</p>${who}` };
      break;
    case 'generate_codes':
      opts = { title: `Generate ${plural(n, 'personal code')}?`, icon: 'key-round', confirmLabel: 'Generate', body: html`<p>Each candidate gets a new 6-digit code (earlier personal codes stop working). The codes are shown <b>once</b> so you can print slips; only a fingerprint is stored.</p>${who}` };
      break;
    case 'move_drive':
      await loadLookups();
      opts = { title: `Move ${plural(n, 'candidate')} to a drive`, icon: 'calendar-days', confirmLabel: 'Move', form: true, body: html`<div class="field"><label for="bulk-drive">Drive</label><select class="select" id="bulk-drive" name="driveId">${raw(driveOptions('', { empty: 'No drive' }))}</select><span class="hint">The college is set from the drive.</span></div>${who}` };
      break;
    case 'set_college':
      await loadLookups();
      opts = { title: `Set the college for ${plural(n, 'candidate')}`, icon: 'building-2', confirmLabel: 'Save', form: true, body: html`<div class="field"><label for="bulk-college">College</label><select class="select" id="bulk-college" name="collegeId">${raw(collegeOptions('', { empty: 'No college' }))}</select></div>${who}` };
      break;
    case 'force_submit':
      opts = { title: `Submit ${plural(n, 'test')} now?`, icon: 'send', tone: 'warning', confirmLabel: 'Submit', body: html`<p>Their saved answers are submitted and the test closes. Only candidates who are in progress are affected.</p>${who}` };
      break;
    case 'revoke':
      opts = { title: `Revoke access for ${plural(n, 'candidate')}?`, icon: 'lock', danger: true, confirmLabel: 'Revoke access', body: html`<p>They are signed out and can't sign in. A running test is submitted.</p>${who}` };
      break;
    case 'restore_access':
      opts = { title: `Restore access for ${plural(n, 'candidate')}?`, icon: 'undo-2', confirmLabel: 'Restore', body: who };
      break;
    case 'mark_test':
      opts = { title: `Mark ${plural(n, 'record')} as test data?`, icon: 'flag', confirmLabel: 'Mark as test', body: html`<p>Test records are left out of counts and exports, and can be removed in Settings → Data.</p>${who}` };
      break;
    case 'unmark_test':
      opts = { title: `Mark ${plural(n, 'record')} as real candidates?`, icon: 'flag', confirmLabel: 'Confirm', body: who };
      break;
    case 'delete': {
      const days = state.settings?.retentionDays ?? 15;
      body.confirm = `DELETE ${n}`;
      opts = {
        title: `Delete ${plural(n, 'candidate')}?`, icon: 'trash-2', danger: true, confirmLabel: 'Delete', requireText: `DELETE ${n}`,
        body: html`<p>This removes their resume, answers, scores and activity. A <b>backup is kept for ${days} days</b>; you can restore it from Settings → Data until then.</p>${who}`,
      };
      break;
    }
    default:
      return false;
  }
  const result = await openDialog({
    ...opts,
    onConfirm: async (values) => {
      if (action === 'resume') body.mode = values.mode || 'remaining';
      if (action === 'move_drive') body.driveId = values.driveId || null;
      if (action === 'set_college') body.collegeId = values.collegeId || null;
      return post('/api/admin/candidates/bulk', body, { timeoutMs: action === 'grade' ? 120000 : action === 'send_invites' ? 90000 : 30000 });
    },
  });
  if (!result) return false;
  await showResult(action, result, cands);
  return true;
}

async function showResult(action, r, cands) {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const failed = (r.results || []).filter((x) => !x.ok);
  const ok = (r.results || []).filter((x) => x.ok).length;
  if (action === 'generate_codes' && r.codes?.length) return showCodes(r.codes, failed, byId);
  if (!failed.length) {
    toast(r.message || `${ACTIONS[action].label}: done for ${plural(ok, 'candidate')}.`, { type: 'success' });
    return;
  }
  await openDialog({
    title: `${ok} done, ${failed.length} not done`,
    icon: 'circle-alert',
    tone: 'warning',
    hideCancel: true,
    confirmLabel: 'OK',
    body: html`<ul class="list result-list">${raw(failed.map((f) => `<li><b>${esc(byId.get(f.id)?.name || byId.get(f.id)?.email || f.id)}</b>&nbsp;<span class="muted">${esc(f.error || 'Failed')}</span></li>`).join(''))}</ul>`,
  });
}

function showCodes(codes, failed, byId) {
  const drives = new Map((state.drives || []).map((d) => [d.id, d]));
  const origin = location.origin;
  const rows = codes.map((c) => {
    const cand = byId.get(c.id);
    const d = cand?.driveId ? drives.get(cand.driveId) : null;
    return { ...c, drive: d?.name || '', date: d?.scheduledOn || '' };
  });
  // Neutralise spreadsheet formulas (names come from resumes): prefix =, +, -, @ with an apostrophe.
  const cell = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
  const csv = ['Name,Email,Code', ...rows.map((r) => [r.name || '', r.email, r.code].map(cell).join(','))].join('\n');
  const dlg = openDialog({
    title: `${codes.length} personal codes`,
    icon: 'key-round',
    wide: true,
    cancelLabel: 'Close',
    confirmLabel: 'Print slips',
    body: html`
      <div class="alert warning">${raw(icon('triangle-alert'))}<div>These codes are shown <b>only now</b>. Print the slips or copy the list before closing.</div></div>
      ${failed.length ? html`<div class="alert danger">${raw(icon('circle-alert'))}<div>${failed.length} skipped: ${failed.map((f) => byId.get(f.id)?.name || f.id).join(', ')} (no email yet).</div></div>` : ''}
      <div class="table-wrap result-list"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Code</th></tr></thead><tbody>${raw(rows.map((r) => `<tr><td>${esc(r.name || '—')}</td><td>${esc(r.email)}</td><td><span class="code-chip">${r.code}</span></td></tr>`).join(''))}</tbody></table></div>
      <button type="button" class="btn btn-secondary btn-sm" id="copy-codes">${raw(icon('copy', { size: 16 }))} Copy as CSV</button>`,
    onConfirm: () => {
      printSlips(rows, origin);
      return false; // keep the dialog open
    },
  });
  $('#copy-codes')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(csv);
      toast('Copied.', { type: 'success' });
    } catch (_) {
      toast('Copy failed. Select the table and copy it instead.', { type: 'error' });
    }
  });
  return dlg.then(() => document.querySelector('.slips')?.remove());
}

function printSlips(rows, origin) {
  document.querySelector('.slips')?.remove();
  const org = state.settings?.orgName || 'Hevo Data';
  const div = document.createElement('div');
  div.className = 'slips';
  div.innerHTML = rows.map((r) => `<div class="slip"><h4>${esc(org)} campus assessment</h4><p><b>${esc(r.name || '')}</b></p><p>${esc(r.email)}</p><p>Go to <b>${esc(origin)}</b>, enter your email and this code:</p><p class="code-chip">${r.code}</p>${r.drive ? `<p>${esc(r.drive)}${r.date ? ` · ${esc(r.date)}` : ''}</p>` : ''}</div>`).join('');
  document.body.appendChild(div);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
