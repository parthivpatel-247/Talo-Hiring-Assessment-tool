-- One Part 1 set per candidate: a position can hold only one question.
-- (The code already inserts each position only if it is free; this backs it up.)
-- Before applying, check nothing breaks it (expect no rows):
--   SELECT candidate_id, position, COUNT(*) FROM part1_assignments
--   GROUP BY candidate_id, position HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_p1a_cand_pos ON part1_assignments(candidate_id, position);
