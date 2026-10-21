-- Migration 0016 (writers / documentation team site ONLY — talo-docs-db).
-- The support site never runs this: its migrations live in ../migrations.
--
-- The writers' test has two parts, and every question in the bank belongs to one:
-- category 'part1' or 'part2'. SQLite can't change a CHECK constraint in place,
-- so question_bank is rebuilt (the standard copy-and-rename recipe) with the two
-- new categories and a per-question word limit.
PRAGMA foreign_keys=OFF;

CREATE TABLE question_bank_new (
  id               TEXT PRIMARY KEY,
  category         TEXT NOT NULL CHECK (category IN ('sql','python','dsa','scenario','part1','part2')),
  prompt           TEXT NOT NULL,
  reference_answer TEXT,
  sample_data      TEXT,
  rubric           TEXT,
  marks            INTEGER NOT NULL DEFAULT 3,
  difficulty       TEXT DEFAULT 'medium',
  status           TEXT NOT NULL DEFAULT 'active',
  active           INTEGER NOT NULL DEFAULT 1,
  expected_output  TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  hint             TEXT,
  deleted_at       TEXT,
  checkpoints      TEXT,
  word_limit       INTEGER
);

INSERT INTO question_bank_new (id,category,prompt,reference_answer,sample_data,rubric,marks,difficulty,status,active,expected_output,created_at,hint,deleted_at,checkpoints)
  SELECT id,category,prompt,reference_answer,sample_data,rubric,marks,difficulty,status,active,expected_output,created_at,hint,deleted_at,checkpoints FROM question_bank;

DROP TABLE question_bank;
ALTER TABLE question_bank_new RENAME TO question_bank;
CREATE INDEX IF NOT EXISTS idx_qbank_cat_active ON question_bank(category, active);
CREATE INDEX IF NOT EXISTS idx_qbank_deleted_cat ON question_bank(deleted_at, category);

PRAGMA foreign_keys=ON;

-- Part 2 questions are copied per candidate from the bank when Part 2 opens, so
-- each copy remembers where it came from and its word limit.
ALTER TABLE part2_questions ADD COLUMN source_question_id TEXT;
ALTER TABLE part2_questions ADD COLUMN word_limit INTEGER;
