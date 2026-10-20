/* Candidate portal: sign-in → rules & device check → exam → submitted. */
import { $, html, raw, setHtml, on } from '../core/dom.js';
import { api, get, post, ApiError } from '../core/api.js';
import { icon } from '../core/icons.js';
import { toast, setLoading } from '../core/ui.js';
import { initErrorTracking, trackView } from '../core/telemetry.js';
import { fmtDate, fmtDateTime, plural } from '../core/format.js';
import { startExam } from './exam.js';

initErrorTracking('candidate');

const main = $('#main');
const state = { config: null, me: null, paper: null, prefetching: null };

function setView(content, { bodyClass = '' } = {}) {
  document.body.className = `cand ${bodyClass}`.trim();
  main.className = '';
  setHtml(main, content);
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function contactLink(subject = 'Assessment help') {
  const c = state.config?.contactEmail;
  return c ? `mailto:${c}?subject=${encodeURIComponent(subject)}` : '/privacy/#contact';
}

/* ---------------- sign in ---------------- */

function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  return { email: p.get('email') || '', code: p.get('code') || '' };
}

let turnstileToken = null;
function mountTurnstile(container) {
  const key = state.config?.turnstileSiteKey;
  if (!key || !container) return;
  const render = () => window.turnstile.render(container, { sitekey: key, callback: (t) => (turnstileToken = t), 'expired-callback': () => (turnstileToken = null) });
  if (typeof window.turnstile?.render === "function") return render();
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true;
  s.onload = render;
  document.head.appendChild(s);
}

function signInView() {
  const cfg = state.config;
  const mode = cfg.loginMode;
  const pre = readHash();
  trackView('view_candidate_login');
  setView(
    html`
    <div class="signin">
      <section class="signin-brand" aria-label="About this assessment">
        <a class="wordmark" href="/" aria-label="Talo home">talo <small>by ${cfg.orgName}</small></a>
        <div>
          <h1>Your campus assessment starts here.</h1>
          <p class="lede">A timed, written test of how you think through data problems. Write in any language or pseudocode: we grade the logic.</p>
          <div class="facts" aria-label="Assessment facts">
            <div class="fact"><b>${cfg.assessmentMinutes}</b><span>minutes</span></div>
            <div class="fact"><b>${cfg.questionCount}</b><span>questions</span></div>
            <div class="fact"><b>1</b><span>attempt</span></div>
          </div>
        </div>
        <p class="brand-foot">Use a laptop or desktop. The test runs in full screen.</p>
        <div class="paper-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      </section>
      <section class="signin-form-wrap">
        <form class="signin-form" id="signin" novalidate>
          <div>
            <h2>Sign in</h2>
            <p class="sub">${mode === 'otp' ? 'Enter the email on your resume. We will send you a 6-digit code.' : mode === 'email_only' ? 'Enter the email address on your resume.' : 'Enter the email on your resume and your access code.'}</p>
          </div>
          <div class="alert danger" id="signin-error" role="alert" hidden>${raw(icon('circle-alert'))}<div></div></div>
          <div class="field">
            <label for="email">Email address</label>
            <input class="input" id="email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required value="${pre.email}" placeholder="name@college.edu">
          </div>
          ${mode === 'code' ? html`
            <div class="field">
              <label for="code">Access code</label>
              <input class="input" id="code" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="8" required value="${pre.code}" placeholder="6 characters">
              <span class="hint">Announced by your invigilator, or sent to your email.</span>
            </div>` : ''}
          ${mode === 'otp' ? html`
            <div class="field" id="otp-field" hidden>
              <label for="code">6-digit code</label>
              <input class="input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000">
              <span class="hint" id="otp-hint">Check your inbox and spam folder. The code expires in 10 minutes.</span>
            </div>` : ''}
          <div id="ts-widget"></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit" id="signin-btn">${mode === 'otp' ? 'Email me a code' : 'Continue'} ${raw(icon('arrow-right'))}</button>
          <p class="muted">Trouble signing in? <a href="${contactLink('Sign-in help')}">Contact the hiring team</a>.</p>
        </form>
        <nav class="signin-links" aria-label="Legal">
          <a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><span>© ${cfg.year} ${cfg.orgName}</span>
        </nav>
      </section>
    </div>`,
    { bodyClass: 'on-signin' }
  );
  mountTurnstile($('#ts-widget'));
  const form = $('#signin');
  const errBox = $('#signin-error');
  const showErr = (msg) => {
    errBox.hidden = false;
    errBox.querySelector('div').textContent = msg;
  };
  let otpSent = false;
  if (!pre.email) $('#email').focus();
  else ($('#code') || $('#email')).focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const email = $('#email').value.trim();
    const code = ($('#code')?.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Enter a valid email address, like name@college.edu.');
    const btn = $('#signin-btn');
    if (mode === 'otp' && !otpSent) {
      setLoading(btn, true);
      try {
        const r = await post('/api/candidate/otp', { email, turnstileToken });
        otpSent = true;
        $('#otp-field').hidden = false;
        $('#otp-hint').textContent = r.message;
        btn.lastChild && (btn.innerHTML = `Sign in ${icon('arrow-right')}`);
        $('#code').focus();
      } catch (err) {
        showErr(err.message);
      } finally {
        setLoading(btn, false);
      }
      return;
    }
    if (mode !== 'email_only' && !code) return showErr(mode === 'otp' ? 'Enter the 6-digit code from the email.' : 'Enter your access code.');
    setLoading(btn, true);
    try {
      await post('/api/candidate/login', { email, code, turnstileToken });
      history.replaceState(null, '', location.pathname);
      await route();
    } catch (err) {
      showErr(err.message);
      if (typeof window.turnstile?.reset === "function") window.turnstile.reset();
      setLoading(btn, false);
    }
  });
}

/* ---------------- rules & device check ---------------- */

function deviceChecks() {
  const fs = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const wide = Math.min(window.screen.width, window.screen.height) >= 600 && window.screen.width >= 1000;
  return { fullscreen: fs, wide, online: navigator.onLine, cookies: navigator.cookieEnabled };
}

function rulesView() {
  const { candidate, rules } = state.me;
  const first = (candidate.name || '').split(' ')[0];
  const dev = deviceChecks();
  const blocked = rules.requireFullscreenDevice && !dev.fullscreen;
  trackView('view_candidate_rules');
  const chk = (ok, label, warn) => html`<span class="badge ${ok ? 'success' : warn ? 'warning' : 'danger'}">${raw(icon(ok ? 'check' : 'triangle-alert', { size: 14 }))}${label}</span>`;
  setView(html`
    ${topBar()}
    <div class="page">
      <div class="page-card">
        <h1>${first ? `Hi ${first}, here is how it works.` : 'Here is how it works.'}</h1>
        <p class="lede">${candidate.driveName ? html`${candidate.driveName}${candidate.driveDate ? ` · ${fmtDate(candidate.driveDate)}` : ''}. ` : ''}${rules.questionCount} questions, ${rules.assessmentMinutes} minutes, one attempt. Read this once before you start.</p>
        <ul class="rules">
          <li><span class="r-ic">${raw(icon('timer'))}</span><div><b>${rules.assessmentMinutes} minutes on the clock</b><p>The timer starts when you press Start and pauses only if your internet drops.</p></div></li>
          <li><span class="r-ic">${raw(icon('code-xml'))}</span><div><b>Any language, or pseudocode</b><p>Pick a language above the answer box. Only your logic is graded, not syntax.</p></div></li>
          <li><span class="r-ic">${raw(icon('maximize'))}</span><div><b>Stay in full screen</b><p>If you leave the test (another tab, app or window) you have ${rules.awayGraceSeconds} seconds to come back, or the test is submitted.</p></div></li>
          <li><span class="r-ic">${raw(icon('save'))}</span><div><b>Your work saves itself</b><p>Answers save every 15 seconds and when you move between questions. Up to ${rules.wordLimit} words each.</p></div></li>
          <li><span class="r-ic">${raw(icon('lock'))}</span><div><b>Closed book</b><p>Copy, paste and right-click are turned off. Every attempt to leave is recorded for the hiring team.</p></div></li>
          <li><span class="r-ic">${raw(icon('rotate-ccw'))}</span><div><b>Don't refresh the page</b><p>Reloading ends the test. If something goes wrong, raise your hand: the invigilator can resume it.</p></div></li>
        </ul>
        <div class="checks" aria-label="Device check">
          ${chk(dev.fullscreen, 'Full screen supported')}
          ${chk(dev.wide, dev.wide ? 'Large screen' : 'Small screen: a laptop is better', true)}
          ${chk(dev.online, dev.online ? 'Online' : 'Offline')}
          ${chk(dev.cookies, 'Cookies on')}
        </div>
        ${blocked ? html`<div class="alert danger" role="alert">${raw(icon('monitor'))}<div><strong>This device can't run the test.</strong> Your browser doesn't support full-screen mode (common on phones). Please switch to a laptop or desktop with Chrome, Edge or Firefox.</div></div>` : ''}
        <div class="consent">
          <label class="check"><input type="checkbox" id="consent"> <span>I will take this assessment on my own, without help, notes, other people or AI tools, and I agree to the <a href="/terms/" target="_blank" rel="noopener">assessment terms</a>. I understand my answers and test activity are recorded as described in the <a href="/privacy/" target="_blank" rel="noopener">privacy notice</a>.</span></label>
          <div class="start-row">
            <button class="btn btn-primary btn-lg" id="start-btn" disabled>${raw(icon('play'))} Start the ${rules.assessmentMinutes}-minute test</button>
            <span class="muted" id="prep-state">${state.paper ? 'Your paper is ready.' : 'Preparing your paper…'}</span>
          </div>
        </div>
      </div>
    </div>`);
  wireTopBar();
  const consent = $('#consent');
  const btn = $('#start-btn');
  consent.addEventListener('change', () => { btn.disabled = !consent.checked || blocked; });
  ensurePaper().then(
    (r) => { const p = $('#prep-state'); if (p) p.textContent = r.driveLive === false ? 'Your paper is ready. Wait for the invigilator to open the drive, then press Start.' : 'Your paper is ready.'; },
    (err) => { const p = $('#prep-state'); if (p) { p.textContent = err.message; p.classList.add('error-text'); } }
  );
  btn.addEventListener('click', async () => {
    if (!consent.checked || blocked) return;
    setLoading(btn, true);
    try {
      try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (_) { /* checked again inside the exam */ }
      const started = await post('/api/candidate/start');
      startExam({ me: state.me, start: started, config: state.config, onDone: doneView, topBar, wireTopBar });
    } catch (err) {
      setLoading(btn, false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (err.code === 'submitted') return route();
      if (err.code === 'drive_not_live') {
        const p = $('#prep-state');
        if (p) { p.textContent = err.message; p.classList.add('error-text'); }
        return;
      }
      toast(err.message, { type: 'error', timeout: 8000 });
    }
  });
  api('/api/candidate/events', { method: 'POST', body: { type: 'rules_viewed' } }).catch(() => {});
  if (blocked) api('/api/candidate/events', { method: 'POST', body: { type: 'device_unsupported', detail: { reason: 'no_fullscreen' } } }).catch(() => {});
}

function ensurePaper() {
  if (state.paper) return Promise.resolve(state.paper);
  if (!state.prefetching) {
    // Assigns the paper; questions are only sent once the clock starts.
    state.prefetching = post('/api/candidate/prepare').then((r) => (state.paper = r)).finally(() => (state.prefetching = null));
  }
  return state.prefetching;
}

/* ---------------- top bar ---------------- */

export function topBar(extra = '') {
  const c = state.me?.candidate;
  return html`
    <header class="cand-top">
      <a class="wordmark" href="/" aria-label="Talo">talo</a>
      ${c ? html`<div class="who"><span class="avatar">${(c.name || c.email || '?').slice(0, 1).toUpperCase()}</span><div class="who-text"><span class="who-name truncate">${c.name || c.email}</span><span class="who-mail truncate">${c.email}</span></div></div>` : ''}
      <span class="spacer"></span>
      ${extra}
      <button class="icon-btn" id="theme-btn" type="button" aria-label="Switch light or dark theme">${raw(icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'))}</button>
    </header>`;
}

export function wireTopBar() {
  const b = $('#theme-btn');
  if (!b) return;
  b.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('talo-theme', next); } catch (_) {}
    b.innerHTML = icon(next === 'dark' ? 'sun' : 'moon');
  });
}

/* ---------------- done ---------------- */

const REASONS = {
  candidate: { title: 'Your assessment is submitted.', body: 'Thank you. Your answers are saved and will be reviewed by the hiring team. You can close this window.', ok: true },
  time_up: { title: 'Time is up: your assessment is submitted.', body: 'Everything you wrote up to the last save has been submitted. You can close this window.', ok: true },
  deadline: { title: 'Time is up: your assessment is submitted.', body: 'Everything you wrote up to the last save has been submitted. You can close this window.', ok: true },
  left_screen: { title: 'Your assessment was submitted because you left the test.', body: 'You left full screen or switched away and did not come back in time. Your saved answers were submitted and this was recorded. If this was a mistake, tell your invigilator now.', ok: false },
  reload: { title: 'Your assessment was closed because the page was reloaded.', body: 'Reloading ends a running test. Your saved answers were submitted. If this happened by accident, tell your invigilator: they can resume your test with the same questions.', ok: false },
  admin: { title: 'Your assessment was submitted by the invigilator.', body: 'Your saved answers have been submitted. Speak to your invigilator if you have questions.', ok: false },
  revoked: { title: 'Your access has been withdrawn.', body: 'Please speak to your invigilator.', ok: false },
  auto_close: { title: 'Your assessment is closed.', body: 'The time for this test has passed and your saved answers were submitted.', ok: false },
};

export function doneView(reason, extra = {}) {
  const r = REASONS[reason] || REASONS.candidate;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setView(html`
    ${topBar()}
    <div class="page">
      <div class="page-card">
        <div class="done-mark ${r.ok ? '' : 'warn'}">${raw(icon(r.ok ? 'circle-check' : 'circle-alert', { size: 28 }))}</div>
        <h1>${r.title}</h1>
        <p class="lede">${r.body}</p>
        ${extra.answered != null ? html`<dl class="kv summary-list"><dt>Answered</dt><dd>${extra.answered} of ${extra.total}</dd><dt>Submitted</dt><dd>${fmtDateTime(new Date().toISOString())}</dd></dl>` : ''}
        <div class="row wrap done-actions">
          <a class="btn btn-secondary" href="${contactLink('Question about my assessment')}">${raw(icon('mail'))} Contact the hiring team</a>
          <button class="btn btn-ghost" id="signout">${raw(icon('log-out'))} Sign out</button>
        </div>
      </div>
    </div>`);
  wireTopBar();
  $('#signout').addEventListener('click', async () => {
    await post('/api/candidate/logout').catch(() => {});
    state.me = null;
    state.paper = null;
    signInView();
  });
}

/* ---------------- routing ---------------- */

async function route() {
  try {
    state.me = await api('/api/candidate/me', { quiet401: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return signInView();
    return errorView(err);
  }
  const a = state.me.attempt;
  if (a.submitted) return doneView(a.submitReason || 'candidate');
  if (a.started) {
    // A fresh page load while the timed test is running ends it (anti-cheat).
    await post('/api/candidate/submit', { reason: 'reload' }).catch(() => {});
    return doneView('reload');
  }
  rulesView();
}

function errorView(err) {
  setView(html`<div class="page"><div class="page-card"><div class="done-mark warn">${raw(icon('wifi-off', { size: 28 }))}</div><h1>We couldn't load the assessment.</h1><p class="lede">${err.message}</p><div class="row done-actions"><button class="btn btn-primary" id="retry">${raw(icon('refresh-cw'))} Try again</button></div></div></div>`);
  $('#retry').addEventListener('click', () => location.reload());
}

async function boot() {
  try {
    state.config = await get('/api/public/config');
  } catch (err) {
    return errorView(err);
  }
  $('#year').textContent = state.config.year;
  if (state.config.contactEmail) $('#help-link').href = contactLink();
  await route();
}

boot();
