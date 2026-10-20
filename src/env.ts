/**
 * Worker bindings and configuration.
 *
 * Secrets (set with `wrangler secret put <NAME>`, never committed):
 *   SESSION_SECRET      long random string used to sign cookies and hash codes
 *   OPENAI_API_KEY      server-side only: resume parsing, enrichment, grading
 *   ADMIN_PASSWORD      first-run setup password (only works until a manager account exists)
 *   EMAIL_API_KEY       optional: Resend or SendGrid key for login codes and invites
 *   TURNSTILE_SECRET    optional: Cloudflare Turnstile secret for the public login forms
 */
export interface Env {
  DB: D1Database;
  RESUMES: R2Bucket;
  ASSETS: Fetcher;

  SESSION_SECRET: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;

  /** Email of the first manager. Pairs with ADMIN_PASSWORD for first-run setup only. */
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;

  /** Public origin of the app, e.g. https://talo.hevo-talo.workers.dev (used in email links + CORS). */
  APP_ORIGIN?: string;
  /** "production" disables dev conveniences (codes are never echoed). */
  ENVIRONMENT?: string;

  /** Email delivery. Provider: "resend" | "sendgrid" | "" (disabled). */
  EMAIL_PROVIDER?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;

  /** Cloudflare Turnstile (CAPTCHA). Both must be set to enable it. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;

  /** Contact shown on the legal pages and the help link. */
  CONTACT_EMAIL?: string;
  ORG_NAME?: string;

  /** Defaults; most are editable in the admin Settings and stored in the DB. */
  PART1_DURATION_MINUTES?: string;
  DATA_RETENTION_DAYS?: string;
  SQL_QUESTIONS_PER_STUDENT?: string;
  PYTHON_QUESTIONS_PER_STUDENT?: string;
  DSA_QUESTIONS_PER_STUDENT?: string;
  SCENARIO_QUESTIONS_PER_STUDENT?: string;
  SQL_MARKS?: string;
  PYTHON_MARKS?: string;
  DSA_MARKS?: string;
  SCENARIO_MARKS?: string;
  STALE_GRACE_MINUTES?: string;
  GRADING_BATCH_SIZE?: string;
  GRADING_CONCURRENCY?: string;
  ANALYSIS_BATCH_SIZE?: string;
  RESUME_PARSE_CONCURRENCY?: string;
  RESUME_UPLOAD_CONCURRENCY?: string;
  COLLEGES?: string;
}

export type AdminRole = 'manager' | 'member';

export type CandidateStatus =
  | 'uploaded'
  | 'parse_failed'
  | 'ready'
  | 'in_progress'
  | 'submitted'
  | 'grading'
  | 'graded'
  | 'shortlisted'
  | 'rejected';

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  'uploaded', 'parse_failed', 'ready', 'in_progress', 'submitted', 'grading', 'graded', 'shortlisted', 'rejected',
];

export type QuestionCategory = 'sql' | 'coding' | 'dsa' | 'scenario';
export const QUESTION_CATEGORIES: QuestionCategory[] = ['sql', 'coding', 'dsa', 'scenario'];
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface CandidateRow {
  id: string;
  email: string;
  email_status: 'pending' | 'parsed' | 'confirmed';
  name: string | null;
  phone: string | null;
  college_id: string | null;
  drive_id: string | null;
  resume_college: string | null;
  degree: string | null;
  graduation_year: number | null;
  skills: string;
  projects: string;
  resume_key: string | null;
  resume_filename: string | null;
  resume_bytes: number | null;
  parsed_at: string | null;
  parse_error: string | null;
  parse_warnings: string | null;
  status: CandidateStatus;
  access_revoked: number;
  invite_code_hash: string | null;
  invite_code_set_at: string | null;
  invite_sent_at: string | null;
  is_test: number;
  grading_claim: string | null;
  grading_claimed_at: string | null;
  score_awarded: number | null;
  score_max: number | null;
  graded_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttemptRow {
  candidate_id: string;
  attempt_no: number;
  session_nonce: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  deadline_at: string | null;
  remaining_seconds: number | null;
  last_heartbeat_at: string | null;
  submitted_at: string | null;
  submit_reason: string | null;
  login_count: number;
  first_login_at: string | null;
  last_login_at: string | null;
  blocked_login_count: number;
  tab_switch_count: number;
  offline_count: number;
  offline_seconds: number;
  paste_blocked_count: number;
  last_ip: string | null;
  user_agent: string | null;
}

export interface QuestionRow {
  id: string;
  category: QuestionCategory;
  title: string | null;
  topic: string | null;
  difficulty: Difficulty;
  prompt: string;
  sample_data: string | null;
  hint: string | null;
  reference_answer: string | null;
  expected_output: string | null;
  rubric: string | null;
  checkpoints: string | null;
  marks: number;
  source: string | null;
  active: number;
  assigned_count: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  pass_hash: string | null;
  pass_salt: string | null;
  pass_iterations: number;
  must_change_password: number;
  email_verified_at: string | null;
  active: number;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  password_changed_at: string | null;
  created_at: string;
}

export interface ParsedResume {
  name: string;
  email: string | null;
  phone?: string | null;
  college?: string | null;
  degree?: string | null;
  graduation_year?: number | null;
  skills: string[];
  projects: { name: string; description: string; technologies: string[] }[];
}

export interface GradeResult {
  score: number;
  reasoning: string;
  deductions: { reason: string; marks: number }[];
  aiContentPercent?: number;
}
