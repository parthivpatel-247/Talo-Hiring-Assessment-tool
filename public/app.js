/* Candidate assessment flow — split-screen written answers.
 * Privacy: the server never sends any score/marks, so nothing here can display
 * or leak them. Answers are limited to 1000 words and autosaved. */

const $ = (id) => document.getElementById(id);
const show = (id) => { const el = $(id); if (el) el.classList.remove('hidden'); };
const hide = (id) => { const el = $(id); if (el) el.classList.add('hidden'); };
const WORD_LIMIT = 1000;
// Which site this page belongs to. The writers' site (two-part writing test) serves
// a page with <body data-team="docs">; the support test's page has no team attribute.
const TEAM = document.body && document.body.dataset.team === 'docs' ? 'docs' : 'support';
const IS_DOCS = TEAM === 'docs';
// Per-question word limit (writers' questions carry their own); support uses WORD_LIMIT.
// Writers' site: the clock syncs every 30 s and the same request saves the answer
// being typed (support: 10 s sync + a separate 15 s autosave). Fewer requests and
// database writes keep a full drive inside Cloudflare's free daily limits.
const HEARTBEAT_MS = IS_DOCS ? 30000 : 10000;
const HEARTBEAT_FAILS_BEFORE_OFFLINE = IS_DOCS ? 1 : 2;
function limitFor(q) { return (q && Number(q.wordLimit) > 0) ? Number(q.wordLimit) : WORD_LIMIT; }

// Theme toggle
(function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('talo-theme', next); } catch (e) {}
  });
})();

// Fill the duration / word-limit / grace figures shown on the intro page from the
// live config, so they always match what the assessment actually enforces (the
// admin can change the assessment length).
(function fillMeta() {
  function setAll(cls, value) {
    document.querySelectorAll('.' + cls).forEach((el) => { el.textContent = String(value); });
  }
  function run() {
    setAll('js-words', WORD_LIMIT);
    setAll('js-grace', RETURN_GRACE_SECONDS);
    fetch('/api/candidate/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg && cfg.assessmentMinutes) setAll('js-min', cfg.assessmentMinutes);
        if (IS_DOCS && cfg && cfg.parts) {
          setAll('js-p1q', cfg.parts.part1.questions); setAll('js-p1min', cfg.parts.part1.minutes);
          setAll('js-p2q', cfg.parts.part2.questions); setAll('js-p2min', cfg.parts.part2.minutes);
          setAll('js-total', cfg.parts.part1.minutes + cfg.parts.part2.minutes);
        }
      })
      .catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

async function api(path, opts = {}, tries = 0) {
  const { noRetry, ...fetchOpts } = opts;
  const res = await fetch(path, {
    ...fetchOpts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // The server asked for a few seconds' pause (a short per-request ceiling): wait
    // and send the same request again, up to twice. The clock sync opts out
    // (noRetry), since it simply runs again on its next tick.
    if (res.status === 429 && body.kind === 'ceiling' && !noRetry && tries < 2) {
      await new Promise((r) => setTimeout(r, Math.min(15, Number(body.retryAfter) || 5) * 1000));
      return api(path, opts, tries + 1);
    }
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  return res.json();
}

function formatTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}
function updateTimer(seconds) {
  const el = $('timer');
  el.classList.remove('hidden');
  el.textContent = formatTime(seconds);
  el.classList.toggle('low', seconds <= 60);
}
// Escapes text for HTML content AND attribute values (quotes included).
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function countWords(t) {
  const w = (t || '').trim();
  return w ? w.split(/\s+/).length : 0;
}
function clampWords(t, limit) {
  const parts = (t || '').trim().split(/\s+/);
  if (parts.length <= limit) return t;
  return parts.slice(0, limit).join(' ');
}
function insertAtCursor(el, text) {
  const s = el.selectionStart, e = el.selectionEnd;
  el.value = el.value.slice(0, s) + text + el.value.slice(e);
  el.selectionStart = el.selectionEnd = s + text.length;
}
function flashSavedTag(part) {
  const t = document.getElementById(`${part}-saved`);
  if (!t) return;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1400);
}

// Render sample data (markdown pipe tables / code fences) to safe HTML.
// Inline markdown on a single line: escape first, then `code` and **bold**.
function renderInline(s) {
  let h = escapeHtml(s);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return h;
}

// Rich renderer for question prompts and example boxes. Supports:
//   ## Title           -> problem title
//   > topic · Easy      -> topic subtitle + a coloured difficulty pill
//   ### Constraints     -> section sub-heading
//   - item / 1. item    -> lists
//   **Example 1**       -> starts an example card
//   Input:/Output:/Expected output:/Actual output:  -> monospace labelled rows
//   Explanation:/Note:  -> labelled prose rows
//   ```lang ... ```      -> code block (stays inside an example card if open)
//   | a | b |           -> table
//   **bold**, `code`    -> inline
function renderRich(md) {
  if (!md) return '';
  const lines = md.split('\n');
  let html = '', i = 0, inExample = false;
  const closeEx = () => { if (inExample) { html += '</div>'; inExample = false; } };
  const DIFF = { easy: 'diff-easy', medium: 'diff-medium', hard: 'diff-hard' };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    // fenced code — kept inside an open example card (e.g. a buggy program)
    if (/^```/.test(t)) {
      let code = ''; i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code += lines[i] + '\n'; i++; }
      i++; html += `<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`; continue;
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      closeEx();
      const head = line.split('|').map((c) => c.trim()).filter((c, idx, a) => !(idx === 0 && c === '') && !(idx === a.length - 1 && c === ''));
      i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i].split('|').map((c) => c.trim());
        if (cells[0] === '') cells.shift(); if (cells[cells.length - 1] === '') cells.pop();
        rows.push(cells); i++;
      }
      html += '<table class="mini"><thead><tr>' + head.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }

    if (/^##\s+/.test(t)) { closeEx(); html += `<div class="q-title">${renderInline(t.replace(/^##\s+/, ''))}</div>`; i++; continue; }
    if (/^###\s+/.test(t)) { closeEx(); html += `<div class="q-subhead">${renderInline(t.replace(/^###\s+/, ''))}</div>`; i++; continue; }

    // topic line: "> Arrays · Two Pointers · Easy" -> subtitle + difficulty pill
    if (/^>\s+/.test(t)) {
      closeEx();
      let topic = t.replace(/^>\s+/, '');
      let pill = '';
      const m = topic.match(/\s·\s*(Easy|Medium|Hard)\s*$/i);
      if (m) { topic = topic.slice(0, m.index).trim(); pill = `<span class="badge ${DIFF[m[1].toLowerCase()]}">${escapeHtml(m[1])}</span>`; }
      html += `<div class="q-topicrow"><span class="q-topic">${escapeHtml(topic)}</span>${pill}</div>`;
      i++; continue;
    }

    // example / buggy-program card header
    const exm = t.match(/^\*\*((?:Example|Buggy pseudocode|Buggy program|Pseudocode|Sample)[^*]*)\*\*$/i);
    if (exm) { closeEx(); html += `<div class="example"><div class="ex-head">${escapeHtml(exm[1])}</div>`; inExample = true; i++; continue; }

    // labelled row
    const lab = t.match(/^(Input|Output|Expected Output|Actual Output|Explanation|Note|Constraints)\s*:\s*(.*)$/i);
    if (lab) {
      const label = lab[1], val = lab[2];
      const mono = /^(input|output|expected output|actual output)$/i.test(label);
      const valHtml = mono ? `<code class="ex-val">${escapeHtml(val)}</code>` : `<span class="ex-exp">${renderInline(val)}</span>`;
      html += `<div class="ex-row"><span class="ex-label">${escapeHtml(label)}</span>${valHtml}</div>`;
      i++; continue;
    }

    if (/^[-*]\s+/.test(t)) {
      closeEx(); html += '<ul>';
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { html += `<li>${renderInline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`; i++; }
      html += '</ul>'; continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      closeEx(); html += '<ol>';
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) { html += `<li>${renderInline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`; i++; }
      html += '</ol>'; continue;
    }

    if (!t) { i++; continue; }
    closeEx();
    html += `<p>${renderInline(t)}</p>`; i++;
  }
  closeEx();
  return html;
}

// Back-compat: the example box uses the same rich renderer.
function renderSample(md) { return renderRich(md); }

// --- Login ---
$('login-btn').addEventListener('click', doLogin);
$('login-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
async function doLogin() {
  const email = $('login-email').value.trim();
  $('login-error').textContent = '';
  if (!email) { $('login-error').textContent = 'Please enter your email.'; return; }
  const btn = $('login-btn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const { name } = await api('/api/candidate/login', { method: 'POST', body: JSON.stringify({ email }) });
    await routeToStage(name);
  } catch (err) {
    $('login-error').textContent = err.message; btn.disabled = false; btn.textContent = 'Start assessment';
  }
}
async function routeToStage(name) {
  const { attempt } = await api('/api/candidate/me');
  hide('login-section');
  if (IS_DOCS) return routeDocs(attempt, name);
  // Single-part assessment. Fully done → terminal screen.
  if (attempt?.part1_submitted_at) { show('done-section'); return; }
  // Anti-cheat: a fresh page load while the timed test is running ends it — a
  // deliberate reload does NOT resume the clock (the server freezes it meanwhile).
  if (attempt?.part1_started_at) {
    await closeAssessment('Your assessment was closed because the page was reloaded while the timed test was in progress. Any answers you had saved have been submitted. If you believe this was a mistake, contact the assessment coordinator.');
    return;
  }
  $('overview-name').textContent = name ? `, ${name.split(' ')[0]}` : '';
  show('overview-section');
  P1.prefetch(); // load the questions in the background while they read the intro
}
// The consent checkbox must be ticked before the assessment can begin.
(function wireConsent() {
  const chk = $('consent-chk');
  const btn = $('begin-part1-btn');
  if (chk && btn) {
    const sync = () => { btn.disabled = !chk.checked; };
    chk.addEventListener('change', sync);
    sync();
  }
})();
$('begin-part1-btn').addEventListener('click', () => {
  const chk = $('consent-chk');
  if (chk && !chk.checked) return; // guard: can't begin without consenting
  hide('overview-section'); show('part1-section'); P1.prefetch();
});

// ---- Generic split-screen part controller ----
function makePart(part) {
  const state = { questions: [], answers: {}, idx: 0, interval: null, submitted: false, metrics: {} };
  // Per-question authenticity metrics (Part 2 only): how much was typed vs pasted
  // and how long the candidate actively spent. These are behavioral SIGNALS for
  // grading — never a verdict on their own.
  function met(qid) { return state.metrics[qid] || (state.metrics[qid] = { typed: 0, pasted: 0, maxPaste: 0, pastes: 0, firstAt: 0, lastAt: 0 }); }
  function touchTime(m) { const t = Date.now(); if (!m.firstAt) m.firstAt = t; m.lastAt = t; }
  const qnav = $(`${part}-qnav`);
  const qpanel = $(`${part}-qpanel`);
  const answer = $(`${part}-answer`);
  const wc = $(`${part}-wc`);
  const savedTag = $(`${part}-saved`);
  const prevBtn = $(`${part}-prev`);
  const nextBtn = $(`${part}-next`);
  let saveTimer;

  function current() { return state.questions[state.idx]; }

  function renderNav() {
    qnav.innerHTML = state.questions.map((q, i) =>
      `<button type="button" class="qpill ${i === state.idx ? 'active' : ''} ${state.answers[q.id] && state.answers[q.id].trim() ? 'done' : ''}" data-i="${i}">Q${i + 1}</button>`
    ).join('');
    qnav.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => goTo(Number(b.dataset.i))));
    prevBtn.disabled = state.idx === 0;
    // Only show the Submit button on the LAST question; until then "Next" is the
    // only way forward, so a candidate can't submit by accident on Q1.
    const isLast = state.idx === state.questions.length - 1;
    nextBtn.classList.toggle('hidden', isLast);
    const submitBtn = $(`${part}-submit-btn`);
    if (submitBtn) submitBtn.classList.toggle('hidden', !isLast);
  }

  function renderQuestion() {
    const q = current();
    // Part 1 shows SQL/Python (useful context); Part 2 is theory — no language label;
    // Part 3 shows the question kind (buggy-code fix vs break-fix scenario).
    let badge = '';
    if (part === 'part1' && !IS_DOCS) {
      badge = `<span class="badge muted">${escapeHtml((q.category || '').toUpperCase())}</span>`;
    } else if (part === 'part3') {
      badge = `<span class="badge">${q.kind === 'buggy_fix' ? 'Buggy-code fix' : 'Break-fix scenario'}</span>`;
    }
    const title = part === 'part3' && q.title ? `<div class="qtitle" style="font-weight:600;margin-bottom:6px">${escapeHtml(q.title)}</div>` : '';
    // Part 3 buggy-fix questions ship a broken code snippet the candidate must read.
    const code = q.codeSnippet ? `<pre class="codeblock" style="background:#0f172a;color:#e2e8f0;padding:14px;border-radius:10px;overflow:auto;font-size:13px;line-height:1.5;margin-top:10px">${escapeHtml(q.codeSnippet)}</pre>` : '';
    qpanel.innerHTML =
      `<div class="qhead"><span class="qnum">Question ${state.idx + 1} of ${state.questions.length}</span>${badge}</div>` +
      title +
      `<div class="qprompt">${renderRich(q.prompt)}</div>` +
      code +
      (q.sampleData ? `<div class="sampledata">${renderSample(q.sampleData)}</div>` : '') +
      (q.hint ? `<details class="hintbox"><summary>💡 Show a hint</summary><div class="hinttext">${escapeHtml(q.hint)}</div></details>` : '');
    // Retrigger a quick fade so moving between questions reads as a smooth swap.
    qpanel.classList.remove('q-enter'); void qpanel.offsetWidth; qpanel.classList.add('q-enter');
    qpanel.scrollTop = 0;
    answer.value = state.answers[q.id] || '';
    updateWordCount();
  }

  function updateWordCount() {
    const n = countWords(answer.value);
    const limit = limitFor(current());
    wc.textContent = `${n} / ${limit} words`;
    wc.classList.toggle('near', n >= limit - 30 && n < limit);
    wc.classList.toggle('at', n >= limit);
  }

  function goTo(i) {
    if (i < 0 || i >= state.questions.length) return;
    saveCurrent(); // snapshot the outgoing answer before switching
    state.idx = i; renderNav(); renderQuestion();
  }

  const lastSaved = {};
  const inFlight = {}; // questionId -> the save request currently being sent
  // Snapshot the current answer to the server. Overwrites the same row, so only
  // the latest version is ever kept. Called on a 15s timer, on question switch,
  // and before submit. One save per question at a time: a newer save waits for the
  // older one, so an old version can never land after a newer one. Resolves to
  // true if the latest text is saved.
  function saveCurrent() {
    const q = current(); if (!q) return Promise.resolve(true);
    return saveQuestion(q.id);
  }
  function saveQuestion(qid) {
    const run = async () => {
      const val = state.answers[qid] || '';
      if (lastSaved[qid] === val) return true; // unchanged since the last good save
      try {
        // noRetry: never resend a stale copy later; the next autosave sends the latest.
        await api(`/api/candidate/${part}/answer`, { method: 'POST', noRetry: true, body: JSON.stringify({ questionId: qid, answerText: val }) });
        lastSaved[qid] = val;
        savedTag.classList.add('show'); setTimeout(() => savedTag.classList.remove('show'), 1400);
        return true;
      } catch { return false; }
    };
    const p = (inFlight[qid] || Promise.resolve()).then(run, run);
    inFlight[qid] = p;
    return p;
  }
  answer.addEventListener('input', (e) => {
    const clamped = clampWords(answer.value, limitFor(current()));
    if (clamped !== answer.value) answer.value = clamped;
    const q = current();
    if (!q) return; // no questions loaded (e.g. the part could not start)
    state.answers[q.id] = answer.value;
    // Part 2: count genuine typing (not paste) toward the "typed" signal.
    if (part === 'part2' && q) {
      const it = e && e.inputType;
      const m = met(q.id);
      touchTime(m);
      if (it && it.indexOf('insert') === 0 && it !== 'insertFromPaste' && it !== 'insertFromDrop') {
        m.typed += (e.data ? e.data.length : 1);
      }
    }
    updateWordCount();
    renderNav();
  });
  // Extra safety net on top of the 15s autosave: snapshot the moment focus leaves
  // the answer box (e.g. clicking Next, a nav button, or away), so nothing typed is
  // ever lost between the timed saves.
  answer.addEventListener('blur', () => { saveCurrent(); });

  // Code-friendly editing for Part 1 (SQL/Python) and Part 3 (may include code
  // in a fix): Tab inserts spaces, Enter keeps indentation, a line ending in ':'
  // adds one more level.
  if ((part === 'part1' || part === 'part3') && !IS_DOCS) {
    answer.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        // Plain Tab indents; Shift+Tab is left alone so keyboard users can move
        // focus out of the editor to the nav/save buttons (accessibility).
        e.preventDefault();
        insertAtCursor(answer, '    ');
        answer.dispatchEvent(new Event('input'));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pos = answer.selectionStart;
        const val = answer.value;
        const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        const curLine = val.slice(lineStart, pos);
        let indent = (curLine.match(/^[ \t]*/) || [''])[0];
        if (curLine.replace(/\s+$/, '').endsWith(':')) indent += '    '; // block opener → deeper indent
        insertAtCursor(answer, '\n' + indent);
        answer.dispatchEvent(new Event('input'));
      }
    });
  }

  // Part 2: pasting (and drag-drop) is BLOCKED — candidates must type their
  // answer in their own words. Every blocked attempt is recorded for the admin,
  // but nothing is inserted into the answer, so no pasted text can enter.
  if (part === 'part2' && IS_DOCS) {
    // Writers' Part 2 is open book: pasting is ALLOWED. Each paste is recorded (size
    // and question) for the hiring team, and counted in the answer's metrics.
    answer.addEventListener('paste', (e) => {
      let len = 0;
      try { len = ((e.clipboardData || window.clipboardData).getData('text') || '').length; } catch (_) {}
      const q = current();
      if (!q) return;
      const m = met(q.id);
      touchTime(m);
      m.pasted += len; m.pastes += 1; m.maxPaste = Math.max(m.maxPaste, len);
      logSwitch('part2', 'paste', { chars: len, questionId: q.id });
    });
  } else if (part === 'part2') {
    answer.addEventListener('paste', (e) => {
      e.preventDefault();
      let len = 0;
      try { len = ((e.clipboardData || window.clipboardData).getData('text') || '').length; } catch (_) {}
      const q = current();
      if (q) logSwitch('part2', 'paste_blocked', { chars: len, questionId: q.id });
      flashWarning('Pasting is disabled — please type your answer in your own words.', true);
    });
    answer.addEventListener('drop', (e) => {
      e.preventDefault();
      const q = current();
      if (q) logSwitch('part2', 'paste_blocked', { chars: 0, questionId: q.id });
      flashWarning('Drag-and-drop is disabled — please type your answer.', true);
    });
  }

  // Send the aggregated authenticity metrics for every answered question. Called
  // once at submit so grading has typed-vs-pasted and time-spent signals.
  function metricsPayloads() {
    return Object.keys(state.metrics).map((qid) => {
      const m = state.metrics[qid];
      return { type: 'metrics', questionId: qid, typed: Math.round(m.typed), pasted: Math.round(m.pasted), pastes: m.pastes, ms: Math.max(0, m.lastAt - m.firstAt) };
    });
  }
  // Resolves once every metrics row has been sent (failures are ignored: these are
  // signals for the panel, never a reason to hold up a submit).
  function flushMetrics() {
    if (part !== 'part2') return Promise.resolve();
    return Promise.all(metricsPayloads().map((b) =>
      api('/api/candidate/part2/tab-switch', { method: 'POST', body: JSON.stringify(b) }).catch(() => {})));
  }
  // For a page that is closing or reloading: the browser delivers beacons even as
  // the page goes away, where an ordinary request would be cancelled.
  function beaconMetrics() {
    if (part !== 'part2' || !navigator.sendBeacon) return;
    for (const b of metricsPayloads()) {
      try { navigator.sendBeacon('/api/candidate/part2/tab-switch', new Blob([JSON.stringify(b)], { type: 'application/json' })); } catch {}
    }
  }

  prevBtn.addEventListener('click', () => goTo(state.idx - 1));
  nextBtn.addEventListener('click', () => goTo(state.idx + 1));

  async function load(preloaded) {
    // Use questions returned by /start or /prepare when provided (no extra round-trip).
    const questions = preloaded || (await api(`/api/candidate/${part}/questions`)).questions;
    state.questions = questions || [];
    // Restore any previously-saved answers (e.g. after an admin "Resume" following
    // a dropped connection) so the candidate continues where they left off.
    for (const q of state.questions) {
      if (q && q.answer != null && q.answer !== '' && !state.answers[q.id]) state.answers[q.id] = q.answer;
    }
    state.idx = 0;
    if (!state.questions.length) {
      qnav.innerHTML = '';
      qpanel.innerHTML = '<div class="notice warn">No questions are available for this section yet. Please contact the assessment coordinator.</div>';
      return;
    }
    renderNav(); renderQuestion();
  }

  function startAutosave() {
    clearInterval(state.saveInterval);
    if (IS_DOCS) return; // writers' site: answers ride along with the clock sync
    state.saveInterval = setInterval(saveCurrent, 15000); // 15s snapshot
  }
  // Writers' site: the current answer, if it changed since the last save.
  function pendingAnswer() {
    if (!IS_DOCS) return null;
    const q = current(); if (!q) return null;
    const val = state.answers[q.id] || '';
    return lastSaved[q.id] === val ? null : { questionId: q.id, answerText: val };
  }

  // Prefetch + pre-render questions into the (hidden) panel BEFORE the candidate
  // clicks begin, so the questions are already on screen the instant they start.
  // Does not start the timer or change status.
  async function prefetch() {
    if (state.prefetched || state.prefetching) return;
    state.prefetching = true;
    try {
      const { questions } = await api(`/api/candidate/${part}/prepare`, { method: 'POST' });
      if (questions && questions.length) {
        await load(questions);
        state.prefetched = true;
      }
    } catch {}
    finally { state.prefetching = false; }
  }

  function startHeartbeat(onExpire) {
    // Smooth 1-second local countdown so the clock never appears to freeze
    // between server syncs.
    clearInterval(state.tick);
    state.tick = setInterval(() => {
      if (state.remaining == null) return;
      state.remaining = Math.max(0, state.remaining - 1);
      updateTimer(state.remaining);
      if (state.remaining <= 0) { stop(); onExpire(); }
    }, 1000);
    // Periodic server sync — authoritative time, and pauses on disconnect.
    clearInterval(state.interval);
    state.hbFails = 0;
    state.interval = setInterval(async () => {
      try {
        const pending = pendingAnswer();
        const res = await api(`/api/candidate/${part}/heartbeat`, { method: 'POST', noRetry: true, ...(pending ? { body: JSON.stringify(pending) } : {}) });
        state.busy = 0;
        const remainingSeconds = res.remainingSeconds;
        if (pending && res.saved) {
          lastSaved[pending.questionId] = pending.answerText;
          savedTag.classList.add('show'); setTimeout(() => savedTag.classList.remove('show'), 1400);
        }
        state.hbFails = 0;
        if (typeof goOnline === 'function') goOnline(); // recovered
        state.remaining = remainingSeconds;
        updateTimer(remainingSeconds);
        if (remainingSeconds <= 0) { stop(); onExpire(); }
      } catch (err) {
        // A 401 means the session was ended (access revoked by the invigilator), not a
        // network problem — say so instead of "connection lost".
        if (err && err.status === 401) { stop(); sessionEnded(err.code); return; }
        // 429 = the server is up but asked us to slow down for a few seconds: skip
        // this sync (the local clock keeps running) rather than treat it as offline.
        if (err && err.status === 429) {
          state.busy = (state.busy || 0) + 1;
          if (state.busy === 4) flashWarning('The server is busy for a moment. Keep going — your answers and time are safe.', false);
          return;
        }
        // Connection lost: after 2 misses, pause the timer and show the overlay.
        state.hbFails = (state.hbFails || 0) + 1;
        if (state.hbFails >= HEARTBEAT_FAILS_BEFORE_OFFLINE && typeof goOffline === 'function') goOffline();
      }
    }, HEARTBEAT_MS);
  }
  function stop() { clearInterval(state.interval); clearInterval(state.saveInterval); clearInterval(state.tick); }

  return { state, load, startAutosave, prefetch, startHeartbeat, stop, renderNav, saveCurrent, flushMetrics, beaconMetrics };
}

const P1 = makePart('part1');
// Writers' site only: the open-book Part 2 (its elements exist only on that page).
const P2 = IS_DOCS ? makePart('part2') : null;

// The single closed-book, locked-down part on screen right now, or null.
function activeLockedPart() {
  return isActive('part1') ? 'part1' : null;
}
function lockedCtrl() { return P1; }

// ---- Connection-loss handling ----
// If the internet drops mid-test, PAUSE the timer and show a blocking overlay;
// when the connection returns, resume automatically from where it left off (the
// server already freezes the clock while heartbeats stop). The candidate is told
// NOT to refresh — a deliberate reload still ends the test (anti-cheat).
let currentPart = null; // { ctrl, onExpire } of the part in progress
let offline = false;
function goOffline() {
  if (offline || !currentPart || currentPart.ctrl.state.submitted || assessmentClosed) return;
  offline = true;
  if (typeof clearAwayTimer === 'function') clearAwayTimer(); // a dropped connection is not a tab-switch — cancel any away countdown
  currentPart.ctrl.stop(); // freeze the local countdown + heartbeat + autosave
  showOfflineOverlay();
  if (IS_DOCS) startRecoveryProbe();
}
// Writers' site: while the "connection lost" screen is up, check every 10 s whether
// the server is reachable again (the browser's 'online' event doesn't fire when the
// network was up but a request failed), and resume as soon as it is.
let recoveryProbe = null;
function startRecoveryProbe() {
  clearInterval(recoveryProbe);
  recoveryProbe = setInterval(async () => {
    if (!offline) { clearInterval(recoveryProbe); recoveryProbe = null; return; }
    try { await api('/api/candidate/me'); clearInterval(recoveryProbe); recoveryProbe = null; goOnline(); }
    catch (err) { if (err && err.status === 401) { clearInterval(recoveryProbe); recoveryProbe = null; sessionEnded(err.code); } /* else still offline */ }
  }, 10000);
}
function goOnline() {
  if (!offline) return;
  offline = false;
  removeOfflineOverlay();
  if (currentPart && !currentPart.ctrl.state.submitted && !assessmentClosed) {
    currentPart.ctrl.startAutosave();
    currentPart.ctrl.startHeartbeat(currentPart.onExpire); // re-syncs remaining time + resumes the clock
  }
}
window.addEventListener('offline', goOffline);
// Optimistically resume on the browser's 'online' event; if the network is still
// flaky the heartbeat will just re-pause. The heartbeat itself is the primary,
// reliable detector (it works even when 'offline'/'online' events don't fire).
window.addEventListener('online', goOnline);
function removeOfflineOverlay() { const o = document.getElementById('offline-overlay'); if (o) o.remove(); }
function showOfflineOverlay() {
  removeOfflineOverlay();
  const o = document.createElement('div');
  o.id = 'offline-overlay';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.97);color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;z-index:100002;padding:24px;';
  o.innerHTML = '<div style="max-width:440px"><div style="font-size:40px;margin:0 0 6px">📡</div><h2 style="color:#fff;margin:0 0 12px">Connection lost — timer paused</h2><p style="color:#cbd5e1;margin:0 0 8px">Your clock is <strong>frozen at the exact time you had left</strong>. Please check your internet — the moment you are back online, the test resumes automatically from the same question with the same time remaining.</p><p style="color:#fca5a5;margin:14px 0 0">Do NOT refresh or close this page — refreshing will end your test.</p></div>';
  document.body.appendChild(o);
}

// ---- Part 1 ----
async function beginPart(part, resuming) {
  if (part === 'part1') {
    if (!resuming) {
      try { await document.documentElement.requestFullscreen(); } catch {}
    }
    hide('part1-fullscreen-gate'); show('part1-work');
    document.body.classList.add('assessment');
    try {
      // Questions were prefetched + pre-rendered on the intro screen, so this
      // only starts the timer. If prefetch didn't finish, fall back to the
      // questions the start call returns.
      const { durationSeconds, questions } = await api('/api/candidate/part1/start', { method: 'POST' });
      P1.state.remaining = durationSeconds;
      updateTimer(durationSeconds);
      if (!P1.state.prefetched) await P1.load(questions);
      P1.startAutosave();
      engageLockdown();
      currentPart = { ctrl: P1, onExpire: finishPart1 };
      P1.startHeartbeat(() => finishPart1());
    } catch (err) {
      if (err && err.status === 401) { sessionEnded(err.code); return; }
      {
        // Go back to the start screen with the reason (for example "the assessment
        // has not opened yet"), out of full screen, so they can retry.
        hide('part1-work'); show('part1-fullscreen-gate');
        document.body.classList.remove('assessment');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        let note = document.getElementById('part1-start-error');
        if (!note) { note = document.createElement('div'); note.id = 'part1-start-error'; note.className = 'notice warn'; $('part1-fullscreen-gate').prepend(note); }
        note.textContent = err.message;
        $('part1-fullscreen-btn').textContent = 'Try again';
        return;
      }
    }
  }
}
$('part1-fullscreen-btn').addEventListener('click', () => beginPart('part1', false));
async function submitPart1Clicked() {
  const answered = Object.values(P1.state.answers).filter((a) => a && a.trim()).length;
  lockdownArmed = false; // the confirm dialog blurs the window — don't count it as a violation
  if (answered < P1.state.questions.length && !confirm(`You've answered ${answered} of ${P1.state.questions.length}. Submit ${IS_DOCS ? 'Part 1' : 'your assessment'} anyway?`)) {
    lockdownArmed = true; return;
  }
  if (!confirm(IS_DOCS
    ? 'Submit Part 1? You will not be able to change your Part 1 answers after this. Part 2 starts when you are ready.'
    : 'Submit your assessment? You will not be able to change your answers after this.')) { lockdownArmed = true; return; }
  await finishPart1();
}
$('part1-submit-btn').addEventListener('click', submitPart1Clicked);
$('part1-save').addEventListener('click', async () => { if (await P1.saveCurrent()) flashSavedTag('part1'); else flashWarning('Not saved yet. Check your connection; it will be saved automatically when it can.', false); });
async function finishPart1() {
  if (P1.state.submitted) return; // guard against double submit (e.g. timer + auto-submit)
  currentPart = null; offline = false; removeOfflineOverlay();
  P1.state.submitted = true;
  disengageLockdown();
  await P1.saveCurrent();
  P1.stop();
  await api('/api/candidate/part1/submit', { method: 'POST' }).catch(() => {});
  document.body.classList.remove('assessment');
  hide('part1-section');
  $('timer').classList.add('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (IS_DOCS) {
    // If the invigilator already ended the whole test (force submit), go to the end screen.
    const me = await api('/api/candidate/me').catch(() => null);
    if (me && me.attempt && me.attempt.part2_submitted_at) { show('done-section'); return; }
    showBetween(P1.state.remaining != null && P1.state.remaining <= 0);
    return;
  }
  show('done-section');
}

// (Part 2 and Part 3 are retired — the assessment is a single locked-down part.)

// ---- Part 1 lockdown ----
// Part 1 is closed-book and monitored. A browser can't truly prevent OS-level
// app/space switching, so we do the strongest thing a web app can: detect every
// way of leaving (tab hidden, window blur, full-screen exit), blank the content
// behind a countdown overlay, and auto-submit if they don't return within 10s.
// STRICT rule: leaving the test area (switching tab/app/window, or exiting
// full-screen) starts a 10-second countdown. Return within 10s and the test
// continues (the attempt is still recorded for the hiring team); fail to return
// in time and the assessment is submitted and closed automatically — no excuses.
const RETURN_GRACE_SECONDS = 10;
let lockdownArmed = false;
let fsWatch = null;
let fsOut = false; // debounce: true while currently out of full-screen
let awayTick = null;    // the 10s countdown interval while the candidate is away
let awayDeadline = 0;   // epoch ms by which they must be fully back

function engageLockdown() {
  lockdownArmed = true; fsOut = false; lastViolationAt = 0;
  // Watchdog: some browsers/OSes don't reliably fire fullscreenchange (e.g. an
  // OS gesture, or a missed event). Poll every 500ms so leaving full-screen is
  // ALWAYS caught, not just sometimes.
  clearInterval(fsWatch);
  fsWatch = setInterval(checkFullscreen, 500);
}
function disengageLockdown() { lockdownArmed = false; clearInterval(fsWatch); clearAwayTimer(); removeOverlay(); }

// Single source of truth for "are we still in full-screen during Part 1?".
// Called by the watchdog and by every fullscreenchange event, and debounced so
// one exit counts as one violation. Re-entering full-screen also counts as
// "returning", which cancels the away countdown.
function checkFullscreen() {
  if (offline) return; // paused for connection loss — don't count focus/fullscreen changes
  const lp = activeLockedPart();
  if (!lockdownArmed || !lp || lockedCtrl(lp).state.submitted) return;
  const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  if (!inFs) {
    // Out of full screen with no countdown running (for example a second exit right
    // after returning, which the 1.5 s debounce swallowed): raise it again, so staying
    // out of full screen always leads to the countdown.
    if (!fsOut || !awayTick) { fsOut = true; violation('fullscreen_exited'); }
  } else {
    fsOut = false;
    checkReturned();
  }
}

// True only when the candidate is fully present: in full-screen, tab visible,
// and the window focused. Anything less means they've left the test area.
function fullyPresent() {
  const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  return inFs && !document.hidden && document.hasFocus();
}

// If an away countdown is running and the candidate is now fully back, cancel it.
function checkReturned() {
  if (!awayTick) return;
  if (fullyPresent()) {
    clearAwayTimer();
    flashWarning('You are back — your timer kept running. Leaving again will auto-submit your assessment.', true);
  }
}

function clearAwayTimer() { if (awayTick) { clearInterval(awayTick); awayTick = null; } removeOverlay(); }

// Brief warning toast that auto-dismisses after 2 seconds. Gives the candidate
// an immediate heads-up the moment a switch is detected, on top of the blocking
// overlay for Part 1 (and as a gentle notice for open-book Part 2).
function flashWarning(text, danger = true) {
  let t = document.getElementById('warn-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'warn-toast';
    t.setAttribute('role', 'alert');
    document.body.appendChild(t);
  }
  t.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(0);
    background:${danger ? '#ef4444' : '#334155'};color:#fff;padding:12px 22px;border-radius:12px;
    font-weight:600;font-size:0.95rem;max-width:92vw;text-align:center;z-index:100001;
    box-shadow:0 10px 30px rgba(0,0,0,0.35);opacity:1;transition:opacity .35s ease;`;
  t.textContent = text;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2000);
}

let lastViolationAt = 0;
function violation(type) {
  if (offline) return; // connection lost — the test is paused, not being cheated on
  const lp = activeLockedPart();
  if (!lockdownArmed || !lp || lockedCtrl(lp).state.submitted) return;
  // A single "leave" can fire several events at once (tab hidden + window blur +
  // full-screen exit, plus the 500ms watchdog). Debounce so one real switch is
  // recorded once.
  const now = Date.now();
  if (now - lastViolationAt < 1500) return;
  lastViolationAt = now;
  logSwitch(lp, type); // recorded for the hiring team's integrity flags
  if (awayTick) return; // already counting down — don't restart the clock

  // Start the 10-second return-or-submit countdown.
  awayDeadline = Date.now() + RETURN_GRACE_SECONDS * 1000;
  showAwayCountdown(RETURN_GRACE_SECONDS);
  awayTick = setInterval(() => {
    // They may have come back without any further event firing — check first.
    if (fullyPresent()) { checkReturned(); return; }
    const left = Math.ceil((awayDeadline - Date.now()) / 1000);
    if (left <= 0) {
      clearAwayTimer();
      closeAssessment(`You left the test area and did not return within ${RETURN_GRACE_SECONDS} seconds. Your assessment has been submitted and closed automatically, and this has been recorded for the hiring team.`);
    } else {
      updateAwayCountdown(left);
    }
  }, 250);
}

// Finalize and end the entire assessment: stop timers, submit both parts
// (keeping whatever answers were saved), exit full-screen, and show a terminal
// message. Used by the 3-strike lockdown and by reload detection.
let assessmentClosed = false;
async function closeAssessment(message) {
  if (assessmentClosed) return;
  assessmentClosed = true;
  currentPart = null; offline = false; removeOfflineOverlay();
  lockdownArmed = false;
  clearInterval(fsWatch);
  // Single-part assessment — finalize the one live part.
  P1.state.submitted = true;
  try { await P1.saveCurrent(); } catch {}
  P1.stop();
  if (IS_DOCS) {
    // Writers' test: closing early ends BOTH parts (saved answers are kept).
    if (P2) {
      const p2Started = P2.state.questions.length > 0;
      P2.state.submitted = true; try { await P2.saveCurrent(); } catch {} P2.stop();
      if (p2Started) await P2.flushMetrics();
    }
    await api('/api/candidate/part2/submit', { method: 'POST' }).catch(() => {});
  } else {
    await api('/api/candidate/part1/submit', { method: 'POST' }).catch(() => {});
  }
  document.body.classList.remove('assessment');
  removeOverlay();
  ['overview-section', 'part1-section'].forEach(hide);
  if (IS_DOCS) ['between-section', 'part2-section'].forEach(hide);
  $('timer').classList.add('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const p = document.querySelector('#done-section p');
  if (p && message) p.textContent = message;
  show('done-section');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (activeLockedPart()) violation('tab_hidden'); }
  else { checkReturned(); } // came back to this tab — cancel the countdown if fully present
});
// Both events route through the same debounced check (plus the 500ms watchdog),
// so leaving full-screen is caught consistently across browsers.
document.addEventListener('fullscreenchange', checkFullscreen);
document.addEventListener('webkitfullscreenchange', checkFullscreen);
window.addEventListener('blur', () => {
  if (!activeLockedPart()) return;
  // Filter transient blurs (e.g. focus flicker); only a real app/space switch
  // leaves the document without focus a moment later.
  setTimeout(() => { if (!document.hasFocus() && activeLockedPart()) violation('window_blur'); }, 400);
});
// Regaining window focus can cancel the away countdown (they clicked back in).
window.addEventListener('focus', () => { checkReturned(); });

// Closed-book: block paste, COPY, CUT, drag-drop and the right-click menu during
// the assessment — on the answer box AND document-wide, so neither the question
// text nor the answer can be copied out to an external tool.
(function guardLockedInput() {
  const ta = $('part1-answer');
  if (ta) ['paste', 'drop', 'copy', 'cut'].forEach((ev) =>
    ta.addEventListener(ev, (e) => {
      if (!activeLockedPart()) return;
      e.preventDefault();
      if (ev === 'copy' || ev === 'cut') flashWarning('Copying is disabled during the assessment.', true);
      else if (ev === 'paste') flashWarning('Pasting is disabled — type your answer in your own words.', true);
    }));
  // Document-wide guards (catch copying the QUESTION text, not just the answer).
  ['copy', 'cut', 'paste'].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (!activeLockedPart()) return;
      e.preventDefault();
      if (ev !== 'paste') flashWarning('Copying is disabled during the assessment.', true);
    }));
  document.addEventListener('contextmenu', (e) => { if (activeLockedPart()) e.preventDefault(); });
})();

function isActive(part) {
  return !$(`${part}-section`).classList.contains('hidden') && !$(`${part}-work`).classList.contains('hidden');
}
function logSwitch(part, type, meta) {
  api(`/api/candidate/${part}/tab-switch`, { method: 'POST', body: JSON.stringify({ type, ...(meta || {}) }) }).catch(() => {});
}
function removeOverlay() { const o = document.getElementById('lockdown-overlay'); if (o) o.remove(); }

// The 10-second "return or be submitted" overlay. Shows a live countdown and a
// button to jump back into full-screen. Returning (full-screen + focus + visible)
// cancels it automatically; reaching 0 auto-submits.
function showAwayCountdown(seconds) {
  removeOverlay();
  const o = document.createElement('div');
  o.id = 'lockdown-overlay';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.98);color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;z-index:99999;padding:24px;';
  o.innerHTML = `<div style="max-width:440px">
      <h2 style="color:#fff;margin:0 0 10px">You left the test area</h2>
      <p style="color:#cbd5e1;margin:0 0 8px">Your assessment must stay in full-screen — no switching tabs, windows, or apps.</p>
      <div id="away-count" style="font-size:54px;font-weight:800;line-height:1.1;margin:14px 0;color:#fca5a5">${seconds}</div>
      <p style="color:#fca5a5;margin:0 0 20px">Return within <strong>${RETURN_GRACE_SECONDS} seconds</strong> or your assessment is <strong>submitted automatically</strong>. This has been recorded.</p>
      <button id="lockdown-return">Return to full-screen now</button>
    </div>`;
  document.body.appendChild(o);
  document.getElementById('lockdown-return').addEventListener('click', async () => {
    try { await document.documentElement.requestFullscreen(); } catch {}
    checkReturned();
  });
}
function updateAwayCountdown(seconds) {
  const el = document.getElementById('away-count');
  if (el) el.textContent = seconds;
}

// ---- Writers' site: two parts (Part 1 closes, then Part 2 opens) ----
// Where to put a signed-in writer on page load.
async function routeDocs(attempt, name) {
  const a = attempt || {};
  if (a.part2_submitted_at) { show('done-section'); return; }
  // A fresh page load while a part is running ends the assessment (same rule as
  // the support test). Between the parts nothing is running, so a reload is fine.
  if ((a.part1_started_at && !a.part1_submitted_at) || a.part2_started_at) {
    await closeAssessment('Your assessment was closed because the page was reloaded while a timed part was in progress. Any answers you had saved have been submitted. If you believe this was a mistake, contact the assessment coordinator.');
    return;
  }
  if (a.part1_submitted_at) { showBetween(false); return; }
  $('overview-name').textContent = name ? `, ${name.split(' ')[0]}` : '';
  show('overview-section');
  P1.prefetch();
}

// The session ended: access revoked, an admin Resume/Retake (sign in again), or the
// test was started from another browser (only that browser can continue).
function sessionEnded(code) {
  currentPart = null; offline = false; removeOfflineOverlay();
  lockdownArmed = false; clearInterval(fsWatch); clearAwayTimer();
  [P1, P2].forEach((c) => { if (c) { c.state.submitted = true; c.stop(); } });
  document.body.classList.remove('assessment');
  ['overview-section', 'part1-section', 'between-section', 'part2-section'].forEach(hide);
  $('timer').classList.add('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const p = document.querySelector('#done-section p');
  if (p) p.textContent = code === 'other_session'
    ? 'This test is running in another browser, and only the browser that started it can continue. Your saved answers have been kept. Speak to the invigilator.'
    : code === 'session_ended'
      ? 'Your session has ended. Reload the page and sign in again to continue. Your saved answers have been kept.'
      : 'Your session was ended by the hiring team. Your saved answers have been kept. If you think this is a mistake, speak to the invigilator.';
  show('done-section');
}

function showBetween(timeUp) {
  ['overview-section', 'part1-section', 'part2-section'].forEach(hide);
  if (timeUp) {
    $('between-title').textContent = "Time's up for Part 1";
    $('between-note').textContent = 'Your saved Part 1 answers have been submitted and can no longer be changed.';
  }
  show('between-section');
}

let p2Starting = false;
async function beginPart2() {
  if (p2Starting || !P2) return;
  p2Starting = true;
  const btn = $('start-part2-btn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  $('between-error').textContent = '';
  try {
    const { durationSeconds, questions } = await api('/api/candidate/part2/start', { method: 'POST' });
    hide('between-section'); show('part2-section');
    document.body.classList.add('assessment'); // wide two-column layout, as in Part 1
    P2.state.remaining = durationSeconds;
    updateTimer(durationSeconds);
    await P2.load(questions);
    P2.startAutosave();
    currentPart = { ctrl: P2, onExpire: finishPart2 };
    P2.startHeartbeat(() => finishPart2());
  } catch (err) {
    if (err && err.status === 401) { sessionEnded(err.code); return; }
    $('between-error').textContent = `Could not start Part 2: ${err.message}. Please tell the invigilator.`;
    btn.disabled = false; btn.textContent = 'Start Part 2';
  } finally { p2Starting = false; }
}

async function submitPart2Clicked() {
  const answered = Object.values(P2.state.answers).filter((a) => a && a.trim()).length;
  if (answered < P2.state.questions.length && !confirm(`You've answered ${answered} of ${P2.state.questions.length} Part 2 questions. Submit your assessment anyway?`)) return;
  if (!confirm('Submit your assessment? You will not be able to change your answers after this.')) return;
  await finishPart2();
}

async function finishPart2() {
  if (!P2 || P2.state.submitted) return;
  currentPart = null; offline = false; removeOfflineOverlay();
  P2.state.submitted = true;
  await P2.saveCurrent();
  P2.stop();
  await P2.flushMetrics();
  await api('/api/candidate/part2/submit', { method: 'POST' }).catch(() => {});
  document.body.classList.remove('assessment');
  hide('part2-section'); show('done-section');
  $('timer').classList.add('hidden');
}

if (IS_DOCS) {
  $('start-part2-btn').addEventListener('click', beginPart2);
  $('part2-submit-btn').addEventListener('click', submitPart2Clicked);
  $('part2-save').addEventListener('click', async () => { if (await P2.saveCurrent()) flashSavedTag('part2'); else flashWarning('Not saved yet. Check your connection; it will be saved automatically when it can.', false); });
  // Part 2 is open book: leaving the tab is allowed, never blocked, and recorded.
  const part2Running = () => P2 && !P2.state.submitted && !$('part2-section').classList.contains('hidden') && currentPart && currentPart.ctrl === P2;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && part2Running() && !offline) logSwitch('part2', 'tab_hidden');
  });
  // Switching to another window (a second monitor, say) blurs the page without hiding
  // the tab. Wait a moment so a tab switch, which fires both, is logged only once.
  window.addEventListener('blur', () => {
    if (!part2Running() || offline) return;
    setTimeout(() => { if (!document.hidden && !document.hasFocus() && part2Running() && !offline) logSwitch('part2', 'window_blur'); }, 400);
  });
  // Closing or reloading the page during Part 2 (a reload ends the test) still
  // delivers the typing metrics the panel sees next to each answer.
  window.addEventListener('pagehide', () => { if (part2Running()) P2.beaconMetrics(); });
}

// Resume on refresh
(async () => { try { await routeToStage(); } catch {} })();

// End screen: sign this browser out so the next candidate can sign in (shared lab PCs).
if ($('switch-user-btn')) $('switch-user-btn').addEventListener('click', async () => {
  try { await api('/api/candidate/logout', { method: 'POST' }); } catch {}
  location.reload();
});
