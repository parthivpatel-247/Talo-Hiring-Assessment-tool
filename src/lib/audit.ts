import type { Ctx } from './context';

/**
 * Admin audit trail: who did what, to what, from where. Written for every
 * mutating admin action. Best-effort: auditing never breaks the action itself.
 */
export async function audit(
  ctx: Ctx,
  action: string,
  target?: { type: string; id?: string | null } | null,
  detail?: unknown
): Promise<void> {
  try {
    const d = detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail);
    await ctx.db.run(
      `INSERT INTO audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ctx.admin?.userId ?? null,
      ctx.admin?.email ?? 'system',
      ctx.admin?.role ?? null,
      action,
      target?.type ?? null,
      target?.id ?? null,
      d ? d.slice(0, 8000) : null,
      ctx.ip
    );
  } catch (err) {
    console.error('audit write failed', err);
  }
}

/** Statement form, for including the audit row inside an atomic batch. */
export function auditStmt(ctx: Ctx, action: string, target?: { type: string; id?: string | null } | null, detail?: unknown): D1PreparedStatement {
  const d = detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail);
  return ctx.db.stmt(
    `INSERT INTO audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ctx.admin?.userId ?? null,
    ctx.admin?.email ?? 'system',
    ctx.admin?.role ?? null,
    action,
    target?.type ?? null,
    target?.id ?? null,
    d ? d.slice(0, 8000) : null,
    ctx.ip
  );
}
