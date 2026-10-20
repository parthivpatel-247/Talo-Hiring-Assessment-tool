/* A small, dependency-free code editor for answers: line numbers, syntax
   highlighting for common languages, smart indentation and comment toggling.
   Built on a <textarea> (accessible, works with IME and screen readers) with a
   highlighted <pre> layered behind it. There is no code execution: answers are
   graded on their logic, in any language. */
import { escapeHtml } from './dom.js';

export const LANGUAGES = [
  { id: 'pseudocode', label: 'Pseudocode' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'cpp', label: 'C++' },
  { id: 'c', label: 'C' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'sql', label: 'SQL' },
  { id: 'text', label: 'Plain text (explanation)' },
];

const KW = {
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print len range self',
  java: 'abstract boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws try void while true false var String List Map ArrayList HashMap',
  cpp: 'auto bool break case catch char class const continue default delete do double else enum false float for if include int long namespace new nullptr private protected public return short signed sizeof static struct switch template this throw true try typedef typename unsigned using vector virtual void while string map unordered_map std cout cin endl',
  c: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while include define NULL printf scanf',
  javascript: 'async await break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield console',
  csharp: 'abstract bool break byte case catch char class const continue decimal default do double else enum false finally float for foreach if in int interface internal is long namespace new null object out override private protected public return static string struct switch this throw true try using var void while List Dictionary Console',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil make len append fmt',
  sql: 'select from where group by order having join left right inner outer full cross on as and or not in is null like between distinct count sum avg min max case when then else end limit offset union all insert into values update set delete create table with over partition row_number rank dense_rank coalesce desc asc exists',
  pseudocode: 'function procedure begin end if then else elif endif for each from to step do while endwhile repeat until return and or not true false null set let print input output in of break continue array map length size append push pop',
};
const KWSETS = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(k === 'sql' || k === 'pseudocode' ? v.split(' ') : v.split(' '))]));
const CASE_INSENSITIVE = new Set(['sql', 'pseudocode']);
const LINE_COMMENT = { python: '#', sql: '--', pseudocode: '//', java: '//', cpp: '//', c: '//', javascript: '//', csharp: '//', go: '//' };

function highlight(code, lang) {
  if (lang === 'text' || !KWSETS[lang]) return escapeHtml(code);
  const kws = KWSETS[lang];
  const ci = CASE_INSENSITIVE.has(lang);
  const lc = LINE_COMMENT[lang];
  const block = lang !== 'python' && lang !== 'sql';
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    // comments
    if (lc && code.startsWith(lc, i) || (lang === 'pseudocode' && ch === '#')) {
      let j = code.indexOf('\n', i);
      if (j < 0) j = n;
      out += `<span class="tk-c">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    if (block && code.startsWith('/*', i)) {
      let j = code.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      out += `<span class="tk-c">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    // strings
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n && code[j] !== ch && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      j = Math.min(n, j + 1);
      out += `<span class="tk-s">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    // numbers
    if (/[0-9]/.test(ch) && !/[A-Za-z_]/.test(code[i - 1] || '')) {
      let j = i;
      while (j < n && /[0-9._xa-fA-F]/.test(code[j])) j++;
      out += `<span class="tk-n">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    // words
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(code[j])) j++;
      const w = code.slice(i, j);
      const isKw = kws.has(ci ? w.toLowerCase() : w);
      let k = j;
      while (k < n && code[k] === ' ') k++;
      const isFn = !isKw && code[k] === '(';
      out += isKw ? `<span class="tk-k">${escapeHtml(w)}</span>` : isFn ? `<span class="tk-f">${escapeHtml(w)}</span>` : escapeHtml(w);
      i = j;
      continue;
    }
    out += escapeHtml(ch);
    i++;
  }
  return out;
}

/**
 * Create an editor inside `host`.
 * opts: { value, language, onInput(value), onLanguage(lang), readOnly, placeholder, label }
 */
export function createEditor(host, opts = {}) {
  host.classList.add('editor');
  host.innerHTML = `
    <div class="editor-gutter" aria-hidden="true"></div>
    <div class="editor-area">
      <pre class="editor-hl" aria-hidden="true"><code></code></pre>
      <textarea class="editor-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea>
    </div>`;
  const gutter = host.querySelector('.editor-gutter');
  const hl = host.querySelector('.editor-hl code');
  const pre = host.querySelector('.editor-hl');
  const ta = host.querySelector('textarea');
  if (opts.label) ta.setAttribute('aria-label', opts.label);
  if (opts.placeholder) ta.placeholder = opts.placeholder;
  if (opts.readOnly) ta.readOnly = true;
  let lang = opts.language || 'pseudocode';
  let lines = 0;

  const render = () => {
    const v = ta.value;
    hl.innerHTML = highlight(v, lang) + '\n';
    const count = v.split('\n').length;
    if (count !== lines) {
      lines = count;
      let g = '';
      for (let k = 1; k <= count; k++) g += `<span>${k}</span>`;
      gutter.innerHTML = g;
    }
    syncScroll();
  };
  const syncScroll = () => {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  };
  const setLang = (l) => {
    lang = l;
    host.dataset.lang = l;
    ta.setAttribute('wrap', l === 'text' ? 'soft' : 'off');
    render();
  };

  const insert = (text, selStart, selEnd) => {
    ta.focus();
    // execCommand keeps native undo; fall back to setRangeText.
    if (!document.execCommand || !document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, selStart ?? ta.selectionStart, selEnd ?? ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  ta.addEventListener('input', () => {
    render();
    opts.onInput?.(ta.value);
  });
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('keydown', (e) => {
    if (ta.readOnly) return;
    const v = ta.value;
    const s = ta.selectionStart;
    const end = ta.selectionEnd;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (lang === 'text' && !e.shiftKey && s === end) return; // let Tab move focus in prose mode
      e.preventDefault();
      if (e.shiftKey) {
        const le = v.indexOf('\n', end);
        const block = v.slice(ls, le < 0 ? v.length : le);
        const out = block.replace(/^( {1,4}|\t)/gm, '');
        ta.setSelectionRange(ls, le < 0 ? v.length : le);
        insert(out);
        ta.setSelectionRange(ls, ls + out.length);
      } else if (s !== end && v.slice(s, end).includes('\n')) {
        const le = v.indexOf('\n', end);
        const block = v.slice(ls, le < 0 ? v.length : le);
        const out = block.replace(/^/gm, '    ');
        ta.setSelectionRange(ls, le < 0 ? v.length : le);
        insert(out);
        ta.setSelectionRange(ls, ls + out.length);
      } else insert('    ');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && lang !== 'text') {
      e.preventDefault();
      const cur = v.slice(ls, s);
      let indent = (cur.match(/^[ \t]*/) || [''])[0];
      const trimmed = cur.replace(/\s+$/, '');
      if (/[:{[(]$/.test(trimmed) || (lang === 'pseudocode' && /\b(then|do|begin)$/i.test(trimmed))) indent += '    ';
      insert('\n' + indent);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      const marker = LINE_COMMENT[lang] || '//';
      const le = v.indexOf('\n', end);
      const block = v.slice(ls, le < 0 ? v.length : le);
      const all = block.split('\n').every((l) => !l.trim() || l.trimStart().startsWith(marker));
      const out = block
        .split('\n')
        .map((l) => (all ? l.replace(new RegExp(`^(\\s*)${marker.replace(/[/]/g, '\\/')} ?`), '$1') : l.trim() ? l.replace(/^(\s*)/, `$1${marker} `) : l))
        .join('\n');
      ta.setSelectionRange(ls, le < 0 ? v.length : le);
      insert(out);
      return;
    }
  });

  ta.value = opts.value || '';
  setLang(lang);

  return {
    textarea: ta,
    get value() {
      return ta.value;
    },
    set value(v) {
      ta.value = v || '';
      render();
    },
    get language() {
      return lang;
    },
    setLanguage: setLang,
    focus: () => ta.focus(),
    refresh: render,
  };
}
