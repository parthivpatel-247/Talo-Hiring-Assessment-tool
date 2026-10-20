/* UI primitives: toasts, confirmation dialogs, menus, button loading states. */
import { html, raw, setHtml, escapeHtml } from './dom.js';
import { icon } from './icons.js';

/* ---------- toasts ---------- */
let stack;
export function toast(message, { type = 'info', timeout = 4200, action } = {}) {
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toasts';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const ic = type === 'success' ? 'circle-check' : type === 'error' ? 'circle-x' : type === 'warning' ? 'triangle-alert' : 'info';
  setHtml(t, html`${raw(icon(ic))}<div class="toast-msg">${message}</div>${action ? html`<button type="button" class="toast-action">${action.label}</button>` : ''}<button type="button" class="toast-close" aria-label="Dismiss">${raw(icon('x', { size: 16 }))}</button>`);
  stack.appendChild(t);
  const close = () => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 320);
  };
  t.querySelector('.toast-close').addEventListener('click', close);
  if (action) t.querySelector('.toast-action').addEventListener('click', () => { action.onClick(); close(); });
  if (timeout) setTimeout(close, timeout);
  return close;
}
export const toastError = (err) => toast(err && err.message ? err.message : String(err), { type: 'error', timeout: 6500 });

/* ---------- dialogs ---------- */

/**
 * Open a modal dialog. `body` is a Raw html`` fragment or text.
 * Returns a promise resolving to the confirm result (true / form values) or false.
 */
export function openDialog({ title, body = '', icon: ic, tone, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, wide = false, requireText = null, onConfirm, hideCancel = false, form = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = `dialog${wide ? ' wide' : ''}`;
    const iconHtml = ic ? html`<div class="dialog-icon ${tone || (danger ? 'danger' : '')}">${raw(icon(ic, { size: 20 }))}</div>` : '';
    const confirmText = requireText
      ? html`<div class="field"><label for="dlg-confirm">Type <strong>${requireText}</strong> to confirm</label><input id="dlg-confirm" class="input" autocomplete="off" spellcheck="false"></div>`
      : '';
    setHtml(d, html`
      <form method="dialog" class="dialog-form" novalidate>
        <div class="dialog-head">${iconHtml}<div class="dialog-titles"><h2>${title}</h2></div></div>
        <div class="dialog-body">${body}${confirmText}<p class="dialog-error error-text" role="alert" hidden></p></div>
        <div class="dialog-foot">
          ${hideCancel ? '' : html`<button type="button" class="btn btn-secondary" data-cancel>${cancelLabel}</button>`}
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm ${requireText ? 'disabled' : ''}>${confirmLabel}</button>
        </div>
      </form>`);
    document.body.appendChild(d);
    const f = d.querySelector('form');
    const confirmBtn = d.querySelector('[data-confirm]');
    const errEl = d.querySelector('.dialog-error');
    if (requireText) {
      const inp = d.querySelector('#dlg-confirm');
      inp.addEventListener('input', () => { confirmBtn.disabled = inp.value.trim() !== requireText; });
    }
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      d.close();
      d.remove();
      resolve(val);
    };
    d.querySelector('[data-cancel]')?.addEventListener('click', () => finish(false));
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    d.addEventListener('click', (e) => { if (e.target === d) finish(false); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = form ? Object.fromEntries(new FormData(f).entries()) : true;
      if (onConfirm) {
        errEl.hidden = true;
        setLoading(confirmBtn, true);
        try {
          const r = await onConfirm(values, d);
          if (r === false) { setLoading(confirmBtn, false); return; }
          finish(r === undefined ? values : r);
        } catch (err) {
          setLoading(confirmBtn, false);
          errEl.textContent = err && err.message ? err.message : String(err);
          errEl.hidden = false;
        }
      } else finish(values);
    });
    d.showModal();
    const first = d.querySelector('input:not([type=hidden]), textarea, select');
    (first || confirmBtn).focus();
  });
}

export const confirmAction = (opts) => openDialog({ icon: opts.danger ? 'triangle-alert' : opts.icon, ...opts });

/* ---------- popover menus ---------- */
let openMenuEl = null;
export function closeMenu() {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
  }
}
/** items: [{ label, icon, onClick, danger, disabled, divider, heading }] */
export function openMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = items
    .map((it, i) => {
      if (it.divider) return '<hr>';
      if (it.heading) return `<div class="menu-label">${escapeHtml(it.heading)}</div>`;
      return `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, { size: 16 }) : ''}<span>${escapeHtml(it.label)}</span></button>`;
    })
    .join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth;
  const mh = m.offsetHeight;
  let left = r.right - mw;
  if (left < 8) left = Math.min(r.left, window.innerWidth - mw - 8);
  let top = r.bottom + 6;
  let origin = 'top right';
  if (top + mh > window.innerHeight - 8) { top = r.top - mh - 6; origin = 'bottom right'; }
  m.style.left = `${Math.max(8, left)}px`;
  m.style.top = `${Math.max(8, top)}px`;
  m.style.setProperty('--origin', origin);
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closeMenu();
    it.onClick?.();
  });
  openMenuEl = m;
  m.querySelector('button')?.focus();
  setTimeout(() => {
    const away = (e) => { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', away); } };
    document.addEventListener('mousedown', away);
  });
  m.addEventListener('keydown', (e) => {
    const btns = Array.from(m.querySelectorAll('button:not([disabled])'));
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  });
  return m;
}
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);

/* ---------- loading state ---------- */
export function setLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    btn.dataset.loading = 'true';
    btn.disabled = true;
    if (!btn.querySelector('.spinner')) btn.insertAdjacentHTML('afterbegin', '<span class="spinner" aria-hidden="true"></span>');
    if (label) {
      btn.dataset.label = btn.dataset.label || btn.textContent;
    }
    btn.setAttribute('aria-busy', 'true');
  } else {
    delete btn.dataset.loading;
    btn.disabled = false;
    btn.querySelector('.spinner')?.remove();
    btn.removeAttribute('aria-busy');
  }
}

export async function withLoading(btn, fn) {
  setLoading(btn, true);
  try {
    return await fn();
  } finally {
    setLoading(btn, false);
  }
}

/** Field-level error display for forms: show the API's `field` error under that input. */
export function showFieldError(form, err) {
  form.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
  form.querySelectorAll('.error-text[data-for]').forEach((x) => x.remove());
  const field = err && err.data && err.data.field;
  const target = field ? form.querySelector(`[name="${field}"]`) : null;
  if (target) {
    target.setAttribute('aria-invalid', 'true');
    const p = document.createElement('p');
    p.className = 'error-text';
    p.dataset.for = field;
    p.textContent = err.message;
    target.closest('.field')?.appendChild(p);
    target.focus();
    return true;
  }
  return false;
}
