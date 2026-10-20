/* Fetch wrapper: JSON in/out, same-origin cookies, clear errors. */

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error', data = null, network = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
    this.network = network;
  }
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(path, { method = 'GET', body, form, timeoutMs = 20000, signal, raw: wantRaw = false, quiet401 = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: form ? undefined : body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: form ? form : body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const timedOut = err && err.name === 'AbortError';
    throw new ApiError(timedOut ? 'The server took too long to respond. Check your connection and try again.' : 'Could not reach the server. Check your internet connection and try again.', { network: true, code: timedOut ? 'timeout' : 'network' });
  }
  clearTimeout(timer);
  if (wantRaw && res.ok) return res;
  let data = null;
  const type = res.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status}).`;
    const err = new ApiError(message, { status: res.status, code: (data && data.code) || 'error', data });
    if (res.status === 401 && onUnauthorized && !quiet401) onUnauthorized(err);
    throw err;
  }
  return data;
}

export const get = (p, o) => api(p, { ...o, method: 'GET' });
export const post = (p, body, o) => api(p, { ...o, method: 'POST', body: body ?? {} });
export const put = (p, body, o) => api(p, { ...o, method: 'PUT', body });
export const patch = (p, body, o) => api(p, { ...o, method: 'PATCH', body });
export const del = (p, o) => api(p, { ...o, method: 'DELETE' });

/** Download a file returned by the API (Content-Disposition filename). */
export async function download(path, fallbackName = 'download') {
  const res = await api(path, { raw: true, timeoutMs: 60000 });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const name = m ? m[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
