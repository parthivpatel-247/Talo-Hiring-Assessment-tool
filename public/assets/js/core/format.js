/* Formatting helpers (dates in the viewer's local time zone). */

const dtf = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const dtfFull = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const df = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const tf = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const nf = new Intl.NumberFormat(undefined);
const rtf = typeof Intl.RelativeTimeFormat === 'function' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

export function parseDate(v) {
  if (!v) return null;
  const s = String(v);
  // Treat legacy "YYYY-MM-DD HH:MM:SS" as UTC.
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
  return isNaN(d.getTime()) ? null : d;
}
export const fmtDateTime = (v) => { const d = parseDate(v); return d ? dtf.format(d) : '—'; };
export const fmtDateTimeFull = (v) => { const d = parseDate(v); return d ? dtfFull.format(d) : '—'; };
export const fmtDate = (v) => {
  if (!v) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    const [y, m, d] = String(v).split('-').map(Number);
    return df.format(new Date(y, m - 1, d));
  }
  const d = parseDate(v);
  return d ? df.format(d) : '—';
};
export const fmtTime = (v) => { const d = parseDate(v); return d ? tf.format(d) : '—'; };
export const fmtNum = (n) => (n == null ? '—' : nf.format(n));

export function fmtRelative(v) {
  const d = parseDate(v);
  if (!d) return '—';
  const s = Math.round((d.getTime() - Date.now()) / 1000);
  const a = Math.abs(s);
  if (!rtf) return dtf.format(d);
  if (a < 45) return 'just now';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return dtf.format(d);
}

/** 3723 -> "1h 2m", 125 -> "2m 5s" */
export function fmtDuration(sec) {
  if (sec == null || isNaN(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return s ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** Clock for the exam timer: 59:07 or 1:02:03 */
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

export function plural(n, one, many = one + 's') {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

export function initials(name, email) {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function pct(a, b) {
  if (a == null || !b) return null;
  return Math.round((a / b) * 100);
}

export function countWords(t) {
  const w = (t || '').trim();
  return w ? w.split(/\s+/).length : 0;
}
