/* Integrity: who left the test, lost connection or pasted, and which answers look alike. */
import { $, html, raw, setHtml, escapeHtml as esc } from '../../core/dom.js';
import { get, post } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { toast, setLoading } from '../../core/ui.js';
import { fmtDuration, fmtRelative, plural } from '../../core/format.js';
import { statusBadge, signalsCell, emptyState } from '../shared.js';
import { openCandidate, closeCandidate } from '../drawer.js';

export async function render(ctx) {
  ctx.setHeader({ title: 'Integrity', actions: html`<button class="btn btn-secondary btn-sm" id="run-sim">${raw(icon('scan-search', { size: 16 }))} Check for similar answers</button>` });
  setHtml(ctx.view, html`
    <p class="page-intro">Signals help you decide where to look; they are not proof. A candidate on a weak connection goes offline more often, and a single tab switch can be an accident. Open a candidate to see the full timeline.</p>
    <section class="panel" aria-labelledby="sig-h"><div class="panel-head"><h2 id="sig-h">Most signals</h2><span class="hint">Leaving the test, copy/paste attempts, second-device sign-ins and similar answers</span></div><div class="table-wrap" id="sig"></div></section>
    <section class="panel" aria-labelledby="sim-h"><div class="panel-head"><h2 id="sim-h">Similar answers</h2><span class="hint" id="sim-note">Pairs of answers to the same question that share most of their wording (80%+)</span></div><div class="table-wrap" id="sim"></div></section>`);

  const draw = async () => {
    const [{ candidates }, { pairs }] = await Promise.all([get('/api/admin/candidates'), get('/api/admin/integrity/similarity')]);
    const score = (c) => c.signals.tabSwitches * 2 + c.signals.pasteBlocked * 2 + c.signals.similar * 3 + c.signals.blockedLogins * 3 + Math.min(c.signals.offline, 5);
    const flagged = candidates.filter((c) => !c.isTest && score(c) > 0).sort((a, b) => score(b) - score(a)).slice(0, 50);
    setHtml($('#sig'), flagged.length ? raw(`<table class="table"><thead><tr><th>Candidate</th><th>Status</th><th>Signals</th><th>Offline time</th><th>Sign-ins blocked</th><th>Last activity</th></tr></thead><tbody>${flagged.map((c) => `<tr class="row-link" data-open="${c.id}" tabindex="0"><td><div class="cell-primary">${esc(c.name || 'Name missing')}</div><div class="cell-secondary">${esc(c.email || '')}${c.college ? ` · ${esc(c.college)}` : ''}</div></td><td>${statusBadge(c.status)}</td><td>${signalsCell(c.signals)}</td><td>${c.signals.offlineSeconds ? fmtDuration(c.signals.offlineSeconds) : '—'}</td><td>${c.signals.blockedLogins ? `<span class="badge danger">${plural(c.signals.blockedLogins, 'attempt')}</span>` : '—'}</td><td class="cell-secondary">${c.lastSeenAt ? fmtRelative(c.lastSeenAt) : '—'}</td></tr>`).join('')}</tbody></table>`)
      : emptyState({ ic: 'shield-check', title: 'No signals yet', body: 'When candidates leave the test, go offline or try to paste, they show up here.' }));
    setHtml($('#sim'), pairs.length ? raw(`<table class="table"><thead><tr><th>Match</th><th>Question</th><th>Candidate A</th><th>Candidate B</th></tr></thead><tbody>${pairs.map((p) => `<tr><td><span class="badge ${p.score >= 0.92 ? 'danger' : 'warning'}">${Math.round(p.score * 100)}%</span></td><td class="truncate">${esc(p.title || 'Question')}</td><td><button class="link-btn" data-open="${p.aId}">${esc(p.aName || p.aEmail)}</button></td><td><button class="link-btn" data-open="${p.bId}">${esc(p.bName || p.bEmail)}</button></td></tr>`).join('')}</tbody></table>`)
      : emptyState({ ic: 'scan-search', title: 'No similar answers found', body: 'Run the check after a drive. It compares every pair of answers to the same question.' }));
  };

  ctx.view.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open]');
    if (t) openCandidate(t.dataset.open, { onChange: draw });
  });
  ctx.view.addEventListener('keydown', (e) => {
    const t = e.target.closest('tr[data-open]');
    if (t && e.target === t && e.key === 'Enter') openCandidate(t.dataset.open, { onChange: draw });
  });
  $('#run-sim').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    setLoading(b, true);
    try {
      const r = await post('/api/admin/integrity/similarity/run', {}, { timeoutMs: 120000 });
      toast(`Compared ${plural(r.pairs, 'pair')} of answers across ${plural(r.questions, 'question')}; ${plural(r.flagged, 'match', 'matches')} found.`, { type: 'success' });
      await draw();
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setLoading(b, false);
    }
  });
  await draw();
  ctx.onRefresh(draw);
  return () => closeCandidate();
}
