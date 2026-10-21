-- READ-ONLY check of the support database (changes nothing). For every change in
-- migrations 0005-0015 it shows whether it is already in the database. Every row
-- must show present = 1 before those migrations are marked as applied.
--   npx wrangler d1 execute campus-hiring-assessment-db --remote --file scripts/check_support_schema.sql
-- (SQLite keeps each table's full definition, including columns added later, in
-- sqlite_master.sql, so a text match on it shows whether a column exists.)
SELECT json_extract(j.value, '$[0]') AS item,
       EXISTS (SELECT 1 FROM sqlite_master m
                WHERE m.type = 'table' AND m.name = json_extract(j.value, '$[1]')
                  AND m.sql LIKE json_extract(j.value, '$[2]')
                  AND m.sql LIKE json_extract(j.value, '$[3]')) AS present
FROM json_each('[
  ["0005 candidates.college",               "candidates",          "%college%",                 "%"],
  ["0006 table settings",                   "settings",            "%",                         "%"],
  ["0007 table admin_users",                "admin_users",         "%",                         "%"],
  ["0008 table part3_questions",            "part3_questions",     "%",                         "%"],
  ["0008 table part3_assignments",          "part3_assignments",   "%",                         "%"],
  ["0008 table part3_answers",              "part3_answers",       "%",                         "%"],
  ["0008 attempts.part3_started_at",        "attempts",            "%part3_started_at%",        "%"],
  ["0008 attempts.part3_remaining_seconds", "attempts",            "%part3_remaining_seconds%", "%"],
  ["0008 attempts.part3_last_heartbeat_at", "attempts",            "%part3_last_heartbeat_at%", "%"],
  ["0008 attempts.part3_submitted_at",      "attempts",            "%part3_submitted_at%",      "%"],
  ["0008 attempts.part3_tab_switch_count",  "attempts",            "%part3_tab_switch_count%",  "%"],
  ["0008 attempts.part3_tab_switch_log",    "attempts",            "%part3_tab_switch_log%",    "%"],
  ["0009 part2_answers.ai_content_pct",     "part2_answers",       "%ai_content_pct%",          "%"],
  ["0010 question bank allows dsa+scenario","question_bank",       "%''dsa''%",                 "%''scenario''%"],
  ["0011 interview_questions.model_answer", "interview_questions", "%model_answer%",            "%"],
  ["0012 question_bank.hint",               "question_bank",       "%hint%",                    "%"],
  ["0013 question_bank.deleted_at",         "question_bank",       "%deleted_at%",              "%"],
  ["0014 question_bank.checkpoints",        "question_bank",       "%checkpoints%",             "%"],
  ["0015 table part1_seen",                 "part1_seen",          "%",                         "%"],
  ["0015 table question_usage",             "question_usage",      "%",                         "%"]
]') AS j;

SELECT name AS already_recorded_as_applied FROM d1_migrations ORDER BY id;
