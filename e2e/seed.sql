-- AUTO-GENERATED for E2E local seeding. Do not edit by hand.
-- (schema = migrations with comments stripped) + deterministic seed data.

-- ==== migrations/0001_init.sql ====
CREATE TABLE candidates (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  resume_r2_key   TEXT NOT NULL,
  resume_filename TEXT,
  skills          TEXT,              
  projects        TEXT,              
  parsed_at       TEXT,
  status          TEXT NOT NULL DEFAULT 'uploaded',
                  
  access_revoked  INTEGER NOT NULL DEFAULT 0,
  retake_granted  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_candidates_status ON candidates(status);






CREATE TABLE question_bank (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL CHECK (category IN ('sql', 'python', 'dsa', 'scenario')),
  prompt        TEXT NOT NULL,       
  code_snippet  TEXT,                
  options       TEXT NOT NULL,       
  correct_index INTEGER NOT NULL,    
  explanation   TEXT,                
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE part1_assignments (
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  question_id  TEXT NOT NULL REFERENCES question_bank(id),
  position     INTEGER NOT NULL,
  PRIMARY KEY (candidate_id, question_id)
);




CREATE TABLE part2_questions (
  id            TEXT PRIMARY KEY,
  candidate_id  TEXT NOT NULL REFERENCES candidates(id),
  position      INTEGER NOT NULL,
  prompt        TEXT NOT NULL,
  based_on_skill TEXT,
  rubric        TEXT NOT NULL,       
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);





CREATE TABLE attempts (
  candidate_id            TEXT PRIMARY KEY REFERENCES candidates(id),
  part1_started_at        TEXT,
  part1_remaining_seconds INTEGER,
  part1_last_heartbeat_at TEXT,
  part1_submitted_at      TEXT,
  part1_tab_switch_count  INTEGER NOT NULL DEFAULT 0,   
  part2_started_at        TEXT,
  part2_remaining_seconds INTEGER,
  part2_last_heartbeat_at TEXT,
  part2_submitted_at      TEXT,
  part2_tab_switch_count  INTEGER NOT NULL DEFAULT 0,   
  part2_tab_switch_log    TEXT                          
);

CREATE TABLE part1_answers (
  candidate_id  TEXT NOT NULL REFERENCES candidates(id),
  question_id   TEXT NOT NULL REFERENCES question_bank(id),
  selected_index INTEGER,
  is_correct    INTEGER,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, question_id)
);

CREATE TABLE part2_answers (
  candidate_id  TEXT NOT NULL REFERENCES candidates(id),
  question_id   TEXT NOT NULL REFERENCES part2_questions(id),
  answer_text   TEXT,
  ai_score      REAL,               
  ai_reasoning  TEXT,
  scored_at     TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, question_id)
);


CREATE TABLE interview_questions (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  position     INTEGER NOT NULL,
  question     TEXT NOT NULL,
  follow_up    TEXT,
  based_on     TEXT,               
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE admin_sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- ==== migrations/0002_written_answers.sql ====
DROP TABLE IF EXISTS part1_answers;
DROP TABLE IF EXISTS question_bank;

CREATE TABLE question_bank (
  id               TEXT PRIMARY KEY,
  category         TEXT NOT NULL CHECK (category IN ('sql', 'python', 'dsa', 'scenario')),
  prompt           TEXT NOT NULL,
  reference_answer TEXT,
  sample_data      TEXT,
  rubric           TEXT,
  marks            INTEGER NOT NULL DEFAULT 3,
  difficulty       TEXT DEFAULT 'medium',
  status           TEXT NOT NULL DEFAULT 'active',
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_qbank_cat_active ON question_bank(category, active);

CREATE TABLE part1_answers (
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  question_id  TEXT NOT NULL REFERENCES question_bank(id),
  answer_text  TEXT,
  ai_score     REAL,
  ai_reasoning TEXT,
  deductions   TEXT,
  max_marks    INTEGER,
  scored_at    TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, question_id)
);


DROP TABLE IF EXISTS part2_answers;
DROP TABLE IF EXISTS part2_questions;

CREATE TABLE part2_questions (
  id             TEXT PRIMARY KEY,
  candidate_id   TEXT NOT NULL REFERENCES candidates(id),
  position       INTEGER NOT NULL,
  prompt         TEXT NOT NULL,
  based_on_skill TEXT,
  rubric         TEXT NOT NULL,
  marks          INTEGER NOT NULL DEFAULT 5,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE part2_answers (
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  question_id  TEXT NOT NULL REFERENCES part2_questions(id),
  answer_text  TEXT,
  ai_score     REAL,
  ai_reasoning TEXT,
  deductions   TEXT,
  max_marks    INTEGER DEFAULT 5,
  scored_at    TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, question_id)
);

-- ==== migrations/0003_expected_output.sql ====
ALTER TABLE question_bank ADD COLUMN expected_output TEXT;

-- ==== migrations/0012_question_hint.sql ====
ALTER TABLE question_bank ADD COLUMN hint TEXT;

-- ==== migrations/0013_question_soft_delete.sql ====
ALTER TABLE question_bank ADD COLUMN deleted_at TEXT;

-- ==== migrations/0014_question_checkpoints.sql ====
ALTER TABLE question_bank ADD COLUMN checkpoints TEXT;

-- ==== migrations/0004_audit_and_login.sql ====
ALTER TABLE attempts ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN first_login_at TEXT;
ALTER TABLE attempts ADD COLUMN last_login_at TEXT;


CREATE TABLE IF NOT EXISTS admin_audit (
  id           TEXT PRIMARY KEY,
  action       TEXT NOT NULL,
  candidate_id TEXT,
  detail       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit(created_at);


-- ==== seed data ====
INSERT INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,rubric,marks,difficulty,status,active) VALUES
 ('qb-sql-1','sql','Table: orders. Total amount per customer.','SELECT customer_id, SUM(amount) FROM orders GROUP BY customer_id','Table: orders','| customer_id | total |','Groups correctly',3,'medium','active',1),
 ('qb-sql-2','sql','Table: students. Names starting with A.','SELECT student_name FROM students WHERE student_name LIKE ''A%''','Table: students','| student_name |','Filters correctly',3,'medium','active',1),
 ('qb-sql-3','sql','Table: employees. Salary above average.','SELECT name FROM employees WHERE salary > (SELECT AVG(salary) FROM employees)','Table: employees','| name |','Subquery correct',3,'medium','active',1),
 ('qb-py-1','python','Remove duplicates keeping order.','def f(x): return list(dict.fromkeys(x))','','[1, 2, 3]','Preserves order',4,'medium','active',1),
 ('qb-py-2','python','Count words in a string.','def f(s): return len(s.split())','','6','Correct count',4,'medium','active',1),
 ('qb-dsa-1','dsa','Two Sum: indices adding to target.','def f(a,t): ...','','[0, 1]','Correct indices',5,'medium','active',1),
 ('qb-dsa-2','dsa','Valid parentheses balanced?','def f(s): ...','','True','Stack logic',5,'medium','active',1),
 ('qb-scn-1','scenario','Best day to buy and sell a share.','def f(p): ...','','5','Min-so-far logic',5,'medium','active',1),
 ('qb-scn-2','scenario','Minimum railway platforms.','def f(a,d): ...','','3','Two-pointer sweep',5,'medium','active',1);

-- Candidate ready for a fresh Part 1 (used to test the intro + gate)
INSERT INTO candidates (id,email,name,resume_r2_key,resume_filename,status) VALUES
 ('e2e-p1','p1@e2e.com','Part One Tester','resumes/e2e-p1.pdf','r.pdf','part2_ready');

-- Candidate who already STARTED (and finished Part 1): used to prove #6 blocks a
-- second/new login once the assessment has been started on the account.
INSERT INTO candidates (id,email,name,resume_r2_key,resume_filename,status) VALUES
 ('e2e-p2','p2@e2e.com','Part Two Tester','resumes/e2e-p2.pdf','r.pdf','part2_ready');
INSERT INTO attempts (candidate_id, part1_started_at, part1_submitted_at, part1_remaining_seconds, login_count) VALUES
 ('e2e-p2', datetime('now'), datetime('now'), 0, 0);
INSERT INTO part2_questions (id,candidate_id,position,prompt,based_on_skill,rubric,marks) VALUES
 ('e2e-p2-q1','e2e-p2',0,'Explain how you would design an ETL pipeline for daily sales data. Discuss one trade-off.','Data Engineering','{"strong_answer_looks_like":"x","weak_answer_looks_like":"y"}',5),
 ('e2e-p2-q2','e2e-p2',1,'A query is slow on a 10M-row table. Walk through how you would diagnose and fix it.','SQL','{"strong_answer_looks_like":"x","weak_answer_looks_like":"y"}',5);

-- FRESH candidate for the reload=auto-close test: Part 1 NOT started, so login is
-- allowed (#6 only blocks a NEW login once the test has started). The test logs in,
-- begins Part 1 to start the clock, then reloads to prove the assessment auto-closes.
INSERT INTO candidates (id,email,name,resume_r2_key,resume_filename,status) VALUES
 ('e2e-p3','p3@e2e.com','Reload Tester','resumes/e2e-p3.pdf','r.pdf','part2_ready');

-- Admin filter-chip test (admin-filters.spec.ts): candidates in different statuses
-- and colleges so the Status and College filters have something to separate.
ALTER TABLE candidates ADD COLUMN college TEXT;
INSERT INTO candidates (id,email,name,resume_r2_key,resume_filename,status,college) VALUES
 ('e2e-f1','f1@e2e.com','Filter Evaluated','resumes/e2e-f1.pdf','r.pdf','evaluated','College Name 1'),
 ('e2e-f2','f2@e2e.com','Filter Shortlisted','resumes/e2e-f2.pdf','r.pdf','shortlisted',NULL),
 ('e2e-f3','f3@e2e.com','Filter InProgress','resumes/e2e-f3.pdf','r.pdf','in_progress','College Name 1');
