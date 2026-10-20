import type { Router } from '../../router';
import type { Ctx } from '../../lib/context';
import type { CandidateRow, ParsedResume } from '../../env';
import { json, readJson, str, email as emailField, oneOf, idList, pathId, bad, notFound, conflict, forbidden, HttpError } from '../../lib/http';
import { listCandidates, deleteCandidatesWithBackup, retakeStatements, resumeStatements } from '../../lib/candidates';
import { getSettings } from '../../lib/settings';
import { audit, auditStmt } from '../../lib/audit';
import { submitStatements } from '../../lib/exam';
import { gradeCandidate, mapPool } from '../../lib/grading';
import { generateInterviewQuestions, parseResume } from '../../lib/openai';
import { extractResumeText, emailsInText } from '../../lib/resume';
import { hashCode, randomDigits } from '../../lib/security';
import { emailConfigured, sendEmail, candidateInviteEmail } from '../../lib/email';
import { newId, parseJson, IN_JSON } from '../../db/db';
import { appOrigin } from './auth';
import { identityWarnings, nameInText } from './resumes';

const MANAGER_ONLY_BULK = new Set(['retake', 'resume', 'revoke', 'restore_access', 'delete', 'move_drive', 'set_college', 'generate_codes', 'send_invites', 'mark_test', 'unmark_test', 'force_submit']);
const BULK_LIMITS: Record<string, number> = { delete: 10, grade: 10, generate_codes: 500, send_invites: 200 };

async function getCandidate(ctx: Ctx, id: string): Promise<CandidateRow> {
  const c = await ctx.db.first<CandidateRow>('SELECT * FROM candidates WHERE id = ?', id);
  if (!c) throw notFound('Candidate not found.');
  return c;
}

export async function generateInterviewFor(ctx: Ctx, c: CandidateRow): Promise<number> {
  const qa = await ctx.db.all<{ question: string; category: string; answer: string | null; score: number | null }>(
    `SELECT q.prompt AS question, q.category, a.answer_text AS answer, a.score FROM assignments s JOIN questions q ON q.id = s.question_id
     LEFT JOIN answers a ON a.candidate_id = s.candidate_id AND a.question_id = s.question_id WHERE s.candidate_id = ? ORDER BY s.position`,
    c.id
  );
  const parsed: ParsedResume = { name: c.name ?? '', email: c.email, skills: parseJson(c.skills, []), projects: parseJson(c.projects, []) };
  const generated = await generateInterviewQuestions(ctx.env, parsed, qa.map((r) => ({ question: r.question, category: r.category, answer: r.answer ?? '', score: r.score })));
  const stmts = [ctx.db.stmt('DELETE FROM interview_questions WHERE candidate_id = ?', c.id)];
  generated.forEach((q, i) =>
    stmts.push(ctx.db.stmt('INSERT INTO interview_questions (id, candidate_id, position, question, model_answer, follow_up, based_on) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId('iq'), c.id, i, q.question, q.model_answer ?? null, q.follow_up ?? null, q.based_on ?? null))
  );
  await ctx.db.batch(stmts);
  return generated.length;
}

export function registerAdminCandidates(r: Router): void {
  r.add('GET', '/api/admin/candidates', 'admin', async (ctx) => {
    const candidates = await listCandidates(ctx.db);
    return json({ candidates, generatedAt: new Date().toISOString() });
  });

  r.add('GET', '/api/admin/candidates/:id', 'admin', async (ctx) => {
    const id = pathId(ctx.params.id);
    const c = await getCandidate(ctx, id);
    const [summary] = await listCandidates(ctx.db, { ids: [id] });
    const [paper, interview, events, similar, auditRows] = await Promise.all([
      ctx.db.all<Record<string, unknown>>(
        `SELECT s.position, q.id AS question_id, q.category, q.title, q.topic, q.difficulty, q.prompt, q.sample_data, q.hint, q.reference_answer,
                q.expected_output, q.rubric, q.checkpoints, q.marks, a.answer_text, a.language, a.word_count, a.revision, a.saved_at,
                a.score, a.max_marks, a.reasoning, a.deductions, a.graded_at
         FROM assignments s JOIN questions q ON q.id = s.question_id
         LEFT JOIN answers a ON a.candidate_id = s.candidate_id AND a.question_id = s.question_id
         WHERE s.candidate_id = ? ORDER BY s.position`,
        id
      ),
      ctx.db.all('SELECT question, model_answer, follow_up, based_on FROM interview_questions WHERE candidate_id = ? ORDER BY position', id),
      ctx.db.all('SELECT type, detail, at, attempt_no FROM attempt_events WHERE candidate_id = ? ORDER BY at DESC, id DESC LIMIT 300', id),
      ctx.db.all<{ question_id: string; other_id: string; other_name: string | null; other_email: string; score: number; title: string | null }>(
        `SELECT sf.question_id, CASE WHEN sf.candidate_a = ? THEN sf.candidate_b ELSE sf.candidate_a END AS other_id, oc.name AS other_name, oc.email AS other_email, sf.score, q.title
         FROM similarity_flags sf JOIN candidates oc ON oc.id = CASE WHEN sf.candidate_a = ? THEN sf.candidate_b ELSE sf.candidate_a END
         JOIN questions q ON q.id = sf.question_id
         WHERE sf.candidate_a = ? OR sf.candidate_b = ? ORDER BY sf.score DESC`,
        id, id, id, id
      ),
      ctx.db.all("SELECT actor_email, action, detail, at FROM audit_log WHERE target_type = 'candidate' AND target_id = ? ORDER BY at DESC LIMIT 50", id),
    ]);
    return json({
      candidate: {
        ...summary,
        phone: c.phone,
        degree: c.degree,
        graduationYear: c.graduation_year,
        skills: parseJson<string[]>(c.skills, []),
        projects: parseJson<unknown[]>(c.projects, []),
        notes: c.notes,
        parsedAt: c.parsed_at,
        hasResume: !!c.resume_key,
      },
      paper: paper.map((p) => ({ ...p, deductions: parseJson(p.deductions, []) })),
      interview,
      events: events.map((e) => ({ ...e, detail: parseJson(e.detail, null) })),
      similar,
      audit: auditRows,
    });
  });

  r.add('GET', '/api/admin/candidates/:id/resume', 'admin', async (ctx) => {
    const c = await getCandidate(ctx, pathId(ctx.params.id));
    if (!c.resume_key) throw notFound('No resume on file for this candidate.');
    const obj = await ctx.env.RESUMES.get(c.resume_key);
    if (!obj) throw notFound('The resume file is missing from storage.');
    const safeName = (c.resume_filename || 'resume.pdf').replace(/[^A-Za-z0-9._ -]/g, '_');
    await audit(ctx, 'resume_viewed', { type: 'candidate', id: c.id });
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });

  // Fix identity (the "Fix name / email" dialog) and other profile fields.
  r.add('PATCH', '/api/admin/candidates/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const c = await getCandidate(ctx, id);
    const body = await readJson(ctx.request, 8192);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const changed: Record<string, unknown> = {};
    if ('name' in body) {
      const name = str(body, 'name', { min: 2, max: 120, label: 'Name' });
      sets.push('name = ?'); vals.push(name); changed.name = '(updated)';
    }
    if ('email' in body) {
      const email = emailField(body);
      if (email !== c.email) {
        const clash = await ctx.db.first('SELECT id FROM candidates WHERE email = ? AND id != ?', email, id);
        if (clash) throw conflict('Another candidate already uses that email address.', 'email_in_use');
      }
      sets.push('email = ?', "email_status = 'confirmed'"); vals.push(email); changed.email = '(updated)';
    }
    if ('phone' in body) { const v = str(body, 'phone', { max: 40, optional: true }); sets.push('phone = ?'); vals.push(v || null); changed.phone = '(updated)'; }
    if ('notes' in body) { const v = str(body, 'notes', { max: 2000, optional: true }); sets.push('notes = ?'); vals.push(v || null); changed.notes = '(updated)'; }
    if ('collegeId' in body) {
      const v = body.collegeId ? str(body, 'collegeId', { max: 64 }) : null;
      if (v && !(await ctx.db.first('SELECT 1 AS ok FROM colleges WHERE id = ?', v))) throw bad('Unknown college.');
      sets.push('college_id = ?'); vals.push(v); changed.collegeId = v;
    }
    if ('driveId' in body) {
      const v = body.driveId ? str(body, 'driveId', { max: 64 }) : null;
      if (v && !(await ctx.db.first('SELECT 1 AS ok FROM drives WHERE id = ?', v))) throw bad('Unknown drive.');
      sets.push('drive_id = ?'); vals.push(v); changed.driveId = v;
    }
    if (!sets.length) throw bad('Nothing to update.');
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    const confirmIdentity = body.confirmIdentity === true || 'email' in body || 'name' in body;
    if (confirmIdentity) sets.push('parse_warnings = NULL');
    await ctx.db.batch([
      ctx.db.stmt(`UPDATE candidates SET ${sets.join(', ')} WHERE id = ?`, ...vals, id),
      // A fixed identity makes an un-parsed candidate ready to sit the test.
      ctx.db.stmt(`UPDATE candidates SET status = 'ready', parse_error = NULL WHERE id = ? AND status IN ('uploaded', 'parse_failed') AND email NOT LIKE 'pending+%' AND name IS NOT NULL`, id),
      auditStmt(ctx, 'candidate_updated', { type: 'candidate', id }, changed),
    ]);
    const [updated] = await listCandidates(ctx.db, { ids: [id] });
    return json({ ok: true, candidate: updated });
  });

  // Re-read one resume and PROPOSE the details; the admin confirms in a dialog.
  r.add('POST', '/api/admin/candidates/:id/reparse', 'manager', async (ctx) => {
    const c = await getCandidate(ctx, pathId(ctx.params.id));
    if (!c.resume_key) throw bad('This candidate has no resume on file.');
    const obj = await ctx.env.RESUMES.get(c.resume_key);
    if (!obj) throw notFound('The resume file is missing from storage.');
    const text = await extractResumeText(await obj.arrayBuffer());
    if (text.replace(/\s+/g, '').length < 40) {
      return json({ ok: false, error: 'This PDF has almost no readable text (it may be a scanned image). Enter the details by hand.', proposal: null });
    }
    let parsed: ParsedResume;
    try {
      parsed = await parseResume(ctx.env, text);
    } catch (err) {
      throw new HttpError(502, 'The resume reader is unavailable right now. Try again in a minute.', 'ai_unavailable');
    }
    const found = emailsInText(text);
    const aiEmail = (parsed.email || '').trim().toLowerCase();
    const email = aiEmail && found.includes(aiEmail) ? aiEmail : found[0] ?? null;
    const name = nameInText(parsed.name, text);
    const proposal = { name, email, phone: parsed.phone ?? null, college: parsed.college ?? null, degree: parsed.degree ?? null, graduationYear: parsed.graduation_year ?? null };
    const warnings = identityWarnings(name, email, found);
    const current = { name: c.name, email: c.email.startsWith('pending+') ? null : c.email };
    const mismatches: string[] = [];
    if (current.name && name && current.name.toLowerCase() !== name.toLowerCase()) mismatches.push('name');
    if (current.email && email && current.email !== email) mismatches.push('email');
    // Skills/projects/education are safe to refresh directly.
    await ctx.db.run(
      `UPDATE candidates SET skills = ?, projects = ?, resume_college = COALESCE(?, resume_college), degree = COALESCE(?, degree),
         graduation_year = COALESCE(?, graduation_year), phone = COALESCE(phone, ?), parsed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      JSON.stringify(parsed.skills ?? []), JSON.stringify(parsed.projects ?? []), proposal.college, proposal.degree,
      Number.isInteger(proposal.graduationYear) ? proposal.graduationYear : null, proposal.phone, c.id
    );
    await audit(ctx, 'resume_reparsed', { type: 'candidate', id: c.id }, { warnings, mismatches });
    return json({ ok: true, proposal, current, warnings, mismatches, emailsFound: found.slice(0, 5) });
  });

  r.add('POST', '/api/admin/candidates/:id/interview', 'admin', async (ctx) => {
    const c = await getCandidate(ctx, pathId(ctx.params.id));
    try {
      const n = await generateInterviewFor(ctx, c);
      await audit(ctx, 'interview_generated', { type: 'candidate', id: c.id }, { questions: n });
      return json({ ok: true, count: n });
    } catch (err) {
      throw new HttpError(502, 'Could not generate interview questions right now. Try again in a minute.', 'ai_unavailable');
    }
  });

  /* ---------- bulk actions (with per-candidate results) ---------- */

  r.add('POST', '/api/admin/candidates/bulk', 'admin', async (ctx) => {
    const body = await readJson(ctx.request, 64 * 1024);
    const action = oneOf(body, 'action', [
      'grade', 'shortlist', 'reject', 'retake', 'resume', 'revoke', 'restore_access', 'delete', 'move_drive', 'set_college',
      'generate_codes', 'send_invites', 'mark_test', 'unmark_test', 'force_submit',
    ] as const)!;
    if (MANAGER_ONLY_BULK.has(action) && ctx.admin!.role !== 'manager') throw forbidden('Only a manager can do this.');
    const ids = idList(body, 'ids', { max: BULK_LIMITS[action] ?? 500, label: 'Candidates' });
    const s = await getSettings(ctx.env, ctx.db);
    const existing = await ctx.db.all<CandidateRow>(`SELECT * FROM candidates WHERE id IN ${IN_JSON}`, JSON.stringify(ids));
    const byId = new Map(existing.map((c) => [c.id, c]));
    const results: { id: string; ok: boolean; error?: string; code?: string }[] = [];
    const missing = ids.filter((id) => !byId.has(id));
    for (const id of missing) results.push({ id, ok: false, error: 'Not found' });
    const found = ids.filter((id) => byId.has(id));
    const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

    switch (action) {
      case 'delete': {
        if (body.confirm !== `DELETE ${found.length}`) throw bad(`Type "DELETE ${found.length}" to confirm.`, 'confirm_required');
        const res = await deleteCandidatesWithBackup(ctx, found, { retentionDays: s.retentionDays, reason: 'Deleted from the candidates table' });
        for (const id of found) results.push({ id, ok: true });
        return json({ ok: true, results, backupId: res.backupId, message: `Deleted ${res.deleted}. A backup is kept for ${s.retentionDays} days.` });
      }
      case 'grade': {
        const out = await mapPool(found, 4, async (id) => {
          const c = byId.get(id)!;
          if (!['submitted', 'graded', 'shortlisted', 'rejected', 'grading'].includes(c.status)) return { id, ok: false, error: 'Not submitted yet' };
          try {
            await gradeCandidate(ctx.env, ctx.db, id);
            await ctx.db.run(`UPDATE candidates SET status = CASE WHEN status IN ('submitted','grading') THEN 'graded' ELSE status END, grading_claim = NULL WHERE id = ?`, id);
            return { id, ok: true };
          } catch (err) {
            return { id, ok: false, error: 'The AI grader is unavailable; try again.' };
          }
        });
        results.push(...out);
        await audit(ctx, 'bulk_grade', { type: 'candidates' }, { ids: found, ok: out.filter((o) => o.ok).length });
        break;
      }
      case 'shortlist':
      case 'reject': {
        const next = action === 'shortlist' ? 'shortlisted' : 'rejected';
        const eligible = found.filter((id) => ['graded', 'shortlisted', 'rejected', 'submitted'].includes(byId.get(id)!.status));
        for (const id of found) if (!eligible.includes(id)) results.push({ id, ok: false, error: 'Grade or submit first' });
        if (eligible.length) {
          await ctx.db.batch([
            ctx.db.stmt(`UPDATE candidates SET status = ?, decided_by = ?, decided_at = ${now}, updated_at = ${now} WHERE id IN ${IN_JSON}`, next, ctx.admin!.email, JSON.stringify(eligible)),
            auditStmt(ctx, `bulk_${action}`, { type: 'candidates' }, { ids: eligible }),
          ]);
          for (const id of eligible) results.push({ id, ok: true });
        }
        if (action === 'shortlist' && eligible.length && eligible.length <= 10) {
          // Interview questions for small shortlists right away; larger ones can be generated per candidate.
          ctx.exec.waitUntil(Promise.all(eligible.map((id) => generateInterviewFor(ctx, byId.get(id)!).catch(() => 0))).then(() => undefined));
        }
        break;
      }
      case 'retake': {
        const stmts = found.flatMap((id) => retakeStatements(ctx, id));
        stmts.push(auditStmt(ctx, 'bulk_retake', { type: 'candidates' }, { ids: found }));
        await ctx.db.batch(stmts);
        for (const id of found) results.push({ id, ok: true });
        break;
      }
      case 'resume': {
        const mode = (oneOf(body, 'mode', ['remaining', 'full'] as const, { optional: true }) ?? 'remaining') as 'remaining' | 'full';
        const stmts: D1PreparedStatement[] = [];
        for (const id of found) {
          try {
            stmts.push(...(await resumeStatements(ctx, id, mode, s.assessmentMinutes * 60)));
            results.push({ id, ok: true });
          } catch (err) {
            results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' });
          }
        }
        stmts.push(auditStmt(ctx, 'bulk_resume', { type: 'candidates' }, { ids: found, mode }));
        await ctx.db.batch(stmts);
        break;
      }
      case 'revoke': {
        const stmts: D1PreparedStatement[] = [
          ctx.db.stmt(`UPDATE candidates SET access_revoked = 1, updated_at = ${now} WHERE id IN ${IN_JSON}`, JSON.stringify(found)),
          ctx.db.stmt(`UPDATE attempts SET session_nonce = NULL WHERE candidate_id IN ${IN_JSON}`, JSON.stringify(found)),
        ];
        for (const id of found) {
          const c = byId.get(id)!;
          if (c.status === 'in_progress') stmts.push(...submitStatements(ctx.db, id, 0, 'revoked'));
          results.push({ id, ok: true });
        }
        stmts.push(auditStmt(ctx, 'bulk_revoke', { type: 'candidates' }, { ids: found }));
        await ctx.db.batch(stmts);
        break;
      }
      case 'restore_access': {
        await ctx.db.batch([
          ctx.db.stmt(`UPDATE candidates SET access_revoked = 0, updated_at = ${now} WHERE id IN ${IN_JSON}`, JSON.stringify(found)),
          auditStmt(ctx, 'bulk_restore_access', { type: 'candidates' }, { ids: found }),
        ]);
        for (const id of found) results.push({ id, ok: true });
        break;
      }
      case 'force_submit': {
        const stmts: D1PreparedStatement[] = [];
        for (const id of found) {
          if (byId.get(id)!.status !== 'in_progress') { results.push({ id, ok: false, error: 'Not in progress' }); continue; }
          stmts.push(...submitStatements(ctx.db, id, 0, 'admin'));
          results.push({ id, ok: true });
        }
        stmts.push(auditStmt(ctx, 'bulk_force_submit', { type: 'candidates' }, { ids: found }));
        await ctx.db.batch(stmts);
        break;
      }
      case 'move_drive': {
        const driveId = body.driveId ? str(body, 'driveId', { max: 64 }) : null;
        let collegeId: string | null = null;
        if (driveId) {
          const d = await ctx.db.first<{ college_id: string | null }>('SELECT college_id FROM drives WHERE id = ?', driveId);
          if (!d) throw bad('Unknown drive.');
          collegeId = d.college_id;
        }
        await ctx.db.batch([
          ctx.db.stmt(`UPDATE candidates SET drive_id = ?, college_id = COALESCE(?, college_id), updated_at = ${now} WHERE id IN ${IN_JSON}`, driveId, collegeId, JSON.stringify(found)),
          auditStmt(ctx, 'bulk_move_drive', { type: 'drive', id: driveId }, { ids: found }),
        ]);
        for (const id of found) results.push({ id, ok: true });
        break;
      }
      case 'set_college': {
        const collegeId = body.collegeId ? str(body, 'collegeId', { max: 64 }) : null;
        if (collegeId && !(await ctx.db.first('SELECT 1 AS ok FROM colleges WHERE id = ?', collegeId))) throw bad('Unknown college.');
        await ctx.db.batch([
          ctx.db.stmt(`UPDATE candidates SET college_id = ?, updated_at = ${now} WHERE id IN ${IN_JSON}`, collegeId, JSON.stringify(found)),
          auditStmt(ctx, 'bulk_set_college', { type: 'college', id: collegeId }, { ids: found }),
        ]);
        for (const id of found) results.push({ id, ok: true });
        break;
      }
      case 'mark_test':
      case 'unmark_test': {
        await ctx.db.batch([
          ctx.db.stmt(`UPDATE candidates SET is_test = ?, updated_at = ${now} WHERE id IN ${IN_JSON}`, action === 'mark_test' ? 1 : 0, JSON.stringify(found)),
          auditStmt(ctx, `bulk_${action}`, { type: 'candidates' }, { ids: found }),
        ]);
        for (const id of found) results.push({ id, ok: true });
        break;
      }
      case 'generate_codes':
      case 'send_invites': {
        const send = action === 'send_invites';
        if (send && !emailConfigured(ctx.env)) throw new HttpError(503, 'Email is not set up yet, so invites cannot be sent. Generate codes and print the slips instead.', 'email_disabled');
        const stmts: D1PreparedStatement[] = [];
        const issued: { id: string; name: string | null; email: string; code: string }[] = [];
        for (const id of found) {
          const c = byId.get(id)!;
          if (c.email.startsWith('pending+')) { results.push({ id, ok: false, error: 'No email yet; fix the email first' }); continue; }
          const code = randomDigits(6);
          stmts.push(ctx.db.stmt(`UPDATE candidates SET invite_code_hash = ?, invite_code_set_at = ${now}, updated_at = ${now} WHERE id = ?`, await hashCode(ctx.env, 'invite', id, code), id));
          issued.push({ id, name: c.name, email: c.email, code });
        }
        stmts.push(auditStmt(ctx, send ? 'invites_sent' : 'codes_generated', { type: 'candidates' }, { count: issued.length }));
        await ctx.db.batch(stmts);
        if (send) {
          const drives = new Map((await ctx.db.all<{ id: string; name: string; scheduled_on: string | null }>('SELECT id, name, scheduled_on FROM drives')).map((d) => [d.id, d]));
          const link = `${appOrigin(ctx)}/`;
          const sent = await mapPool(issued, 5, async (it) => {
            const c = byId.get(it.id)!;
            const d = c.drive_id ? drives.get(c.drive_id) : undefined;
            const mail = candidateInviteEmail(s.orgName, c.name || 'there', `${link}#email=${encodeURIComponent(c.email)}`, it.code, { driveName: d?.name, date: d?.scheduled_on, minutes: s.assessmentMinutes });
            const r = await sendEmail(ctx.env, { to: c.email, ...mail });
            if (r.ok) await ctx.db.run(`UPDATE candidates SET invite_sent_at = ${now} WHERE id = ?`, it.id);
            return { id: it.id, ok: r.ok, error: r.error };
          });
          results.push(...sent);
          return json({ ok: true, results, sent: sent.filter((x) => x.ok).length });
        }
        // Plaintext codes are returned exactly once, for printing slips; only hashes are stored.
        for (const it of issued) results.push({ id: it.id, ok: true, code: it.code });
        return json({ ok: true, results, codes: issued });
      }
    }
    const okCount = results.filter((x) => x.ok).length;
    return json({ ok: true, results, message: `${okCount} of ${ids.length} updated.` });
  });
}
