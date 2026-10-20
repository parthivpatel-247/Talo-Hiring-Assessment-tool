/* Settings: assessment & paper, sign-in & security, team, data & privacy, usage, integrations. */
import { $, $$, html, raw, setHtml, escapeHtml as esc } from '../../core/dom.js';
import { get, post, patch, del, download } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { openDialog, openMenu, toast, setLoading, showFieldError } from '../../core/ui.js';
import { fmtDateTime, fmtDate, fmtBytes, fmtNum, plural, fmtRelative } from '../../core/format.js';
import { state, isManager, loadLookups, emptyState, applyWidths } from '../shared.js';

const TABS = [
  ['assessment', 'Assessment'],
  ['security', 'Sign-in & security'],
  ['team', 'Team', true],
  ['data', 'Data & privacy'],
  ['usage', 'Usage'],
  ['integrations', 'Integrations'],
];
const CAT = { sql: 'SQL', coding: 'Coding', dsa: 'Data structures', scenario: 'Scenario' };

export async function render(ctx) {
  const tab = TABS.some(([k]) => k === ctx.rest[0]) ? ctx.rest[0] : 'assessment';
  ctx.setHeader({ title: 'Settings' });
  await loadLookups(true);
  setHtml(ctx.view, html`
    <div class="tabs" role="tablist" aria-label="Settings sections">${raw(TABS.filter(([, , mgr]) => !mgr || isManager()).map(([k, l]) => `<a class="tab" role="tab" href="#/settings/${k}" aria-selected="${k === tab}">${l}</a>`).join(''))}</div>
    <div id="tab-body" class="stack-6"></div>`);
  const body = $('#tab-body');
  const fns = { assessment, security, team, data, usage, integrations };
  return fns[tab](body, ctx);
}

const ro = () => (isManager() ? '' : 'disabled');
const readOnlyNote = () => (isManager() ? '' : html`<div class="alert info">${raw(icon('lock'))}<div>Only managers can change settings.</div></div>`);

async function save(patchBody, btn) {
  setLoading(btn, true);
  try {
    const r = await patch('/api/admin/settings', patchBody);
    state.settings = r.settings;
    toast('Settings saved. Changes reach every server within 30 seconds.', { type: 'success' });
    return true;
  } catch (err) {
    toast(err.message, { type: 'error', timeout: 7000 });
    return false;
  } finally {
    setLoading(btn, false);
  }
}

/* ---------------- assessment ---------------- */
async function assessment(body) {
  const s = state.settings;
  const pool = (await get('/api/admin/questions')).questions.filter((q) => q.active && !q.deletedAt);
  const avail = (cat, diff) => pool.filter((q) => q.category === cat && (diff === 'any' || q.difficulty === diff)).length;
  let slots = s.paper.map((p) => ({ category: p.category, difficulty: p.difficulty, count: p.count }));

  setHtml(body, html`
    ${readOnlyNote()}
    <section class="panel"><div class="panel-head"><h2>Test rules</h2></div>
      <div class="setting-row"><div><b>Length</b><p>Minutes on the clock for each candidate.</p></div><input class="input" id="s-min" type="number" min="5" max="240" value="${s.assessmentMinutes}" ${ro()}></div>
      <div class="setting-row"><div><b>Connection pause allowance</b><p>Extra minutes a test can stay open if the internet drops (the clock pauses while offline). After start + length + this allowance, the test closes regardless.</p></div><input class="input" id="s-pause" type="number" min="0" max="60" value="${s.pauseAllowanceMinutes}" ${ro()}></div>
      <div class="setting-row"><div><b>Word limit per answer</b></div><input class="input" id="s-words" type="number" min="100" max="3000" value="${s.wordLimit}" ${ro()}></div>
      <div class="setting-row"><div><b>Time allowed off the test</b><p>Seconds a candidate can be away (another tab, window or out of full screen) before the test is submitted.</p></div><input class="input" id="s-away" type="number" min="5" max="60" value="${s.awayGraceSeconds}" ${ro()}></div>
      <div class="setting-row"><div><b>Require full screen</b><p>Devices that can't go full screen (most phones) can't start. Turn off only for special cases.</p></div><label class="switch"><input type="checkbox" id="s-fs" ${s.requireFullscreenDevice ? 'checked' : ''} ${ro()} aria-label="Require full screen"></label></div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Paper</h2><span class="hint" id="paper-total"></span></div>
      <div class="panel-body stack"><p class="muted">What each candidate gets. Questions are drawn least-used first, so students sitting together get different papers.</p><div id="slots" class="stack"></div>${isManager() ? html`<div><button class="btn btn-secondary btn-sm" id="add-slot" type="button">${raw(icon('plus', { size: 16 }))} Add a slot</button></div>` : ''}</div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Organisation</h2></div>
      <div class="setting-row"><div><b>Organisation name</b><p>Shown to candidates and in emails.</p></div><input class="input" id="s-org" maxlength="80" value="${s.orgName}" ${ro()}></div>
      <div class="setting-row"><div><b>Help and privacy contact</b><p>Where candidates write for help or to exercise their data rights.</p></div><input class="input" id="s-contact" type="email" value="${s.contactEmail}" ${ro()}></div>
      <div class="setting-row"><div><b>Admin auto-refresh</b><p>Seconds between live updates on Overview and Candidates.</p></div><input class="input" id="s-refresh" type="number" min="15" max="600" value="${s.autoRefreshSeconds}" ${ro()}></div>
      ${isManager() ? html`<div class="panel-foot"><button class="btn btn-primary" id="save-a">Save changes</button></div>` : ''}
    </section>`);

  const drawSlots = () => {
    const total = slots.reduce((n, x) => n + Number(x.count || 0), 0);
    $('#paper-total').textContent = `${plural(total, 'question')} per paper`;
    setHtml($('#slots'), raw(slots.map((sl, i) => {
      const a = avail(sl.category, sl.difficulty);
      const low = a < sl.count * 3;
      return `<div class="slot-row" data-i="${i}">
        <select class="select" data-f="category" aria-label="Question type" ${ro()}>${Object.entries(CAT).map(([k, v]) => `<option value="${k}" ${k === sl.category ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select class="select" data-f="difficulty" aria-label="Difficulty" ${ro()}>${['any', 'easy', 'medium', 'hard'].map((d) => `<option value="${d}" ${d === sl.difficulty ? 'selected' : ''}>${d === 'any' ? 'Any difficulty' : d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select>
        <input class="input" type="number" min="0" max="10" data-f="count" value="${sl.count}" aria-label="Questions" ${ro()}>
        <div class="row"><span class="slot-pool${low ? ' low' : ''}">${a} in bank</span>${isManager() && slots.length > 1 ? `<button class="btn btn-ghost btn-icon btn-sm" data-rm="${i}" aria-label="Remove slot">${icon('x', { size: 14 })}</button>` : ''}</div>
      </div>`;
    }).join('')));
  };
  drawSlots();
  $('#slots').addEventListener('change', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    const sl = slots[Number(row.dataset.i)];
    sl[e.target.dataset.f] = e.target.dataset.f === 'count' ? Number(e.target.value) : e.target.value;
    drawSlots();
  });
  $('#slots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { slots.splice(Number(b.dataset.rm), 1); drawSlots(); }
  });
  $('#add-slot')?.addEventListener('click', () => { slots.push({ category: 'dsa', difficulty: 'any', count: 1 }); drawSlots(); });
  $('#save-a')?.addEventListener('click', async (e) => {
    const body2 = {
      assessmentMinutes: Number($('#s-min').value), pauseAllowanceMinutes: Number($('#s-pause').value), wordLimit: Number($('#s-words').value),
      awayGraceSeconds: Number($('#s-away').value), requireFullscreenDevice: $('#s-fs').checked, paper: slots.map((x) => ({ ...x, count: Number(x.count) })),
      orgName: $('#s-org').value.trim(), contactEmail: $('#s-contact').value.trim(), autoRefreshSeconds: Number($('#s-refresh').value),
    };
    const short = slots.filter((x) => avail(x.category, x.difficulty) < x.count);
    if (short.length) {
      const ok = await openDialog({ title: 'Not enough questions', icon: 'triangle-alert', tone: 'warning', confirmLabel: 'Save anyway', body: html`<p>Some slots ask for more questions than the bank has, so papers would come out short. Add questions first, or save anyway.</p>` });
      if (!ok) return;
    }
    await save(body2, e.currentTarget);
  });
}

/* ---------------- security ---------------- */
function security(body) {
  const s = state.settings;
  const emailOn = !!state.integrations?.email;
  setHtml(body, html`
    ${readOnlyNote()}
    <section class="panel"><div class="panel-head"><h2>How students sign in</h2></div>
      <div class="panel-body stack">
        <label class="check"><input type="radio" name="lm" value="code" ${s.loginMode === 'code' ? 'checked' : ''} ${ro()}> <span><b>Email + access code</b> (recommended)<br><span class="muted">The drive's hall code announced in the room, or a personal 6-digit code you emailed or printed. Once a student has a personal code, only that code works for them, so classmates who know the hall code can't sign in as them.</span></span></label>
        <label class="check"><input type="radio" name="lm" value="otp" ${s.loginMode === 'otp' ? 'checked' : ''} ${emailOn ? ro() : 'disabled'}> <span><b>Email + one-time code sent to the student</b>${emailOn ? '' : ' <span class="badge outline">Needs email</span>'}<br><span class="muted">Proves the student owns the inbox: only the emailed code is accepted (hall and personal codes are not). Needs reliable email delivery on the day.</span></span></label>
        <label class="check"><input type="radio" name="lm" value="email_only" ${s.loginMode === 'email_only' ? 'checked' : ''} ${ro()}> <span><b>Email only</b> <span class="badge danger">Not recommended</span><br><span class="muted">Anyone who knows a candidate's email can start their test.</span></span></label>
      </div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Admin sign-in</h2></div>
      <div class="setting-row"><div><b>Two-step sign-in</b><p>After the password, admins enter a 6-digit code sent to their email. ${emailOn ? '' : 'Takes effect once email delivery is set up.'}</p></div><label class="switch"><input type="checkbox" id="s-2fa" ${s.admin2fa === 'email' ? 'checked' : ''} ${ro()} aria-label="Two-step sign-in"></label></div>
      <div class="setting-row"><div><b>Lockout</b><p>5 wrong passwords lock an account for 15 minutes. A manager can unlock it from Team.</p></div><span class="badge success">Always on</span></div>
      <div class="setting-row"><div><b>Password rules</b><p>At least 12 characters, not a common password, not containing the email. Stored as salted PBKDF2 hashes.</p></div><span class="badge success">Always on</span></div>
      <div class="setting-row"><div><b>Bot protection</b><p>Cloudflare Turnstile on sign-in forms. Rate limits apply either way.</p></div><span class="badge ${state.integrations?.turnstile ? 'success' : 'outline'}">${state.integrations?.turnstile ? 'On' : 'Not configured'}</span></div>
      ${isManager() ? html`<div class="panel-foot"><button class="btn btn-primary" id="save-s">Save changes</button></div>` : ''}
    </section>`);
  $('#save-s')?.addEventListener('click', async (e) => {
    const lm = body.querySelector('input[name="lm"]:checked')?.value || 'code';
    if (lm === 'email_only') {
      const ok = await openDialog({ title: 'Allow email-only sign-in?', icon: 'triangle-alert', danger: true, confirmLabel: 'Allow', body: html`<p>Anyone who knows or guesses a candidate's email could start and submit their test.</p>` });
      if (!ok) return;
    }
    await save({ loginMode: lm, admin2fa: $('#s-2fa').checked ? 'email' : 'off' }, e.currentTarget);
  });
}

/* ---------------- team ---------------- */
async function team(body) {
  if (!isManager()) { setHtml(body, emptyState({ ic: 'lock', title: 'Managers only' })); return; }
  const draw = async () => {
    const r = await get('/api/admin/members');
    setHtml(body, html`
      <section class="panel">
        <div class="panel-head"><h2>Team</h2><span class="hint">Managers can change settings, upload, delete and manage the team. Panel members can review, grade, shortlist and export.</span><span class="spacer"></span><button class="btn btn-primary btn-sm" id="invite">${raw(icon('user-plus', { size: 16 }))} Add someone</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead><tbody>${raw(r.members.map((m) => {
          const locked = m.lockedUntil && Date.parse(m.lockedUntil) > Date.now();
          const st = !m.active ? '<span class="badge outline">Deactivated</span>' : locked ? '<span class="badge danger">Locked</span>' : !m.hasPassword ? '<span class="badge warning">Invite pending</span>' : m.mustChangePassword ? '<span class="badge warning">Temporary password</span>' : '<span class="badge success">Active</span>';
          return `<tr><td><div class="cell-primary">${esc(m.name)}${m.id === state.me.id ? ' <span class="badge outline">You</span>' : ''}</div><div class="cell-secondary">${esc(m.email)}</div></td><td>${m.role === 'manager' ? 'Manager' : 'Panel member'}</td><td>${st}</td><td class="cell-secondary">${m.lastLoginAt ? fmtRelative(m.lastLoginAt) : 'Never'}</td><td class="actions">${m.id === state.me.id ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-m="${m.id}" aria-label="Actions for ${esc(m.name)}">${icon('ellipsis', { size: 16 })}</button>`}</td></tr>`;
        }).join(''))}</tbody></table></div>
      </section>`);
    $('#invite').addEventListener('click', () => invite(r.emailEnabled));
    body.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      const m = r.members.find((x) => x.id === b.dataset.m);
      const locked = m.lockedUntil && Date.parse(m.lockedUntil) > Date.now();
      openMenu(b, [
        { label: m.role === 'manager' ? 'Make panel member' : 'Make manager', icon: 'shield-check', onClick: () => change(m, { role: m.role === 'manager' ? 'member' : 'manager' }, 'Role updated.') },
        { label: 'Set a temporary password', icon: 'key-round', onClick: () => tempPassword(m) },
        ...(locked ? [{ label: 'Unlock', icon: 'lock', onClick: () => change(m, { unlock: true }, 'Account unlocked.') }] : []),
        { label: m.active ? 'Deactivate' : 'Reactivate', icon: m.active ? 'user-round-x' : 'user-round-check', onClick: () => change(m, { active: !m.active }, m.active ? 'Deactivated and signed out.' : 'Reactivated.') },
        { divider: true },
        { label: 'Remove from team', icon: 'trash-2', danger: true, onClick: () => removeMember(m) },
      ]);
    }));
  };
  const change = async (m, b, msg) => { try { await patch(`/api/admin/members/${m.id}`, b); toast(msg, { type: 'success' }); draw(); } catch (err) { toast(err.message, { type: 'error' }); } };
  const tempPassword = async (m) => {
    const ok = await openDialog({ title: `Temporary password for ${m.name}`, icon: 'key-round', form: true, confirmLabel: 'Set password', body: html`<p>They are signed out everywhere and must choose a new password at their next sign-in. Share it with them privately.</p><div class="field"><label for="tp">Temporary password</label><input class="input" id="tp" name="pw" minlength="12" required autocomplete="new-password"></div>`, onConfirm: (v) => patch(`/api/admin/members/${m.id}`, { temporaryPassword: v.pw }) });
    if (ok) toast('Temporary password set.', { type: 'success' });
    draw();
  };
  const removeMember = async (m) => {
    const ok = await openDialog({ title: `Remove ${m.name}?`, icon: 'trash-2', danger: true, confirmLabel: 'Remove', body: html`<p>Their account and sessions are deleted. The activity log keeps a record of what they did.</p>`, onConfirm: () => del(`/api/admin/members/${m.id}`) });
    if (ok) { toast('Removed.', { type: 'success' }); draw(); }
  };
  const invite = async (emailEnabled) => {
    const r = await openDialog({
      title: 'Add a team member', icon: 'user-plus', form: true, confirmLabel: emailEnabled ? 'Send invite' : 'Add',
      body: html`
        <div class="field"><label for="iv-name">Name</label><input class="input" id="iv-name" name="name" required minlength="2" maxlength="80"></div>
        <div class="field"><label for="iv-email">Work email</label><input class="input" id="iv-email" name="email" type="email" required></div>
        <div class="field"><label for="iv-role">Role</label><select class="select" id="iv-role" name="role"><option value="member">Panel member</option><option value="manager">Manager</option></select></div>
        <div class="field"><label for="iv-pw">Temporary password${emailEnabled ? ' (optional)' : ''}</label><input class="input" id="iv-pw" name="temporaryPassword" minlength="12" autocomplete="new-password" ${emailEnabled ? '' : 'required'}><span class="hint">${emailEnabled ? 'Leave empty to email them an invite link (valid 72 hours) that verifies their address.' : 'Email is not set up, so share this password privately. They choose their own at first sign-in.'}</span></div>`,
      onConfirm: (v) => post('/api/admin/members', { name: v.name.trim(), email: v.email.trim(), role: v.role, temporaryPassword: v.temporaryPassword || undefined }),
    });
    if (r) { toast(r.message, { type: r.invited === false && emailEnabled && !r.message.includes('temporary') ? 'warning' : 'success', timeout: 7000 }); draw(); }
  };
  await draw();
}

/* ---------------- data & privacy ---------------- */
async function data(body) {
  const s = state.settings;
  const mgr = isManager();
  const [bk, dr, er, td] = await Promise.all([
    get('/api/admin/system/backups'),
    get('/api/admin/system/data-requests'),
    get('/api/admin/system/errors'),
    mgr ? get('/api/admin/system/test-data') : Promise.resolve({ candidates: [] }),
  ]);
  setHtml(body, html`
    <section class="panel"><div class="panel-head"><h2>Retention</h2></div>
      <div class="setting-row"><div><b>Keep candidate data for</b><p>Resumes, answers, scores, exports and backups are deleted automatically this many days after they are created (checked daily at 03:00 UTC).</p></div><div class="row"><input class="input" id="s-ret" type="number" min="7" max="365" value="${s.retentionDays}" ${ro()}><span class="muted">days</span></div></div>
      ${mgr ? html`<div class="panel-foot"><button class="btn btn-primary btn-sm" id="save-ret">Save</button></div>` : ''}
    </section>

    <section class="panel"><div class="panel-head"><h2>Backups</h2><span class="hint">A full snapshot is taken every day. Deletions always take a restorable backup first.</span><span class="spacer"></span>${mgr ? html`<button class="btn btn-secondary btn-sm" id="bk-new">${raw(icon('database', { size: 16 }))} Back up now</button>` : ''}</div>
      ${bk.backups.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Kind</th><th>What</th><th class="num">Candidates</th><th class="num">Size</th><th>Expires</th><th class="actions"></th></tr></thead><tbody>${raw(bk.backups.map((b) => `<tr><td class="nowrap">${fmtDateTime(b.createdAt)}<div class="cell-secondary">${esc((b.createdBy || '').split('@')[0])}</div></td><td><span class="badge ${b.kind === 'pre_delete' ? 'warning' : 'neutral'}">${{ pre_delete: 'Before delete', daily: 'Daily', manual: 'Manual', pre_migration: 'Before upgrade' }[b.kind] || b.kind}</span>${b.restoredAt ? ' <span class="badge success">Restored</span>' : ''}</td><td class="cell-secondary">${esc(b.summary || '')}</td><td class="num">${b.candidates ?? '—'}</td><td class="num">${fmtBytes(b.bytes || 0)}</td><td class="cell-secondary nowrap">${b.expiresAt ? fmtDate(b.expiresAt) : '—'}</td><td class="actions">${mgr ? `<button class="btn btn-ghost btn-icon btn-sm" data-bk="${b.id}" aria-label="Backup actions">${icon('ellipsis', { size: 16 })}</button>` : ''}</td></tr>`).join(''))}</tbody></table></div>` : emptyState({ ic: 'database', title: 'No backups yet', body: 'The first daily backup runs tonight.' })}
      <div class="panel-body"><p class="cell-secondary">The whole database can also be restored to an earlier point with Cloudflare D1 Time Travel (7 days back on the Workers Free plan, 30 days on Paid). See the runbook.</p></div>
    </section>

    <section class="panel"><div class="panel-head"><h2>Privacy requests</h2><span class="hint">From the form on the privacy page: access, correction, deletion or questions.</span></div>
      ${dr.requests.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Received</th><th>From</th><th>Request</th><th>Message</th><th>Status</th><th class="actions"></th></tr></thead><tbody>${raw(dr.requests.map((q) => `<tr><td class="nowrap">${fmtDateTime(q.createdAt)}</td><td>${esc(q.email)}</td><td>${esc({ access: 'Copy of my data', deletion: 'Delete my data', correction: 'Correct my data' }[q.kind] || q.kind)}</td><td class="cell-secondary">${esc(q.message || '')}</td><td><span class="badge ${q.status === 'open' ? 'warning' : q.status === 'done' ? 'success' : 'outline'}">${q.status}</span>${q.resolvedBy ? `<div class="cell-secondary">${esc(q.resolvedBy.split('@')[0])}</div>` : ''}</td><td class="actions">${mgr ? `<button class="btn btn-ghost btn-icon btn-sm" data-dr="${q.id}" aria-label="Update request">${icon('ellipsis', { size: 16 })}</button>` : ''}</td></tr>`).join(''))}</tbody></table></div>` : emptyState({ ic: 'inbox', title: 'No privacy requests' })}
      <div class="panel-body"><p class="cell-secondary">Respond within 30 days. For a deletion request, find the candidate in Candidates, delete them, then mark the request done.</p></div>
    </section>

    ${mgr ? html`<section class="panel"><div class="panel-head"><h2>Test data</h2><span class="hint">Records marked as test, or with example/test emails (example.com, test.local, load…, e2e…).</span><span class="spacer"></span>${td.candidates.length ? html`<button class="btn btn-danger btn-sm" id="td-del">${raw(icon('trash-2', { size: 16 }))} Delete ${td.candidates.length}</button>` : ''}</div>
      ${td.candidates.length ? html`<ul class="list result-list">${raw(td.candidates.slice(0, 200).map((c) => `<li><span class="grow truncate"><b>${esc(c.name || 'Unnamed')}</b> <span class="muted">${esc(c.email || 'no email')}</span></span>${c.markedTest ? '<span class="badge outline">Marked</span>' : '<span class="badge outline">Email pattern</span>'}</li>`).join(''))}</ul>` : html`<div class="panel-body"><p class="muted">No test records found.</p></div>`}
    </section>` : ''}

    <section class="panel"><div class="panel-head"><h2>Browser errors</h2><span class="hint">Script errors from candidate and admin pages (no personal data), kept 30 days.</span><span class="spacer"></span>${mgr && er.errors.length ? html`<button class="btn btn-secondary btn-sm" id="er-clear">Clear</button>` : ''}</div>
      ${er.errors.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Last seen</th><th>Where</th><th>Error</th><th class="num">Count</th></tr></thead><tbody>${raw(er.errors.map((x) => `<tr><td class="nowrap">${fmtRelative(x.lastAt)}</td><td>${esc(x.surface)}<div class="cell-secondary mono">${esc(x.url || '')}</div></td><td><div>${esc(x.message)}</div><div class="cell-secondary mono truncate">${esc(x.source || '')}</div></td><td class="num">${x.count}</td></tr>`).join(''))}</tbody></table></div>` : emptyState({ ic: 'bug', title: 'No errors reported' })}
    </section>

    ${mgr ? html`<section class="panel danger-zone"><div class="panel-head"><h2>Delete all candidates</h2></div>
      <div class="panel-body stack"><p>For a new hiring season: removes every candidate with their resume, answers, scores, activity and all exports. Questions, drives, colleges, settings and the team stay. A full snapshot and restorable deletion backups are taken first and kept for ${s.retentionDays} days.</p><div><button class="btn btn-danger" id="wipe">${raw(icon('trash-2', { size: 16 }))} Delete all candidates…</button></div></div>
    </section>` : ''}`);

  $('#save-ret')?.addEventListener('click', (e) => save({ retentionDays: Number($('#s-ret').value) }, e.currentTarget));
  $('#bk-new')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    setLoading(b, true);
    try { await post('/api/admin/system/backups', {}, { timeoutMs: 90000 }); toast('Backup created.', { type: 'success' }); data(body); } catch (err) { toast(err.message, { type: 'error' }); setLoading(b, false); }
  });
  body.querySelectorAll('[data-bk]').forEach((b) => b.addEventListener('click', () => {
    const x = bk.backups.find((y) => y.id === b.dataset.bk);
    openMenu(b, [
      { label: 'Download (JSON)', icon: 'download', onClick: () => download(`/api/admin/system/backups/${x.id}/download`, `talo-backup-${x.id}.json`).catch((err) => toast(err.message, { type: 'error' })) },
      ...(x.kind === 'pre_delete' && !x.restoredAt ? [{ label: 'Restore these candidates', icon: 'archive-restore', onClick: () => restore(x) }] : []),
    ]);
  }));
  const restore = async (x) => {
    const ok = await openDialog({ title: 'Restore deleted candidates?', icon: 'archive-restore', confirmLabel: 'Restore', body: html`<p>${x.summary}</p><p class="muted">Candidates come back with their resume, answers, scores and activity. Restoring fails if a candidate with the same email was added since.</p>`, onConfirm: () => post(`/api/admin/system/backups/${x.id}/restore`, {}, { timeoutMs: 90000 }) });
    if (ok) { toast(ok.message, { type: 'success' }); data(body); }
  };
  body.querySelectorAll('[data-dr]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.dr;
    const setSt = async (status) => { try { await patch(`/api/admin/system/data-requests/${id}`, { status }); toast('Request updated.', { type: 'success' }); data(body); } catch (err) { toast(err.message, { type: 'error' }); } };
    openMenu(b, [{ label: 'Mark done', icon: 'check', onClick: () => setSt('done') }, { label: 'Mark rejected', icon: 'x', onClick: () => setSt('rejected') }, { label: 'Reopen', icon: 'undo-2', onClick: () => setSt('open') }]);
  }));
  $('#td-del')?.addEventListener('click', async () => {
    const ok = await openDialog({ title: `Delete ${plural(td.candidates.length, 'test record')}?`, icon: 'trash-2', danger: true, requireText: 'DELETE TEST DATA', confirmLabel: 'Delete', body: html`<p>Only records that are marked as test or have a test email are deleted. A restorable backup is kept for ${s.retentionDays} days.</p>`, onConfirm: () => post('/api/admin/system/test-data/delete', { confirm: 'DELETE TEST DATA', ids: td.candidates.map((c) => c.id) }, { timeoutMs: 120000 }) });
    if (ok) { toast(`Deleted ${ok.deleted}.`, { type: 'success' }); data(body); }
  });
  $('#er-clear')?.addEventListener('click', async () => { await del('/api/admin/system/errors'); toast('Cleared.', { type: 'success' }); data(body); });
  $('#wipe')?.addEventListener('click', () => wipe(body));
}

async function wipe(body) {
  const total = (await get('/api/admin/candidates')).candidates.length;
  if (!total) return toast('There are no candidates to delete.', { type: 'info' });
  const ok = await openDialog({
    title: `Delete all ${total} candidates?`, icon: 'trash-2', danger: true, requireText: 'DELETE ALL CANDIDATES', confirmLabel: 'Delete everything',
    body: html`<p>This can't be undone from here after ${state.settings.retentionDays} days. Until then, each deletion batch can be restored from Backups.</p><ul><li>Download an export first if you still need the results.</li><li>Candidates taking a test right now are listed before anything is deleted.</li></ul>`,
  });
  if (!ok) return;
  let force = false;
  let step = 0;
  let deleted = 0;
  const done = toast('Deleting…', { timeout: 0 });
  try {
    for (let i = 0; i < 400; i++) {
      let r;
      try {
        r = await post('/api/admin/system/wipe', { confirm: 'DELETE ALL CANDIDATES', step, force }, { timeoutMs: 120000 });
      } catch (err) {
        if (err.code === 'tests_running' && !force) {
          const go = await openDialog({ title: err.message, icon: 'triangle-alert', danger: true, confirmLabel: 'Delete anyway', body: html`<p>Their tests end and their answers are deleted with everything else.</p>` });
          if (!go) return;
          force = true;
          continue;
        }
        throw err;
      }
      step++;
      deleted += r.deleted;
      if (!r.remaining) break;
    }
    toast(`Deleted ${plural(deleted, 'candidate')}. Backups are in the list below.`, { type: 'success', timeout: 8000 });
  } catch (err) {
    toast(err.message, { type: 'error' });
  } finally {
    done();
    data(body);
  }
}

/* ---------------- usage ---------------- */
async function usage(body, ctx) {
  const day = ctx.query.get('day') || '';
  const r = await get(`/api/admin/system/usage${day ? `?day=${day}` : ''}`);
  const days = [...r.days].reverse();
  const max = Math.max(1, ...days.map((d) => Number(d.rowsRead)));
  const today = days[days.length - 1];
  const sum = (k) => days.reduce((a, d) => a + Number(d[k] || 0), 0);
  const events = {};
  for (const a of r.analytics) events[a.event] = (events[a.event] || 0) + Number(a.count);
  setHtml(body, html`
    <section class="panel"><div class="panel-head"><h2>Database reads, last ${days.length} days</h2><span class="hint">${r.limits.note}</span></div>
      <div class="metric-row"><div class="metric"><b>${fmtNum(sum('requests'))}</b><span>API requests</span></div><div class="metric"><b>${fmtNum(sum('rowsRead'))}</b><span>rows read</span></div><div class="metric"><b>${fmtNum(sum('rowsWritten'))}</b><span>rows written</span></div></div>
      ${days.length ? html`<div class="bars" role="img" aria-label="Rows read per day">${raw(days.map((d) => `<a class="bar" href="#/settings/usage?day=${d.day}" data-h="${Math.max(2, (Number(d.rowsRead) / max) * 100)}" data-tip="${d.day}: ${fmtNum(d.rowsRead)} rows read" aria-label="${d.day}: ${fmtNum(d.rowsRead)} rows read"></a>`).join(''))}</div><div class="bars-axis"><span>${days[0]?.day || ''}</span><span>${today?.day || ''}</span></div>` : emptyState({ ic: 'chart-column', title: 'No usage recorded yet' })}
    </section>
    <section class="panel"><div class="panel-head"><h2>By route on ${r.day}</h2><span class="hint">Where the reads come from. Counted from D1's own metadata on every query.</span></div>
      ${r.routes.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Route</th><th class="num">Requests</th><th class="num">Rows read</th><th class="num">Rows written</th><th class="num">Reads per request</th></tr></thead><tbody>${raw(r.routes.map((x) => `<tr><td class="mono">${esc(x.route)}</td><td class="num">${fmtNum(x.requests)}</td><td class="num">${fmtNum(x.rowsRead)}</td><td class="num">${fmtNum(x.rowsWritten)}</td><td class="num">${x.requests ? fmtNum(Math.round(x.rowsRead / x.requests)) : '—'}</td></tr>`).join(''))}</tbody></table></div>` : emptyState({ ic: 'activity', title: 'No requests that day' })}
    </section>
    <section class="panel"><div class="panel-head"><h2>Page views and events, last 14 days</h2><span class="hint">First-party counts with no cookies or personal data.</span></div>
      ${Object.keys(events).length ? html`<ul class="list">${raw(Object.entries(events).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li><span class="grow">${esc(k.replace(/_/g, ' '))}</span><b class="tabular">${fmtNum(v)}</b></li>`).join(''))}</ul>` : emptyState({ ic: 'chart-column', title: 'No events yet' })}
    </section>`);
  body.querySelectorAll('[data-h]').forEach((b) => { b.style.height = `${b.dataset.h}%`; });
}

/* ---------------- integrations ---------------- */
function integrations(body) {
  const i = state.integrations || {};
  const row = (ok, title, detail, cmd) => html`<div class="setting-row"><div><b>${title}</b><p>${detail}</p>${cmd ? html`<p class="mono">${cmd}</p>` : ''}</div><span class="badge ${ok ? 'success' : 'outline'}">${ok ? 'Connected' : 'Not set up'}</span></div>`;
  setHtml(body, html`
    <section class="panel"><div class="panel-head"><h2>Integrations</h2><span class="hint">Secrets are set by whoever deploys Talo, in their own terminal. They are never shown or entered here.</span></div>
      ${row(!!i.email, 'Email delivery', i.email ? `Sending through ${i.email.provider} as ${i.email.from}. Used for admin sign-in codes, invites, password resets and student codes.` : 'Set EMAIL_PROVIDER ("resend" or "sendgrid") and EMAIL_FROM in wrangler.toml, then the API key as a secret.', i.email ? '' : 'npx wrangler secret put EMAIL_API_KEY')}
      ${row(!!i.turnstile, 'Cloudflare Turnstile', 'Bot protection on the sign-in, reset and code request forms.', i.turnstile ? '' : 'Set TURNSTILE_SITE_KEY in wrangler.toml, then: npx wrangler secret put TURNSTILE_SECRET')}
      ${row(!!i.ai, 'AI (resume reading, grading, rubrics)', i.ai ? `Model: ${i.model}. Resume text and written answers are sent to OpenAI for this; nothing else.` : 'Resume reading and grading need an OpenAI API key.', i.ai ? '' : 'npx wrangler secret put OPENAI_API_KEY')}
    </section>`);
}
