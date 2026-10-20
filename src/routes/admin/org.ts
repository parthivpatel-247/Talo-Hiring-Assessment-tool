import type { Router } from '../../router';
import type { AdminUserRow, AdminRole } from '../../env';
import { json, readJson, str, email as emailField, oneOf, bool, pathId, bad, notFound, conflict, forbidden } from '../../lib/http';
import { getSettings, saveSettings, type Settings, CATEGORY_LABEL } from '../../lib/settings';
import { audit, auditStmt } from '../../lib/audit';
import { randomHallCode, randomToken, sha256Hex } from '../../lib/security';
import { hashPassword, passwordProblem } from '../../lib/passwords';
import { emailConfigured, sendEmail, memberInviteEmail } from '../../lib/email';
import { turnstileEnabled } from '../../lib/turnstile';
import { revokeAllAdminSessions } from '../../lib/sessions';
import { clear } from '../../lib/ratelimit';
import { newId } from '../../db/db';
import { appOrigin } from './auth';

function settingsView(s: Settings) {
  return { ...s, paper: s.paper.map((p) => ({ ...p, label: CATEGORY_LABEL[p.category] })) };
}

export function registerAdminOrg(r: Router): void {
  /* ---------- settings ---------- */

  r.add('GET', '/api/admin/settings', 'admin', async (ctx) => {
    const s = await getSettings(ctx.env, ctx.db);
    return json({
      settings: settingsView(s),
      integrations: {
        email: emailConfigured(ctx.env) ? { provider: ctx.env.EMAIL_PROVIDER, from: ctx.env.EMAIL_FROM } : null,
        turnstile: turnstileEnabled(ctx.env),
        ai: !!ctx.env.OPENAI_API_KEY,
        model: ctx.env.OPENAI_MODEL || 'gpt-4o-mini',
      },
    });
  });

  r.add('PATCH', '/api/admin/settings', 'manager', async (ctx) => {
    const b = await readJson(ctx.request, 16 * 1024);
    for (const k of Object.keys(b)) if (!['assessmentMinutes', 'pauseAllowanceMinutes', 'wordLimit', 'awayGraceSeconds', 'requireFullscreenDevice', 'paper', 'loginMode', 'admin2fa', 'retentionDays', 'contactEmail', 'orgName', 'autoRefreshSeconds'].includes(k)) throw bad(`Unknown setting "${k.slice(0, 40)}".`);
    if (b.loginMode === 'otp' && !emailConfigured(ctx.env)) throw bad('Email codes need an email provider. Set EMAIL_PROVIDER, EMAIL_API_KEY and EMAIL_FROM first.');
    const before = await getSettings(ctx.env, ctx.db);
    const s = await saveSettings(ctx.env, ctx.db, b as never, ctx.admin!.email);
    const changes: Record<string, unknown> = {};
    for (const k of Object.keys(b)) if (k in before) changes[k] = { from: (before as never)[k], to: (s as never)[k] };
    await audit(ctx, 'settings_updated', { type: 'settings' }, changes);
    return json({ ok: true, settings: settingsView(s) });
  });

  /* ---------- colleges ---------- */

  r.add('GET', '/api/admin/colleges', 'admin', async (ctx) => {
    const rows = await ctx.db.all(
      `SELECT c.id, c.name, c.city, c.archived_at AS archivedAt, c.created_at AS createdAt,
              (SELECT COUNT(*) FROM candidates x WHERE x.college_id = c.id) AS candidates,
              (SELECT COUNT(*) FROM drives d WHERE d.college_id = c.id) AS drives
       FROM colleges c ORDER BY c.archived_at IS NOT NULL, c.name`
    );
    return json({ colleges: rows });
  });

  r.add('POST', '/api/admin/colleges', 'manager', async (ctx) => {
    const b = await readJson(ctx.request, 4096);
    const name = str(b, 'name', { min: 2, max: 120, label: 'College name' });
    const city = str(b, 'city', { max: 80, optional: true });
    if (await ctx.db.first('SELECT 1 AS ok FROM colleges WHERE name = ?', name)) throw conflict('A college with that name already exists.');
    const id = newId('col');
    await ctx.db.batch([
      ctx.db.stmt('INSERT INTO colleges (id, name, city) VALUES (?, ?, ?)', id, name, city || null),
      auditStmt(ctx, 'college_created', { type: 'college', id }, { name }),
    ]);
    return json({ ok: true, id });
  });

  r.add('PATCH', '/api/admin/colleges/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const b = await readJson(ctx.request, 4096);
    const cur = await ctx.db.first<{ name: string }>('SELECT name FROM colleges WHERE id = ?', id);
    if (!cur) throw notFound('College not found.');
    const sets: string[] = [];
    const vals: unknown[] = [];
    if ('name' in b) {
      const name = str(b, 'name', { min: 2, max: 120, label: 'College name' });
      if (await ctx.db.first('SELECT 1 AS ok FROM colleges WHERE name = ? AND id != ?', name, id)) throw conflict('A college with that name already exists.');
      sets.push('name = ?'); vals.push(name);
    }
    if ('city' in b) { sets.push('city = ?'); vals.push(str(b, 'city', { max: 80, optional: true }) || null); }
    if ('archived' in b) { sets.push(bool(b, 'archived') ? "archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'archived_at = NULL'); }
    if (!sets.length) throw bad('Nothing to update.');
    await ctx.db.batch([
      ctx.db.stmt(`UPDATE colleges SET ${sets.join(', ')} WHERE id = ?`, ...vals, id),
      auditStmt(ctx, 'college_updated', { type: 'college', id }, { from: cur.name, ...b }),
    ]);
    return json({ ok: true });
  });

  r.add('DELETE', '/api/admin/colleges/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const n = Number((await ctx.db.value<number>('SELECT COUNT(*) AS n FROM candidates WHERE college_id = ?', id)) ?? 0);
    if (n > 0) throw conflict(`${n} candidate(s) belong to this college. Archive it instead, or move them first.`, 'in_use');
    await ctx.db.batch([ctx.db.stmt('DELETE FROM colleges WHERE id = ?', id), auditStmt(ctx, 'college_deleted', { type: 'college', id })]);
    return json({ ok: true });
  });

  /* ---------- drives (a college + a date + a hall code) ---------- */

  r.add('GET', '/api/admin/drives', 'admin', async (ctx) => {
    const rows = await ctx.db.all(
      `SELECT d.id, d.name, d.college_id AS collegeId, c.name AS college, d.scheduled_on AS scheduledOn, d.status,
              d.code_required AS codeRequired, d.access_code AS accessCode, d.created_at AS createdAt,
              (SELECT COUNT(*) FROM candidates x WHERE x.drive_id = d.id) AS candidates,
              (SELECT COUNT(*) FROM candidates x WHERE x.drive_id = d.id AND x.status IN ('submitted','grading','graded','shortlisted','rejected')) AS submitted
       FROM drives d LEFT JOIN colleges c ON c.id = d.college_id ORDER BY COALESCE(d.scheduled_on, d.created_at) DESC`
    );
    return json({ drives: rows });
  });

  r.add('POST', '/api/admin/drives', 'manager', async (ctx) => {
    const b = await readJson(ctx.request, 4096);
    const name = str(b, 'name', { min: 2, max: 120, label: 'Drive name' });
    const collegeId = b.collegeId ? str(b, 'collegeId', { max: 64 }) : null;
    if (collegeId && !(await ctx.db.first('SELECT 1 AS ok FROM colleges WHERE id = ?', collegeId))) throw bad('Unknown college.');
    const scheduledOn = str(b, 'scheduledOn', { optional: true, pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: 'Use a date like 2026-11-04.' });
    const codeRequired = bool(b, 'codeRequired', { optional: true }) ?? true;
    const id = newId('drv');
    const code = randomHallCode(6);
    await ctx.db.batch([
      ctx.db.stmt('INSERT INTO drives (id, college_id, name, scheduled_on, access_code, code_required, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, collegeId, name, scheduledOn || null, code, codeRequired ? 1 : 0, ctx.admin!.email),
      auditStmt(ctx, 'drive_created', { type: 'drive', id }, { name }),
    ]);
    return json({ ok: true, id, accessCode: code });
  });

  r.add('PATCH', '/api/admin/drives/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    if (!(await ctx.db.first('SELECT 1 AS ok FROM drives WHERE id = ?', id))) throw notFound('Drive not found.');
    const b = await readJson(ctx.request, 4096);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if ('name' in b) { sets.push('name = ?'); vals.push(str(b, 'name', { min: 2, max: 120, label: 'Drive name' })); }
    if ('collegeId' in b) {
      const v = b.collegeId ? str(b, 'collegeId', { max: 64 }) : null;
      if (v && !(await ctx.db.first('SELECT 1 AS ok FROM colleges WHERE id = ?', v))) throw bad('Unknown college.');
      sets.push('college_id = ?'); vals.push(v);
    }
    if ('scheduledOn' in b) { sets.push('scheduled_on = ?'); vals.push(str(b, 'scheduledOn', { optional: true, pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: 'Use a date like 2026-11-04.' }) || null); }
    if ('status' in b) { sets.push('status = ?'); vals.push(oneOf(b, 'status', ['scheduled', 'live', 'closed'] as const)); }
    if ('codeRequired' in b) { sets.push('code_required = ?'); vals.push(bool(b, 'codeRequired') ? 1 : 0); }
    let code: string | null = null;
    if (b.rotateCode === true) { code = randomHallCode(6); sets.push('access_code = ?'); vals.push(code); }
    if (!sets.length) throw bad('Nothing to update.');
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    await ctx.db.batch([
      ctx.db.stmt(`UPDATE drives SET ${sets.join(', ')} WHERE id = ?`, ...vals, id),
      auditStmt(ctx, code ? 'drive_code_rotated' : 'drive_updated', { type: 'drive', id }, { fields: Object.keys(b) }),
    ]);
    return json({ ok: true, accessCode: code ?? undefined });
  });

  r.add('DELETE', '/api/admin/drives/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const n = Number((await ctx.db.value<number>('SELECT COUNT(*) AS n FROM candidates WHERE drive_id = ?', id)) ?? 0);
    if (n > 0) throw conflict(`${n} candidate(s) are in this drive. Move or delete them first, or close the drive instead.`, 'in_use');
    await ctx.db.batch([ctx.db.stmt('DELETE FROM drives WHERE id = ?', id), auditStmt(ctx, 'drive_deleted', { type: 'drive', id })]);
    return json({ ok: true });
  });

  /* ---------- team (admin accounts) ---------- */

  r.add('GET', '/api/admin/members', 'manager', async (ctx) => {
    const rows = await ctx.db.all<AdminUserRow>('SELECT * FROM admin_users ORDER BY role DESC, name');
    return json({
      members: rows.map((u) => ({
        id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active, emailVerified: !!u.email_verified_at,
        mustChangePassword: !!u.must_change_password, lastLoginAt: u.last_login_at, lockedUntil: u.locked_until, createdAt: u.created_at,
        hasPassword: !!u.pass_hash,
      })),
      emailEnabled: emailConfigured(ctx.env),
    });
  });

  r.add('POST', '/api/admin/members', 'manager', async (ctx) => {
    const b = await readJson(ctx.request, 4096);
    const name = str(b, 'name', { min: 2, max: 80, label: 'Name' });
    const email = emailField(b);
    const role = oneOf(b, 'role', ['manager', 'member'] as const)! as AdminRole;
    if (await ctx.db.first('SELECT 1 AS ok FROM admin_users WHERE email = ?', email)) throw conflict('Someone with that email is already on the team.');
    const tempPassword = str(b, 'temporaryPassword', { optional: true, max: 128, trim: false });
    const id = newId('usr');
    if (emailConfigured(ctx.env) && !tempPassword) {
      await ctx.db.run('INSERT INTO admin_users (id, email, name, role, created_by) VALUES (?, ?, ?, ?, ?)', id, email, name, role, ctx.admin!.email);
      const token = randomToken(32);
      const chId = newId('ch');
      await ctx.db.run('INSERT INTO auth_challenges (id, purpose, subject_id, code_hash, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?)',
        chId, 'invite', id, await sha256Hex(token), new Date(Date.now() + 72 * 3600_000).toISOString(), ctx.ip);
      const s = await getSettings(ctx.env, ctx.db);
      const sent = await sendEmail(ctx.env, { to: email, ...memberInviteEmail(s.orgName, name, ctx.admin!.name, `${appOrigin(ctx)}/admin/#/reset?c=${chId}&t=${token}&invite=1`, role) });
      await audit(ctx, 'member_invited', { type: 'admin_user', id }, { email, role, emailed: sent.ok });
      return json({ ok: true, id, invited: sent.ok, message: sent.ok ? `Invite sent to ${email}.` : 'The account was created but the invite email failed. Set a temporary password for them instead.' });
    }
    const problem = passwordProblem(tempPassword, { email, name });
    if (problem) throw bad(`Temporary password: ${problem}`, 'weak_password', { field: 'temporaryPassword' });
    const { salt, hash, iterations } = await hashPassword(tempPassword);
    await ctx.db.run(
      'INSERT INTO admin_users (id, email, name, role, pass_hash, pass_salt, pass_iterations, must_change_password, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
      id, email, name, role, hash, salt, iterations, ctx.admin!.email
    );
    await audit(ctx, 'member_added', { type: 'admin_user', id }, { email, role });
    return json({ ok: true, id, invited: false, message: `${name} can sign in with the temporary password and will be asked to choose a new one.` });
  });

  r.add('PATCH', '/api/admin/members/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    const u = await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE id = ?', id);
    if (!u) throw notFound('Team member not found.');
    const b = await readJson(ctx.request, 4096);
    const sets: string[] = [];
    const vals: unknown[] = [];
    let revoke = false;
    const managers = Number((await ctx.db.value<number>("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'manager' AND active = 1")) ?? 0);
    if ('role' in b) {
      const role = oneOf(b, 'role', ['manager', 'member'] as const)!;
      if (u.role === 'manager' && role === 'member' && managers <= 1) throw forbidden('You cannot demote the last active manager.');
      sets.push('role = ?'); vals.push(role);
    }
    if ('active' in b) {
      const active = bool(b, 'active')!;
      if (!active && u.role === 'manager' && managers <= 1) throw forbidden('You cannot deactivate the last active manager.');
      if (!active && id === ctx.admin!.userId) throw forbidden('You cannot deactivate your own account.');
      sets.push('active = ?'); vals.push(active ? 1 : 0);
      if (!active) revoke = true;
    }
    if ('name' in b) { sets.push('name = ?'); vals.push(str(b, 'name', { min: 2, max: 80, label: 'Name' })); }
    if ('temporaryPassword' in b) {
      const pw = str(b, 'temporaryPassword', { max: 128, trim: false, label: 'Temporary password' });
      const problem = passwordProblem(pw, { email: u.email, name: u.name });
      if (problem) throw bad(`Temporary password: ${problem}`, 'weak_password');
      const { salt, hash, iterations } = await hashPassword(pw);
      sets.push('pass_hash = ?', 'pass_salt = ?', 'pass_iterations = ?', 'must_change_password = 1', 'locked_until = NULL', 'failed_logins = 0');
      vals.push(hash, salt, iterations);
      revoke = true;
    }
    if (b.unlock === true) { sets.push('locked_until = NULL', 'failed_logins = 0'); await clear(ctx.db, `adm-fail:${u.email}`); }
    if (!sets.length) throw bad('Nothing to update.');
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    // Removing a manager's power is conditional in the same statement, so two managers
    // demoting each other at the same moment can never leave the team without one.
    const losesManager = u.role === 'manager' && (b.role === 'member' || b.active === false);
    const guard = losesManager ? " AND (SELECT COUNT(*) FROM admin_users WHERE role = 'manager' AND active = 1 AND id != ?) >= 1" : '';
    const res = await ctx.db.run(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?${guard}`, ...vals, id, ...(losesManager ? [id] : []));
    if (!res.changes) throw forbidden('At least one active manager must remain.');
    await audit(ctx, 'member_updated', { type: 'admin_user', id }, { fields: Object.keys(b).map((k) => (k === 'temporaryPassword' ? 'password reset' : k)) });
    if (revoke) await revokeAllAdminSessions(ctx.db, id);
    return json({ ok: true });
  });

  r.add('DELETE', '/api/admin/members/:id', 'manager', async (ctx) => {
    const id = pathId(ctx.params.id);
    if (id === ctx.admin!.userId) throw forbidden('You cannot remove your own account.');
    const u = await ctx.db.first<AdminUserRow>('SELECT * FROM admin_users WHERE id = ?', id);
    if (!u) throw notFound('Team member not found.');
    if (u.role === 'manager') {
      const managers = Number((await ctx.db.value<number>("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'manager' AND active = 1")) ?? 0);
      if (managers <= 1) throw forbidden('You cannot remove the last manager.');
    }
    await ctx.db.batch([
      ctx.db.stmt('DELETE FROM admin_users WHERE id = ?', id), // sessions cascade
      auditStmt(ctx, 'member_removed', { type: 'admin_user', id }, { email: u.email }),
    ]);
    return json({ ok: true });
  });
}
