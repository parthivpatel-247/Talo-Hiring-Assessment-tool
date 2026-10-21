-- Editable settings (key/value). Used to store the college list so a manager
-- can rename colleges from the admin UI without a redeploy.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
