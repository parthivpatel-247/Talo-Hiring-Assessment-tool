-- Named admin accounts so a manager can add/manage panel members and their
-- roles from the UI (in addition to the bootstrap ADMIN_PASSWORD manager login).
CREATE TABLE IF NOT EXISTS admin_users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  pass_salt  TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
