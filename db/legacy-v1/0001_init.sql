-- Campus hiring assessment — initial schema

-- One row per shortlisted candidate, created when the admin uploads resumes.
CREATE TABLE candidates (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  resume_r2_key   TEXT NOT NULL,
  resume_filename TEXT,
  skills          TEXT,              -- JSON array of strings, filled after parsing
  projects        TEXT,              -- JSON array of {name, description, technologies[]}
  parsed_at       TEXT,
  status          TEXT NOT NULL DEFAULT 'uploaded',
                  -- uploaded -> parsed -> part2_ready -> in_progress -> submitted -> evaluated -> shortlisted | rejected
  access_revoked  INTEGER NOT NULL DEFAULT 0,
  retake_granted  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_candidates_status ON candidates(status);

-- Part 1 static question bank. Multiple-choice by design: it's the only
-- format Cloudflare Workers can grade deterministically without an
-- external code-execution sandbox (Workers cannot run arbitrary submitted
-- SQL/Python). A SQL question presents a scenario + query options; a
-- Python question presents a short snippet + "what does this print" options.
CREATE TABLE question_bank (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL CHECK (category IN ('sql', 'python')),
  prompt        TEXT NOT NULL,       -- scenario / snippet, markdown or plain text
  code_snippet  TEXT,                -- optional formatted code block shown with the prompt
  options       TEXT NOT NULL,       -- JSON array of 4 strings
  correct_index INTEGER NOT NULL,    -- 0-3
  explanation   TEXT,                -- shown to admin only, not the candidate
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which Part 1 questions each candidate was randomly assigned.
CREATE TABLE part1_assignments (
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  question_id  TEXT NOT NULL REFERENCES question_bank(id),
  position     INTEGER NOT NULL,
  PRIMARY KEY (candidate_id, question_id)
);

-- Part 2 questions are generated per candidate from their resume, ahead of
-- test day (not live at login), so flag-off never triggers live OpenAI
-- calls for every student at once.
CREATE TABLE part2_questions (
  id            TEXT PRIMARY KEY,
  candidate_id  TEXT NOT NULL REFERENCES candidates(id),
  position      INTEGER NOT NULL,
  prompt        TEXT NOT NULL,
  based_on_skill TEXT,
  rubric        TEXT NOT NULL,       -- JSON: what a strong / weak answer looks like
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One attempt per candidate. Timers are tracked as remaining-seconds +
-- last-heartbeat, so the clock only ticks down while the candidate has an
-- active connection, and resumes with the same remaining time after a
-- disconnect (see src/lib/timer.ts).
CREATE TABLE attempts (
  candidate_id            TEXT PRIMARY KEY REFERENCES candidates(id),
  part1_started_at        TEXT,
  part1_remaining_seconds INTEGER,
  part1_last_heartbeat_at TEXT,
  part1_submitted_at      TEXT,
  part1_tab_switch_count  INTEGER NOT NULL DEFAULT 0,   -- Part 1 is locked down; any switch is logged even though the client also blocks it
  part2_started_at        TEXT,
  part2_remaining_seconds INTEGER,
  part2_last_heartbeat_at TEXT,
  part2_submitted_at      TEXT,
  part2_tab_switch_count  INTEGER NOT NULL DEFAULT 0,   -- Part 2 allows switching (open-book); this is logged only, never blocking
  part2_tab_switch_log    TEXT                          -- JSON array of {at, type}
);

CREATE TABLE part1_answers (
  candidate_id  TEXT NOT NULL REFERENCES candidates(id),
  question_id   TEXT NOT NULL REFERENCES question_bank(id),
  selected_index INTEGER,
  is_correct    INTEGER,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, question_id)
);

CREATE TABLE part2_answers (
  candidate_id  TEXT NOT NULL REFERENCES candidates(id),
  question_id   TEXT NOT NULL REFERENCES part2_questions(id),
  answer_text   TEXT,
  ai_score      REAL,               -- 0-10
  ai_reasoning  TEXT,
  scored_at     TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, question_id)
);

-- Generated once the admin shortlists a candidate for interview.
CREATE TABLE interview_questions (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  position     INTEGER NOT NULL,
  question     TEXT NOT NULL,
  follow_up    TEXT,
  based_on     TEXT,               -- e.g. "project:Customer churn model" or "part2:Q2"
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Shared admin login (single password for the small internal team).
CREATE TABLE admin_sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
