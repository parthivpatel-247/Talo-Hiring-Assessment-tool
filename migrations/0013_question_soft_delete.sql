-- Questions are SOFT-deleted: instead of removing the row (and its answer history),
-- we stamp deleted_at. The row, its full content, and any answers/assignments that
-- referenced it stay in the DB, so a question removed by mistake can be restored and
-- a full snapshot is also kept in admin_audit. Active listing and assignment filter
-- on deleted_at IS NULL.
ALTER TABLE question_bank ADD COLUMN deleted_at TEXT;
