-- ONE-TIME bootstrap so Wrangler's migration tracking adopts the migrations that
-- were already applied by hand (0001–0004) WITHOUT re-running them (re-running
-- 0002 would drop the question bank!). After running this once, use
-- `npm run migrate:apply` for all future migrations (0005+).
--
-- Run once:  npx wrangler d1 execute campus-hiring-assessment-db --remote --file scripts/register_existing_migrations.sql
CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0001_init.sql'),
  ('0002_written_answers.sql'),
  ('0003_expected_output.sql'),
  ('0004_audit_and_login.sql');
