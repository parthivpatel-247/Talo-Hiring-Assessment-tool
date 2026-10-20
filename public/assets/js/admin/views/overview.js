/* Overview: the pipeline at a glance, what is live right now, and what still needs setting up. */
import { html, raw, setHtml, $, escapeHtml as esc } from '../../core/dom.js';
import { get } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { fmtNum, fmtDate, fmtRelative, plural } from '../../core/format.js';
import { pipelineStrip, stageCounts, isManager, state, applyWidths } from '../shared.js';

const ACTION_LABEL = {
  login: 'signed in', logout: 'signed out', setup_complete: 'finished first-run setup', settings_updated: 'changed settings',
  resumes_uploaded: 'uploaded resumes', resumes_processed: 'processed resumes', bulk_shortlist: 'shortlisted candidates', bulk_reject: 'rejected candidates',
  bulk_grade: 'graded candidates', grading_batch: 'ran grading', candidates_deleted: 'deleted candidates', export_created: 'created an export',
  drive_created: 'created a drive', drive_code_rotated: 'rotated a hall code', bulk_retake: 'gave a retake', bulk_resume: 'resumed a test',
  candidate_updated: 'fixed candidate details', member_invited: 'invited a team member', member_added: 'added a team member', backup_created: 'made a backup',
  backup_restored: 'restored a backup', invites_sent: 'emailed invites', codes_generated: 'generated access codes', question_created: 'added a question',
  question_updated: 'edited a question', questions_imported: 'imported questions', similarity_computed: 'checked for similar answers', wipe_completed: 'deleted all candidates',
};

export async function render(ctx) {
  ctx.setHeader({
    title: 'Overview',
    actions: isManager() ? html`<a class="btn btn-secondary btn-sm" href="#/drives">${raw(icon('calendar-days', { size: 16 }))} New drive</a><a class="btn btn-primary btn-sm" href="#/resumes">${raw(icon('upload', { size: 16 }))} Add resumes</a>` : '',
  });
  const draw = async () => {
    const o = await get('/api/admin/overview');
    state.overview = o;
    const sc = stageCounts(o.counts);
    const done = sc.completed;
    const subs = {
      all: o.total ? `${fmtNum(done)} completed so far` : 'No candidates yet',
      attention: sc.attention ? 'Fix name or email' : 'All parsed',
      ready: 'Waiting to start',
      in_progress: o.liveNow ? `${o.liveNow} live now` : 'None live',
      completed: sc.awaiting ? `${sc.awaiting} awaiting grade` : done ? 'All graded' : '—',
      shortlisted: done ? `${Math.round((sc.shortlisted / done) * 100)}% of completed` : '—',
      rejected: done ? `${Math.round((sc.rejected / done) * 100)}% of completed` : '—',
    };
    const todo = o.checklist.filter((c) => !c.ok).length;
    const u = o.usageToday;
    setHtml(ctx.view, html`
      ${pipelineStrip(o.counts, { subs, href: (id) => `#/candidates?stage=${id}` })}
      ${!o.total ? html`<div class="panel"><div class="empty"><div class="empty-icon">${raw(icon('graduation-cap', { size: 22 }))}</div><h3>Set up your first drive</h3><p>Create a drive for the college visit, upload the shortlisted resumes, and share the hall code on the day. Students sign in with their resume email and the code.</p>${isManager() ? html`<div class="row wrap"><a class="btn btn-secondary" href="#/drives">${raw(icon('calendar-days'))} Create a drive</a><a class="btn btn-primary" href="#/resumes">${raw(icon('upload'))} Upload resumes</a></div>` : ''}</div></div>` : ''}
      <div class="grid-main">
        <div class="stack-6">
          <section class="panel" aria-labelledby="live-h">
            <div class="panel-head"><h2 id="live-h">${o.liveNow ? html`<span class="live-dot" aria-hidden="true"></span>` : ''}Live now</h2><span class="spacer"></span><a class="btn btn-ghost btn-sm" href="#/candidates?stage=in_progress">View in progress ${raw(icon('arrow-right', { size: 14 }))}</a></div>
            <div class="metric-row">
              <div class="metric"><b>${fmtNum(o.liveNow)}</b><span>taking the test right now</span></div>
              <div class="metric"><b>${fmtNum(sc.in_progress)}</b><span>started, not submitted</span></div>
              <div class="metric"><b>${fmtNum(sc.awaiting)}</b><span>submitted, awaiting grade</span></div>
            </div>
          </section>
          <section class="panel" aria-labelledby="drives-h">
            <div class="panel-head"><h2 id="drives-h">Upcoming and live drives</h2><span class="spacer"></span><a class="btn btn-ghost btn-sm" href="#/drives">All drives ${raw(icon('arrow-right', { size: 14 }))}</a></div>
            ${o.drives.length ? html`<ul class="list">${raw(o.drives.map((d) => `<li><span class="badge ${d.status === 'live' ? 'success' : 'neutral'}">${d.status === 'live' ? 'Live' : 'Scheduled'}</span><div class="grow"><div class="cell-primary truncate">${esc(d.name)}</div><div class="cell-secondary truncate">${esc(d.college || 'No college')} · ${d.scheduledOn ? fmtDate(d.scheduledOn) : 'No date'}</div></div><a class="btn btn-ghost btn-sm" href="#/candidates?drive=${d.id}">Candidates</a></li>`).join(''))}</ul>`
              : html`<div class="empty"><p>No upcoming drives.</p></div>`}
          </section>
          <section class="panel" aria-labelledby="paper-h">
            <div class="panel-head"><h2 id="paper-h">Paper</h2><span class="hint">${plural(o.paper.questions, 'question')} · ${o.paper.minutes} minutes</span><span class="spacer"></span><a class="btn btn-ghost btn-sm" href="#/questions">Question bank ${raw(icon('arrow-right', { size: 14 }))}</a></div>
            <div class="pool-bars" id="pool-bars">${raw(o.paper.slots.map((s) => `<div><span class="cell-secondary">${esc(s.label)}</span><div><b>${s.available}</b> <span class="muted">in bank</span></div><div class="cell-secondary">${s.needed} per paper</div><div class="progress"><span data-w="${Math.min(100, (s.available / Math.max(1, s.needed * 10)) * 100)}"></span></div></div>`).join(''))}</div>
          </section>
        </div>
        <div class="stack-6">
          <section class="panel" aria-labelledby="ck-h">
            <div class="panel-head"><h2 id="ck-h">Setup checklist</h2><span class="spacer"></span><span class="badge ${todo ? 'warning' : 'success'}">${todo ? `${todo} to do` : 'All set'}</span></div>
            <ul class="checklist">${raw(o.checklist.map((c) => `<li><span class="${c.ok ? 'ck-ok' : 'ck-no'}">${icon(c.ok ? 'circle-check' : 'circle-alert', { size: 18 })}</span><div><b>${esc(c.label)}</b><p>${esc(c.detail)}</p></div></li>`).join(''))}</ul>
          </section>
          <section class="panel" aria-labelledby="use-h">
            <div class="panel-head"><h2 id="use-h">Today's usage</h2><span class="spacer"></span><a class="btn btn-ghost btn-sm" href="#/settings/usage">Details ${raw(icon('arrow-right', { size: 14 }))}</a></div>
            <div class="metric-row">
              <div class="metric"><b>${fmtNum(u.requests)}</b><span>API requests</span></div>
              <div class="metric"><b>${fmtNum(u.rowsRead)}</b><span>database rows read</span></div>
              <div class="metric"><b>${fmtNum(u.rowsWritten)}</b><span>rows written</span></div>
            </div>
            ${o.errorsLastDay || o.openDataRequests ? html`<div class="panel-body stack">${o.errorsLastDay ? html`<div class="alert warning">${raw(icon('bug'))}<div>${plural(o.errorsLastDay, 'browser error')} in the last day. <a href="#/settings/data">Review</a></div></div>` : ''}${o.openDataRequests ? html`<div class="alert info">${raw(icon('inbox'))}<div>${plural(o.openDataRequests, 'open privacy request')}. <a href="#/settings/data">Respond</a></div></div>` : ''}</div>` : ''}
          </section>
          <section class="panel" aria-labelledby="act-h">
            <div class="panel-head"><h2 id="act-h">Recent activity</h2><span class="spacer"></span><a class="btn btn-ghost btn-sm" href="#/activity">Activity log ${raw(icon('arrow-right', { size: 14 }))}</a></div>
            ${o.recent.length ? html`<ul class="list">${raw(o.recent.map((a) => `<li><span class="avatar">${esc((a.actor_email || '?').slice(0, 1).toUpperCase())}</span><div class="grow"><div class="truncate"><b>${esc((a.actor_email || 'system').split('@')[0])}</b> ${esc(ACTION_LABEL[a.action] || a.action.replace(/_/g, ' '))}</div><div class="cell-secondary">${fmtRelative(a.at)}</div></div></li>`).join(''))}</ul>` : html`<div class="empty"><p>No activity yet.</p></div>`}
          </section>
        </div>
      </div>`);
    applyWidths(ctx.view);
    $('#pool-bars')?.style.setProperty('--n', String(Math.max(1, o.paper.slots.length)));
  };
  await draw();
  ctx.onRefresh(draw);
}
