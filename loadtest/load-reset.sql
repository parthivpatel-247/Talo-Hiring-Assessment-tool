-- Reset mutable per-attempt state between scenarios (restores login-ability).
DELETE FROM part1_answers;
DELETE FROM part1_assignments;
DELETE FROM part2_answers;
DELETE FROM attempts;
UPDATE candidates SET status='part2_ready';
