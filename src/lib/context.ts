import type { Env, AdminRole, CandidateRow, AttemptRow } from '../env';
import type { Db } from '../db/db';

export interface AdminPrincipal {
  userId: string;
  email: string;
  name: string;
  role: AdminRole;
  tokenHash: string;
  mustChangePassword: boolean;
}

export interface CandidatePrincipal {
  candidate: CandidateRow;
  attempt: AttemptRow;
}

export interface Ctx {
  env: Env;
  db: Db;
  request: Request;
  url: URL;
  ip: string;
  ua: string;
  requestId: string;
  params: Record<string, string>;
  exec: ExecutionContext;
  admin?: AdminPrincipal;
  candidate?: CandidatePrincipal;
  /** Cookies to set on the response. */
  cookies: string[];
}

export function actor(ctx: Ctx): { id: string | null; email: string; role: string | null } {
  if (ctx.admin) return { id: ctx.admin.userId, email: ctx.admin.email, role: ctx.admin.role };
  return { id: null, email: 'system', role: null };
}
