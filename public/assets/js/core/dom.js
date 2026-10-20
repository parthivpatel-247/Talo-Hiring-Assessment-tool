/* DOM helpers. Every interpolated value in html`` is escaped unless wrapped in raw(). */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

class Raw {
  constructor(s) {
    this.s = String(s);
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(s);

function part(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return escapeHtml(v);
}

/** Tagged template that escapes interpolations. Returns a Raw so templates nest. */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += part(values[i]);
  });
  return new Raw(out);
}

export function setHtml(el, content) {
  el.innerHTML = content instanceof Raw ? content.s : escapeHtml(content);
  return el;
}

export function el(tag, attrs = {}, content) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  if (content != null) setHtml(node, content);
  return node;
}

/** Event delegation: on(root, 'click', '[data-action]', (e, target) => …) */
export function on(root, type, selector, handler, opts) {
  root.addEventListener(
    type,
    (e) => {
      const t = e.target instanceof Element ? e.target.closest(selector) : null;
      if (t && root.contains(t)) handler(e, t);
    },
    opts
  );
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) out[k] = typeof v === 'string' ? v : v;
  return out;
}
