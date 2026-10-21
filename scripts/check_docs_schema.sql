-- READ-ONLY check of the writers database (changes nothing). Every "required" row
-- should show present = 1. "added on first use" rows show 1 once the Worker has
-- served the matching request at least once; 0 before that is normal.
--   npx wrangler d1 execute talo-docs-db --remote --env docs --command "$(grep -v '^--' scripts/check_docs_schema.sql | tr '\n' ' ')"
SELECT json_extract(j.value, '$[0]') AS item,
       json_extract(j.value, '$[1]') AS kind,
       EXISTS (SELECT 1 FROM sqlite_master m
                WHERE m.type = json_extract(j.value, '$[2]') AND m.name = json_extract(j.value, '$[3]')
                  AND m.sql LIKE json_extract(j.value, '$[4]')) AS present
FROM json_each('[
  ["table candidates",                         "required", "table",   "candidates",          "%"],
  ["candidates.email UNIQUE",                  "required", "table",   "candidates",          "%email%UNIQUE%"],
  ["candidates.college",                       "required", "table",   "candidates",          "%college%"],
  ["question bank: part1/part2 categories",    "required", "table",   "question_bank",       "%''part1'',''part2''%"],
  ["question_bank.word_limit",                 "required", "table",   "question_bank",       "%word_limit%"],
  ["question_bank.deleted_at (soft delete)",   "required", "table",   "question_bank",       "%deleted_at%"],
  ["table part1_assignments",                  "required", "table",   "part1_assignments",   "%"],
  ["table part1_answers",                      "required", "table",   "part1_answers",       "%"],
  ["part2_questions.source_question_id",       "required", "table",   "part2_questions",     "%source_question_id%"],
  ["part2_questions.word_limit",               "required", "table",   "part2_questions",     "%word_limit%"],
  ["part2_answers.ai_content_pct",             "required", "table",   "part2_answers",       "%ai_content_pct%"],
  ["table attempts",                           "required", "table",   "attempts",            "%"],
  ["table attempt_events (cascade delete)",    "required", "table",   "attempt_events",      "%ON DELETE CASCADE%"],
  ["table settings",                           "required", "table",   "settings",            "%"],
  ["table admin_users",                        "required", "table",   "admin_users",         "%"],
  ["table admin_sessions",                     "required", "table",   "admin_sessions",      "%"],
  ["table admin_audit",                        "required", "table",   "admin_audit",         "%"],
  ["table part1_seen (rotation)",              "required", "table",   "part1_seen",          "%"],
  ["table question_usage (rotation)",          "required", "table",   "question_usage",      "%"],
  ["table rate_limits (sign-in limits)",       "required", "table",   "rate_limits",         "%"],
  ["unique: part1 draw position",              "required", "index",   "idx_p1a_cand_pos",    "%UNIQUE%"],
  ["unique: part2 draw position",              "required", "index",   "idx_p2q_cand_pos",    "%UNIQUE%"],
  ["index: questions by part",                 "required", "index",   "idx_qbank_cat_active","%"],
  ["index: events by candidate",               "required", "index",   "idx_events_cand_part","%"],
  ["index: candidates by date (retention)",    "required", "index",   "idx_candidates_created","%"],
  ["index: sessions by expiry",                "required", "index",   "idx_admin_sessions_expires","%"],
  ["index: audit by action",                   "required", "index",   "idx_audit_action_cand","%"],
  ["rule: candidate status (insert)",          "required", "trigger", "trg_candidates_status_ins","%"],
  ["rule: candidate status (update)",          "required", "trigger", "trg_candidates_status_upd","%"],
  ["rule: marks and word limit (insert)",      "required", "trigger", "trg_question_bank_ins","%"],
  ["rule: marks and word limit (update)",      "required", "trigger", "trg_question_bank_upd","%"],
  ["rule: clock never negative",               "required", "trigger", "trg_attempts_clock",  "%"],
  ["attempts.part1/2_deadline_at",             "added on first use", "table", "attempts",    "%part2_deadline_at%"],
  ["attempts.part1_reopen_until",              "added on first use", "table", "attempts",    "%part1_reopen_until%"],
  ["candidates.grading_claim",                 "added on first use", "table", "candidates",  "%grading_claimed_at%"],
  ["candidates.parse_claim / parse_attempts",  "added on first use", "table", "candidates",  "%parse_attempts%"],
  ["admin_sessions.user_id",                   "added on first use", "table", "admin_sessions", "%user_id%"]
]') AS j;

SELECT COUNT(*) AS migrations_recorded, MAX(name) AS latest FROM d1_migrations;
