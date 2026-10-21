export interface Env {
  DB: D1Database;
  RESUMES: R2Bucket;
  ASSETS: Fetcher;

  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  ADMIN_EMAIL?: string; // email the manager signs in with (paired with ADMIN_PASSWORD)
  ADMIN_PASSWORD: string; // manager (full access)
  PANEL_EMAIL?: string; // email the panel bootstrap signs in with (paired with PANEL_PASSWORD)
  PANEL_PASSWORD?: string; // panel member (limited access); optional
  SESSION_SECRET: string;
  COLLEGES?: string; // comma-separated college names for segregation

  PART1_DURATION_MINUTES: string;
  PART2_DURATION_MINUTES: string;
  PART3_DURATION_MINUTES?: string;
  DATA_RETENTION_DAYS: string;
  SQL_QUESTIONS_PER_STUDENT: string;
  PYTHON_QUESTIONS_PER_STUDENT: string;
  DSA_QUESTIONS_PER_STUDENT?: string;
  SCENARIO_QUESTIONS_PER_STUDENT?: string;
  PART2_QUESTIONS_PER_STUDENT: string;
  PART3_BUGGY_PER_STUDENT?: string;
  PART3_SCENARIO_PER_STUDENT?: string;
  SQL_MARKS: string;
  PYTHON_MARKS: string;
  DSA_MARKS?: string;
  SCENARIO_MARKS?: string;
  PART2_MARKS: string;
  PART3_MARKS?: string;
  ANALYSIS_BATCH_SIZE: string;
  STALE_GRACE_MINUTES?: string;
  // How many candidates to grade per analysis/run call (default 12).
  GRADING_BATCH_SIZE?: string;
  // How many candidates in that batch to grade concurrently (default 6).
  GRADING_CONCURRENCY?: string;
  // How many resumes to parse concurrently per "Parse resumes" click (default 6).
  RESUME_PARSE_CONCURRENCY?: string;
  // How many resume files to upload to R2 concurrently per batch (default 10).
  RESUME_UPLOAD_CONCURRENCY?: string;

  // Which hiring team this deployment serves: unset/"support" = support hiring,
  // "docs" = documentation/writers hiring (two-part writing test). See src/lib/team.ts.
  TEAM?: string;
  // Writers site only: questions per candidate in each part, default marks for a new
  // question in each part, and the default word limit per answer.
  DOCS_PART1_QUESTIONS?: string;
  DOCS_PART2_QUESTIONS?: string;
  DOCS_PART1_MARKS?: string;
  DOCS_PART2_MARKS?: string;
  DOCS_WORD_LIMIT?: string;
}

export interface Candidate {
  id: string;
  email: string;
  name: string | null;
  resume_r2_key: string;
  resume_filename: string | null;
  skills: string | null; // JSON string
  projects: string | null; // JSON string
  parsed_at: string | null;
  status: CandidateStatus;
  access_revoked: number;
  retake_granted: number;
  college: string | null;
  created_at: string;
}

export type CandidateStatus =
  | 'uploaded'
  | 'parsed'
  | 'part2_ready'
  | 'in_progress'
  | 'submitted'
  | 'evaluated'
  | 'shortlisted'
  | 'rejected'
  | 'parse_failed';

export interface ParsedResume {
  name: string;
  email: string | null;
  skills: string[];
  projects: { name: string; description: string; technologies: string[] }[];
}

export interface QuestionBankRow {
  id: string;
  category: 'sql' | 'python' | 'dsa' | 'scenario' | 'part1' | 'part2'; // part1/part2: writers site only
  prompt: string;
  word_limit?: number | null; // writers site only
  reference_answer: string | null;
  sample_data: string | null;
  expected_output: string | null; // the correct result the reference produces on sample_data — grading matches against THIS, not query text
  rubric: string | null;
  hint: string | null; // one-line nudge shown to the candidate on demand (no full solution)
  checkpoints: string | null; // DSA/scenario: itemized marking checkpoints (admin-only)
  marks: number;
  difficulty: string | null;
  status: string;
  active: number;
  deleted_at: string | null; // set when soft-deleted; row + content kept for restore/audit
}

export interface Part2Question {
  id: string;
  candidate_id: string;
  position: number;
  prompt: string;
  based_on_skill: string | null;
  rubric: string; // JSON string
  marks: number;
}

export interface Part3QuestionRow {
  id: string;
  kind: 'buggy_fix' | 'scenario';
  title: string | null;
  prompt: string;
  code_snippet: string | null;
  reference_answer: string | null;
  rubric: string | null;
  marks: number;
  difficulty: string | null;
  active: number;
}

export interface AttemptRow {
  candidate_id: string;
  part1_started_at: string | null;
  part1_remaining_seconds: number | null;
  part1_last_heartbeat_at: string | null;
  part1_submitted_at: string | null;
  part1_tab_switch_count: number;
  part2_started_at: string | null;
  part2_remaining_seconds: number | null;
  part2_last_heartbeat_at: string | null;
  part2_submitted_at: string | null;
  part2_tab_switch_count: number;
  part2_tab_switch_log: string | null;
  part3_started_at?: string | null;
  part3_remaining_seconds?: number | null;
  part3_last_heartbeat_at?: string | null;
  part3_submitted_at?: string | null;
  part3_tab_switch_count?: number;
  part3_tab_switch_log?: string | null;
  login_count?: number;
  first_login_at?: string | null;
  last_login_at?: string | null;
}

export interface GradeResult {
  score: number; // marks awarded, 0..maxMarks
  reasoning: string;
  deductions: { reason: string; marks: number }[];
  aiContentPercent?: number; // Part 2 only: 0-100 estimate of how AI-generated the answer looks
}
