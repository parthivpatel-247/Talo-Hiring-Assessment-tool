-- Questions can carry a HINT shown to the candidate on demand (a nudge toward the
-- technique without giving the answer). Most useful for DSA / Scenario problems.
ALTER TABLE question_bank ADD COLUMN hint TEXT;
