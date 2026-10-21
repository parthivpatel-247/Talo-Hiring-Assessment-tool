-- ONE-TIME fix for the support database (campus-hiring-assessment-db).
--
-- Why: migrations 0005-0015 were never run with `wrangler d1 migrations apply`.
-- Their changes reached the live database another way (the Worker adds missing
-- columns and tables itself, and some were run by hand), so Wrangler still lists
-- them as "to be applied" and fails on the first one ("duplicate column name:
-- college"). Re-running them is NOT safe: 0010 rebuilds the question bank table
-- and would drop the hint, deleted_at and checkpoints columns and their data.
--
-- This file only records 0005-0015 as applied. It changes no table or row except
-- Wrangler's own d1_migrations list. Run it ONLY after scripts/check_support_schema.sql
-- shows present = 1 on every row.
--   npx wrangler d1 execute campus-hiring-assessment-db --remote --file scripts/register_migrations_0005_0015.sql
INSERT INTO d1_migrations (name)
SELECT j.value FROM json_each('[
  "0005_college.sql", "0006_settings.sql", "0007_admin_users.sql", "0008_part3.sql",
  "0009_part2_ai_pct.sql", "0010_expand_categories.sql", "0011_interview_answer.sql",
  "0012_question_hint.sql", "0013_question_soft_delete.sql", "0014_question_checkpoints.sql",
  "0015_perf.sql"
]') AS j
WHERE NOT EXISTS (SELECT 1 FROM d1_migrations d WHERE d.name = j.value);

-- The indexes from 0005, 0008 and 0015, in case the database is missing any
-- (each one is skipped if it already exists; no data changes).
CREATE INDEX IF NOT EXISTS idx_candidates_college ON candidates(college);
CREATE INDEX IF NOT EXISTS idx_part3_kind_active ON part3_questions(kind, active);
CREATE INDEX IF NOT EXISTS idx_audit_action_cand ON admin_audit(action, candidate_id);
CREATE INDEX IF NOT EXISTS idx_qbank_deleted_cat ON question_bank(deleted_at, category);
CREATE INDEX IF NOT EXISTS idx_qbank_cat_active ON question_bank(category, active);

SELECT id, name, applied_at FROM d1_migrations ORDER BY id;
