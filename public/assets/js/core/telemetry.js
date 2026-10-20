/* Error tracking + cookieless page counts (first party; no personal data). */

let sent = 0;
const seen = new Set();

export function initErrorTracking(surface) {
  const report = (message, source, stack) => {
    const key = `${message}|${source}`;
    if (seen.has(key) || sent >= 10) return;
    seen.add(key);
    sent++;
    const body = JSON.stringify({ surface, message: String(message || 'Error').slice(0, 500), source: String(source || '').slice(0, 300), stack: String(stack || '').slice(0, 4000), url: location.pathname });
    try {
      fetch('/api/public/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {});
    } catch (_) {}
  };
  window.addEventListener('error', (e) => report(e.message, `${e.filename || ''}:${e.lineno || 0}`, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && (r.network || r.status)) return; // API errors are shown to the user, not crashes
    report(r && r.message ? r.message : String(r), 'unhandledrejection', r && r.stack);
  });
}

export function trackView(event) {
  try {
    fetch('/api/public/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, path: location.pathname }), keepalive: true, credentials: 'same-origin' }).catch(() => {});
  } catch (_) {}
}
