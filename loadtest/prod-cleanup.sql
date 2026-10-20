-- Remove ALL prod load-test data (throwaway candidates and everything they generated).
-- Child rows first (FK order), parent last. Scoped strictly to 'load-%' ids.
DELETE FROM part1_answers     WHERE candidate_id LIKE 'load-%';
DELETE FROM part2_answers     WHERE candidate_id LIKE 'load-%';
DELETE FROM part1_assignments WHERE candidate_id LIKE 'load-%';
DELETE FROM part2_questions   WHERE candidate_id LIKE 'load-%';
DELETE FROM attempts          WHERE candidate_id LIKE 'load-%';
DELETE FROM admin_audit       WHERE candidate_id LIKE 'load-%';
DELETE FROM candidates        WHERE id LIKE 'load-%';
