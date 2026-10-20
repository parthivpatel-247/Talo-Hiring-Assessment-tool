import type { Ctx } from './lib/context';

export type Access = 'public' | 'candidate' | 'admin' | 'manager';
export type Handler = (ctx: Ctx) => Promise<Response>;

export interface Route {
  method: string;
  path: string;
  access: Access;
  handler: Handler;
  /** Allowed even while the admin must change their password. */
  allowDuringPasswordChange?: boolean;
  regex: RegExp;
  keys: string[];
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, access: Access, handler: Handler, opts: { allowDuringPasswordChange?: boolean } = {}): this {
    const keys: string[] = [];
    const pattern = path.replace(/:([A-Za-z]+)/g, (_, k: string) => {
      keys.push(k);
      return '([^/]+)';
    });
    this.routes.push({ method, path, access, handler, keys, regex: new RegExp(`^${pattern}$`), ...opts });
    return this;
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | { allowed: string[] } | null {
    const allowed: string[] = [];
    for (const r of this.routes) {
      const m = pathname.match(r.regex);
      if (!m) continue;
      if (r.method !== method) {
        allowed.push(r.method);
        continue;
      }
      const params: Record<string, string> = {};
      let bad = false;
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          bad = true; // malformed %-encoding: treat as no match (404), never a crash
        }
      });
      if (bad) return null;
      return { route: r, params };
    }
    return allowed.length ? { allowed } : null;
  }
}
