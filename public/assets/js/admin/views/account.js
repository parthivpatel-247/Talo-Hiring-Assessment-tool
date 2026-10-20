/* Your account: password and signed-in sessions. */
import { $, html, raw, setHtml, escapeHtml as esc } from '../../core/dom.js';
import { get, post } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { toast, setLoading, showFieldError } from '../../core/ui.js';
import { fmtDateTime, fmtRelative } from '../../core/format.js';
import { state } from '../shared.js';

function device(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${b}${o ? ` on ${o}` : ''}`;
}

export async function render(ctx) {
  const u = state.me;
  ctx.setHeader({ title: 'Your account' });
  const draw = async () => {
    const { sessions } = await get('/api/admin/account/sessions');
    setHtml(ctx.view, html`
      ${u.mustChangePassword ? html`<div class="alert warning">${raw(icon('key-round'))}<div><strong>Choose a new password to continue.</strong> Your manager set a temporary one.</div></div>` : ''}
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Profile</h2></div>
          <div class="panel-body"><dl class="kv"><dt>Name</dt><dd>${u.name}</dd><dt>Email</dt><dd>${u.email}</dd><dt>Role</dt><dd>${u.role === 'manager' ? 'Manager' : 'Panel member'}</dd></dl><p class="cell-secondary">Ask a manager to change your name, email or role.</p></div>
        </section>
        <section class="panel"><div class="panel-head"><h2>Change password</h2></div>
          <form class="panel-body stack" id="pw-form" novalidate>
            <div class="field"><label for="cur">Current password</label><input class="input" id="cur" name="currentPassword" type="password" autocomplete="current-password" required></div>
            <div class="field"><label for="np">New password</label><input class="input" id="np" name="newPassword" type="password" autocomplete="new-password" minlength="12" required><span class="hint">At least 12 characters. Other sessions are signed out.</span></div>
            <div class="row"><button class="btn btn-primary" id="pw-btn" type="submit">Update password</button></div>
          </form>
        </section>
      </div>
      <section class="panel"><div class="panel-head"><h2>Where you're signed in</h2><span class="spacer"></span>${sessions.length > 1 ? html`<button class="btn btn-secondary btn-sm" id="revoke">${raw(icon('log-out', { size: 16 }))} Sign out other sessions</button>` : ''}</div>
        <ul class="list">${raw(sessions.map((s) => `<li>${icon('laptop', { size: 18 })}<div class="grow"><div class="cell-primary">${esc(device(s.userAgent || ''))}${s.current ? ' <span class="badge success">This browser</span>' : ''}</div><div class="cell-secondary">Signed in ${fmtDateTime(s.createdAt)} · last active ${s.lastSeenAt ? fmtRelative(s.lastSeenAt) : '—'}${s.ip ? ` · ${esc(s.ip)}` : ''}</div></div></li>`).join(''))}</ul>
      </section>`);
    $('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = $('#pw-btn');
      setLoading(btn, true);
      try {
        const r = await post('/api/admin/account/password', { currentPassword: $('#cur').value, newPassword: $('#np').value });
        toast(r.message, { type: 'success' });
        if (u.mustChangePassword) { location.hash = '#/overview'; location.reload(); return; }
        draw();
      } catch (err) {
        if (!showFieldError(form, err)) toast(err.message, { type: 'error' });
      } finally {
        setLoading(btn, false);
      }
    });
    $('#revoke')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      setLoading(b, true);
      try { const r = await post('/api/admin/account/sessions/revoke-others'); toast(`Signed out ${r.revoked} other session(s).`, { type: 'success' }); draw(); } catch (err) { toast(err.message, { type: 'error' }); setLoading(b, false); }
    });
  };
  await draw();
}
