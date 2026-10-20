/**
 * Thin, metered wrapper around D1.
 *
 * Every query goes through here so we can count rows read / written per request
 * (D1 returns them in `meta`). Those counts feed the admin "Database usage" view,
 * which is how we keep an eye on D1's rows-read quota during a drive.
 */
export interface DbStats {
  queries: number;
  rowsRead: number;
  rowsWritten: number;
}

type Param = string | number | null | boolean | ArrayBuffer;

function norm(params: unknown[]): Param[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p as Param;
  });
}

export class Db {
  readonly stats: DbStats = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  constructor(readonly d1: D1Database) {}

  private meter(meta: { rows_read?: number; rows_written?: number } | undefined) {
    this.stats.queries += 1;
    this.stats.rowsRead += Number(meta?.rows_read ?? 0);
    this.stats.rowsWritten += Number(meta?.rows_written ?? 0);
  }

  /** A prepared statement for use in `batch()`. */
  stmt(sql: string, ...params: unknown[]): D1PreparedStatement {
    const s = this.d1.prepare(sql);
    return params.length ? s.bind(...norm(params)) : s;
  }

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const res = await this.stmt(sql, ...params).all<T>();
    this.meter(res.meta as never);
    return res.results ?? [];
  }

  async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
    const rows = await this.all<T>(sql, ...params);
    return rows[0] ?? null;
  }

  async value<T = number>(sql: string, ...params: unknown[]): Promise<T | null> {
    const row = await this.first<Record<string, unknown>>(sql, ...params);
    if (!row) return null;
    const k = Object.keys(row)[0];
    return (row[k] as T) ?? null;
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastRowId: number }> {
    const res = await this.stmt(sql, ...params).run();
    this.meter(res.meta as never);
    return { changes: Number(res.meta?.changes ?? 0), lastRowId: Number(res.meta?.last_row_id ?? 0) };
  }

  /** Atomic: D1 runs a batch as a single transaction. */
  async batch(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
    if (!stmts.length) return [];
    const res = await this.d1.batch(stmts);
    for (const r of res) this.meter(r.meta as never);
    return res;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** "?, ?, ?" for an IN (...) list. */
/** IN-list over one JSON parameter: avoids D1's 100-bound-parameter limit. Bind `JSON.stringify(ids)`. */
export const IN_JSON = '(SELECT value FROM json_each(?))';

export function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ');
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}
