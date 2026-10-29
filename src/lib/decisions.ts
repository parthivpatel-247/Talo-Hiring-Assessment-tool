import type { Env } from '../types';
import { json } from './auth';
import { ensureManagerEditCols } from './db';

/**
 * Shortlist / reject (both sites). Only a graded candidate: status evaluated,
 * shortlisted or rejected, and not a candidate whose "rejected" came from Revoke
 * access before they were graded (their status_before_revoke is not a graded one).
 * The decision supersedes the revoke, so Restore access keeps it.
 * Returns an error response, or null when the decision was saved.
 */
export async function decideCandidate(env: Env, id: string, status: 'shortlisted' | 'rejected'): Promise<Response | null> {
  await ensureManagerEditCols(env);
  const r = await env.DB.prepare(
    `UPDATE candidates SET status = ?, status_before_revoke = NULL
      WHERE id = ? AND status IN ('evaluated','shortlisted','rejected')
        AND (status_before_revoke IS NULL OR status_before_revoke IN ('evaluated','shortlisted','rejected'))`
  ).bind(status, id).run();
  if (r.meta?.changes) return null;
  const c = await env.DB.prepare('SELECT status, status_before_revoke FROM candidates WHERE id = ?').bind(id).first<{ status: string; status_before_revoke: string | null }>();
  if (c?.status === 'rejected' && c.status_before_revoke) {
    return json({ error: 'This candidate was rejected when their access was revoked, before they were graded. Restore access and grade them first.' }, { status: 409 });
  }
  return json({ error: 'Only a graded candidate can be shortlisted or rejected. Refresh the list.' }, { status: 409 });
}
