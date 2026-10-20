import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { resetSchemaCache } from '../src/db/migrate';
import { invalidateSettings } from '../src/lib/settings';
import { Db } from '../src/db/db';

export const BOOT = { email: 'admin@test.local', password: 'bootstrap-setup-pass' };
export const MANAGER_PASSWORD = 'Correct-Horse-42-battery';

/** Fresh empty database for each test (storage is isolated per test by the pool). */
export async function fresh(): Promise<Db> {
  resetSchemaCache();
  invalidateSettings();
  const db = new Db(env.DB);
  // Trigger schema creation through the real Worker path.
  await req('/api/health');
  await req('/api/public/config');
  return db;
}

export async function req(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const request = new Request('https://test.local' + path, { ...init, headers, body });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function cookieOf(res: Response, name: string): string {
  const all = res.headers.getSetCookie?.() ?? [res.headers.get('Set-Cookie') || ''];
  const c = all.find((x) => x.startsWith(name + '='));
  return c ? c.split(';')[0] : '';
}

/** Complete first-run setup and return the manager's cookie. */
export async function managerCookie(): Promise<string> {
  const login = await req('/api/admin/auth/login', { method: 'POST', json: BOOT });
  const lb = await login.json<any>();
  if (lb.next === 'setup') {
    const setup = await req('/api/admin/auth/setup', { method: 'POST', json: { token: lb.token, name: 'Test Manager', password: MANAGER_PASSWORD } });
    if (setup.status !== 200) throw new Error('setup failed: ' + (await setup.text()));
    return cookieOf(setup, '__Host-talo_admin');
  }
  const again = await req('/api/admin/auth/login', { method: 'POST', json: { email: BOOT.email, password: MANAGER_PASSWORD } });
  return cookieOf(again, '__Host-talo_admin');
}

export async function memberCookie(manager: string, email = 'member@test.local'): Promise<string> {
  const pw = 'Temporary-pass-77';
  await req('/api/admin/members', { method: 'POST', headers: { Cookie: manager }, json: { name: 'Panel Member', email, role: 'member', temporaryPassword: pw } });
  const l1 = await (await req('/api/admin/auth/login', { method: 'POST', json: { email, password: pw } })).json<any>();
  const ch = await req('/api/admin/auth/change-password', { method: 'POST', json: { token: l1.token, password: 'Panel-fresh-pass-88' } });
  return cookieOf(ch, '__Host-talo_admin');
}

export async function seedPaperQuestions(db: Db) {
  const rows = [
    ['q-sql-1', 'sql', 'easy', 'Write a SQL query that returns every product priced above 100.'],
    ['q-sql-2', 'sql', 'medium', 'Write a SQL query that returns the total order amount per customer.'],
    ['q-sql-3', 'sql', 'medium', 'Write a SQL query that lists customers with no orders.'],
    ['q-sql-4', 'sql', 'hard', 'Write a SQL query that finds the second highest salary per department.'],
    ['q-code-1', 'coding', 'easy', 'Write a function that returns the sum of an array of numbers.'],
    ['q-code-2', 'coding', 'medium', 'Write a function that counts the vowels in a string.'],
  ];
  await db.batch(rows.map(([id, cat, diff, prompt]) => db.stmt(
    "INSERT INTO questions (id, category, difficulty, prompt, reference_answer, rubric, marks, source) VALUES (?, ?, ?, ?, 'ref', 'rubric', 3, 'test')",
    id, cat, diff, prompt
  )));
}

export async function createDrive(manager: string, name = 'Test College Drive', live = true): Promise<{ id: string; code: string }> {
  const res = await req('/api/admin/drives', { method: 'POST', headers: { Cookie: manager }, json: { name, scheduledOn: '2026-11-04' } });
  const b = await res.json<any>();
  // Drives start "scheduled"; the invigilator sets them live on the day (tests start live).
  if (live) await req(`/api/admin/drives/${b.id}`, { method: 'PATCH', headers: { Cookie: manager }, json: { status: 'live' } });
  return { id: b.id, code: b.accessCode };
}

/** Insert a ready candidate directly (bypassing resume parsing). */
export async function createCandidate(db: Db, id: string, email: string, opts: { driveId?: string | null; status?: string; name?: string } = {}) {
  await db.run(
    "INSERT INTO candidates (id, email, email_status, name, status, drive_id, resume_key) VALUES (?, ?, 'parsed', ?, ?, ?, NULL)",
    id, email, opts.name ?? 'Asha Kulkarni', opts.status ?? 'ready', opts.driveId ?? null
  );
}

export async function candidateLogin(email: string, code?: string): Promise<{ res: Response; cookie: string }> {
  const res = await req('/api/candidate/login', { method: 'POST', json: { email, code } });
  return { res, cookie: cookieOf(res, '__Host-talo_cand') };
}

export function openAiReply(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

/** Load the legacy v1 schema from db/legacy-v1 (used by the upgrade tests). */
export async function loadV1Schema(files: string[]): Promise<void> {
  for (const sql of files) {
    const clean = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of clean.split(';').map((s) => s.trim()).filter(Boolean)) {
      if (/^PRAGMA\s/i.test(stmt)) continue;
      await env.DB.prepare(stmt).run();
    }
  }
}
