/* Question renderer: a small, safe subset of Markdown. Every piece of text is
   escaped before any markup is added, so question content can never inject HTML.
   Supports: ## title, > topic · Difficulty, ### subheading, paragraphs, lists,
   tables, fenced code, **Example N** cards with Input/Output/Explanation rows,
   **Buggy pseudocode** cards, inline `code` and **bold**. */
import { escapeHtml } from './dom.js';

export function renderInline(s) {
  let h = escapeHtml(s);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return h;
}

const DIFF = { easy: 'success', medium: 'warning', hard: 'danger' };
const CARD = /^\*\*((?:Example|Buggy pseudocode|Buggy program|Buggy code|Pseudocode|Sample|Input format|Output format)[^*]*)\*\*:?$/i;
const ROW = /^(Input|Output|Expected output|Actual output|Explanation|Note|Returns?)\s*:\s*(.*)$/i;

export function renderRich(md, { skipTitle = false } = {}) {
  if (!md) return '';
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let out = '';
  let i = 0;
  let inCard = false;
  const closeCard = () => {
    if (inCard) {
      out += '</div>';
      inCard = false;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (/^```/.test(t)) {
      const lang = t.slice(3).trim();
      let code = '';
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code += lines[i] + '\n';
        i++;
      }
      i++;
      out += `<pre class="md-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
      continue;
    }
    const isPipeRow = (l) => /^\|.*\|$/.test((l || '').trim());
    const hasSep = line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-');
    // Tables with a |---| separator, or plain |a|b| rows (older questions omit the separator).
    if (hasSep || (isPipeRow(line) && isPipeRow(lines[i + 1]))) {
      const split = (l) => {
        const c = l.split('|').map((x) => x.trim());
        if (c[0] === '') c.shift();
        if (c[c.length - 1] === '') c.pop();
        return c;
      };
      const head = split(line);
      i += hasSep ? 2 : 1;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(split(lines[i++]));
      out += `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head.map((h) => `<th>${renderInline(h)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
      continue;
    }
    if (/^##\s+/.test(t)) {
      closeCard();
      if (!skipTitle) out += `<h3 class="q-title">${renderInline(t.replace(/^##\s+/, ''))}</h3>`;
      i++;
      continue;
    }
    if (/^###\s+/.test(t)) {
      closeCard();
      out += `<h4 class="q-sub">${renderInline(t.replace(/^###\s+/, ''))}</h4>`;
      i++;
      continue;
    }
    if (/^>\s+/.test(t)) {
      closeCard();
      let topic = t.replace(/^>\s+/, '');
      let pill = '';
      const m = topic.match(/\s·\s*(Easy|Medium|Hard)\s*$/i);
      if (m) {
        topic = topic.slice(0, m.index).trim();
        pill = `<span class="badge ${DIFF[m[1].toLowerCase()]}">${escapeHtml(m[1])}</span>`;
      }
      if (!skipTitle) out += `<div class="q-topic"><span>${escapeHtml(topic)}</span>${pill}</div>`;
      i++;
      continue;
    }
    const card = t.match(CARD);
    if (card) {
      closeCard();
      const isBug = /buggy|pseudocode/i.test(card[1]);
      out += `<div class="md-card${isBug ? ' md-card-code' : ''}"><div class="md-card-head">${escapeHtml(card[1])}</div>`;
      inCard = true;
      i++;
      continue;
    }
    const row = t.match(ROW);
    if (row) {
      const label = row[1];
      const val = row[2];
      if (!val.trim()) {
        // "Input:" on its own line introduces tables or text below it.
        out += `<div class="md-sub">${escapeHtml(label)}</div>`;
        i++;
        continue;
      }
      const mono = /^(input|output|expected output|actual output|returns?)$/i.test(label);
      const tone = /^actual/i.test(label) ? ' bad' : /^expected/i.test(label) ? ' good' : '';
      out += `<div class="md-row${tone}"><span class="md-label">${escapeHtml(label)}</span>${mono ? `<code class="md-val">${escapeHtml(val)}</code>` : `<span class="md-text">${renderInline(val)}</span>`}</div>`;
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(t)) {
      closeCard();
      out += '<ul>';
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) out += `<li>${renderInline(lines[i++].trim().replace(/^[-*]\s+/, ''))}</li>`;
      out += '</ul>';
      continue;
    }
    if (/^\d+[.)]\s+/.test(t)) {
      closeCard();
      out += '<ol>';
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) out += `<li>${renderInline(lines[i++].trim().replace(/^\d+[.)]\s+/, ''))}</li>`;
      out += '</ol>';
      continue;
    }
    if (!t) {
      i++;
      continue;
    }
    if (!inCard) closeCard();
    out += `<p>${renderInline(t)}</p>`;
    i++;
  }
  closeCard();
  return out;
}

/** Derive a display title when a question has none (SQL questions often start with "Table: …"). */
export function questionTitle(q) {
  if (q.title) return q.title;
  const lines = String(q.prompt || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const ask = lines.find((l) => /^(write|find|return|list|given|show|get|calculate|count)\b/i.test(l));
  const t = (ask || lines[0] || 'Question').replace(/[*`#>]/g, '');
  return t.length > 80 ? t.slice(0, 77).replace(/\s+\S*$/, '') + '…' : t;
}
