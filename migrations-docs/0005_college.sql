-- College segregation: each candidate belongs to a college (campus drive can
-- run across several colleges). NULL = not yet assigned ("Unassigned").
ALTER TABLE candidates ADD COLUMN college TEXT;
CREATE INDEX IF NOT EXISTS idx_candidates_college ON candidates(college);
