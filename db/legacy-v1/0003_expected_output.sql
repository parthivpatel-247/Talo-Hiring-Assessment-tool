-- Migration 0003: store the expected RESULT of each question so grading matches
-- the candidate's output rather than their query/code text (many correct SQL
-- formulations produce the same result). Non-destructive: adds one column.
-- Run once. Re-running errors with "duplicate column name" — that is harmless.
ALTER TABLE question_bank ADD COLUMN expected_output TEXT;
