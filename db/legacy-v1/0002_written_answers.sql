-- Migration 0002: written-answer model, AI-graded with partial credit.
-- Written as full DROP + CREATE (no ALTER) so it is idempotent and safe to
-- re-run. Safe on a pre-launch database (no real candidate data yet).

DROP TABLE IF EXISTS part1_answers;
DROP TABLE IF EXISTS question_bank;

CREATE TABLE question_bank (
  id               TEXT PRIMARY KEY,
  category         TEXT NOT NULL CHECK (category IN ('sql', 'python')),
  prompt           TEXT NOT NULL,
  reference_answer TEXT,
  sample_data      TEXT,
  rubric           TEXT,
  marks            INTEGER NOT NULL DEFAULT 3,
  difficulty       TEXT DEFAULT 'medium',
  status           TEXT NOT NULL DEFAULT 'active',
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_qbank_cat_active ON question_bank(category, active);

CREATE TABLE part1_answers (
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  question_id  TEXT NOT NULL REFERENCES question_bank(id),
  answer_text  TEXT,
  ai_score     REAL,
  ai_reasoning TEXT,
  deductions   TEXT,
  max_marks    INTEGER,
  scored_at    TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, question_id)
);

-- Recreate Part 2 tables with the full written-answer schema (no ALTER).
DROP TABLE IF EXISTS part2_answers;
DROP TABLE IF EXISTS part2_questions;

CREATE TABLE part2_questions (
  id             TEXT PRIMARY KEY,
  candidate_id   TEXT NOT NULL REFERENCES candidates(id),
  position       INTEGER NOT NULL,
  prompt         TEXT NOT NULL,
  based_on_skill TEXT,
  rubric         TEXT NOT NULL,
  marks          INTEGER NOT NULL DEFAULT 5,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE part2_answers (
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  question_id  TEXT NOT NULL REFERENCES part2_questions(id),
  answer_text  TEXT,
  ai_score     REAL,
  ai_reasoning TEXT,
  deductions   TEXT,
  max_marks    INTEGER DEFAULT 5,
  scored_at    TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, question_id)
);
