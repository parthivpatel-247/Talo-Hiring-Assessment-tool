import type { Env, QuestionCategory, Difficulty } from '../env';
import type { Db } from '../db/db';
import { bad } from './http';

/**
 * Typed settings with defaults. Stored as rows in `settings`; read through a
 * short in-memory cache so hot paths (heartbeats, answer saves) cost no reads.
 */

export interface PaperSlot {
  category: QuestionCategory;
  difficulty: Difficulty | 'any';
  count: number;
}

export interface Settings {
  assessmentMinutes: number;
  pauseAllowanceMinutes: number;
  wordLimit: number;
  awayGraceSeconds: number;
  requireFullscreenDevice: boolean;
  paper: PaperSlot[];
  loginMode: 'code' | 'otp' | 'email_only';
  admin2fa: 'email' | 'off';
  retentionDays: number;
  contactEmail: string;
  orgName: string;
  autoRefreshSeconds: number;
}

const CACHE_MS = 30_000;
let cache: { at: number; value: Settings } | null = null;

export function invalidateSettings(): void {
  cache = null;
}

function envInt(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : d;
}

export function defaults(env: Env): Settings {
  return {
    assessmentMinutes: Math.min(240, Math.max(5, envInt(env.PART1_DURATION_MINUTES, 60))),
    pauseAllowanceMinutes: 10,
    wordLimit: 1000,
    awayGraceSeconds: 10,
    requireFullscreenDevice: true,
    paper: [
      { category: 'sql', difficulty: 'any', count: envInt(env.SQL_QUESTIONS_PER_STUDENT, 2) },
      { category: 'coding', difficulty: 'any', count: envInt(env.PYTHON_QUESTIONS_PER_STUDENT, 1) },
      { category: 'dsa', difficulty: 'any', count: envInt(env.DSA_QUESTIONS_PER_STUDENT, 1) },
      { category: 'scenario', difficulty: 'any', count: envInt(env.SCENARIO_QUESTIONS_PER_STUDENT, 1) },
    ],
    loginMode: 'code',
    admin2fa: 'email',
    retentionDays: Math.min(365, Math.max(7, envInt(env.DATA_RETENTION_DAYS, 15))),
    contactEmail: (env.CONTACT_EMAIL || env.ADMIN_EMAIL || '').trim(),
    orgName: (env.ORG_NAME || 'Hevo Data').trim(),
    autoRefreshSeconds: 60,
  };
}

const KEY: Record<keyof Settings, string> = {
  assessmentMinutes: 'assessment_minutes',
  pauseAllowanceMinutes: 'pause_allowance_minutes',
  wordLimit: 'word_limit',
  awayGraceSeconds: 'away_grace_seconds',
  requireFullscreenDevice: 'require_fullscreen_device',
  paper: 'paper',
  loginMode: 'login_mode',
  admin2fa: 'admin_2fa',
  retentionDays: 'retention_days',
  contactEmail: 'contact_email',
  orgName: 'org_name',
  autoRefreshSeconds: 'auto_refresh_seconds',
};

export async function getSettings(env: Env, db: Db): Promise<Settings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const s = defaults(env);
  for (const [prop, key] of Object.entries(KEY) as [keyof Settings, string][]) {
    if (!map.has(key)) continue;
    try {
      const parsed = coerce(prop, map.get(key)!);
      (s as unknown as Record<string, unknown>)[prop] = parsed;
    } catch {
      /* an invalid stored value falls back to the default */
    }
  }
  cache = { at: Date.now(), value: s };
  return s;
}

const CATS: QuestionCategory[] = ['sql', 'coding', 'dsa', 'scenario'];
const DIFFS = ['any', 'easy', 'medium', 'hard'];

/** Validate one setting value (from the admin form or the DB). Throws 400 on bad input. */
export function coerce(prop: keyof Settings, raw: unknown): Settings[keyof Settings] {
  const intIn = (min: number, max: number, label: string) => {
    const n = typeof raw === 'number' ? raw : Number(String(raw));
    if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}.`);
    return n;
  };
  switch (prop) {
    case 'assessmentMinutes': return intIn(5, 240, 'Assessment length (minutes)');
    case 'pauseAllowanceMinutes': return intIn(0, 60, 'Network pause allowance (minutes)');
    case 'wordLimit': return intIn(100, 3000, 'Word limit');
    case 'awayGraceSeconds': return intIn(5, 60, 'Off-screen grace (seconds)');
    case 'retentionDays': return intIn(7, 365, 'Data retention (days)');
    case 'autoRefreshSeconds': return intIn(15, 600, 'Auto-refresh (seconds)');
    case 'requireFullscreenDevice': {
      if (raw === true || raw === 'true' || raw === '1') return true;
      if (raw === false || raw === 'false' || raw === '0') return false;
      throw bad('Full-screen device requirement must be true or false.');
    }
    case 'loginMode': {
      const v = String(raw);
      if (!['code', 'otp', 'email_only'].includes(v)) throw bad('Student sign-in must be "code", "otp" or "email_only".');
      return v as Settings['loginMode'];
    }
    case 'admin2fa': {
      const v = String(raw);
      if (!['email', 'off'].includes(v)) throw bad('Admin two-step sign-in must be "email" or "off".');
      return v as Settings['admin2fa'];
    }
    case 'contactEmail': {
      const v = String(raw).trim();
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad('Contact email must be a valid email address.');
      return v.slice(0, 254);
    }
    case 'orgName': {
      const v = String(raw).trim();
      if (!v || v.length > 80) throw bad('Organisation name must be 1 to 80 characters.');
      return v;
    }
    case 'paper': {
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(arr) || !arr.length || arr.length > 12) throw bad('The paper needs 1 to 12 question slots.');
      const slots: PaperSlot[] = arr.map((x: Record<string, unknown>) => {
        const category = String(x?.category) as QuestionCategory;
        const difficulty = String(x?.difficulty ?? 'any') as PaperSlot['difficulty'];
        const count = Number(x?.count);
        if (!CATS.includes(category)) throw bad(`Unknown question type "${category}".`);
        if (!DIFFS.includes(difficulty)) throw bad(`Unknown difficulty "${difficulty}".`);
        if (!Number.isInteger(count) || count < 0 || count > 10) throw bad('Each slot needs 0 to 10 questions.');
        return { category, difficulty, count };
      });
      const total = slots.reduce((n, s) => n + s.count, 0);
      if (total < 1 || total > 15) throw bad('A paper must have between 1 and 15 questions in total.');
      return slots;
    }
  }
}

export async function saveSettings(env: Env, db: Db, patch: Partial<Record<keyof Settings, unknown>>, by: string): Promise<Settings> {
  const stmts: D1PreparedStatement[] = [];
  for (const [prop, raw] of Object.entries(patch) as [keyof Settings, unknown][]) {
    if (!Object.prototype.hasOwnProperty.call(KEY, prop)) continue;
    const v = coerce(prop, raw);
    const stored = typeof v === 'string' ? v : JSON.stringify(v);
    stmts.push(
      db.stmt(
        `INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        KEY[prop], stored, by
      )
    );
  }
  if (!stmts.length) throw bad('Nothing to update.');
  await db.batch(stmts);
  invalidateSettings();
  return getSettings(env, db);
}

export function paperTotal(s: Settings): number {
  return s.paper.reduce((n, x) => n + x.count, 0);
}

export const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  sql: 'SQL',
  coding: 'Coding',
  dsa: 'DSA',
  scenario: 'Scenario',
};

export function defaultMarks(env: Env, category: QuestionCategory): number {
  const m: Record<QuestionCategory, string | undefined> = { sql: env.SQL_MARKS, coding: env.PYTHON_MARKS, dsa: env.DSA_MARKS, scenario: env.SCENARIO_MARKS };
  const fallback: Record<QuestionCategory, number> = { sql: 3, coding: 4, dsa: 5, scenario: 5 };
  const n = Number(m[category]);
  return Number.isFinite(n) && n > 0 ? n : fallback[category];
}
