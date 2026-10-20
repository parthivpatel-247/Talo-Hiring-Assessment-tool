-- Performance: cut D1 rows-read on the admin dashboard and the question rotation.
-- Idempotent (IF NOT EXISTS / OR IGNORE) — safe to run more than once. The Worker
-- also self-heals all of this on first use (ensurePerfSchema), so this file is the
-- explicit, auditable version of the same change.

-- Flags panel: count duplicate-login audit events per candidate via an index
-- instead of scanning the whole audit table once per candidate.
CREATE INDEX IF NOT EXISTS idx_audit_action_cand ON admin_audit(action, candidate_id);

-- Deleted-question count and the category list read only this index.
CREATE INDEX IF NOT EXISTS idx_qbank_deleted_cat ON question_bank(deleted_at, category);

-- Every question a candidate has ever been assigned (survives retakes).
CREATE TABLE IF NOT EXISTS part1_seen (
  candidate_id TEXT NOT NULL,
  question_id  TEXT NOT NULL,
  PRIMARY KEY (candidate_id, question_id)
);

-- How many distinct students have seen each question. The rotation reads one
-- row per question from here instead of re-counting all past assignments.
CREATE TABLE IF NOT EXISTS question_usage (
  question_id TEXT PRIMARY KEY,
  uses        INTEGER NOT NULL DEFAULT 0
);

-- One-time backfills from existing history.
INSERT OR IGNORE INTO part1_seen (candidate_id, question_id)
  SELECT candidate_id, question_id FROM part1_assignments;
INSERT OR IGNORE INTO question_usage (question_id, uses)
  SELECT question_id, COUNT(*) FROM part1_seen GROUP BY question_id;
