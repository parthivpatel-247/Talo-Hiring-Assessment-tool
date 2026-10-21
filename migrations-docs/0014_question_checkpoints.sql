-- DSA / Scenario questions carry itemized "marking checkpoints" (one gradable
-- criterion per line). The grader splits the marks across them and awards grace
-- marks per checkpoint whose logic the candidate satisfies. Admin-only — never
-- sent to the candidate browser.
ALTER TABLE question_bank ADD COLUMN checkpoints TEXT;
