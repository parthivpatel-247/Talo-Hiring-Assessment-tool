/* Add resumes: pick the drive, drop PDFs, and Talo reads each one into a candidate. */
import { $, html, raw, setHtml, escapeHtml as esc } from '../../core/dom.js';
import { api, post } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { toast, setLoading } from '../../core/ui.js';
import { fmtBytes, plural } from '../../core/format.js';
import { state, isManager, loadLookups, driveOptions, collegeOptions, applyWidths } from '../shared.js';

const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 100;
const CHUNK_BYTES = 30 * 1024 * 1024;
const CHUNK_FILES = 20;

export async function render(ctx) {
  ctx.setHeader({ title: 'Add resumes' });
  if (!isManager()) {
    setHtml(ctx.view, html`<div class="panel"><div class="empty"><div class="empty-icon">${raw(icon('lock', { size: 22 }))}</div><h3>Managers only</h3><p>Ask a manager to upload resumes.</p></div></div>`);
    return;
  }
  await loadLookups(true);
  let files = [];
  let busy = false;

  setHtml(ctx.view, html`
    <div class="steps" aria-label="Steps"><span class="step on" id="st1"><i>1</i>Choose the drive</span><span class="step" id="st2"><i>2</i>Add PDFs</span><span class="step" id="st3"><i>3</i>Read resumes</span></div>
    <div class="grid-main">
      <div class="stack-6">
        <section class="panel">
          <div class="panel-head"><h2>Where do these candidates belong?</h2></div>
          <div class="panel-body form-grid">
            <div class="field"><label for="up-drive">Drive</label><select class="select" id="up-drive">${raw(driveOptions('', { empty: 'No drive yet' }))}</select><span class="hint">Students in a drive sign in with its hall code.</span></div>
            <div class="field"><label for="up-college">College</label><select class="select" id="up-college">${raw(collegeOptions('', { empty: 'From the drive, or matched from the resume' }))}</select></div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Resumes</h2><span class="hint">PDF only · up to ${MAX_FILES} at a time · 10 MB each</span></div>
          <div class="panel-body stack">
            <label class="dropzone" id="dz" for="file-input">
              <span class="dz-icon">${raw(icon('upload', { size: 22 }))}</span>
              <b>Drop PDF resumes here</b>
              <p>or <span class="link-btn">choose files</span> from your computer</p>
              <input type="file" id="file-input" accept="application/pdf,.pdf" multiple class="sr-only">
            </label>
            <div id="file-list"></div>
          </div>
          <div class="panel-foot"><button class="btn btn-secondary" id="clear-files" hidden>Clear</button><button class="btn btn-primary" id="upload-btn" disabled>${raw(icon('upload', { size: 16 }))} Upload and read</button></div>
        </section>
        <section class="panel" id="progress-panel" hidden>
          <div class="panel-head"><h2 id="prog-title">Reading resumes…</h2><span class="spacer"></span><span class="hint" id="prog-count"></span></div>
          <div class="panel-body stack"><div class="progress"><span id="prog-bar" data-w="0"></span></div><p class="muted" id="prog-note">Keep this tab open. Each resume takes a few seconds.</p></div>
          <ul class="list result-list" id="prog-list"></ul>
          <div class="panel-foot" id="prog-foot" hidden></div>
        </section>
      </div>
      <aside class="panel">
        <div class="panel-head"><h2>How resumes are read</h2></div>
        <ul class="checklist">
          <li><span class="ck-ok">${raw(icon('circle-check', { size: 18 }))}</span><div><b>Name and email come from the PDF text</b><p>An email is used only if it appears in the resume. A name that is not on the resume is never invented.</p></div></li>
          <li><span class="ck-ok">${raw(icon('circle-check', { size: 18 }))}</span><div><b>Problems are flagged, not guessed</b><p>Scanned PDFs, missing emails and duplicates land in <b>Needs details</b> for you to fix from the resume.</p></div></li>
          <li><span class="ck-ok">${raw(icon('circle-check', { size: 18 }))}</span><div><b>College is matched automatically</b><p>If the resume names a college on your list, it's linked. You can change it later.</p></div></li>
          <li><span class="ck-ok">${raw(icon('circle-check', { size: 18 }))}</span><div><b>Resumes are private</b><p>Stored in a private bucket, deleted after the ${state.settings?.retentionDays ?? 15}-day retention period.</p></div></li>
        </ul>
      </aside>
    </div>`);

  const dz = $('#dz');
  const input = $('#file-input');
  const step = (n) => ['st1', 'st2', 'st3'].forEach((id, i) => { const e = $(`#${id}`); e.classList.toggle('on', i === n - 1); e.classList.toggle('done', i < n - 1); });

  const addFiles = (list) => {
    const errs = [];
    for (const f of list) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { errs.push(`${f.name}: not a PDF`); continue; }
      if (f.size > MAX_FILE) { errs.push(`${f.name}: larger than 10 MB`); continue; }
      if (files.some((x) => x.name === f.name && x.size === f.size)) continue;
      files.push(f);
    }
    if (files.length > MAX_FILES) { errs.push(`Only the first ${MAX_FILES} files are kept; upload the rest next.`); files = files.slice(0, MAX_FILES); }
    if (errs.length) toast(errs.slice(0, 4).join(' · ') + (errs.length > 4 ? ` and ${errs.length - 4} more` : ''), { type: 'warning', timeout: 7000 });
    drawFiles();
  };
  const drawFiles = () => {
    const total = files.reduce((a, f) => a + f.size, 0);
    $('#upload-btn').disabled = !files.length || busy;
    $('#clear-files').hidden = !files.length || busy;
    if (files.length) step(2);
    setHtml($('#file-list'), files.length ? html`<p class="cell-secondary">${plural(files.length, 'file')} · ${fmtBytes(total)}</p><ul class="list file-list">${raw(files.map((f, i) => `<li>${icon('file-text', { size: 16 })}<span class="grow truncate">${esc(f.name)}</span><span class="cell-secondary">${fmtBytes(f.size)}</span>${busy ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-rm="${i}" aria-label="Remove ${esc(f.name)}">${icon('x', { size: 14 })}</button>`}</li>`).join(''))}</ul>` : '');
  };
  $('#file-list').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { files.splice(Number(b.dataset.rm), 1); drawFiles(); } });
  input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => addFiles([...(e.dataTransfer?.files || [])]));
  $('#clear-files').addEventListener('click', () => { files = []; drawFiles(); });
  $('#up-drive').addEventListener('change', (e) => {
    const d = state.drives.find((x) => x.id === e.target.value);
    if (d?.collegeId) $('#up-college').value = d.collegeId;
  });

  const beforeUnload = (e) => { if (busy) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  $('#upload-btn').addEventListener('click', async (e) => {
    if (!files.length || busy) return;
    busy = true;
    const btn = e.currentTarget;
    setLoading(btn, true);
    drawFiles();
    step(3);
    const panel = $('#progress-panel');
    panel.hidden = false;
    const list = $('#prog-list');
    setHtml(list, '');
    const bar = $('#prog-bar');
    const setProg = (done, total, title) => {
      bar.dataset.w = String(total ? (done / total) * 100 : 0);
      applyWidths(panel);
      $('#prog-count').textContent = `${done} of ${total}`;
      if (title) $('#prog-title').textContent = title;
    };
    const addLine = (ok, name, msg) => list.insertAdjacentHTML('afterbegin', `<li><span class="${ok === true ? 'ck-ok' : ok === 'warn' ? 'ck-no' : 'error-text'}">${icon(ok === true ? 'circle-check' : ok === 'warn' ? 'triangle-alert' : 'circle-x', { size: 16 })}</span><span class="grow truncate">${esc(name)}</span><span class="cell-secondary truncate">${esc(msg)}</span></li>`);

    // 1) upload in chunks
    const chunks = [];
    let cur = [];
    let bytes = 0;
    for (const f of files) {
      if (cur.length && (cur.length >= CHUNK_FILES || bytes + f.size > CHUNK_BYTES)) { chunks.push(cur); cur = []; bytes = 0; }
      cur.push(f);
      bytes += f.size;
    }
    if (cur.length) chunks.push(cur);
    let uploaded = 0;
    let skipped = 0;
    setProg(0, files.length, 'Uploading…');
    for (const chunk of chunks) {
      const fd = new FormData();
      chunk.forEach((f) => fd.append('files', f, f.name));
      if ($('#up-drive').value) fd.append('driveId', $('#up-drive').value);
      if ($('#up-college').value) fd.append('collegeId', $('#up-college').value);
      try {
        const r = await api('/api/admin/resumes/upload', { method: 'POST', form: fd, timeoutMs: 120000 });
        uploaded += r.uploaded.length;
        skipped += r.skipped.length;
        r.skipped.forEach((s) => addLine(false, s.filename, s.reason));
      } catch (err) {
        skipped += chunk.length;
        chunk.forEach((f) => addLine(false, f.name, err.message));
      }
      setProg(uploaded + skipped, files.length);
    }
    // 2) read them
    let read = 0;
    let ok = 0;
    let warn = 0;
    let failed = 0;
    setProg(0, uploaded, 'Reading resumes…');
    for (let guard = 0; guard < 200; guard++) {
      let r;
      try {
        r = await post('/api/admin/resumes/process', {}, { timeoutMs: 120000 });
      } catch (err) {
        $('#prog-note').textContent = `${err.message} Retrying…`;
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      for (const p of r.processed) {
        read++;
        if (!p.ok) { failed++; addLine(false, p.filename || 'resume.pdf', p.error); }
        else if (p.warnings?.length) { warn++; addLine('warn', p.filename || 'resume.pdf', p.warnings.join(' ')); }
        else { ok++; addLine(true, p.filename || 'resume.pdf', 'Ready'); }
      }
      setProg(Math.min(read, uploaded), Math.max(uploaded, read));
      if (!r.remaining || !r.processed.length) break;
    }
    busy = false;
    files = [];
    setLoading(btn, false);
    drawFiles();
    $('#prog-title').textContent = 'Done';
    $('#prog-note').textContent = `${plural(ok + warn, 'candidate')} ready${warn ? ` (${warn} to double-check)` : ''}, ${failed} need details, ${skipped} skipped.`;
    const foot = $('#prog-foot');
    foot.hidden = false;
    setHtml(foot, html`${failed ? html`<a class="btn btn-secondary" href="#/candidates?stage=attention">${raw(icon('square-pen', { size: 16 }))} Fix ${failed} candidate${failed === 1 ? '' : 's'}</a>` : ''}<a class="btn btn-primary" href="#/candidates${$('#up-drive').value ? `?drive=${$('#up-drive').value}` : ''}">View candidates ${raw(icon('arrow-right', { size: 16 }))}</a>`);
    toast('Resumes processed.', { type: 'success' });
  });

  return () => window.removeEventListener('beforeunload', beforeUnload);
}
