/* The timed exam: question panes, code editor, autosave, connection handling
   and the screen lock. Server time is the source of truth; this file only
   renders it and reports what happens in the browser.

   Connection model
   - A heartbeat every 5 s keeps the clock in sync and measures round-trip time
     for the signal indicator.
   - If a heartbeat or save fails, the test pauses behind a "connection lost"
     screen and retries every 10 s (or at once when the browser says it is back
     online). The clock does not run while offline: the server charges at most
     15 s per gap. On reconnect the same paper and answers carry on, and the
     outage (seconds, retries) is logged for the hiring team.

   Screen lock
   - Leaving the tab, window or full screen starts an `awayGraceSeconds`
     countdown. Coming back in time logs a `returned` event; otherwise the test
     is submitted with reason `left_screen`. */
import { $, $$, html, raw, setHtml } from '../core/dom.js';
import { api, get, post, put, ApiError } from '../core/api.js';
import { icon } from '../core/icons.js';
import { toast, openDialog } from '../core/ui.js';
import { fmtClock, countWords, plural, fmtTime } from '../core/format.js';
import { renderRich, renderInline, questionTitle } from '../core/markdown.js';
import { createEditor, LANGUAGES } from '../core/editor.js';
import { trackView } from '../core/telemetry.js';

const HEARTBEAT_MS = 5000;
const AUTOSAVE_MS = 15000;
const RETRY_SECONDS = 10;
const WARN_AT = [600, 300, 60];
const CATEGORY = { sql: 'SQL', coding: 'Coding', dsa: 'Data structures', scenario: 'Scenario' };
const DIFF_TONE = { easy: 'success', medium: 'warning', hard: 'danger' };

function rememberedLanguage() {
  try {
    const v = localStorage.getItem('talo-lang');
    return LANGUAGES.some((l) => l.id === v) ? v : null;
  } catch (_) {
    return null;
  }
}
function rememberLanguage(v) {
  try { localStorage.setItem('talo-lang', v); } catch (_) {}
}
function defaultLanguage(q) {
  if (q.language) return q.language;
  if (q.category === 'sql') return 'sql';
  if (q.category === 'scenario') return 'text';
  return rememberedLanguage() || 'pseudocode';
}

export function startExam({ me, start, config, onDone, topBar, wireTopBar }) {
  const rules = me.rules;
  const questions = start.questions || [];
  const total = questions.length;
  const wordLimit = rules.wordLimit || 1000;
  const grace = Math.max(3, rules.awayGraceSeconds || 10);
  const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  // Full screen is enforced when the device supports it, unless the hiring team turned the requirement off.
  const needFullscreen = fsSupported && rules.requireFullscreenDevice !== false;

  /* ---------- state ---------- */
  const answers = new Map(
    questions.map((q) => [q.id, { text: q.answer || '', language: defaultLanguage(q), savedText: q.answer || '', savedLanguage: q.language || null, savedAt: q.savedAt, error: null, inflight: null }])
  );
  let index = Math.max(0, questions.findIndex((q) => !(q.answer || '').trim()));
  if (index < 0 || index >= total) index = 0;
  let finished = false;
  const timers = [];
  const cleanups = [];

  // clock
  let remaining = Math.max(0, Number(start.attempt?.remainingSeconds ?? rules.assessmentMinutes * 60));
  let syncAt = performance.now();
  let clockRunning = true;
  const warned = new Set(WARN_AT.filter((w) => remaining <= w));
  const now = () => (clockRunning ? Math.max(0, remaining - (performance.now() - syncAt) / 1000) : remaining);
  const freezeClock = () => { remaining = now(); clockRunning = false; };
  const syncClock = (sec) => { remaining = Math.max(0, sec); syncAt = performance.now(); clockRunning = true; };

  // connection
  let online = true;
  let offlineSince = 0;
  let retries = 0;
  let nextRetryAt = 0;
  let lastRtt = null;
  let weakStreak = 0;
  let lastWeakReport = 0;
  const pendingEvents = [];

  // lock
  let awayStartedAt = 0;
  let awayKind = null;

  /* ---------- layout ---------- */
  const extra = html`
    <span class="conn good" id="conn" role="status" aria-live="polite">${raw(icon('signal-high', { size: 16 }))}<span class="conn-label hide-sm">Strong</span></span>
    <span class="save-state hide-sm" id="save-top" aria-live="polite"></span>
    <span class="timer" id="timer" role="timer" aria-label="Time left">${raw(icon('clock', { size: 16 }))}<span id="timer-val">${fmtClock(remaining)}</span></span>
    <button class="btn btn-primary btn-sm" id="submit-btn" type="button">${raw(icon('send', { size: 16 }))}<span class="hide-sm">Submit</span></button>`;

  document.body.className = 'cand in-exam';
  const main = $('#main');
  main.className = 'exam-main';
  setHtml(main, html`
    ${topBar(extra)}
    <nav class="exam-nav" aria-label="Questions">
      <div class="qnav" id="qnav" role="tablist"></div>
      <span class="spacer"></span>
      <span class="exam-nav-meta hide-sm" id="answered-meta"></span>
    </nav>
    <div class="exam">
      <section class="exam-q" id="exam-q" aria-labelledby="q-title" tabindex="-1"></section>
      <section class="exam-a" aria-label="Your answer">
        <div class="exam-a-bar">
          <label class="sr-only" for="lang">Answer language</label>
          <select class="select" id="lang">${raw(LANGUAGES.map((l) => `<option value="${l.id}">${l.label}</option>`).join(''))}</select>
          <span class="lang-note" id="lang-note">Graded on logic, not syntax.</span>
          <span class="spacer"></span>
          <span class="save-state" id="save-q" aria-live="polite"></span>
        </div>
        <div class="exam-editor" id="editor"></div>
        <div class="exam-a-foot">
          <span class="words" id="words" aria-live="polite"></span>
          <span class="kbd-hint hide-sm"><kbd>Ctrl</kbd> <kbd>S</kbd> save · <kbd>Tab</kbd> indent · <kbd>Ctrl</kbd> <kbd>/</kbd> comment</span>
          <span class="spacer"></span>
          <button class="btn btn-secondary btn-sm" id="prev" type="button">${raw(icon('chevron-left', { size: 16 }))} Previous</button>
          <button class="btn btn-primary btn-sm" id="next" type="button">Next ${raw(icon('chevron-right', { size: 16 }))}</button>
        </div>
      </section>
    </div>
    <div class="sr-only" id="sr-live" aria-live="assertive"></div>`);
  wireTopBar();

  const el = {
    qnav: $('#qnav'), q: $('#exam-q'), lang: $('#lang'), langNote: $('#lang-note'), saveQ: $('#save-q'), saveTop: $('#save-top'),
    words: $('#words'), prev: $('#prev'), next: $('#next'), timer: $('#timer'), timerVal: $('#timer-val'), conn: $('#conn'),
    submit: $('#submit-btn'), meta: $('#answered-meta'), live: $('#sr-live'),
  };
  const announce = (msg) => { el.live.textContent = ''; setTimeout(() => (el.live.textContent = msg), 30); };

  const editor = createEditor($('#editor'), {
    label: 'Answer editor',
    placeholder: 'Write your answer here. Comments explaining your approach help.',
    onInput: (v) => {
      const a = current();
      a.text = v;
      a.error = null;
      renderWords();
      renderSaveState();
      renderNav();
    },
  });
  editor.textarea.addEventListener('blur', () => saveCurrent('blur'));

  const current = () => answers.get(questions[index].id);
  const isDirty = (a) => a.text !== a.savedText || (a.text && a.language !== a.savedLanguage);
  const answeredCount = () => [...answers.values()].filter((a) => a.text.trim()).length;

  /* ---------- rendering ---------- */
  function renderNav() {
    setHtml(el.qnav, raw(questions.map((q, i) => {
      const a = answers.get(q.id);
      const done = a.text.trim().length > 0;
      const unsaved = isDirty(a);
      return `<button type="button" role="tab" class="qpill${i === index ? ' active' : ''}${done ? ' done' : ''}" data-i="${i}" aria-selected="${i === index}" aria-label="Question ${i + 1}${done ? ', answered' : ', not answered'}${unsaved ? ', unsaved changes' : ''}">${i + 1}${done && i !== index ? '<span class="done-dot" aria-hidden="true"></span>' : ''}</button>`;
    }).join('')));
    el.meta.textContent = `${answeredCount()} of ${total} answered`;
  }

  function renderQuestion() {
    const q = questions[index];
    const a = current();
    const diff = (q.difficulty || '').toLowerCase();
    setHtml(el.q, html`
      <div class="exam-q-head">
        <span>Question ${index + 1} of ${total}</span>
        <span class="badge neutral">${CATEGORY[q.category] || q.category}</span>
        ${diff ? html`<span class="badge ${DIFF_TONE[diff] || 'neutral'}">${diff[0].toUpperCase() + diff.slice(1)}</span>` : ''}
      </div>
      <h1 class="q-title" id="q-title">${questionTitle(q)}</h1>
      ${q.topic ? html`<p class="q-topic">${q.topic}</p>` : ''}
      <div class="q-body">${raw(renderRich(q.prompt, { skipTitle: true }))}</div>
      ${q.sampleData ? html`<h2 class="q-sub">Examples</h2><div class="q-body">${raw(renderRich(q.sampleData))}</div>` : ''}
      ${q.hint ? html`<details class="q-hint"><summary>${raw(icon('circle-help', { size: 16 }))} Need a nudge?</summary><p>${raw(renderInline(q.hint))}</p></details>` : ''}`);
    el.q.scrollTop = 0;
    editor.setLanguage(a.language);
    editor.value = a.text;
    el.lang.value = a.language;
    el.langNote.textContent = a.language === 'text' ? 'Explain in plain words. Graded on reasoning.' : 'Graded on logic, not syntax.';
    el.prev.disabled = index === 0;
    setHtml(el.next, index === total - 1 ? raw(`${icon('send', { size: 16 })} Review &amp; submit`) : raw(`Next ${icon('chevron-right', { size: 16 })}`));
    document.title = `Question ${index + 1} of ${total} · Talo`;
    renderWords();
    renderSaveState();
    renderNav();
  }

  function renderWords() {
    const n = countWords(current().text);
    el.words.textContent = `${n.toLocaleString('en-US')} / ${wordLimit.toLocaleString('en-US')} words`;
    el.words.classList.toggle('near', n > wordLimit * 0.9 && n <= wordLimit);
    el.words.classList.toggle('over', n > wordLimit);
    if (n > wordLimit) el.words.textContent += ': trim to save';
  }

  function saveLabel(a) {
    if (a.error) return { cls: 'error', ic: 'circle-alert', text: a.error };
    if (a.inflight) return { cls: '', ic: 'loader-circle', text: 'Saving…', spin: true };
    if (isDirty(a)) return { cls: '', ic: 'pencil', text: 'Unsaved changes' };
    if (a.savedAt) return { cls: '', ic: 'circle-check', text: `Saved ${fmtTime(a.savedAt)}` };
    return { cls: '', ic: '', text: '' };
  }
  function renderSaveState() {
    const s = saveLabel(current());
    el.saveQ.className = `save-state ${s.cls}`;
    setHtml(el.saveQ, raw(s.text ? `${s.ic ? icon(s.ic, { size: 14, class: s.spin ? 'spin' : '' }) : ''}<span>${s.text}</span>` : ''));
    // top bar: overall
    const all = [...answers.values()];
    const failing = all.some((a) => a.error);
    const saving = all.some((a) => a.inflight);
    const dirty = all.some(isDirty);
    el.saveTop.className = `save-state hide-sm${failing ? ' error' : ''}`;
    setHtml(el.saveTop, raw(
      !online ? `${icon('wifi-off', { size: 14 })}<span>Saved on this device</span>`
        : failing ? `${icon('circle-alert', { size: 14 })}<span>Some answers not saved</span>`
        : saving ? `${icon('loader-circle', { size: 14, class: 'spin' })}<span>Saving…</span>`
        : dirty ? `${icon('pencil', { size: 14 })}<span>Autosaves every 15 s</span>`
        : `${icon('circle-check', { size: 14 })}<span>All changes saved</span>`
    ));
  }

  function renderClock() {
    const sec = Math.ceil(now());
    el.timerVal.textContent = fmtClock(sec);
    el.timer.classList.toggle('paused', !clockRunning);
    el.timer.classList.toggle('critical', clockRunning && sec <= 60);
    el.timer.classList.toggle('low', clockRunning && sec > 60 && sec <= 300);
    el.timer.setAttribute('aria-label', clockRunning ? `Time left ${fmtClock(sec)}` : `Clock paused at ${fmtClock(sec)}`);
    for (const w of WARN_AT) {
      if (sec <= w && !warned.has(w) && clockRunning) {
        warned.add(w);
        const msg = w > 60 ? `${plural(w / 60, 'minute')} left.` : 'One minute left.';
        toast(w === 60 ? `${msg} Your answers are submitted automatically when time runs out.` : msg, { type: w <= 60 ? 'error' : 'warning', timeout: 7000 });
        announce(msg);
      }
    }
    if (sec <= 0 && clockRunning && !finished) timeUp();
  }

  function renderConn() {
    let cls = 'good', ic = 'signal-high', label = 'Strong';
    if (!online) { cls = 'offline'; ic = 'wifi-off'; label = 'Offline'; }
    else if (lastRtt != null && lastRtt > 1500) { cls = 'weak'; ic = 'signal-low'; label = 'Weak'; }
    else if (lastRtt != null && lastRtt > 600) { cls = 'fair'; ic = 'signal-medium'; label = 'Fair'; }
    el.conn.className = `conn ${cls}`;
    el.conn.title = online ? `Connection ${label.toLowerCase()}${lastRtt != null ? ` (${Math.round(lastRtt)} ms)` : ''}` : 'No connection';
    setHtml(el.conn, raw(`${icon(ic, { size: 16 })}<span class="conn-label hide-sm">${label}</span>`));
  }

  /* ---------- events to the server ---------- */
  function sendEvent(type, detail) {
    const body = { type, detail: detail || undefined };
    if (!online) { pendingEvents.push(body); return; }
    api('/api/candidate/events', { method: 'POST', body, timeoutMs: 8000 }).catch((err) => {
      if (err.network) pendingEvents.push(body);
    });
  }
  async function flushEvents() {
    while (pendingEvents.length && online) {
      const body = pendingEvents.shift();
      try { await api('/api/candidate/events', { method: 'POST', body, timeoutMs: 8000 }); }
      catch (err) { if (err.network) { pendingEvents.unshift(body); break; } }
    }
  }

  /* ---------- saving ---------- */
  function save(qid, why) {
    const a = answers.get(qid);
    if (finished && why !== 'final') return Promise.resolve(true);
    if (!isDirty(a)) return Promise.resolve(true);
    if (countWords(a.text) > wordLimit) {
      a.error = `Over ${wordLimit.toLocaleString('en-US')} words: not saved`;
      renderSaveState();
      return Promise.resolve(false);
    }
    if (!online) return Promise.resolve(false);
    if (a.inflight) return a.inflight.then(() => save(qid, why));
    const text = a.text;
    const language = a.language;
    a.inflight = put(`/api/candidate/answers/${encodeURIComponent(qid)}`, { text, language }, { timeoutMs: 15000 })
      .then((r) => {
        a.savedText = text;
        a.savedLanguage = language;
        a.savedAt = r.savedAt;
        a.error = null;
        return true;
      })
      .catch((err) => {
        if (err instanceof ApiError) {
          if (err.network) { goOffline('save'); return false; }
          if (err.status === 409 && err.code === 'closed') { serverClosed(); return false; }
          if (err.status === 401) { finish('revoked'); return false; }
          a.error = err.message;
          sendEvent('save_failed', { reason: (err.code || 'error').slice(0, 60), questionIndex: questions.findIndex((q) => q.id === qid) + 1 });
        }
        return false;
      })
      .finally(() => {
        a.inflight = null;
        if (!finished) { renderSaveState(); renderNav(); }
      });
    renderSaveState();
    return a.inflight;
  }
  const saveCurrent = (why) => save(questions[index].id, why);
  const saveAll = async (why) => {
    const results = await Promise.all(questions.map((q) => save(q.id, why)));
    return results.every(Boolean);
  };

  /* ---------- navigation ---------- */
  function go(i) {
    if (i < 0 || i >= total || i === index) return;
    saveCurrent('switch');
    index = i;
    renderQuestion();
    el.q.focus({ preventScroll: true });
  }

  el.qnav.addEventListener('click', (e) => {
    const b = e.target.closest('.qpill');
    if (b) go(Number(b.dataset.i));
  });
  el.qnav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = Math.min(total - 1, Math.max(0, index + (e.key === 'ArrowRight' ? 1 : -1)));
    go(n);
    $(`.qpill[data-i="${n}"]`, el.qnav)?.focus();
  });
  el.prev.addEventListener('click', () => go(index - 1));
  el.next.addEventListener('click', () => (index === total - 1 ? confirmSubmit() : go(index + 1)));
  el.lang.addEventListener('change', () => {
    const a = current();
    a.language = el.lang.value;
    editor.setLanguage(a.language);
    el.langNote.textContent = a.language === 'text' ? 'Explain in plain words. Graded on reasoning.' : 'Graded on logic, not syntax.';
    if (a.language !== 'text' && a.language !== 'sql') rememberLanguage(a.language);
    renderSaveState();
    editor.focus();
  });
  el.submit.addEventListener('click', () => confirmSubmit());

  /* ---------- clock & heartbeat ---------- */
  let hbBusy = false;
  async function heartbeat(fromRetry = false) {
    if (finished || hbBusy || (!online && !fromRetry)) return;
    hbBusy = true;
    const t0 = performance.now();
    try {
      const r = await post('/api/candidate/heartbeat', {}, { timeoutMs: 8000 });
      const rtt = performance.now() - t0;
      lastRtt = rtt;
      if (!online) await comeBackOnline();
      if (r.submitted) return serverClosed();
      syncClock(r.remainingSeconds);
      if (rtt > 1500) {
        weakStreak++;
        if (weakStreak >= 3 && Date.now() - lastWeakReport > 60000) {
          lastWeakReport = Date.now();
          sendEvent('signal_weak', { rttMs: rtt });
        }
      } else weakStreak = 0;
      renderConn();
    } catch (err) {
      if (err instanceof ApiError && err.network) goOffline('heartbeat');
      else if (err instanceof ApiError && err.status === 401) finish('revoked');
    } finally {
      hbBusy = false;
    }
  }

  function timeUp() {
    // Local clock reached zero: push the last edits, then let the server close it.
    clockRunning = false;
    remaining = 0;
    showBlocking('timeup');
    saveAll('final').finally(async () => {
      try { await post('/api/candidate/submit', { reason: 'time_up' }, { timeoutMs: 15000 }); } catch (_) { /* server closes it anyway */ }
      finish('time_up');
    });
  }

  async function serverClosed() {
    if (finished) return;
    let reason = 'time_up';
    try {
      const m = await get('/api/candidate/me', { quiet401: true, timeoutMs: 8000 });
      reason = m.attempt?.submitReason || reason;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) reason = 'revoked';
    }
    finish(reason);
  }

  /* ---------- offline handling ---------- */
  function goOffline(source) {
    if (!online || finished) return;
    online = false;
    offlineSince = Date.now();
    retries = 0;
    freezeClock();
    nextRetryAt = Date.now() + RETRY_SECONDS * 1000;
    pendingEvents.push({ type: 'offline', detail: { reason: source, questionIndex: index + 1 } });
    renderConn();
    renderClock();
    renderSaveState();
    showBlocking('offline');
    announce('Connection lost. Your clock is paused and your answers are kept on this device.');
  }

  async function comeBackOnline() {
    if (online) return;
    online = true;
    const seconds = Math.round((Date.now() - offlineSince) / 1000);
    pendingEvents.push({ type: 'online', detail: { seconds, retries } });
    hideBlocking('offline');
    renderConn();
    renderSaveState();
    toast(`Back online after ${seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`}. Your test continues where you left off.`, { type: 'success', timeout: 5000 });
    announce('Back online. The test continues.');
    await flushEvents();
    saveAll('reconnect');
  }

  async function retryNow() {
    if (online || finished) return;
    retries++;
    nextRetryAt = Date.now() + RETRY_SECONDS * 1000;
    updateOfflineOverlay(true);
    await heartbeat(true);
    if (!online) updateOfflineOverlay(false);
  }

  /* ---------- blocking overlays ---------- */
  const overlays = {};
  function showBlocking(kind) {
    if (overlays[kind]) return overlays[kind];
    const o = document.createElement('div');
    o.className = 'overlay';
    o.setAttribute('role', 'alertdialog');
    o.setAttribute('aria-modal', 'true');
    o.dataset.kind = kind;
    if (kind === 'offline') {
      o.setAttribute('aria-labelledby', 'ov-off-title');
      setHtml(o, html`
        <div class="ov-card">
          <div class="ov-icon">${raw(icon('wifi-off', { size: 26 }))}</div>
          <h2 id="ov-off-title">Connection lost</h2>
          <p>Don't close or reload this page. Your clock is paused and everything you typed is kept on this device. We will reconnect automatically.</p>
          <p class="ov-retry" id="ov-retry">Retrying in ${RETRY_SECONDS} s</p>
          <button class="btn btn-light" id="ov-retry-btn" type="button">${raw(icon('refresh-cw', { size: 16 }))} Retry now</button>
          <p class="ov-small" id="ov-meta">Attempts so far: 0</p>
        </div>`);
      o.querySelector('#ov-retry-btn').addEventListener('click', retryNow);
    } else if (kind === 'away') {
      o.setAttribute('aria-labelledby', 'ov-away-title');
      setHtml(o, html`
        <div class="ov-card">
          <div class="big-count" id="ov-count">${grace}</div>
          <h2 id="ov-away-title">You left the test</h2>
          <p>Come back now. If you don't return within <b id="ov-count-words">${grace} seconds</b>, your test is submitted automatically.</p>
          <button class="btn btn-light btn-lg" id="ov-return" type="button">${raw(icon('maximize', { size: 18 }))} Return to the test</button>
          <p class="warn-line">This has been recorded for the hiring team.</p>
        </div>`);
      o.querySelector('#ov-return').addEventListener('click', returnToTest);
    } else if (kind === 'needfs') {
      setHtml(o, html`
        <div class="ov-card">
          <div class="ov-icon">${raw(icon('maximize', { size: 26 }))}</div>
          <h2>Switch to full screen</h2>
          <p>The test runs in full screen. Your clock has started, so continue now.</p>
          <button class="btn btn-light btn-lg" id="ov-fs" type="button">${raw(icon('maximize', { size: 18 }))} Enter full screen</button>
        </div>`);
      o.querySelector('#ov-fs').addEventListener('click', async () => {
        try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (_) {}
        if (document.fullscreenElement) hideBlocking('needfs');
      });
    } else if (kind === 'timeup') {
      setHtml(o, html`
        <div class="ov-card">
          <div class="ov-icon">${raw(icon('timer', { size: 26 }))}</div>
          <h2>Time is up</h2>
          <p>Saving your last changes and submitting…</p>
          <span class="spinner" aria-hidden="true"></span>
        </div>`);
    } else if (kind === 'submitting') {
      setHtml(o, html`
        <div class="ov-card">
          <span class="spinner" aria-hidden="true"></span>
          <h2>Submitting your test…</h2>
          <p>Keep this window open for a moment.</p>
        </div>`);
    }
    document.body.appendChild(o);
    overlays[kind] = o;
    o.querySelector('button')?.focus();
    return o;
  }
  function hideBlocking(kind) {
    overlays[kind]?.remove();
    delete overlays[kind];
    if (!Object.keys(overlays).length && !finished) editor.focus();
  }
  function updateOfflineOverlay(trying) {
    const o = overlays.offline;
    if (!o) return;
    const left = Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000));
    o.querySelector('#ov-retry').textContent = trying ? 'Trying to reconnect…' : `Retrying in ${left} s`;
    const away = Math.round((Date.now() - offlineSince) / 1000);
    o.querySelector('#ov-meta').textContent = `Offline for ${away < 60 ? `${away} s` : `${Math.floor(away / 60)} min ${away % 60} s`} · reconnect attempts: ${retries}`;
  }

  /* ---------- screen lock ---------- */
  const isAway = () => document.visibilityState === 'hidden' || !document.hasFocus() || (needFullscreen && !document.fullscreenElement);
  function leave(kind) {
    if (finished || awayStartedAt) return;
    awayStartedAt = Date.now();
    awayKind = kind;
    sendEvent(kind, { questionIndex: index + 1 });
    saveCurrent('away');
    showBlocking('away');
  }
  function checkReturn() {
    if (!awayStartedAt || finished) return;
    const away = (Date.now() - awayStartedAt) / 1000;
    if (away >= grace) return leftTooLong();
    if (!isAway()) {
      sendEvent('returned', { seconds: Math.round(away), reason: awayKind });
      awayStartedAt = 0;
      awayKind = null;
      hideBlocking('away');
      toast('Welcome back. Please stay on this screen until you submit.', { type: 'warning', timeout: 5000 });
    }
  }
  async function returnToTest() {
    if (needFullscreen && !document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (_) {}
    }
    window.focus();
    checkReturn();
  }
  function leftTooLong() {
    if (finished) return;
    hideBlocking('away');
    showBlocking('submitting');
    saveAll('final').finally(async () => {
      try { await post('/api/candidate/submit', { reason: 'left_screen' }, { timeoutMs: 15000 }); } catch (_) {}
      finish('left_screen');
    });
  }
  function updateAwayOverlay() {
    const o = overlays.away;
    if (!o || !awayStartedAt) return;
    const left = Math.max(0, Math.ceil(grace - (Date.now() - awayStartedAt) / 1000));
    o.querySelector('#ov-count').textContent = String(left);
    o.querySelector('#ov-count-words').textContent = plural(left, 'second');
    if (left <= 0) leftTooLong();
  }

  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave('tab_hidden');
    else checkReturn();
  });
  listen(window, 'blur', () => {
    // A blur caused by our own select menu or dialog keeps focus in the document.
    setTimeout(() => { if (!document.hasFocus() && document.visibilityState === 'visible') leave('window_blur'); }, 250);
  });
  listen(window, 'focus', () => checkReturn());
  listen(document, 'fullscreenchange', () => {
    if (!needFullscreen) return;
    if (overlays.needfs) { if (document.fullscreenElement) hideBlocking('needfs'); return; }
    if (!document.fullscreenElement) leave('fullscreen_exit');
    else checkReturn();
  });

  // copy / paste / drag are off during the test
  let lastBlockToast = 0;
  const block = (type) => (e) => {
    if (finished) return;
    e.preventDefault();
    const chars = type === 'paste_blocked' ? (e.clipboardData?.getData('text') || '').length : String(window.getSelection() || '').length;
    if (Date.now() - lastBlockToast > 3000) {
      lastBlockToast = Date.now();
      toast(type === 'paste_blocked' ? 'Pasting is turned off during the test.' : 'Copying is turned off during the test.', { type: 'warning' });
      sendEvent(type, { chars, questionIndex: index + 1 });
    }
  };
  listen(document, 'paste', block('paste_blocked'));
  listen(document, 'copy', block('copy_blocked'));
  listen(document, 'cut', block('copy_blocked'));
  listen(document, 'drop', (e) => { e.preventDefault(); block('paste_blocked')(e); });
  listen(document, 'dragstart', (e) => e.preventDefault());
  listen(document, 'contextmenu', (e) => e.preventDefault());

  listen(document, 'keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveCurrent('manual').then((ok) => ok && toast('Saved.', { type: 'success', timeout: 1600 }));
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'f')) {
      e.preventDefault(); // printing or find-in-page would take focus away from the test
    } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      go(index + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });

  listen(window, 'offline', () => goOffline('browser'));
  listen(window, 'online', () => { if (!online) retryNow(); });
  const beforeUnload = (e) => {
    if (finished) return;
    e.preventDefault();
    e.returnValue = '';
  };
  listen(window, 'beforeunload', beforeUnload);

  /* ---------- submit ---------- */
  async function confirmSubmit() {
    if (finished) return;
    let submitAnyway = false;
    await saveCurrent('review');
    const missing = questions.map((q, i) => (answers.get(q.id).text.trim() ? null : i + 1)).filter(Boolean);
    const failing = [...answers.values()].some((a) => a.error || isDirty(a));
    const ok = await openDialog({
      title: 'Submit your test?',
      icon: 'send',
      confirmLabel: 'Submit test',
      cancelLabel: 'Keep working',
      body: html`
        <p>You have answered <b>${answeredCount()} of ${total}</b> questions${clockRunning ? html` and have <b>${fmtClock(Math.ceil(now()))}</b> left` : ''}.</p>
        ${missing.length ? html`<div class="alert warning">${raw(icon('triangle-alert'))}<div>Not answered: ${missing.map((n) => `Question ${n}`).join(', ')}.</div></div>` : ''}
        ${failing ? html`<div class="alert danger">${raw(icon('circle-alert'))}<div>Some changes are not saved yet. We will try once more before submitting.</div></div>` : ''}
        <p class="muted">You can't change your answers after submitting.</p>`,
      onConfirm: async () => {
        const saved = await saveAll('final');
        if (!online) throw new Error('You are offline. Wait for the connection to come back, then submit.');
        if (!saved && !submitAnyway) {
          submitAnyway = true;
          const bad = questions.map((q, i) => (answers.get(q.id).error ? i + 1 : null)).filter(Boolean);
          throw new Error(`Question ${bad.join(', ')} could not be saved (see the message on that question). Press Submit test again to submit your last saved version, or Keep working to fix it.`);
        }
        await post('/api/candidate/submit', { reason: 'candidate' }, { timeoutMs: 15000 });
        return true;
      },
    });
    if (ok) finish('candidate');
  }

  /* ---------- finish ---------- */
  function finish(reason) {
    if (finished) return;
    finished = true;
    timers.forEach((t) => clearInterval(t));
    cleanups.forEach((fn) => fn());
    Object.keys(overlays).forEach((k) => { overlays[k].remove(); delete overlays[k]; });
    $$('dialog.dialog').forEach((d) => { d.close?.(); d.remove(); });
    document.title = 'Talo · Campus assessment by Hevo Data';
    onDone(reason, { answered: answeredCount(), total });
  }

  /* ---------- go ---------- */
  renderQuestion();
  renderClock();
  renderConn();
  trackView('view_candidate_exam');
  editor.focus();

  timers.push(setInterval(() => {
    if (finished) return;
    renderClock();
    if (!online) {
      updateOfflineOverlay(false);
      if (Date.now() >= nextRetryAt) retryNow();
    }
    if (awayStartedAt) {
      updateAwayOverlay();
      checkReturn();
    }
  }, 250));
  timers.push(setInterval(() => heartbeat(), HEARTBEAT_MS));
  timers.push(setInterval(() => { if (online) saveAll('auto'); }, AUTOSAVE_MS));

  // Started without full screen (the browser refused the request): ask for it
  // once without a countdown. Leaving full screen later counts as leaving.
  if (needFullscreen && !document.fullscreenElement) showBlocking('needfs');
}
