/**
 * Setup / config / destructive admin actions that only a MANAGER may perform.
 * Panel members can view, grade and shortlist; everything matched here returns 403
 * for them. Shared by the support and writers admin routes so both sites enforce
 * exactly the same rule.
 */
export function isManagerOnlyRoute(path: string, method: string): boolean {
  return (
    (path === '/api/admin/resumes/upload' && method === 'POST') ||
    (path === '/api/admin/resumes/process' && method === 'POST') ||
    (path === '/api/admin/questions' && method === 'POST') ||
    (path === '/api/admin/questions/bulk-import' && method === 'POST') ||
    (path === '/api/admin/questions/enrich-all' && method === 'POST') ||
    (/^\/api\/admin\/questions\/[^/]+\/enrich$/.test(path) && method === 'POST') ||
    (/^\/api\/admin\/questions\/[^/]+\/toggle-active$/.test(path) && method === 'POST') ||
    (/^\/api\/admin\/questions\/[^/]+\/restore$/.test(path) && method === 'POST') ||
    (/^\/api\/admin\/questions\/[^/]+$/.test(path) && (method === 'PUT' || method === 'DELETE')) ||
    (path === '/api/admin/part3/seed' && method === 'POST') ||
    (/^\/api\/admin\/candidates\/[^/]+$/.test(path) && method === 'DELETE') ||
    (/^\/api\/admin\/candidates\/[^/]+\/(force-submit|manual|retake|resume|revoke|unrevoke|college)$/.test(path) && method === 'POST') ||
    // Writers site: per-part assessment length.
    (path === '/api/admin/assessment-length' && method === 'POST') ||
    (path === '/api/admin/start-open' && method === 'POST') ||
    (path === '/api/admin/signin-pauses/clear' && method === 'POST')
  );
}

export const MANAGER_ONLY_MESSAGE = 'This action needs manager access. Log in with the manager password to do it.';
