-- Sample data for a local smoke test of colleges/roles/filters/export.
INSERT INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,rubric,marks,difficulty,status,active) VALUES
 ('qb-sql-1','sql','Table: orders. Total per customer.','SELECT customer_id, SUM(amount) FROM orders GROUP BY customer_id','Table: orders','| customer_id | total |','Groups',3,'medium','active',1),
 ('qb-py-1','python','Remove duplicates keeping order.','def f(x): return list(dict.fromkeys(x))','Input: [1,2,2,3]','Output: [1,2,3]','Preserves order',4,'medium','active',1);

INSERT INTO candidates (id,email,name,resume_r2_key,resume_filename,status,college) VALUES
 ('sm1','aarav@ex.com','Aarav Sharma','resumes/sm1.pdf','r.pdf','shortlisted','College Name 1'),
 ('sm2','diya@ex.com','Diya Patel','resumes/sm2.pdf','r.pdf','evaluated','College Name 1'),
 ('sm3','rohan@ex.com','Rohan Iyer','resumes/sm3.pdf','r.pdf','submitted','College Name 2'),
 ('sm4','isha@ex.com','Isha Reddy','resumes/sm4.pdf','r.pdf','rejected','College Name 2'),
 ('sm5','kabir@ex.com','Kabir Nair','resumes/sm5.pdf','r.pdf','part2_ready','College Name 3'),
 ('sm6','myra@ex.com','Myra Joshi','resumes/sm6.pdf','r.pdf','part2_ready',NULL);

INSERT INTO attempts (candidate_id, part1_submitted_at, part2_submitted_at, login_count) VALUES
 ('sm1', datetime('now'), datetime('now'), 1),
 ('sm2', datetime('now'), datetime('now'), 1);

INSERT INTO part1_assignments (candidate_id, question_id, position) VALUES ('sm1','qb-sql-1',0),('sm2','qb-sql-1',0);
INSERT INTO part1_answers (candidate_id, question_id, answer_text, ai_score, ai_reasoning, deductions, max_marks, scored_at) VALUES
 ('sm1','qb-sql-1','SELECT customer_id, SUM(amount) FROM orders GROUP BY customer_id',3,'Correct.','[]',3,datetime('now')),
 ('sm2','qb-sql-1','SELECT customer_id, amount FROM orders',1,'Missing GROUP BY.','[{"marks":2,"reason":"No aggregation"}]',3,datetime('now'));
