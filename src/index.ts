import type { Env } from './env';
import { Router } from './router';
import { Db } from './db/db';
import { ensureSchema } from './db/migrate';
import type { Ctx } from './lib/context';
import { HttpError, errorResponse, json, withCookies } from './lib/http';
import { clientIp, isCrossSite, secureResponse, userAgent } from './lib/security';
import { loadAdmin, loadCandidate } from './lib/sessions';
import { recordError, recordUsage } from './lib/telemetry';
import { registerPublic } from './routes/public';
import { registerCandidate } from './routes/candidate';
import { registerAdminAuth } from './routes/admin/auth';
import { registerAdminCandidates } from './routes/admin/candidates';
import { registerAdminResumes } from './routes/admin/resumes';
import { registerAdminQuestions } from './routes/admin/questions';
import { registerAdminOrg } from './routes/admin/org';
import { registerAdminReports } from './routes/admin/reports';
import { runScheduled } from './cron';

const router = new Router();
registerPublic(router);
registerCandidate(router);
registerAdminAuth(router);
registerAdminCandidates(router);
registerAdminResumes(router);
registerAdminQuestions(router);
registerAdminOrg(router);
registerAdminReports(router);

async function handleApi(request: Request, env: Env, exec: ExecutionContext, url: URL, requestId: string): Promise<Response> {
  if (request.method === 'OPTIONS') {
    // No CORS: the API is same-origin only. Preflights get no Allow-Origin, so browsers block cross-site calls.
    return new Response(null, { status: 204 });
  }
  if (isCrossSite(request, env)) {
    return json({ error: 'Cross-site requests are not allowed.', code: 'cross_site' }, { status: 403 });
  }
  const matched = router.match(request.method, url.pathname);
  if (!matched) return json({ error: 'Not found.', code: 'not_found' }, { status: 404 });
  if ('allowed' in matched) {
    return json({ error: 'Method not allowed.', code: 'method_not_allowed' }, { status: 405, headers: { Allow: matched.allowed.join(', ') } });
  }
  const { route, params } = matched;
  const db = new Db(env.DB);
  const ctx: Ctx = { env, db, request, url, ip: clientIp(request), ua: userAgent(request), requestId, params, exec, cookies: [] };
  const routeKey = `${route.method} ${route.path}`;
  try {
    try {
      await ensureSchema(env, db);
    } catch (err) {
      console.error('schema upgrade failed', err);
      return json({ error: 'Talo is being updated. Please try again in a minute.', code: 'maintenance', requestId }, { status: 503, headers: { 'Retry-After': '30' } });
    }
    if (route.access === 'candidate') {
      const p = await loadCandidate(env, db, request);
      if (!p) throw new HttpError(401, 'Your session has ended. Please sign in again.', 'unauthorized');
      ctx.candidate = p;
    } else if (route.access === 'admin' || route.access === 'manager') {
      const a = await loadAdmin(db, request);
      if (!a) throw new HttpError(401, 'Please sign in to continue.', 'unauthorized');
      ctx.admin = a;
      if (a.mustChangePassword && !route.allowDuringPasswordChange) throw new HttpError(403, 'Choose a new password to continue.', 'password_change_required');
      if (route.access === 'manager' && a.role !== 'manager') throw new HttpError(403, 'Only a manager can do this.', 'forbidden');
    }
    const res = await route.handler(ctx);
    return ctx.cookies.length ? withCookies(res, ctx.cookies) : res;
  } catch (err) {
    if (err instanceof HttpError) {
      const res = errorResponse(err, err.status >= 500 ? requestId : undefined);
      if (err.status === 429 && err.extra.retryAfter) res.headers.set('Retry-After', String(err.extra.retryAfter));
      return ctx.cookies.length ? withCookies(res, ctx.cookies) : res;
    }
    console.error(`[${requestId}] ${routeKey} failed`, err);
    exec.waitUntil(
      recordError(new Db(env.DB), {
        surface: 'server',
        message: err instanceof Error ? err.message : String(err),
        source: routeKey,
        stack: err instanceof Error ? err.stack : undefined,
        url: url.pathname,
      })
    );
    return json({ error: 'Something went wrong on our side. Please try again; if it keeps happening, share this reference with support.', code: 'internal', requestId }, { status: 500 });
  } finally {
    recordUsage(env, exec, routeKey, db.stats);
  }
}

export default {
  async fetch(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID().slice(0, 8);
    let res: Response;
    if (url.pathname.startsWith('/api/')) {
      res = await handleApi(request, env, exec, url, requestId);
    } else {
      if (url.pathname === '/admin') return Response.redirect(`${url.origin}/admin/`, 301);
      res = await env.ASSETS.fetch(request);
      if (url.pathname.endsWith('.html') || url.pathname.endsWith('/') || !url.pathname.includes('.')) {
        res = new Response(res.body, res);
        res.headers.set('Cache-Control', 'no-cache');
      }
    }
    const out = secureResponse(res, env, url.pathname);
    out.headers.set('X-Request-Id', requestId);
    return out;
  },

  async scheduled(event: ScheduledController, env: Env, exec: ExecutionContext): Promise<void> {
    exec.waitUntil(runScheduled(event.cron, env));
  },
};
