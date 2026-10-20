/**
 * Talo database schema, version 2.
 *
 * Design notes
 * - Third normal form for the core entities: colleges, drives, candidates,
 *   attempts (1:1 with candidate), questions, assignments, answers (1:1 with an
 *   assignment), question exposures (history), interview questions.
 * - Every child row has a foreign key; candidate data cascades on delete, so a
 *   single DELETE FROM candidates removes everything that belongs to them.
 * - Questions are never hard-deleted while referenced: they are soft-deleted
 *   (deleted_at) so past papers and grades stay explainable.
 * - CHECK constraints guard enums and JSON columns at the database level.
 * - Every query path used by the app has an index (see INDEXES below). Counts
 *   that would otherwise need a scan are kept as small counters
 *   (questions.assigned_count, attempts.*_count) and updated in the same batch.
 *
 * Timestamps are ISO-8601 UTC text (SQLite has no native timestamp type).
 */
export const SCHEMA_VERSION = 2;

export const TABLES: string[] = [
  `CREATE TABLE schema_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by TEXT
  )`,

  `CREATE TABLE colleges (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 120),
    city        TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    archived_at TEXT
  )`,

  `CREATE TABLE drives (
    id            TEXT PRIMARY KEY,
    college_id    TEXT REFERENCES colleges(id) ON DELETE SET NULL,
    name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    scheduled_on  TEXT,
    access_code   TEXT,
    code_required INTEGER NOT NULL DEFAULT 1 CHECK (code_required IN (0, 1)),
    status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'closed')),
    created_by    TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE candidates (
    id                 TEXT PRIMARY KEY,
    email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email_status       TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'parsed', 'confirmed')),
    name               TEXT,
    phone              TEXT,
    college_id         TEXT REFERENCES colleges(id) ON DELETE SET NULL,
    drive_id           TEXT REFERENCES drives(id) ON DELETE SET NULL,
    resume_college     TEXT,
    degree             TEXT,
    graduation_year    INTEGER,
    skills             TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skills)),
    projects           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(projects)),
    resume_key         TEXT,
    resume_filename    TEXT,
    resume_bytes       INTEGER,
    parsed_at          TEXT,
    parse_error        TEXT,
    parse_warnings     TEXT,
    status             TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parse_failed', 'ready', 'in_progress', 'submitted', 'grading', 'graded', 'shortlisted', 'rejected')),
    access_revoked     INTEGER NOT NULL DEFAULT 0 CHECK (access_revoked IN (0, 1)),
    invite_code_hash   TEXT,
    invite_code_set_at TEXT,
    invite_sent_at     TEXT,
    is_test            INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
    grading_claim      TEXT,
    grading_claimed_at TEXT,
    score_awarded      REAL,
    score_max          REAL,
    graded_at          TEXT,
    decided_by         TEXT,
    decided_at         TEXT,
    notes              TEXT,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE attempts (
    candidate_id        TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
    attempt_no          INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
    session_nonce       TEXT,
    duration_seconds    INTEGER,
    started_at          TEXT,
    deadline_at         TEXT,
    remaining_seconds   INTEGER,
    last_heartbeat_at   TEXT,
    submitted_at        TEXT,
    submit_reason       TEXT CHECK (submit_reason IS NULL OR submit_reason IN ('candidate', 'time_up', 'deadline', 'left_screen', 'reload', 'admin', 'revoked', 'auto_close')),
    login_count         INTEGER NOT NULL DEFAULT 0,
    first_login_at      TEXT,
    last_login_at       TEXT,
    blocked_login_count INTEGER NOT NULL DEFAULT 0,
    tab_switch_count    INTEGER NOT NULL DEFAULT 0,
    offline_count       INTEGER NOT NULL DEFAULT 0,
    offline_seconds     INTEGER NOT NULL DEFAULT 0,
    paste_blocked_count INTEGER NOT NULL DEFAULT 0,
    last_ip             TEXT,
    user_agent          TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE attempt_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    attempt_no   INTEGER NOT NULL DEFAULT 1,
    type         TEXT NOT NULL,
    detail       TEXT CHECK (detail IS NULL OR json_valid(detail)),
    at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE questions (
    id               TEXT PRIMARY KEY,
    category         TEXT NOT NULL CHECK (category IN ('sql', 'coding', 'dsa', 'scenario')),
    title            TEXT,
    topic            TEXT,
    difficulty       TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    prompt           TEXT NOT NULL CHECK (length(prompt) > 0),
    sample_data      TEXT,
    hint             TEXT,
    reference_answer TEXT,
    expected_output  TEXT,
    rubric           TEXT,
    checkpoints      TEXT,
    marks            REAL NOT NULL DEFAULT 5 CHECK (marks > 0 AND marks <= 100),
    source           TEXT,
    active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    assigned_count   INTEGER NOT NULL DEFAULT 0 CHECK (assigned_count >= 0),
    version          INTEGER NOT NULL DEFAULT 1,
    created_by       TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at       TEXT
  )`,

  `CREATE TABLE question_exposures (
    candidate_id  TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    question_id   TEXT NOT NULL REFERENCES questions(id),
    first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (candidate_id, question_id)
  )`,

  `CREATE TABLE assignments (
    candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    question_id  TEXT NOT NULL REFERENCES questions(id),
    position     INTEGER NOT NULL CHECK (position >= 0),
    assigned_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (candidate_id, question_id),
    UNIQUE (candidate_id, position)
  )`,

  `CREATE TABLE answers (
    candidate_id TEXT NOT NULL,
    question_id  TEXT NOT NULL,
    language     TEXT,
    answer_text  TEXT NOT NULL DEFAULT '',
    word_count   INTEGER NOT NULL DEFAULT 0,
    revision     INTEGER NOT NULL DEFAULT 0,
    saved_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    score        REAL,
    max_marks    REAL,
    reasoning    TEXT,
    deductions   TEXT CHECK (deductions IS NULL OR json_valid(deductions)),
    graded_at    TEXT,
    grader       TEXT,
    PRIMARY KEY (candidate_id, question_id),
    FOREIGN KEY (candidate_id, question_id) REFERENCES assignments(candidate_id, question_id) ON DELETE CASCADE
  )`,

  `CREATE TABLE interview_questions (
    id           TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    question     TEXT NOT NULL,
    model_answer TEXT,
    follow_up    TEXT,
    based_on     TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE admin_users (
    id                   TEXT PRIMARY KEY,
    email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name                 TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK (role IN ('manager', 'member')),
    pass_hash            TEXT,
    pass_salt            TEXT,
    pass_iterations      INTEGER NOT NULL DEFAULT 100000,
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
    email_verified_at    TEXT,
    active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    failed_logins        INTEGER NOT NULL DEFAULT 0,
    locked_until         TEXT,
    last_login_at        TEXT,
    password_changed_at  TEXT,
    created_by           TEXT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE admin_sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('manager', 'member')),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at   TEXT NOT NULL,
    last_seen_at TEXT,
    ip           TEXT,
    user_agent   TEXT,
    revoked_at   TEXT
  )`,

  `CREATE TABLE auth_challenges (
    id         TEXT PRIMARY KEY,
    purpose    TEXT NOT NULL CHECK (purpose IN ('admin_login', 'candidate_login', 'password_reset', 'invite')),
    subject_id TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE rate_limits (
    bucket        TEXT PRIMARY KEY,
    count         INTEGER NOT NULL,
    window_start  INTEGER NOT NULL,
    blocked_until INTEGER
  )`,

  `CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id    TEXT,
    actor_email TEXT,
    actor_role  TEXT,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    detail      TEXT,
    ip          TEXT,
    at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE exports (
    id         TEXT PRIMARY KEY,
    version    INTEGER NOT NULL,
    format     TEXT NOT NULL CHECK (format IN ('xlsx', 'csv')),
    scope      TEXT NOT NULL,
    filters    TEXT,
    filename   TEXT NOT NULL,
    r2_key     TEXT,
    row_count  INTEGER NOT NULL DEFAULT 0,
    bytes      INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE backups (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('pre_delete', 'daily', 'pre_migration', 'manual')),
    r2_key          TEXT NOT NULL,
    summary         TEXT,
    candidate_count INTEGER NOT NULL DEFAULT 0,
    bytes           INTEGER NOT NULL DEFAULT 0,
    restored_at     TEXT,
    created_by      TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at      TEXT
  )`,

  `CREATE TABLE usage_daily (
    day          TEXT NOT NULL,
    route        TEXT NOT NULL,
    requests     INTEGER NOT NULL DEFAULT 0,
    rows_read    INTEGER NOT NULL DEFAULT 0,
    rows_written INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, route)
  )`,

  `CREATE TABLE client_errors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    surface     TEXT NOT NULL,
    message     TEXT NOT NULL,
    source      TEXT,
    stack       TEXT,
    url         TEXT,
    user_agent  TEXT,
    count       INTEGER NOT NULL DEFAULT 1,
    first_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,

  `CREATE TABLE analytics_daily (
    day   TEXT NOT NULL,
    event TEXT NOT NULL,
    path  TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, event, path)
  )`,

  `CREATE TABLE similarity_flags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id TEXT NOT NULL REFERENCES questions(id),
    candidate_a TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    candidate_b TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    score       REAL NOT NULL CHECK (score BETWEEN 0 AND 1),
    computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (question_id, candidate_a, candidate_b)
  )`,

  `CREATE TABLE data_requests (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('deletion', 'access', 'correction')),
    message     TEXT,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'rejected')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    resolved_at TEXT,
    resolved_by TEXT
  )`,
];

export const INDEXES: string[] = [
  'CREATE INDEX idx_drives_college ON drives(college_id)',
  'CREATE INDEX idx_drives_status ON drives(status, scheduled_on)',
  'CREATE INDEX idx_candidates_status ON candidates(status)',
  'CREATE INDEX idx_candidates_college ON candidates(college_id, status)',
  'CREATE INDEX idx_candidates_drive ON candidates(drive_id, status)',
  'CREATE INDEX idx_candidates_claim ON candidates(grading_claim)',
  'CREATE INDEX idx_candidates_created ON candidates(created_at)',
  'CREATE INDEX idx_candidates_test ON candidates(is_test)',
  'CREATE INDEX idx_attempts_open ON attempts(submitted_at, started_at)',
  'CREATE INDEX idx_events_candidate ON attempt_events(candidate_id, at)',
  'CREATE INDEX idx_events_type ON attempt_events(type, at)',
  'CREATE INDEX idx_questions_pool ON questions(category, active, deleted_at, assigned_count)',
  'CREATE INDEX idx_questions_deleted ON questions(deleted_at)',
  'CREATE INDEX idx_exposures_question ON question_exposures(question_id)',
  'CREATE INDEX idx_assignments_question ON assignments(question_id)',
  'CREATE INDEX idx_answers_question ON answers(question_id)',
  'CREATE INDEX idx_interview_candidate ON interview_questions(candidate_id, position)',
  'CREATE INDEX idx_admin_sessions_user ON admin_sessions(user_id)',
  'CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at)',
  'CREATE INDEX idx_challenges_subject ON auth_challenges(purpose, subject_id, created_at)',
  'CREATE INDEX idx_challenges_expires ON auth_challenges(expires_at)',
  'CREATE INDEX idx_rate_limits_window ON rate_limits(window_start)',
  'CREATE INDEX idx_audit_at ON audit_log(at)',
  'CREATE INDEX idx_audit_target ON audit_log(target_type, target_id, at)',
  'CREATE INDEX idx_audit_action ON audit_log(action, at)',
  'CREATE INDEX idx_exports_created ON exports(created_at)',
  'CREATE INDEX idx_backups_created ON backups(kind, created_at)',
  'CREATE INDEX idx_backups_expires ON backups(expires_at)',
  'CREATE INDEX idx_client_errors_last ON client_errors(last_at)',
  'CREATE INDEX idx_sim_a ON similarity_flags(candidate_a)',
  'CREATE INDEX idx_sim_b ON similarity_flags(candidate_b)',
  'CREATE INDEX idx_sim_question ON similarity_flags(question_id, score)',
  'CREATE INDEX idx_data_requests_status ON data_requests(status, created_at)',
];

/** Tables from schema v1 (pre-October 2026), oldest dependency last for DROP order. */
export const V1_TABLES_DROP_ORDER = [
  'part3_answers', 'part3_assignments', 'part3_questions',
  'part2_answers', 'part2_questions',
  'part1_answers', 'part1_assignments', 'part1_seen', 'question_usage',
  'interview_questions', 'attempts', 'admin_sessions', 'admin_audit',
  'question_bank', 'admin_users', 'settings', 'candidates',
];
