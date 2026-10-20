import type { Router } from '../../router';
import type { CandidateRow, ParsedResume } from '../../env';
import { json, bad, HttpError } from '../../lib/http';
import { extractResumeText, emailsInText } from '../../lib/resume';
import { parseResume } from '../../lib/openai';
import { audit } from '../../lib/audit';
import { mapPool } from '../../lib/grading';
import { newId } from '../../db/db';

const MAX_FILES = 100;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 40 * 1024 * 1024;
const PROCESS_BATCH = 20;

/** Accept a parsed name only if one of its words (3+ letters) really appears in the resume text. */
export function nameInText(name: string | null | undefined, text: string): string | null {
  const n = (name || '').replace(/\s+/g, ' ').trim();
  if (!n || n.length > 120) return null;
  if (/^(john|jane)\s+doe$/i.test(n)) return null;
  const hay = text.toLowerCase();
  const words = n.toLowerCase().split(' ').filter((w) => w.length >= 3);
  return words.some((w) => hay.includes(w)) ? n : null;
}

/** Things a human should confirm before this candidate sits the test. */
export function identityWarnings(name: string | null, email: string | null, found: string[]): string[] {
  const w: string[] = [];
  if (!name) w.push('No name was found on the resume.');
  if (!email) w.push('No email address was found on the resume.');
  if (found.length > 1) w.push(`The resume lists ${found.length} email addresses; check the right one was picked.`);
  if (name && email) {
    const local = email.split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
    const parts = name.toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
    const matches = parts.some((p) => local.includes(p.slice(0, 4)) || p.includes(local.slice(0, 4)));
    if (local.length >= 4 && parts.length && !matches) w.push(`The email "${email}" does not look like it belongs to "${name}".`);
  }
  return w;
}

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF-" within the first 1 KB (some generators prepend whitespace or a BOM).
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
  return head.includes('%PDF-');
}

function normCollege(s: string): string {
  return s.toLowerCase().replace(/\b(the|of|and|college|university|institute|engineering|technology)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function registerAdminResumes(r: Router): void {
  r.add('POST', '/api/admin/resumes/upload', 'manager', async (ctx) => {
    const len = Number(ctx.request.headers.get('Content-Length') || 0);
    // The admin page uploads in chunks of up to 30 MB; anything much larger would exhaust Worker memory.
    if (len > MAX_REQUEST_BYTES) throw new HttpError(413, 'That upload is too large. Upload up to 40 MB of resumes per request (the Add resumes page splits large batches for you).', 'too_large');
    let form: FormData;
    try {
      form = await ctx.request.formData();
    } catch {
      throw bad('Upload the resumes as a multipart form.');
    }
    const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
    if (!files.length) throw bad('Choose at least one PDF resume.');
    if (files.length > MAX_FILES) throw bad(`Upload at most ${MAX_FILES} resumes at a time.`);
    const driveId = String(form.get('driveId') || '').trim() || null;
    let collegeId = String(form.get('collegeId') || '').trim() || null;
    if (driveId) {
      const d = await ctx.db.first<{ college_id: string | null }>('SELECT college_id FROM drives WHERE id = ?', driveId);
      if (!d) throw bad('Unknown drive.');
      collegeId = collegeId || d.college_id;
    }
    if (collegeId && !(await ctx.db.first('SELECT 1 AS ok FROM colleges WHERE id = ?', collegeId))) throw bad('Unknown college.');

    const skipped: { filename: string; reason: string }[] = [];
    const accepted: { file: File; bytes: Uint8Array }[] = [];
    for (const f of files) {
      const name = (f.name || '(unnamed)').slice(0, 200);
      if (f.size > MAX_BYTES) { skipped.push({ filename: name, reason: 'Larger than 10 MB' }); continue; }
      if (f.size < 200) { skipped.push({ filename: name, reason: 'File is empty or too small' }); continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (!isPdf(bytes)) { skipped.push({ filename: name, reason: 'Not a PDF (only PDF resumes are accepted)' }); continue; }
      accepted.push({ file: f, bytes });
    }
    const uploaded = await mapPool(accepted, 10, async ({ file, bytes }) => {
      const id = newId('cand');
      const key = `resumes/${id}.pdf`;
      await ctx.env.RESUMES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
      return { id, key, filename: (file.name || 'resume.pdf').slice(0, 200), bytes: bytes.length };
    });
    if (uploaded.length) {
      await ctx.db.batch(
        uploaded.map((u) =>
          ctx.db.stmt(
            `INSERT INTO candidates (id, email, email_status, resume_key, resume_filename, resume_bytes, status, college_id, drive_id)
             VALUES (?, ?, 'pending', ?, ?, ?, 'uploaded', ?, ?)`,
            u.id, `pending+${u.id}@unresolved.local`, u.key, u.filename, u.bytes, collegeId, driveId
          )
        )
      );
    }
    await audit(ctx, 'resumes_uploaded', { type: 'drive', id: driveId }, { uploaded: uploaded.length, skipped: skipped.length });
    return json({ ok: true, uploaded: uploaded.map((u) => ({ id: u.id, filename: u.filename })), skipped });
  });

  // Parse the next batch of uploaded resumes. The admin UI calls this until remaining = 0.
  r.add('POST', '/api/admin/resumes/process', 'manager', async (ctx) => {
    const batch = await ctx.db.all<CandidateRow>("SELECT * FROM candidates WHERE status = 'uploaded' ORDER BY created_at LIMIT ?", PROCESS_BATCH);
    const colleges = await ctx.db.all<{ id: string; name: string }>('SELECT id, name FROM colleges WHERE archived_at IS NULL');
    const claimed = new Set<string>();
    const conc = Number(ctx.env.RESUME_PARSE_CONCURRENCY) || 8;

    const processed = await mapPool(batch, conc, async (c) => {
      const fail = async (reason: string, parsed?: Omit<Partial<ParsedResume>, "name"> & { name?: string | null }) => {
        await ctx.db.run(
          `UPDATE candidates SET status = 'parse_failed', parse_error = ?, name = COALESCE(?, name), skills = COALESCE(?, skills),
             projects = COALESCE(?, projects), resume_college = COALESCE(?, resume_college), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
          reason, parsed?.name ?? null, parsed?.skills ? JSON.stringify(parsed.skills) : null, parsed?.projects ? JSON.stringify(parsed.projects) : null,
          parsed?.college ?? null, c.id
        );
        return { id: c.id, filename: c.resume_filename, ok: false, error: reason };
      };
      try {
        const obj = c.resume_key ? await ctx.env.RESUMES.get(c.resume_key) : null;
        if (!obj) return fail('The resume file is missing from storage. Upload it again.');
        const text = await extractResumeText(await obj.arrayBuffer());
        if (text.replace(/\s+/g, '').length < 40) return fail('This PDF has almost no readable text (it may be a scanned image). Use "Fix details" to enter the name and email.');
        const parsed = await parseResume(ctx.env, text);
        const found = emailsInText(text);
        const aiEmail = (parsed.email || '').trim().toLowerCase();
        const email = aiEmail && found.includes(aiEmail) ? aiEmail : found[0] ?? null;
        const name = nameInText(parsed.name, text);
        const partial = { ...parsed, name };
        if (!email) return fail('No email address was found on the resume. Use "Fix details" to add it.', partial);
        if (!name) return fail('No name was found on the resume. Use "Fix details" to add it.', partial);
        if (claimed.has(email)) return fail(`Another resume in this batch has the same email (${email}). Check for a duplicate upload.`, partial);
        const taken = await ctx.db.first<{ name: string | null }>('SELECT name FROM candidates WHERE email = ? AND id != ?', email, c.id);
        if (taken) return fail(`${email} is already used by ${taken.name || 'another candidate'}. Check for a duplicate resume.`, partial);
        claimed.add(email);
        const warnings = identityWarnings(name, email, found);
        let collegeId = c.college_id;
        if (!collegeId && parsed.college) {
          const n = normCollege(parsed.college);
          const hit = colleges.find((col) => { const m = normCollege(col.name); return m && n && (m === n || n.includes(m) || m.includes(n)); });
          if (hit) collegeId = hit.id;
        }
        const year = Number.isInteger(parsed.graduation_year) && Number(parsed.graduation_year) > 1990 && Number(parsed.graduation_year) < 2100 ? parsed.graduation_year : null;
        await ctx.db.run(
          `UPDATE candidates SET email = ?, email_status = 'parsed', name = ?, phone = ?, resume_college = ?, degree = ?, graduation_year = ?,
             college_id = ?, skills = ?, projects = ?, parsed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), parse_error = NULL, parse_warnings = ?,
             status = 'ready', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
          email, name, (parsed.phone || '').slice(0, 40) || null, (parsed.college || '').slice(0, 200) || null, (parsed.degree || '').slice(0, 120) || null,
          year, collegeId, JSON.stringify(parsed.skills ?? []), JSON.stringify(parsed.projects ?? []), warnings.length ? warnings.join(' ') : null, c.id
        );
        return { id: c.id, filename: c.resume_filename, ok: true, warnings };
      } catch (err) {
        console.error('resume parse failed', c.id, err);
        return fail('The resume reader could not process this file. Try "Re-read resume" later or use "Fix details".');
      }
    });
    const remaining = Number((await ctx.db.value<number>("SELECT COUNT(*) AS n FROM candidates WHERE status = 'uploaded'")) ?? 0);
    await audit(ctx, 'resumes_processed', { type: 'candidates' }, { processed: processed.length, ok: processed.filter((p) => p.ok).length });
    return json({ processed, remaining });
  });
}
