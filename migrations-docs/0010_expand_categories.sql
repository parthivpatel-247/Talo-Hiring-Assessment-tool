-- Expand question_bank to allow two new sections: 'dsa' and 'scenario'.
-- SQLite cannot ALTER a CHECK constraint, so rebuild the table (standard recipe).
-- FKs are turned off around the swap so part1_assignments (which references
-- question_bank) is not disturbed; the ids are preserved, so references stay valid.
PRAGMA foreign_keys=OFF;

CREATE TABLE question_bank_new (
  id               TEXT PRIMARY KEY,
  category         TEXT NOT NULL CHECK (category IN ('sql','python','dsa','scenario')),
  prompt           TEXT NOT NULL,
  reference_answer TEXT,
  sample_data      TEXT,
  rubric           TEXT,
  marks            INTEGER NOT NULL DEFAULT 3,
  difficulty       TEXT DEFAULT 'medium',
  status           TEXT NOT NULL DEFAULT 'active',
  active           INTEGER NOT NULL DEFAULT 1,
  expected_output  TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO question_bank_new (id,category,prompt,reference_answer,sample_data,rubric,marks,difficulty,status,active,expected_output,created_at)
  SELECT id,category,prompt,reference_answer,sample_data,rubric,marks,difficulty,status,active,expected_output,created_at FROM question_bank;

DROP TABLE question_bank;
ALTER TABLE question_bank_new RENAME TO question_bank;
CREATE INDEX IF NOT EXISTS idx_qbank_cat_active ON question_bank(category, active);

PRAGMA foreign_keys=ON;
