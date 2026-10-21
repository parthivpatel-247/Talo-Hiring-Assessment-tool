-- Migration 0017 (writers site only — talo-docs-db): indexes, integrity rules and a
-- proper event log for the writers' test. Safe to run on a database that already
-- has 0001–0016 (every statement is IF NOT EXISTS or a new object).

-- ---------------------------------------------------------------------------
-- 1. Indexes for every lookup the writers' test makes, so D1 reads (and bills)
--    only the rows a query needs instead of scanning a table.
-- ---------------------------------------------------------------------------

-- Part 2 questions are looked up per candidate (start, grading, export). UNIQUE also
-- makes "one question per position per candidate" a database rule, so two
-- overlapping requests can never give a candidate two Part 2 sets.
CREATE UNIQUE INDEX IF NOT EXISTS idx_p2q_cand_pos ON part2_questions(candidate_id, position);
-- The same rule for the Part 1 set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_p1a_cand_pos ON part1_assignments(candidate_id, position);

-- Foreign-key child columns. D1 enforces foreign keys: deleting a parent row checks
-- its children, and without these indexes each check scanned the whole child table.
CREATE INDEX IF NOT EXISTS idx_p2ans_question ON part2_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_interview_cand ON interview_questions(candidate_id);

-- Daily retention purge: expired candidates, expired admin sessions, old audit rows.
CREATE INDEX IF NOT EXISTS idx_candidates_created ON candidates(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

-- ---------------------------------------------------------------------------
-- 2. Integrity rules the database enforces itself (SQLite can't add a CHECK to an
--    existing table, so these are triggers that reject bad writes).
-- ---------------------------------------------------------------------------

-- A candidate's status is one of the known pipeline states.
CREATE TRIGGER IF NOT EXISTS trg_candidates_status_ins
BEFORE INSERT ON candidates
WHEN NEW.status NOT IN ('uploaded','parsed','parse_failed','part2_ready','in_progress','submitted','grading','evaluated','shortlisted','rejected')
BEGIN SELECT RAISE(ABORT, 'invalid candidate status'); END;

CREATE TRIGGER IF NOT EXISTS trg_candidates_status_upd
BEFORE UPDATE OF status ON candidates
WHEN NEW.status NOT IN ('uploaded','parsed','parse_failed','part2_ready','in_progress','submitted','grading','evaluated','shortlisted','rejected')
BEGIN SELECT RAISE(ABORT, 'invalid candidate status'); END;

-- Questions carry positive marks and, if set, a word limit between 50 and 3,000.
CREATE TRIGGER IF NOT EXISTS trg_question_bank_ins
BEFORE INSERT ON question_bank
WHEN NEW.marks <= 0 OR (NEW.word_limit IS NOT NULL AND (NEW.word_limit < 50 OR NEW.word_limit > 3000))
BEGIN SELECT RAISE(ABORT, 'invalid marks or word limit'); END;

CREATE TRIGGER IF NOT EXISTS trg_question_bank_upd
BEFORE UPDATE OF marks, word_limit ON question_bank
WHEN NEW.marks <= 0 OR (NEW.word_limit IS NOT NULL AND (NEW.word_limit < 50 OR NEW.word_limit > 3000))
BEGIN SELECT RAISE(ABORT, 'invalid marks or word limit'); END;

-- A part's clock never goes below zero.
CREATE TRIGGER IF NOT EXISTS trg_attempts_clock
BEFORE UPDATE OF part1_remaining_seconds, part2_remaining_seconds ON attempts
WHEN NEW.part1_remaining_seconds < 0 OR NEW.part2_remaining_seconds < 0
BEGIN SELECT RAISE(ABORT, 'remaining time cannot be negative'); END;

-- ---------------------------------------------------------------------------
-- 3. Integrity events as rows (one row per event) instead of a JSON array that is
--    read, appended to and rewritten in the attempts row. Each event is a single
--    INSERT: no lost events when two arrive at once (for example the per-question
--    metrics sent together at submit), and they can be counted and filtered in SQL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attempt_events (
  id           INTEGER PRIMARY KEY,
  candidate_id TEXT    NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  part         INTEGER NOT NULL CHECK (part IN (1, 2)),
  type         TEXT    NOT NULL,          -- tab_hidden, window_blur, fullscreen_exited, paste, metrics, ...
  question_id  TEXT,                      -- Part 1: question_bank.id · Part 2: part2_questions.id
  chars        INTEGER CHECK (chars  IS NULL OR chars  >= 0),
  typed        INTEGER CHECK (typed  IS NULL OR typed  >= 0),
  pasted       INTEGER CHECK (pasted IS NULL OR pasted >= 0),
  pastes       INTEGER CHECK (pastes IS NULL OR pastes >= 0),
  ms           INTEGER CHECK (ms     IS NULL OR ms     >= 0),
  at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_events_cand_part ON attempt_events(candidate_id, part, type);
