-- Migration 0004: admin audit log + candidate login tracking.
-- Non-destructive: adds columns and one new table. Run once; re-running the
-- ALTERs errors with "duplicate column name" (harmless).

ALTER TABLE attempts ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN first_login_at TEXT;
ALTER TABLE attempts ADD COLUMN last_login_at TEXT;

-- Every mutating admin action is recorded here for accountability / disputes.
CREATE TABLE IF NOT EXISTS admin_audit (
  id           TEXT PRIMARY KEY,
  action       TEXT NOT NULL,
  candidate_id TEXT,
  detail       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit(created_at);
