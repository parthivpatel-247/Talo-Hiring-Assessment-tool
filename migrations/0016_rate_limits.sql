-- Sign-in limits (src/lib/ratelimit.ts). One row per counter: a bucket name made of
-- a kind label plus keyed hashes (never a raw email or IP), a fixed-window count,
-- and an optional pause end. Admin sign-ins and candidate sign-ins with an unknown
-- email write here; the daily cron deletes rows more than a day old. No secondary
-- index: the table stays small, and an index would double the writes. The Worker
-- also creates this table itself if this file hasn't been applied.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket        TEXT PRIMARY KEY CHECK (length(bucket) BETWEEN 1 AND 80),
  count         INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  window_start  INTEGER NOT NULL,
  blocked_until INTEGER
);
