/* Drives (a college visit on a date, with a hall code) and the colleges list. */
import { $, $$, html, raw, setHtml, escapeHtml as esc } from '../../core/dom.js';
import { get, post, patch, del } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { openDialog, openMenu, toast } from '../../core/ui.js';
import { fmtDate, plural } from '../../core/format.js';
import { state, isManager, loadLookups, collegeOptions, emptyState } from '../shared.js';

const STATUS = { scheduled: ['Scheduled', 'neutral'], live: ['Live', 'success'], closed: ['Closed', 'outline'] };

export async function render(ctx) {
  ctx.setHeader({
    title: 'Drives & colleges',
    actions: isManager() ? html`<button class="btn btn-secondary btn-sm" id="new-college">${raw(icon('building-2', { size: 16 }))} Add college</button><button class="btn btn-primary btn-sm" id="new-drive">${raw(icon('plus', { size: 16 }))} New drive</button>` : '',
  });
  const revealed = new Set();

  const draw = async () => {
    await loadLookups(true);
    const drives = state.drives;
    const colleges = state.colleges;
    setHtml(ctx.view, html`
      <p class="page-intro">A drive is one campus visit: a college, a date and a <b>hall code</b> that the invigilator announces. Students sign in with the email on their resume and that code (or a personal code you emailed them). Set the drive to <b>Live</b> on the day: until then students can sign in but cannot start or see any question. Set it to <b>Closed</b> afterwards to stop sign-ins with the hall code. Candidates with a personal code must use that code; the hall code no longer works for them.</p>
      <section class="panel" aria-labelledby="dr-h">
        <div class="panel-head"><h2 id="dr-h">Drives</h2><span class="hint">${plural(drives.length, 'drive')}</span></div>
        ${drives.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Drive</th><th>Date</th><th>Status</th><th>Hall code</th><th class="num">Candidates</th><th class="num">Submitted</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${raw(drives.map((d) => {
            const [label, tone] = STATUS[d.status] || [d.status, 'neutral'];
            const code = d.accessCode ? (revealed.has(d.id) ? `<span class="code-chip">${esc(d.accessCode)}</span>` : '<span class="code-chip">••••••</span>') : '<span class="muted">None</span>';
            return `<tr>
              <td><div class="cell-primary">${esc(d.name)}</div><div class="cell-secondary">${esc(d.college || 'No college')}</div></td>
              <td class="nowrap">${d.scheduledOn ? fmtDate(d.scheduledOn) : '<span class="muted">No date</span>'}</td>
              <td><span class="badge ${tone}">${label}</span>${d.codeRequired ? '' : ' <span class="badge warning" title="Students can sign in with email only">No code</span>'}</td>
              <td class="nowrap">${code} ${d.accessCode ? `<button class="btn btn-ghost btn-icon btn-sm" data-reveal="${d.id}" aria-label="${revealed.has(d.id) ? 'Hide' : 'Show'} code">${icon(revealed.has(d.id) ? 'eye-off' : 'eye', { size: 16 })}</button><button class="btn btn-ghost btn-icon btn-sm" data-copy="${d.id}" aria-label="Copy code">${icon('copy', { size: 16 })}</button>` : ''}</td>
              <td class="num"><a href="#/candidates?drive=${d.id}">${d.candidates}</a></td>
              <td class="num">${d.submitted}</td>
              <td class="actions"><button class="btn btn-ghost btn-icon btn-sm" data-menu="${d.id}" aria-label="Actions for ${esc(d.name)}">${icon('ellipsis', { size: 16 })}</button></td>
            </tr>`;
          }).join(''))}</tbody></table></div>`
          : emptyState({ ic: 'calendar-days', title: 'No drives yet', body: 'Create one drive per campus visit. Each drive gets its own hall code.', action: isManager() ? html`<button class="btn btn-primary btn-sm" id="new-drive-2">${raw(icon('plus', { size: 16 }))} New drive</button>` : '' })}
      </section>
      <section class="panel" aria-labelledby="col-h">
        <div class="panel-head"><h2 id="col-h">Colleges</h2><span class="hint">Used for filters, exports and matching resumes to a college.</span></div>
        ${colleges.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>College</th><th>City</th><th class="num">Candidates</th><th class="num">Drives</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${raw(colleges.map((c) => `<tr>
            <td><span class="cell-primary">${esc(c.name)}</span>${c.archivedAt ? ' <span class="badge outline">Archived</span>' : ''}</td>
            <td>${esc(c.city || '—')}</td>
            <td class="num"><a href="#/candidates?college=${c.id}">${c.candidates}</a></td>
            <td class="num">${c.drives}</td>
            <td class="actions">${isManager() ? `<button class="btn btn-ghost btn-icon btn-sm" data-cmenu="${c.id}" aria-label="Actions for ${esc(c.name)}">${icon('ellipsis', { size: 16 })}</button>` : ''}</td>
          </tr>`).join(''))}</tbody></table></div>`
          : emptyState({ ic: 'building-2', title: 'No colleges yet', body: 'Add the colleges you visit. Resumes that mention a known college are matched to it automatically.' })}
      </section>`);
    $('#new-drive-2')?.addEventListener('click', () => driveDialog());
  };

  ctx.view.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.reveal) { revealed.has(t.dataset.reveal) ? revealed.delete(t.dataset.reveal) : revealed.add(t.dataset.reveal); return draw(); }
    if (t.dataset.copy) {
      const d = state.drives.find((x) => x.id === t.dataset.copy);
      try { await navigator.clipboard.writeText(d.accessCode); toast('Hall code copied.', { type: 'success' }); } catch (_) { toast('Copy failed.', { type: 'error' }); }
      return;
    }
    if (t.dataset.menu) {
      const d = state.drives.find((x) => x.id === t.dataset.menu);
      const items = [
        { label: 'Show code on projector', icon: 'monitor', onClick: () => present(d), disabled: !d.accessCode },
        { label: 'View candidates', icon: 'users', onClick: () => (location.hash = `#/candidates?drive=${d.id}`) },
      ];
      if (isManager()) {
        items.push({ divider: true });
        if (d.status !== 'live') items.push({ label: 'Set live (drive day)', icon: 'play', onClick: () => setStatus(d, 'live') });
        if (d.status !== 'closed') items.push({ label: 'Close drive', icon: 'lock', onClick: () => setStatus(d, 'closed') });
        if (d.status === 'closed') items.push({ label: 'Reopen as scheduled', icon: 'undo-2', onClick: () => setStatus(d, 'scheduled') });
        items.push({ label: 'Edit', icon: 'pencil', onClick: () => driveDialog(d) });
        items.push({ label: 'New hall code', icon: 'refresh-cw', onClick: () => rotate(d) });
        items.push({ divider: true }, { label: 'Delete drive', icon: 'trash-2', danger: true, onClick: () => removeDrive(d) });
      }
      return openMenu(t, items);
    }
    if (t.dataset.cmenu) {
      const c = state.colleges.find((x) => x.id === t.dataset.cmenu);
      return openMenu(t, [
        { label: 'Edit', icon: 'pencil', onClick: () => collegeDialog(c) },
        { label: c.archivedAt ? 'Unarchive' : 'Archive', icon: c.archivedAt ? 'archive-restore' : 'archive', onClick: async () => { await patch(`/api/admin/colleges/${c.id}`, { archived: !c.archivedAt }); toast(c.archivedAt ? 'College restored.' : 'College archived.', { type: 'success' }); draw(); } },
        { divider: true },
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => removeCollege(c) },
      ]);
    }
  });
  $('#new-drive')?.addEventListener('click', () => driveDialog());
  $('#new-college')?.addEventListener('click', () => collegeDialog());

  async function setStatus(d, status) {
    if (status === 'closed') {
      const ok = await openDialog({ title: `Close ${d.name}?`, icon: 'lock', tone: 'warning', confirmLabel: 'Close drive', body: html`<p>Students in this drive can no longer sign in with the hall code. Tests already running are not affected.</p>` });
      if (!ok) return;
    }
    try {
      await patch(`/api/admin/drives/${d.id}`, { status });
      toast(status === 'live' ? `${d.name} is live.` : status === 'closed' ? `${d.name} is closed.` : 'Drive reopened.', { type: 'success' });
      draw();
    } catch (err) { toast(err.message, { type: 'error' }); }
  }

  async function rotate(d) {
    const r = await openDialog({
      title: 'Issue a new hall code?', icon: 'refresh-cw', tone: 'warning', confirmLabel: 'New code',
      body: html`<p>The current code stops working at once. Students already signed in stay signed in. Announce the new code in the hall.</p>`,
      onConfirm: () => patch(`/api/admin/drives/${d.id}`, { rotateCode: true }),
    });
    if (r) { revealed.add(d.id); toast(`New code: ${r.accessCode}`, { type: 'success', timeout: 9000 }); draw(); }
  }

  async function removeDrive(d) {
    const ok = await openDialog({ title: `Delete ${d.name}?`, icon: 'trash-2', danger: true, confirmLabel: 'Delete drive', body: html`<p>Only empty drives can be deleted. Move or delete its candidates first, or close the drive instead.</p>`, onConfirm: () => del(`/api/admin/drives/${d.id}`) });
    if (ok) { toast('Drive deleted.', { type: 'success' }); draw(); }
  }

  async function removeCollege(c) {
    const ok = await openDialog({ title: `Delete ${c.name}?`, icon: 'trash-2', danger: true, confirmLabel: 'Delete', body: html`<p>Only colleges with no candidates can be deleted. Archive it to hide it from lists instead.</p>`, onConfirm: () => del(`/api/admin/colleges/${c.id}`) });
    if (ok) { toast('College deleted.', { type: 'success' }); draw(); }
  }

  async function driveDialog(d = null) {
    const r = await openDialog({
      title: d ? 'Edit drive' : 'New drive',
      icon: 'calendar-days',
      confirmLabel: d ? 'Save' : 'Create drive',
      form: true,
      body: html`
        <div class="field"><label for="dv-name">Drive name</label><input class="input" id="dv-name" name="name" required minlength="2" maxlength="120" value="${d?.name || ''}" placeholder="e.g. VIIT Pune · Data Engineer · Nov 2026"></div>
        <div class="field"><label for="dv-college">College</label><select class="select" id="dv-college" name="collegeId">${raw(collegeOptions(d?.collegeId || ''))}</select><span class="hint">Add a college first if it's not listed.</span></div>
        <div class="field"><label for="dv-date">Date</label><input class="input" id="dv-date" name="scheduledOn" type="date" value="${d?.scheduledOn || ''}"></div>
        <label class="check"><input type="checkbox" name="codeRequired" value="1" ${!d || d.codeRequired ? 'checked' : ''}> <span><b>Require the hall code</b><br><span class="muted">Recommended. Without it, anyone who knows a candidate's email could sign in as them.</span></span></label>`,
      onConfirm: (v) => {
        const body = { name: v.name.trim(), collegeId: v.collegeId || null, scheduledOn: v.scheduledOn || '', codeRequired: v.codeRequired === '1' };
        return d ? patch(`/api/admin/drives/${d.id}`, body) : post('/api/admin/drives', body);
      },
    });
    if (!r) return;
    if (!d && r.accessCode) {
      revealed.add(r.id);
      await openDialog({ title: 'Drive created', icon: 'circle-check', tone: 'accent', hideCancel: true, confirmLabel: 'Done', body: html`<p>The hall code for this drive is</p><p><span class="code-chip">${r.accessCode}</span></p><p class="muted">Announce it in the hall on the day, or use <b>Show code on projector</b>. You can issue a new code at any time.</p><div class="alert info">${raw(icon('play'))}<div>On the day, set the drive to <b>Live</b>. Students can sign in and read the rules earlier, but nobody can start (or see a question) until the drive is live.</div></div>` });
    } else toast('Drive saved.', { type: 'success' });
    draw();
  }

  async function collegeDialog(c = null) {
    const r = await openDialog({
      title: c ? 'Edit college' : 'Add college',
      icon: 'building-2',
      confirmLabel: c ? 'Save' : 'Add college',
      form: true,
      body: html`
        <div class="field"><label for="cl-name">College name</label><input class="input" id="cl-name" name="name" required minlength="2" maxlength="120" value="${c?.name || ''}" placeholder="Full official name"></div>
        <div class="field"><label for="cl-city">City</label><input class="input" id="cl-city" name="city" maxlength="80" value="${c?.city || ''}"></div>`,
      onConfirm: (v) => (c ? patch(`/api/admin/colleges/${c.id}`, { name: v.name.trim(), city: v.city.trim() }) : post('/api/admin/colleges', { name: v.name.trim(), city: v.city.trim() })),
    });
    if (r) { toast(c ? 'College saved.' : 'College added.', { type: 'success' }); draw(); }
  }

  await draw();
}

/** Full-screen hall code for the projector. */
function present(d) {
  const o = document.createElement('div');
  o.className = 'overlay present';
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-label', 'Hall code');
  setHtml(o, html`<div class="ov-card present-card">
    <p class="present-url">Go to <b>${location.host}</b></p>
    <p>Sign in with the email on your resume and this code</p>
    <div class="present-code">${d.accessCode}</div>
    <p class="muted">${d.name}</p>
    <button class="btn btn-light" type="button">${raw(icon('x', { size: 16 }))} Close (Esc)</button></div>`);
  document.body.appendChild(o);
  const close = () => { o.remove(); document.removeEventListener('keydown', k); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  const k = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', k);
  o.querySelector('button').addEventListener('click', close);
  o.querySelector('button').focus();
  o.requestFullscreen?.().catch(() => {});
}
