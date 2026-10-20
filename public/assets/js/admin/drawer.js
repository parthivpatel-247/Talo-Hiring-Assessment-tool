/* Candidate detail drawer: summary, answers with grading, activity timeline, interview prep, resume. */
import { $, $$, html, raw, setHtml, escapeHtml as esc } from '../core/dom.js';
import { get, post, patch } from '../core/api.js';
import { icon } from '../core/icons.js';
import { openDialog, openMenu, toast, setLoading, showFieldError } from '../core/ui.js';
import { fmtDateTime, fmtDuration, fmtTime, fmtDate, plural } from '../core/format.js';
import { renderRich, questionTitle } from '../core/markdown.js';
import { state, isManager, statusBadge, scoreCell, applyWidths, collegeOptions, driveOptions, loadLookups, EVENT_LABEL, REASON_LABEL, trimNum } from './shared.js';
import { ACTIONS, allowed, runBulk } from './bulk.js';

const CAT = { sql: 'SQL', coding: 'Coding', dsa: 'Data structures', scenario: 'Scenario' };
const LANG = { sql: 'SQL', python: 'Python', java: 'Java', cpp: 'C++', c: 'C', javascript: 'JavaScript', csharp: 'C#', go: 'Go', pseudocode: 'Pseudocode', text: 'Plain text' };

let el = null;
let opts = {};
let data = null;
let tab = 'summary';
let lastFocus = null;

export function closeCandidate() {
  if (!el) return;
  el.backdrop.remove();
  el.drawer.remove();
  document.removeEventListener('keydown', onKey);
  el = null;
  opts.onClose?.();
  lastFocus?.focus?.();
}

function onKey(e) {
  if (e.key === 'Escape' && !document.querySelector('dialog[open]') && !document.querySelector('.menu')) closeCandidate();
}

export async function openCandidate(id, o = {}) {
  if (el) { el.backdrop.remove(); el.drawer.remove(); document.removeEventListener('keydown', onKey); }
  opts = o;
  tab = 'summary';
  lastFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-labelledby', 'dr-name');
  drawer.tabIndex = -1;
  setHtml(drawer, html`<div class="drawer-head"><div class="dr-title"><h2 id="dr-name"><span class="skeleton" ></span></h2></div><button class="btn btn-ghost btn-icon" data-close aria-label="Close">${raw(icon('x'))}</button></div><div class="drawer-body"><div class="dr-section"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div></div>`);
  document.body.append(backdrop, drawer);
  el = { backdrop, drawer, id };
  backdrop.addEventListener('click', closeCandidate);
  drawer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeCandidate(); });
  document.addEventListener('keydown', onKey);
  drawer.focus();
  await load();
}

async function load() {
  if (!el) return;
  const id = el.id;
  try {
    data = await get(`/api/admin/candidates/${encodeURIComponent(id)}`);
  } catch (err) {
    if (!el) return;
    setHtml(el.drawer.querySelector('.drawer-body'), html`<div class="dr-section"><div class="alert danger">${raw(icon('circle-alert'))}<div>${err.message}</div></div></div>`);
    return;
  }
  if (!el || el.id !== id) return;
  draw();
}

function draw() {
  const c = data.candidate;
  const d = el.drawer;
  const tabs = [
    ['summary', 'Summary'],
    ['answers', `Answers${data.paper.length ? ` (${data.paper.length})` : ''}`],
    ['activity', 'Activity'],
    ['interview', `Interview${data.interview.length ? ` (${data.interview.length})` : ''}`],
    ['resume', 'Resume'],
  ];
  setHtml(d, html`
    <div class="drawer-head">
      <span class="avatar">${(c.name || c.email || '?').slice(0, 1).toUpperCase()}</span>
      <div class="dr-title"><h2 id="dr-name" class="truncate">${c.name || 'Name missing'}</h2><span class="truncate">${c.email || 'Email missing'}${c.college ? ` · ${c.college}` : ''}</span></div>
      ${raw(statusBadge(c.status))}
      ${isManager() || allowed('shortlist') ? html`<button class="btn btn-secondary btn-sm" id="dr-actions" aria-haspopup="menu">${raw(icon('ellipsis', { size: 16 }))} Actions</button>` : ''}
      <button class="btn btn-ghost btn-icon" data-close aria-label="Close">${raw(icon('x'))}</button>
    </div>
    <div class="drawer-body">
      <div class="tabs dr-tabs" role="tablist">${raw(tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join(''))}</div>
      <div id="dr-panel" role="tabpanel"></div>
    </div>`);
  $$('[data-tab]', d).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  $('#dr-actions', d)?.addEventListener('click', (e) => actionsMenu(e.currentTarget));
  const panel = $('#dr-panel', d);
  ({ summary, answers, activity, interview, resume })[tab](panel, c);
  applyWidths(panel);
}

function actionsMenu(anchor) {
  const c = data.candidate;
  const items = [];
  if (isManager()) {
    items.push({ label: 'Fix details', icon: 'square-pen', onClick: fixDetails });
    if (c.hasResume) items.push({ label: 'Re-read resume', icon: 'refresh-cw', onClick: reparse });
    items.push({ divider: true });
  }
  for (const a of ['grade', 'shortlist', 'reject', 'resume', 'retake', 'send_invites', 'generate_codes', 'move_drive', 'set_college', 'force_submit', 'revoke', 'restore_access', c.isTest ? 'unmark_test' : 'mark_test', 'delete']) {
    if (!allowed(a)) continue;
    if (a === 'restore_access' && !c.accessRevoked) continue;
    if (a === 'revoke' && c.accessRevoked) continue;
    if (a === 'force_submit' && c.status !== 'in_progress') continue;
    if (a === 'delete') items.push({ divider: true });
    items.push({ label: ACTIONS[a].label, icon: ACTIONS[a].icon, danger: a === 'delete' || a === 'revoke', onClick: () => bulk(a) });
  }
  openMenu(anchor, items);
}

async function bulk(action) {
  const changed = await runBulk(action, [data.candidate]);
  if (!changed) return;
  opts.onChange?.();
  if (action === 'delete') return closeCandidate();
  await load();
}

/* ---------------- summary ---------------- */
function summary(panel, c) {
  const s = c.signals;
  const warn = c.parseError || c.parseWarnings;
  const facts = html`<div class="facts-grid">
    <div><span>Score</span><b>${raw(c.score != null ? `${trimNum(c.score)} <span class="muted">/ ${trimNum(c.maxScore)}</span>` : '—')}</b></div>
    <div><span>Answered</span><b>${c.questionCount ? `${c.answered} / ${c.questionCount}` : '—'}</b></div>
    <div><span>Time taken</span><b>${c.timeUsedSeconds != null ? fmtDuration(c.timeUsedSeconds) : '—'}</b></div>
    <div><span>Attempt</span><b>#${c.attemptNo}</b></div>
  </div>`;
  const idRow = (label, val) => html`<dt>${label}</dt><dd>${val || raw('<span class="muted">—</span>')}</dd>`;
  setHtml(panel, html`
    <div class="dr-section">
      ${warn ? html`<div class="alert ${c.parseError ? 'danger' : 'warning'}">${raw(icon('triangle-alert'))}<div><strong>${c.parseError ? 'Details needed.' : 'Check these details.'}</strong> ${c.parseError || c.parseWarnings}${isManager() ? html` <button class="link-btn" id="fix-inline">Fix details</button>` : ''}</div></div>` : ''}
      ${c.accessRevoked ? html`<div class="alert danger">${raw(icon('lock'))}<div>Access is revoked: this candidate can't sign in.</div></div>` : ''}
      ${facts}
      <div class="grid-2">
        <div>
          <h3 class="section-title">Profile</h3>
          <dl class="kv">
            ${idRow('Email', c.email)}${idRow('Phone', c.phone)}${idRow('College', c.college)}${idRow('From resume', c.resumeCollege)}
            ${idRow('Degree', c.degree)}${idRow('Graduates', c.graduationYear)}${idRow('Drive', c.drive)}
            ${idRow('Access', c.hasPersonalCode ? `Personal code set${c.inviteSentAt ? ` · invite emailed ${fmtDate(c.inviteSentAt)}` : ''}` : 'Drive hall code')}
          </dl>
        </div>
        <div>
          <h3 class="section-title">Test</h3>
          <dl class="kv">
            ${idRow('Started', c.startedAt ? fmtDateTime(c.startedAt) : '')}${idRow('Submitted', c.submittedAt ? fmtDateTime(c.submittedAt) : '')}
            ${idRow('Ended because', c.submitReason ? REASON_LABEL[c.submitReason] || c.submitReason : '')}
            ${idRow('Sign-ins', `${s.logins}${s.blockedLogins ? ` · ${s.blockedLogins} blocked second device` : ''}`)}
            ${idRow('Left the test', plural(s.tabSwitches, 'time'))}
            ${idRow('Offline', s.offline ? `${plural(s.offline, 'time')} · ${fmtDuration(s.offlineSeconds)} total` : 'Never')}
            ${idRow('Copy/paste blocked', plural(s.pasteBlocked, 'time'))}
            ${idRow('Similar answers', s.similar ? plural(s.similar, 'match', 'matches') : 'None found')}
          </dl>
        </div>
      </div>
      ${data.similar.length ? html`<div><h3 class="section-title">Similar answers</h3><ul class="list">${raw(data.similar.map((x) => `<li><span class="badge danger">${Math.round(x.score * 100)}%</span><div class="grow"><div class="cell-primary truncate">${esc(x.title || 'Question')}</div><div class="cell-secondary truncate">with ${esc(x.other_name || x.other_email)}</div></div><button class="btn btn-ghost btn-sm" data-open="${x.other_id}">Open</button></li>`).join(''))}</ul></div>` : ''}
      ${c.skills?.length ? html`<div><h3 class="section-title">Skills from resume</h3><div class="tags">${raw(c.skills.slice(0, 40).map((k) => `<span class="badge neutral">${esc(k)}</span>`).join(''))}</div></div>` : ''}
      ${c.projects?.length ? html`<div><h3 class="section-title">Projects</h3><ul class="list">${raw(c.projects.slice(0, 8).map((p) => `<li><div class="grow"><div class="cell-primary">${esc(p.name || p.title || 'Project')}</div>${p.description || p.summary ? `<div class="cell-secondary">${esc(p.description || p.summary)}</div>` : ''}</div></li>`).join(''))}</ul></div>` : ''}
      <div>
        <h3 class="section-title">Notes for the panel</h3>
        ${isManager() ? html`<textarea class="textarea" id="notes" rows="3" maxlength="2000" placeholder="Visible to the hiring team only">${c.notes || ''}</textarea><div class="row"><button class="btn btn-secondary btn-sm" id="save-notes">Save notes</button></div>` : html`<p>${c.notes || raw('<span class="muted">No notes.</span>')}</p>`}
      </div>
    </div>`);
  $('#fix-inline', panel)?.addEventListener('click', () => fixDetails());
  $$('[data-open]', panel).forEach((b) => b.addEventListener('click', () => {
    const qs = location.hash.split('?')[1];
    history.replaceState(null, '', `#/candidates/${b.dataset.open}${qs ? `?${qs}` : ''}`);
    openCandidate(b.dataset.open, opts);
  }));
  $('#save-notes', panel)?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    setLoading(b, true);
    try {
      await patch(`/api/admin/candidates/${c.id}`, { notes: $('#notes', panel).value });
      toast('Notes saved.', { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setLoading(b, false);
    }
  });
}

/* ---------------- answers ---------------- */
function answers(panel) {
  if (!data.paper.length) {
    setHtml(panel, html`<div class="dr-section"><div class="empty"><div class="empty-icon">${raw(icon('file-text', { size: 22 }))}</div><h3>No paper yet</h3><p>Questions are assigned when the candidate opens the rules page.</p></div></div>`);
    return;
  }
  setHtml(panel, html`<div class="dr-section">${raw(data.paper.map((p, i) => {
    const title = questionTitle({ title: p.title, prompt: p.prompt });
    const graded = p.score != null;
    const max = p.max_marks ?? p.marks;
    const lang = p.language ? LANG[p.language] || p.language : null;
    const prose = p.language === 'text' || p.category === 'scenario' && !p.language;
    const ded = Array.isArray(p.deductions) ? p.deductions : [];
    return `<article class="answer-card">
      <header><span class="badge outline">Q${i + 1}</span><h3>${esc(title)}</h3><span class="badge neutral">${CAT[p.category] || p.category}</span>${p.difficulty ? `<span class="badge outline">${esc(p.difficulty)}</span>` : ''}${graded ? `<span class="badge ${p.score >= max * 0.7 ? 'success' : p.score >= max * 0.4 ? 'warning' : 'danger'}">${trimNum(p.score)} / ${trimNum(max)}</span>` : `<span class="badge outline">${trimNum(p.marks)} marks</span>`}</header>
      <div class="ac-body">
        <details><summary>Question</summary><div class="q-body">${renderRich(p.prompt, { skipTitle: true })}</div>${p.sample_data ? `<div class="q-body">${renderRich(p.sample_data)}</div>` : ''}</details>
        <div><div class="row"><span class="section-title">Answer</span>${lang ? `<span class="badge neutral">${esc(lang)}</span>` : ''}${p.word_count != null ? `<span class="cell-secondary">${plural(p.word_count, 'word')}${p.saved_at ? ` · saved ${fmtTime(p.saved_at)}` : ''}${p.revision > 1 ? ` · ${p.revision} saves` : ''}</span>` : ''}</div>
          ${p.answer_text ? `<pre class="answer-text${prose ? ' prose' : ''}">${esc(p.answer_text)}</pre>` : '<p class="answer-empty">Not answered.</p>'}</div>
        ${graded ? `<div><span class="section-title">Grader's reasoning</span><p>${esc(p.reasoning || '—')}</p>${ded.length ? `<ul class="deductions">${ded.map((x) => `<li>−${trimNum(x.marks)}: ${esc(x.reason)}</li>`).join('')}</ul>` : ''}</div>` : ''}
        ${p.reference_answer || p.expected_output || p.rubric || p.checkpoints ? `<details><summary>Answer key and rubric</summary><div class="stack">${p.reference_answer ? `<div><span class="section-title">Reference answer</span><pre class="answer-text">${esc(p.reference_answer)}</pre></div>` : ''}${p.expected_output ? `<div><span class="section-title">Expected output</span><pre class="answer-text">${esc(p.expected_output)}</pre></div>` : ''}${p.rubric ? `<div><span class="section-title">Rubric</span><pre class="answer-text prose">${esc(p.rubric)}</pre></div>` : ''}${p.checkpoints ? `<div><span class="section-title">Checkpoints</span><pre class="answer-text prose">${esc(p.checkpoints)}</pre></div>` : ''}</div></details>` : ''}
      </div>
    </article>`;
  }).join(''))}</div>`);
}

/* ---------------- activity ---------------- */
function activity(panel) {
  const evs = data.events.map((e) => ({ at: e.at, kind: 'event', type: e.type, detail: e.detail, attempt: e.attempt_no }));
  const aud = data.audit.map((a) => ({ at: a.at, kind: 'audit', type: a.action, actor: a.actor_email, detail: typeof a.detail === 'string' ? safeParse(a.detail) : a.detail }));
  const all = [...evs, ...aud].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!all.length) {
    setHtml(panel, html`<div class="dr-section"><div class="empty"><div class="empty-icon">${raw(icon('history', { size: 22 }))}</div><h3>No activity yet</h3></div></div>`);
    return;
  }
  let lastDay = '';
  const items = all.map((x) => {
    const day = String(x.at).slice(0, 10);
    const dayHead = day !== lastDay ? `<li><span></span><span></span><span class="section-title">${fmtDate(x.at)}</span></li>` : '';
    lastDay = day;
    if (x.kind === 'audit') {
      return `${dayHead}<li><span class="t-time">${fmtTime(x.at)}</span><span class="t-ic">${icon('user-round-check', { size: 12 })}</span><span class="t-text"><b>${esc((x.actor || 'system').split('@')[0])}</b> <span>${esc(x.type.replace(/_/g, ' '))}</span></span></li>`;
    }
    const [label, ic, tone] = EVENT_LABEL[x.type] || [x.type.replace(/_/g, ' '), 'activity', ''];
    const det = x.detail || {};
    const bits = [];
    if (det.seconds != null) bits.push(x.type === 'online' ? `offline ${fmtDuration(det.seconds)}` : x.type === 'admin_resume' ? `${Math.round(det.seconds / 60)} min on the clock` : `away ${fmtDuration(det.seconds)}`);
    if (det.retries != null) bits.push(plural(det.retries, 'retry', 'retries'));
    if (det.questionIndex) bits.push(`on Q${det.questionIndex}`);
    if (det.chars) bits.push(plural(det.chars, 'character'));
    if (det.rttMs) bits.push(`${det.rttMs} ms round trip`);
    if (det.reason && x.type === 'submit') bits.push(REASON_LABEL[det.reason] || det.reason);
    if (det.by) bits.push(`by ${String(det.by).split('@')[0]}`);
    return `${dayHead}<li><span class="t-time">${fmtTime(x.at)}</span><span class="t-ic ${tone}">${icon(ic, { size: 12 })}</span><span class="t-text"><b>${esc(label)}</b>${bits.length ? ` <span>· ${esc(bits.join(' · '))}</span>` : ''}${x.attempt > 1 ? ` <span class="badge outline">attempt ${x.attempt}</span>` : ''}</span></li>`;
  });
  setHtml(panel, html`<div class="dr-section"><ol class="timeline">${raw(items.join(''))}</ol></div>`);
}
const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/* ---------------- interview ---------------- */
function interview(panel, c) {
  const can = ['graded', 'shortlisted', 'rejected', 'submitted'].includes(c.status);
  setHtml(panel, html`<div class="dr-section">
    <div class="row"><p class="muted">Questions for the face-to-face round, based on the resume and how they answered.</p><span class="spacer"></span>
      <button class="btn btn-secondary btn-sm" id="gen-iq" ${can ? '' : 'disabled'}>${raw(icon('sparkles', { size: 16 }))} ${data.interview.length ? 'Regenerate' : 'Generate'}</button></div>
    ${!can ? html`<div class="alert info">${raw(icon('info'))}<div>Available once the candidate has submitted.</div></div>` : ''}
    ${data.interview.length ? raw(data.interview.map((q, i) => `<div class="iq"><span class="iq-meta">Question ${i + 1}${q.based_on ? ` · based on ${esc(q.based_on)}` : ''}</span><b>${esc(q.question)}</b>${q.follow_up ? `<p><b>Follow-up:</b> ${esc(q.follow_up)}</p>` : ''}${q.model_answer ? `<details><summary class="cell-secondary">What a strong answer covers</summary><p>${esc(q.model_answer)}</p></details>` : ''}</div>`).join('')) : can ? html`<div class="empty"><p>No interview questions yet.</p></div>` : ''}
  </div>`);
  $('#gen-iq', panel)?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    setLoading(b, true);
    try {
      const r = await post(`/api/admin/candidates/${c.id}/interview`, {}, { timeoutMs: 90000 });
      toast(`${plural(r.count, 'question')} ready.`, { type: 'success' });
      await load();
    } catch (err) {
      toast(err.message, { type: 'error' });
      setLoading(b, false);
    }
  });
}

/* ---------------- resume ---------------- */
function resume(panel, c) {
  if (!c.hasResume) {
    setHtml(panel, html`<div class="dr-section"><div class="empty"><div class="empty-icon">${raw(icon('file-text', { size: 22 }))}</div><h3>No resume on file</h3></div></div>`);
    return;
  }
  const url = `/api/admin/candidates/${encodeURIComponent(c.id)}/resume`;
  setHtml(panel, html`<div class="dr-section"><div class="row"><span class="cell-secondary truncate">${c.resumeFilename || 'resume.pdf'}</span><span class="spacer"></span><a class="btn btn-secondary btn-sm" href="${url}" target="_blank" rel="noopener">${raw(icon('external-link', { size: 16 }))} Open in a new tab</a></div><iframe class="resume-frame" src="${url}" title="Resume of ${c.name || 'candidate'}"></iframe></div>`);
}

/* ---------------- fix details & re-read ---------------- */
async function fixDetails(prefill = null) {
  await loadLookups();
  const c = data.candidate;
  const v = { name: c.name || '', email: c.email || '', phone: c.phone || '', ...(prefill || {}) };
  const saved = await openDialog({
    title: 'Fix candidate details',
    icon: 'square-pen',
    confirmLabel: 'Save details',
    form: true,
    wide: true,
    body: html`
      <p>Use exactly what is on the resume. Saving a name and email marks the candidate ready to take the test.</p>
      ${c.parseError || c.parseWarnings ? html`<div class="alert warning">${raw(icon('triangle-alert'))}<div>${c.parseError || c.parseWarnings}</div></div>` : ''}
      <div class="form-grid">
        <div class="field"><label for="fx-name">Full name</label><input class="input" id="fx-name" name="name" required minlength="2" maxlength="120" value="${v.name}" autocomplete="off"></div>
        <div class="field"><label for="fx-email">Email</label><input class="input" id="fx-email" name="email" type="email" required maxlength="254" value="${v.email}" autocomplete="off"><span class="hint">Students sign in with this address.</span></div>
        <div class="field"><label for="fx-phone">Phone</label><input class="input" id="fx-phone" name="phone" maxlength="40" value="${v.phone}" autocomplete="off"></div>
        <div class="field"><label for="fx-college">College</label><select class="select" id="fx-college" name="collegeId">${raw(collegeOptions(c.collegeId || ''))}</select>${c.resumeCollege ? html`<span class="hint">Resume says: ${c.resumeCollege}</span>` : ''}</div>
        <div class="field full"><label for="fx-drive">Drive</label><select class="select" id="fx-drive" name="driveId">${raw(driveOptions(c.driveId || ''))}</select></div>
      </div>
      ${c.hasResume ? html`<p class="cell-secondary"><a href="/api/admin/candidates/${c.id}/resume" target="_blank" rel="noopener">Open the resume</a> to check.</p>` : ''}`,
    onConfirm: async (vals, dlg) => {
      const body = { name: vals.name.trim(), email: vals.email.trim(), phone: vals.phone.trim(), collegeId: vals.collegeId || null, driveId: vals.driveId || null, confirmIdentity: true };
      try {
        return await patch(`/api/admin/candidates/${c.id}`, body);
      } catch (err) {
        if (err.code === 'email_in_use') throw new Error(`${err.message} Check for a duplicate resume.`);
        throw err;
      }
    },
  });
  if (saved) {
    toast('Details saved.', { type: 'success' });
    opts.onChange?.();
    await load();
  }
}

async function reparse() {
  const c = data.candidate;
  let r;
  const wait = toast('Reading the resume again…', { timeout: 20000 });
  try {
    r = await post(`/api/admin/candidates/${c.id}/reparse`, {}, { timeoutMs: 60000 });
  } catch (err) {
    wait();
    return toast(err.message, { type: 'error' });
  }
  wait();
  if (!r.ok || !r.proposal) {
    await openDialog({ title: "Couldn't read this resume", icon: 'circle-alert', tone: 'warning', confirmLabel: 'Enter details by hand', body: html`<p>${r.error || 'No details were found.'}</p>` }).then((ok) => ok && fixDetails());
    return;
  }
  const p = r.proposal;
  const row = (label, cur, next, key) => {
    const diff = cur && next && String(cur).toLowerCase() !== String(next).toLowerCase();
    return `<tr><td>${label}</td><td>${cur ? esc(cur) : '<span class="muted">—</span>'}</td><td>${next ? `<b>${esc(next)}</b>` : '<span class="muted">Not found</span>'}${diff ? ' <span class="badge warning">Different</span>' : ''}</td></tr>`;
  };
  const choice = await openDialog({
    title: 'Details from the resume',
    icon: 'refresh-cw',
    wide: true,
    confirmLabel: 'Review and save',
    cancelLabel: 'Keep current details',
    body: html`
      <p>Nothing has changed yet. Skills, projects and education were refreshed; name and email change only if you save.</p>
      ${r.warnings?.length ? html`<div class="alert warning">${raw(icon('triangle-alert'))}<div>${r.warnings.join(' ')}</div></div>` : ''}
      <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Current</th><th>On the resume</th></tr></thead><tbody>${raw(
        row('Name', r.current.name, p.name) + row('Email', r.current.email, p.email) + row('Phone', c.phone, p.phone) + row('College', c.resumeCollege, p.college) + row('Degree', c.degree, p.degree) + row('Graduates', c.graduationYear, p.graduationYear)
      )}</tbody></table></div>
      ${r.emailsFound?.length > 1 ? html`<p class="cell-secondary">Emails found on the resume: ${r.emailsFound.join(', ')}</p>` : ''}`,
  });
  opts.onChange?.();
  if (choice) await fixDetails({ name: p.name || c.name || '', email: p.email || c.email || '', phone: p.phone || c.phone || '' });
  else await load();
}
