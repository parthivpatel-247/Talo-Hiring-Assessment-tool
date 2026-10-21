-- Migration 0008: Part 3 — closed-book debugging & break-fix.
-- Two question kinds:
--   buggy_fix — a broken SQL/Python snippet the candidate must diagnose and fix
--   scenario  — a support break-fix ticket (find the root cause, how to verify, the fix)
-- Non-destructive: new tables + new attempt columns. Run once; re-running the
-- ALTERs errors with "duplicate column name" (harmless). The app also self-heals
-- this schema at runtime (ensurePart3Schema) so it works even if this isn't run.

CREATE TABLE IF NOT EXISTS part3_questions (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('buggy_fix', 'scenario')),
  title            TEXT,
  prompt           TEXT NOT NULL,
  code_snippet     TEXT,              -- shown for buggy_fix (broken code), optional for scenario
  reference_answer TEXT,              -- correct diagnosis + fix, admin-only (never sent to candidates)
  rubric           TEXT,              -- what a strong/weak answer covers (cause / check / fix / clarity)
  marks            INTEGER NOT NULL DEFAULT 5,
  difficulty       TEXT DEFAULT 'medium',
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_part3_kind_active ON part3_questions(kind, active);

CREATE TABLE IF NOT EXISTS part3_assignments (
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  question_id  TEXT NOT NULL REFERENCES part3_questions(id),
  position     INTEGER NOT NULL,
  PRIMARY KEY (candidate_id, question_id)
);

CREATE TABLE IF NOT EXISTS part3_answers (
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  question_id  TEXT NOT NULL REFERENCES part3_questions(id),
  answer_text  TEXT,
  ai_score     REAL,
  ai_reasoning TEXT,
  deductions   TEXT,
  max_marks    INTEGER DEFAULT 5,
  scored_at    TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, question_id)
);

-- Part 3 is closed-book and locked down like Part 1, so it tracks its own
-- timer + tab-switch count (any switch is logged even though the client blocks it).
ALTER TABLE attempts ADD COLUMN part3_started_at TEXT;
ALTER TABLE attempts ADD COLUMN part3_remaining_seconds INTEGER;
ALTER TABLE attempts ADD COLUMN part3_last_heartbeat_at TEXT;
ALTER TABLE attempts ADD COLUMN part3_submitted_at TEXT;
ALTER TABLE attempts ADD COLUMN part3_tab_switch_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN part3_tab_switch_log TEXT;
