/* Privacy, terms and 404 pages: fill live details (organisation, contact, retention) and the privacy request form. */
import { get, post } from './core/api.js';
import { initErrorTracking, trackView } from './core/telemetry.js';

initErrorTracking('legal');
const page = location.pathname.startsWith('/privacy') ? 'privacy' : location.pathname.startsWith('/terms') ? 'terms' : '404';
trackView(page === 'privacy' ? 'view_privacy' : page === 'terms' ? 'view_terms' : 'view_404');

let turnstileToken = null;

async function init() {
  let cfg = null;
  try { cfg = await get('/api/public/config'); } catch (_) { /* the static text still reads correctly */ }
  if (cfg) {
    document.querySelectorAll('[data-org]').forEach((e) => (e.textContent = cfg.orgName));
    document.querySelectorAll('[data-year]').forEach((e) => (e.textContent = cfg.year));
    document.querySelectorAll('[data-retention]').forEach((e) => (e.textContent = cfg.retentionDays));
    document.querySelectorAll('[data-contact]').forEach((a) => {
      if (cfg.contactEmail) {
        a.href = `mailto:${cfg.contactEmail}`;
        if (a.textContent === 'the hiring team') a.textContent = cfg.contactEmail;
      } else a.removeAttribute('href');
    });
    document.querySelectorAll('[data-if="email"]').forEach((e) => (e.hidden = !cfg.emailEnabled));
    document.querySelectorAll('[data-if="turnstile"]').forEach((e) => (e.hidden = !cfg.turnstileEnabled));
    if (cfg.turnstileSiteKey && document.getElementById("ts-widget")) {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => window.turnstile.render('#ts-widget', { sitekey: cfg.turnstileSiteKey, callback: (t) => (turnstileToken = t) });
      document.head.appendChild(s);
    }
  }
  const form = document.getElementById('dr-form');
  if (!form) return;
  const ok = document.getElementById('dr-ok');
  const err = document.getElementById('dr-err');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ok.hidden = true;
    err.hidden = true;
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter the email address from your resume.'; err.hidden = false; return; }
    const btn = document.getElementById('dr-btn');
    btn.disabled = true;
    try {
      const r = await post('/api/public/data-request', { email, kind: form.kind.value, message: form.message.value.trim(), turnstileToken });
      ok.textContent = r.message;
      ok.hidden = false;
      form.reset();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      if (typeof window.turnstile?.reset === "function") window.turnstile.reset();
    } finally {
      btn.disabled = false;
    }
  });
}
init();
