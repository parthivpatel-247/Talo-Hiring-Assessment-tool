/* Talo admin: sign-in flows (setup, password, two-step code, reset), the app
   shell (sidebar, top bar, auto-refresh) and a small hash router. */
import { $, $$, html, raw, setHtml } from '../core/dom.js';
import { api, get, post, ApiError, setUnauthorizedHandler } from '../core/api.js';
import { icon } from '../core/icons.js';
import { toast, openMenu, setLoading, showFieldError, openDialog } from '../core/ui.js';
import { initErrorTracking, trackView } from '../core/telemetry.js';
import { initials } from '../core/format.js';
import { state, isManager, skeletonView, loadLookups } from './shared.js';

initErrorTracking('admin');

const root = $('#root');
const ORG = () => state.config?.orgName || 'Hevo Data';

/* ======================================================================
   Auth
   ====================================================================== */

let turnstileToken = null;
function mountTurnstile(container) {
  const key = state.auth?.turnstileSiteKey;
  if (!key || !container) return;
  const render = () => window.turnstile.render(container, { sitekey: key, callback: (t) => (turnstileToken = t), 'expired-callback': () => (turnstileToken = null) });
  if (typeof window.turnstile?.render === "function") return render();
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true;
  s.onload = render;
  document.head.appendChild(s);
}

function authLayout(formHtml) {
  document.body.className = 'adm';
  setHtml(root, html`
    <div class="auth">
      <section class="auth-side" aria-label="About Talo">
        <a class="side-brand" href="/admin/">talo <small>by ${ORG()}</small></a>
        <div>
          <h1>Campus hiring, from resume to shortlist.</h1>
          <p>Upload resumes, run proctored drives, grade with a rubric and export the shortlist. Every action is logged.</p>
          <div class="pipe-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        </div>
        <p class="auth-foot">Admin access only. Each sign-in lasts up to 12 hours.</p>
      </section>
      <section class="auth-main">
        ${formHtml}
        <nav class="auth-links" aria-label="Legal"><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><span>© ${new Date().getFullYear()} ${ORG()}</span></nav>
      </section>
    </div>`);
  root.className = '';
}

const errBox = () => html`<div class="alert danger" id="auth-error" role="alert" hidden>${raw(icon('circle-alert'))}<div></div></div>`;
const infoBox = (msg) => html`<div class="alert info" role="status">${raw(icon('info'))}<div>${msg}</div></div>`;
function showErr(msg) {
  const b = $('#auth-error');
  if (!b) return toast(msg, { type: 'error' });
  b.hidden = false;
  b.querySelector('div').textContent = msg;
}
function hideErr() {
  const b = $('#auth-error');
  if (b) b.hidden = true;
}

function pwScore(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes >= 2) s++;
  if (classes >= 3 && pw.length >= 12) s++;
  return Math.min(4, s);
}
const PW_FIELD = (id, label, auto = 'new-password') => html`
  <div class="field">
    <label for="${id}">${label}</label>
    <div class="input-group">
      <input class="input" id="${id}" name="password" type="password" autocomplete="${auto}" minlength="12" maxlength="128" required>
      <button class="btn btn-ghost btn-sm input-action" type="button" data-reveal="${id}" aria-label="Show password">${raw(icon('eye', { size: 16 }))}</button>
    </div>
    <div class="pw-meter" id="${id}-meter" data-score="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <span class="hint">At least 12 characters. A short phrase of unrelated words works well.</span>
  </div>`;
function wirePasswordField(id) {
  const inp = $(`#${id}`);
  const meter = $(`#${id}-meter`);
  inp?.addEventListener('input', () => { if (meter) meter.dataset.score = String(pwScore(inp.value)); });
  wireReveal();
}
function wireReveal() {
  $$('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const inp = $(`#${b.dataset.reveal}`);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    b.innerHTML = icon(show ? 'eye-off' : 'eye', { size: 16 });
  }));
}

function signInView(notice = '') {
  trackView('view_admin_login');
  authLayout(html`
    <form class="auth-form" id="login" novalidate>
      <div><h2>Sign in to Talo</h2><p class="sub">For the ${ORG()} hiring team.</p></div>
      ${notice ? infoBox(notice) : ''}
      ${errBox()}
      <div class="field"><label for="email">Work email</label><input class="input" id="email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
      <div class="field">
        <div class="row-between"><label class="label" for="password">Password</label><button class="link-btn" type="button" id="forgot">Forgot password?</button></div>
        <div class="input-group">
          <input class="input" id="password" name="password" type="password" autocomplete="current-password" required maxlength="256">
          <button class="btn btn-ghost btn-sm input-action" type="button" data-reveal="password" aria-label="Show password">${raw(icon('eye', { size: 16 }))}</button>
        </div>
      </div>
      <div id="ts-widget"></div>
      <button class="btn btn-primary btn-lg btn-block" id="login-btn" type="submit">Sign in ${raw(icon('arrow-right'))}</button>
      ${state.auth?.setupRequired ? html`<p class="muted">First time here? Sign in with the setup email and the setup password from your deployment to create the first manager account.</p>` : ''}
    </form>`);
  wireReveal();
  mountTurnstile($('#ts-widget'));
  $('#email').focus();
  $('#forgot').addEventListener('click', () => forgotView($('#email').value.trim()));
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideErr();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    if (!email || !password) return showErr('Enter your email and password.');
    const btn = $('#login-btn');
    setLoading(btn, true);
    try {
      const r = await post('/api/admin/auth/login', { email, password, turnstileToken });
      await afterStep(r, { email });
    } catch (err) {
      showErr(err.message);
      if (typeof window.turnstile?.reset === "function") window.turnstile.reset();
    } finally {
      setLoading(btn, false);
    }
  });
}

async function afterStep(r, ctx = {}) {
  if (r.next === 'setup') return setupView(r.token, r.email);
  if (r.next === 'change_password') return changePasswordView(r.token);
  if (r.next === 'code') return codeView(r.token, r.emailHint);
  if (r.next === 'done') return startApp();
}

function setupView(token, email) {
  authLayout(html`
    <form class="auth-form" id="setup" novalidate>
      <div><h2>Create the first manager account</h2><p class="sub">This replaces the setup password: once you finish, the setup password stops working and everyone signs in with their own account.</p></div>
      ${errBox()}
      <div class="field"><label>Email</label><input class="input" value="${email}" disabled></div>
      <div class="field"><label for="name">Your name</label><input class="input" id="name" name="name" autocomplete="name" required minlength="2" maxlength="80"></div>
      ${PW_FIELD('newpw', 'Choose a password')}
      <button class="btn btn-primary btn-lg btn-block" id="setup-btn" type="submit">Create account ${raw(icon('arrow-right'))}</button>
    </form>`);
  wirePasswordField('newpw');
  $('#name').focus();
  $('#setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideErr();
    const btn = $('#setup-btn');
    setLoading(btn, true);
    try {
      const r = await post('/api/admin/auth/setup', { token, name: $('#name').value.trim(), password: $('#newpw').value });
      toast('Your manager account is ready.', { type: 'success' });
      await afterStep(r);
    } catch (err) {
      if (!showFieldError($('#setup'), err)) showErr(err.message);
      if (err.status === 401) setTimeout(() => signInView(), 1500);
    } finally {
      setLoading(btn, false);
    }
  });
}

function changePasswordView(token) {
  authLayout(html`
    <form class="auth-form" id="chpw" novalidate>
      <div><h2>Choose your own password</h2><p class="sub">You signed in with a temporary password. Pick a new one to continue.</p></div>
      ${errBox()}
      ${PW_FIELD('newpw', 'New password')}
      <button class="btn btn-primary btn-lg btn-block" id="chpw-btn" type="submit">Save and continue</button>
    </form>`);
  wirePasswordField('newpw');
  $('#newpw').focus();
  $('#chpw').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideErr();
    const btn = $('#chpw-btn');
    setLoading(btn, true);
    try {
      const r = await post('/api/admin/auth/change-password', { token, password: $('#newpw').value });
      await afterStep(r);
    } catch (err) {
      showErr(err.message);
      if (err.status === 401) setTimeout(() => signInView(), 1500);
    } finally {
      setLoading(btn, false);
    }
  });
}

function codeView(token, hint) {
  authLayout(html`
    <form class="auth-form" id="code-form" novalidate>
      <div><h2>Check your email</h2><p class="sub">We sent a 6-digit sign-in code to <b>${hint || 'your email'}</b>. It expires in 10 minutes.</p></div>
      ${errBox()}
      <div class="field">
        <label for="code">Sign-in code</label>
        <input class="input code-input-lg" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required placeholder="000000">
      </div>
      <button class="btn btn-primary btn-lg btn-block" id="code-btn" type="submit">Verify and sign in</button>
      <div class="row-between"><button class="link-btn" type="button" id="resend">Send a new code</button><button class="link-btn" type="button" id="back">Use another account</button></div>
    </form>`);
  const inp = $('#code');
  inp.focus();
  inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/\D/g, '').slice(0, 6);
    if (inp.value.length === 6) $('#code-form').requestSubmit();
  });
  $('#back').addEventListener('click', () => signInView());
  $('#resend').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    setLoading(b, true);
    try {
      const r = await post('/api/admin/auth/resend', { token });
      token = r.token;
      toast('A new code is on its way.', { type: 'success' });
    } catch (err) {
      showErr(err.message);
    } finally {
      setLoading(b, false);
    }
  });
  $('#code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideErr();
    const btn = $('#code-btn');
    if (btn.disabled) return;
    setLoading(btn, true);
    try {
      const r = await post('/api/admin/auth/verify', { token, code: inp.value });
      await afterStep(r);
    } catch (err) {
      showErr(err.message);
      inp.select();
    } finally {
      setLoading(btn, false);
    }
  });
}

function forgotView(prefill = '') {
  authLayout(html`
    <form class="auth-form" id="forgot-form" novalidate>
      <div><h2>Reset your password</h2><p class="sub">Enter your work email. If it belongs to a Talo account, we'll email a link that's valid for 30 minutes.</p></div>
      ${errBox()}
      <div class="alert success" id="forgot-ok" role="status" hidden>${raw(icon('circle-check'))}<div></div></div>
      <div class="field"><label for="email">Work email</label><input class="input" id="email" type="email" autocomplete="username" value="${prefill}" required></div>
      <div id="ts-widget"></div>
      <button class="btn btn-primary btn-lg btn-block" id="forgot-btn" type="submit">Email me a reset link</button>
      <button class="link-btn" type="button" id="back">${raw(icon('arrow-left', { size: 14 }))} Back to sign in</button>
    </form>`);
  mountTurnstile($('#ts-widget'));
  $('#email').focus();
  $('#back').addEventListener('click', () => signInView());
  $('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideErr();
    const btn = $('#forgot-btn');
    setLoading(btn, true);
    try {
      const r = await post('/api/admin/auth/forgot', { email: $('#email').value.trim(), turnstileToken });
      const ok = $('#forgot-ok');
      ok.hidden = false;
      ok.querySelector('div').textContent = r.message;
    } catch (err) {
      showErr(err.message);
    } finally {
      setLoading(btn, false);
    }
  });
}

function resetView(q) {
  const invite = q.get('invite') === '1';
  authLayout(html`
    <form class="auth-form" id="reset-form" novalidate>
      <div><h2>${invite ? 'Welcome to Talo' : 'Choose a new password'}</h2><p class="sub">${invite ? 'Set a password to finish creating your account.' : 'This also signs you out everywhere else.'}</p></div>
      ${errBox()}
      ${PW_FIELD('newpw', invite ? 'Create a password' : 'New password')}
      <button class="btn btn-primary btn-lg btn-block" id="reset-btn" type="submit">${invite ? 'Create my account' : 'Save new password'}</button>
    </form>`);
  wirePasswordField('newpw');
  $('#newpw').focus();
  $('#reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideErr();
    const btn = $('#reset-btn');
    setLoading(btn, true);
    try {
      const r = await post('/api/admin/auth/reset', { challengeId: q.get('c') || '', token: q.get('t') || '', password: $('#newpw').value });
      history.replaceState(null, '', '/admin/');
      signInView(r.message);
    } catch (err) {
      showErr(err.message);
    } finally {
      setLoading(btn, false);
    }
  });
}

/* ======================================================================
   Shell
   ====================================================================== */

const NAV = [
  { group: 'Hiring', items: [
    { id: 'overview', label: 'Overview', ic: 'layout-dashboard' },
    { id: 'candidates', label: 'Candidates', ic: 'users', count: 'live' },
    { id: 'drives', label: 'Drives & colleges', ic: 'calendar-days' },
    { id: 'resumes', label: 'Add resumes', ic: 'upload', manager: true },
  ] },
  { group: 'Assessment', items: [
    { id: 'questions', label: 'Question bank', ic: 'book-open' },
    { id: 'results', label: 'Grading & exports', ic: 'file-spreadsheet', count: 'awaiting' },
    { id: 'integrity', label: 'Integrity', ic: 'shield-alert' },
  ] },
  { group: 'Admin', items: [
    { id: 'activity', label: 'Activity log', ic: 'history' },
    { id: 'settings', label: 'Settings', ic: 'settings' },
  ] },
];

const VIEWS = {
  overview: () => import('./views/overview.js'),
  candidates: () => import('./views/candidates.js'),
  drives: () => import('./views/drives.js'),
  resumes: () => import('./views/resumes.js'),
  questions: () => import('./views/questions.js'),
  results: () => import('./views/results.js'),
  integrity: () => import('./views/integrity.js'),
  activity: () => import('./views/activity.js'),
  settings: () => import('./views/settings.js'),
  account: () => import('./views/account.js'),
};
const TITLES = {
  overview: 'Overview', candidates: 'Candidates', drives: 'Drives & colleges', resumes: 'Add resumes', questions: 'Question bank',
  results: 'Grading & exports', integrity: 'Integrity', activity: 'Activity log', settings: 'Settings', account: 'Your account',
};

function renderShell() {
  document.body.className = 'adm';
  const u = state.me;
  setHtml(root, html`
    <div class="shell">
      <aside class="side" id="side" aria-label="Main navigation">
        <a class="side-brand" href="#/overview">talo <small>${ORG()}</small></a>
        ${raw(NAV.map((g) => `<nav class="nav-group" aria-label="${g.group}"><div class="nav-label">${g.group}</div>${g.items.filter((it) => !it.manager || isManager()).map((it) => `<a class="nav-item" href="#/${it.id}" data-nav="${it.id}">${icon(it.ic, { size: 18 })}<span>${it.label}</span>${it.count ? `<span class="nav-count${it.count === 'live' ? ' live' : ''}" data-count="${it.count}" hidden></span>` : ''}</a>`).join('')}</nav>`).join(''))}
        <div class="side-foot">
          <button class="me-btn" id="me-btn" type="button" aria-haspopup="menu">
            <span class="avatar">${initials(u.name, u.email)}</span>
            <span class="me-text"><span class="me-name truncate">${u.name}</span><span class="me-role">${u.role === 'manager' ? 'Manager' : 'Panel member'}</span></span>
            ${raw(icon('chevron-up', { size: 16 }))}
          </button>
        </div>
      </aside>
      <div class="side-scrim" id="scrim"></div>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon menu-toggle" id="menu-toggle" type="button" aria-label="Open menu" aria-controls="side" aria-expanded="false">${raw(icon('menu'))}</button>
          <div><h1 id="page-title">Overview</h1><div class="crumb" id="page-sub" hidden></div></div>
          <div class="topbar-actions" id="page-actions"></div>
          <span class="refresh-note" id="refresh-note" aria-live="off"></span>
        </header>
        <main class="view" id="view" tabindex="-1"></main>
      </div>
    </div>`);
  root.className = '';
  $('#menu-toggle').addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
  $('#scrim').addEventListener('click', () => setNav(false));
  $('#me-btn').addEventListener('click', (e) => {
    const dark = document.documentElement.dataset.theme === 'dark';
    openMenu(e.currentTarget, [
      { heading: u.email },
      { label: 'Your account', icon: 'user-round-check', onClick: () => (location.hash = '#/account') },
      { label: dark ? 'Light theme' : 'Dark theme', icon: dark ? 'sun' : 'moon', onClick: toggleTheme },
      { label: 'Keyboard shortcuts', icon: 'keyboard', onClick: showShortcuts },
      { divider: true },
      { label: 'Sign out', icon: 'log-out', onClick: signOut },
    ]);
  });
}

function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('#menu-toggle')?.setAttribute('aria-expanded', String(open));
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('talo-theme', next); } catch (_) {}
}

function showShortcuts() {
  openDialog({
    title: 'Keyboard shortcuts',
    icon: 'keyboard',
    hideCancel: true,
    confirmLabel: 'Done',
    body: html`<dl class="kv"><dt><kbd>/</kbd></dt><dd>Search candidates</dd><dt><kbd>g</kbd> then <kbd>o</kbd></dt><dd>Overview</dd><dt><kbd>g</kbd> then <kbd>c</kbd></dt><dd>Candidates</dd><dt><kbd>g</kbd> then <kbd>q</kbd></dt><dd>Question bank</dd><dt><kbd>g</kbd> then <kbd>r</kbd></dt><dd>Grading &amp; exports</dd><dt><kbd>Esc</kbd></dt><dd>Close a panel or dialog</dd></dl>`,
  });
}

async function signOut() {
  await post('/api/admin/auth/logout').catch(() => {});
  state.me = null;
  stopRefresh();
  location.hash = '';
  signInView('You have signed out.');
}

/* ---------- page header & refresh ---------- */
let current = { id: null, cleanup: null, refresh: null };
let refreshTimer = null;
let lastRefresh = 0;
let noteTimer = null;

function setHeader({ title, sub = '', actions = '' } = {}) {
  $('#page-title').textContent = title || TITLES[current.id] || 'Talo';
  const s = $('#page-sub');
  s.hidden = !sub;
  s.textContent = sub || '';
  setHtml($('#page-actions'), actions || '');
  document.title = `${title || TITLES[current.id]} · Talo admin`;
}

function stopRefresh() {
  clearInterval(refreshTimer);
  clearInterval(noteTimer);
  refreshTimer = null;
}
function startRefresh() {
  stopRefresh();
  const sec = Math.max(15, Number(state.settings?.autoRefreshSeconds) || 60);
  lastRefresh = Date.now();
  refreshTimer = setInterval(async () => {
    if (document.hidden || !current.refresh || document.querySelector('dialog[open]')) return;
    try {
      await current.refresh();
      lastRefresh = Date.now();
    } catch (_) { /* the view shows its own error */ }
    updateNavCounts();
  }, sec * 1000);
  const note = $('#refresh-note');
  noteTimer = setInterval(() => {
    if (!note) return;
    if (!current.refresh) { note.textContent = ''; return; }
    const s = Math.round((Date.now() - lastRefresh) / 1000);
    note.textContent = s < 5 ? 'Updated just now' : `Updated ${s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`} ago`;
  }, 1000);
}

export async function updateNavCounts() {
  try {
    const o = await get('/api/admin/overview');
    state.overview = o;
    const awaiting = (o.counts.submitted || 0) + (o.counts.grading || 0);
    const set = (k, n) => {
      const el = $(`[data-count="${k}"]`);
      if (!el) return;
      el.hidden = !n;
      el.textContent = String(n);
      el.title = k === 'live' ? `${n} taking the test now` : `${n} awaiting grade`;
    };
    set('live', o.liveNow);
    set('awaiting', awaiting);
  } catch (_) {}
}

/* ---------- router ---------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { id: parts[0] || 'overview', rest: parts.slice(1), query: new URLSearchParams(qs) };
}

async function route() {
  const r = parseHash();
  if (r.id === 'reset') return resetView(r.query);
  if (!state.me) return;
  if (state.me.mustChangePassword && r.id !== 'account') { location.hash = '#/account'; return; }
  const loader = VIEWS[r.id];
  if (!loader) { location.hash = '#/overview'; return; }
  setNav(false);
  $$('[data-nav]').forEach((a) => (a.getAttribute('data-nav') === r.id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const sameView = current.id === r.id && !!current.module;
  if (sameView && current.module.update) { current.module.update({ rest: r.rest, query: r.query }); return; }
  if (current.cleanup) try { current.cleanup(); } catch (_) {}
  const keep = sameView ? current.module : null;
  current = { id: r.id, cleanup: null, refresh: null, module: keep };
  // A fresh <main> each render drops the listeners the previous view attached.
  const old = $('#view');
  const fresh = old.cloneNode(false);
  if (sameView) while (old.firstChild) fresh.appendChild(old.firstChild); // move, don't re-parse (keeps CSSOM widths CSP-safe)
  else { setHeader({ title: TITLES[r.id] }); setHtml(fresh, skeletonView()); }
  old.replaceWith(fresh);
  try {
    const mod = keep || (await loader());
    if (current.id !== r.id) return; // navigated away while loading
    current.module = mod;
    const ctx = {
      view: fresh,
      rest: r.rest,
      query: r.query,
      setHeader,
      onRefresh: (fn) => { current.refresh = fn; lastRefresh = Date.now(); },
      navigate: (hash, { replace = false } = {}) => (replace ? history.replaceState(null, '', hash) : (location.hash = hash)),
    };
    const cleanup = await mod.render(ctx);
    current.cleanup = typeof cleanup === 'function' ? cleanup : null;
    if (!sameView) fresh.focus({ preventScroll: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    console.error(err);
    setHtml($('#view'), html`<div class="panel"><div class="empty"><div class="empty-icon">${raw(icon('circle-alert', { size: 22 }))}</div><h3>This page could not load</h3><p>${err.message || 'Something went wrong.'}</p><button class="btn btn-secondary" id="retry">${raw(icon('refresh-cw'))} Try again</button></div></div>`);
    $('#retry')?.addEventListener('click', () => { current.id = null; route(); });
  }
}

/* keyboard: "/" focuses search, g+key jumps */
let gPressed = 0;
document.addEventListener('keydown', (e) => {
  if (!state.me || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.closest('input, textarea, select, [contenteditable], dialog')) return;
  if (e.key === '/') {
    const s = $('#search');
    if (s) { e.preventDefault(); s.focus(); }
    return;
  }
  if (e.key === 'g') { gPressed = Date.now(); return; }
  if (Date.now() - gPressed < 900) {
    const map = { o: 'overview', c: 'candidates', q: 'questions', r: 'results', d: 'drives', s: 'settings', a: 'activity' };
    if (map[e.key]) { location.hash = `#/${map[e.key]}`; gPressed = 0; }
  }
});

async function startApp() {
  try {
    const r = await api('/api/admin/auth/me', { quiet401: true });
    state.me = r.user;
  } catch (err) {
    if (err.status === 401) return signInView();
    throw err;
  }
  if (!state.me.mustChangePassword) await loadLookups().catch(() => {});
  renderShell();
  if (!state.me.mustChangePassword) { startRefresh(); updateNavCounts(); }
  if (!location.hash || location.hash.startsWith('#/reset')) location.hash = '#/overview';
  current = { id: null };
  route();
}

window.addEventListener('hashchange', route);
setUnauthorizedHandler(() => {
  if (!state.me) return;
  state.me = null;
  stopRefresh();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  signInView('Your session ended. Please sign in again.');
});

async function boot() {
  try {
    const [cfg, auth] = await Promise.all([get('/api/public/config'), get('/api/admin/auth/status')]);
    state.config = cfg;
    state.auth = auth;
  } catch (err) {
    setHtml(root, html`<div class="empty"><div class="empty-icon">${raw(icon('wifi-off', { size: 22 }))}</div><h3>Talo could not load</h3><p>${err.message}</p><button class="btn btn-primary" id="retry">Try again</button></div>`);
    $('#retry').addEventListener('click', () => location.reload());
    return;
  }
  const r = parseHash();
  if (r.id === 'reset') return resetView(r.query);
  try {
    await startApp();
  } catch (err) {
    console.error(err);
    signInView();
  }
}

boot();
