#!/usr/bin/env python3
"""Generate accurate sample_data + expected_output for every seeded question by
actually running each reference SQL query / Python program. Emits an idempotent
UPDATE SQL file keyed by question id (qseedNNN)."""
import sqlite3, io, contextlib, json

def md_table(cols, rows):
    out = ['| ' + ' | '.join(str(c) for c in cols) + ' |',
           '| ' + ' | '.join('---' for _ in cols) + ' |']
    for r in rows:
        out.append('| ' + ' | '.join('' if v is None else str(v) for v in r) + ' |')
    return '\n'.join(out)

def fmt_num(v):
    # keep integers clean, round floats to 2dp
    if isinstance(v, float):
        return int(v) if v.is_integer() else round(v, 2)
    return v

# ---- SQL questions: sample tables + the query to run (SQLite-compatible) ----
SQL = {}

SQL[15] = {
  "tables": [("orders", ["order_id","customer_id","order_date","amount","status"], [
      (1,101,"2026-01-05",6000,"completed"),(2,101,"2026-01-08",7000,"completed"),
      (3,102,"2026-01-06",4000,"completed"),(4,102,"2026-02-01",3000,"completed"),
      (5,103,"2026-01-10",20000,"completed"),(6,103,"2026-01-11",5000,"cancelled"),
      (7,104,"2026-01-12",15000,"pending")])],
  "query": "SELECT customer_id, SUM(amount) AS total_amount FROM orders WHERE status='completed' GROUP BY customer_id HAVING SUM(amount) > 10000"}

SQL[16] = {
  "tables": [("students", ["student_id","student_name","age","course","marks"], [
      (1,"Aarav",20,"CS",92),(2,"Bhavna",21,"Math",78),(3,"Chirag",20,"CS",85),
      (4,"Divya",22,"Physics",88),(5,"Esha",21,"CS",80)])],
  "query": "SELECT student_name, marks FROM students WHERE marks > 80 ORDER BY marks DESC"}

SQL[17] = {
  "tables": [("employees", ["employee_id","employee_name","department","salary"], [
      (1,"Alice","Eng",95000),(2,"Bob","Eng",85000),(3,"Carol","Sales",50000),
      (4,"Dan","Sales",40000),(5,"Eve","Sales",30000)])],
  "query": "SELECT employee_id, employee_name, salary FROM employees WHERE salary > (SELECT AVG(salary) FROM employees)"}

SQL[18] = {
  "tables": [("customers", ["customer_id","customer_name","city"], [
      (1,"Alice","NY"),(2,"Bob","LA"),(3,"Carol","SF")]),
     ("orders", ["order_id","customer_id","order_date","amount"], [
      (101,1,"2026-01-01",500),(102,1,"2026-01-02",300)])],
  "query": "SELECT c.customer_id, c.customer_name FROM customers c LEFT JOIN orders o ON c.customer_id=o.customer_id WHERE o.order_id IS NULL"}

SQL[19] = {
  "tables": [("orders", ["order_id","customer_id","order_date","amount","status"], [
      (1,101,"2026-01-01",500,"completed"),(2,102,"2026-01-02",300,"completed"),
      (3,103,"2026-01-03",200,"pending"),(4,104,"2026-01-04",400,"cancelled"),
      (5,105,"2026-01-05",600,"pending")])],
  "query": "SELECT status, COUNT(*) AS order_count, SUM(amount) AS total_amount FROM orders GROUP BY status"}

SQL[20] = {
  "tables": [("products", ["product_id","product_name","category","price","stock_quantity"], [
      (1,"Pen","Stationery",10,30),(2,"Pencil","Stationery",5,40),
      (3,"Laptop","Electronics",50000,60),(4,"Mouse","Electronics",500,80),
      (5,"Notebook","Stationery",20,20)])],
  "query": "SELECT category, SUM(stock_quantity) AS total_stock FROM products GROUP BY category HAVING SUM(stock_quantity) < 100"}

SQL[21] = {
  "tables": [("students", ["student_id","student_name","course","marks","attendance"], [
      (1,"Alice","CS",35,90),(2,"Bob","CS",85,70),(3,"Carol","Math",90,95),
      (4,"Dave","Physics",38,60)])],
  "query": "SELECT student_name, marks, attendance FROM students WHERE marks < 40 OR attendance < 75"}

SQL[22] = {
  "tables": [("students", ["student_id","student_name","class","section","marks","admission_date"], [
      (1,"Aarav","10","A",88,"2025-06-01"),(2,"Bhavna","10","B",75,"2025-06-02"),
      (3,"Ananya","9","A",80,"2025-06-03"),(4,"Rahul","9","C",70,"2025-06-04")])],
  "query": "SELECT student_name, class, section FROM students WHERE student_name LIKE 'A%'"}

SQL[23] = {
  "tables": [("students", ["student_id","student_name","class","section","marks","attendance"], [
      (1,"Alice","10","A",90,88),(2,"Bob","10","B",85,80),
      (3,"Carol","9","A",90,95),(4,"Dave","9","B",70,60)])],
  "query": "SELECT student_name, class, marks, RANK() OVER (ORDER BY marks DESC) AS marks_rank FROM students"}

SQL[24] = {
  "tables": [("students", ["student_id","student_name","class","section"], [
      (1,"Alice","10","A"),(2,"Bob","10","B")]),
     ("marks", ["mark_id","student_id","subject","marks"], [
      (1,1,"Math",80),(2,1,"Science",90),(3,2,"Math",70),(4,2,"Science",60)])],
  "query": "SELECT s.student_name, SUM(m.marks) AS total_marks FROM students s JOIN marks m ON s.student_id=m.student_id GROUP BY s.student_id, s.student_name"}

SQL[25] = {
  "tables": [("students", ["student_id","student_name","class","section"], [
      (1,"Alice","10","A"),(2,"Bob","10","B")]),
     ("attendance", ["attendance_id","student_id","attendance_date","status"], [
      (1,1,"2026-01-01","Absent"),(2,1,"2026-01-02","Absent"),(3,1,"2026-01-03","Absent"),
      (4,1,"2026-01-04","Absent"),(5,1,"2026-01-05","Absent"),(6,1,"2026-01-06","Absent"),
      (7,1,"2026-01-07","Present"),(8,2,"2026-01-01","Absent"),(9,2,"2026-01-02","Absent")])],
  "query": "SELECT student_id, COUNT(*) AS absent_days FROM attendance WHERE status='Absent' GROUP BY student_id HAVING COUNT(*) > 5"}

SQL[26] = {
  "tables": [("appointments", ["appointment_id","patient_id","doctor_id","appointment_date","status"], [
      (1,201,10,"2026-02-01","Completed"),(2,202,10,"2026-03-01","Completed"),
      (3,203,10,"2025-12-01","Completed"),(4,204,11,"2026-04-01","Completed"),
      (5,205,11,"2026-05-01","Cancelled")])],
  "query": "SELECT doctor_id, COUNT(*) AS appointment_count FROM appointments WHERE status='Completed' AND appointment_date >= '2026-01-01' AND appointment_date < '2027-01-01' GROUP BY doctor_id"}

SQL[27] = {
  "tables": [("flights", ["flight_id","airline","source","destination","departure_time","arrival_time","status"], [
      (1,"IndiGo","DEL","BOM","08:00","10:00","Completed"),
      (2,"IndiGo","BOM","DEL","12:00","14:00","Delayed"),
      (3,"IndiGo","DEL","GOI","15:00","17:00","Cancelled"),
      (4,"AirIndia","DEL","MAA","09:00","11:30","Completed")])],
  "query": "SELECT airline, COUNT(*) AS flight_count FROM flights WHERE status IN ('Completed','Delayed') GROUP BY airline"}

SQL[28] = {
  "tables": [("rentals", ["rental_id","vehicle_id","customer_id","rental_date","return_date","rental_amount","status"], [
      (1,"V1",301,"2026-01-01","2026-01-03",1000,"returned"),
      (2,"V1",302,"2026-02-01","2026-02-02",2000,"returned"),
      (3,"V2",303,"2026-01-05","2026-01-06",3000,"returned")])],
  "query": "SELECT vehicle_id, AVG(rental_amount) AS average_rental_amount FROM rentals GROUP BY vehicle_id ORDER BY average_rental_amount DESC"}

SQL[29] = {
  "tables": [("transactions", ["transaction_id","customer_id","transaction_date","amount","status"], [
      (1,101,"2026-01-01",500,"success"),(2,101,"2026-01-02",300,"failed"),
      (3,102,"2026-01-03",200,"success"),(4,102,"2026-01-04",400,"success")])],
  "query": "SELECT customer_id, 100.0*SUM(CASE WHEN status='success' THEN 1 ELSE 0 END)/COUNT(*) AS success_percentage FROM transactions GROUP BY customer_id"}

SQL[30] = {
  "tables": [("orders", ["order_id","customer_id","order_date","amount"], [
      (1,101,"2026-01-01",100),(2,101,"2026-01-01",200),
      (3,102,"2026-01-02",300),(4,101,"2026-01-03",150)])],
  "query": "SELECT customer_id, order_date, COUNT(*) AS order_count FROM orders GROUP BY customer_id, order_date HAVING COUNT(*) >= 2"}

SQL[31] = {
  "tables": [("source_orders", ["order_id","customer_id","amount","updated_at"], [
      (1,101,500,"2026-01-01"),(2,102,300,"2026-01-02"),(3,103,200,"2026-01-03")]),
     ("destination_orders", ["order_id","customer_id","amount","updated_at"], [
      (1,101,500,"2026-01-01")])],
  "query": "SELECT s.order_id, s.customer_id, s.amount FROM source_orders s LEFT JOIN destination_orders d ON s.order_id=d.order_id WHERE d.order_id IS NULL"}

SQL[32] = {
  "tables": [("transactions", ["transaction_id","customer_id","transaction_date","amount","status"], [
      (1,101,"2026-01-01",500,"success"),(2,101,"2026-01-02",1500,"success"),
      (3,101,"2026-01-03",3000,"failed"),(4,102,"2026-01-04",800,"success")])],
  "query": "SELECT customer_id, MAX(amount) AS highest_transaction FROM transactions WHERE status='success' GROUP BY customer_id"}

SQL[33] = {
  "tables": [("employee_salary_history", ["id","employee_id","salary","effective_date"], [
      (1,10,50000,"2024-01-01"),(2,10,60000,"2025-01-01"),(3,10,70000,"2026-01-01"),
      (4,11,40000,"2025-06-01"),(5,11,45000,"2026-06-01")])],
  "query": "SELECT employee_id, salary, effective_date FROM (SELECT e.*, ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY effective_date DESC) AS rn FROM employee_salary_history e) x WHERE rn=1"}

SQL[34] = {
  "tables": [("products", ["product_id","product_name","category","price"], [
      (1,"Pen","Stationery",10),(2,"Pencil","Stationery",5),(3,"Eraser","Stationery",3),
      (4,"Laptop","Electronics",50000),(5,"Mouse","Electronics",500)]),
     ("order_items", ["order_id","product_id","quantity"], [
      (1,1,50),(2,2,30),(3,3,10),(4,4,20),(5,5,25)])],
  "query": "SELECT category, product_id, product_name, total_quantity FROM (SELECT p.category, p.product_id, p.product_name, SUM(oi.quantity) AS total_quantity, DENSE_RANK() OVER (PARTITION BY p.category ORDER BY SUM(oi.quantity) DESC) AS rnk FROM products p JOIN order_items oi ON p.product_id=oi.product_id GROUP BY p.category, p.product_id, p.product_name) x WHERE rnk <= 2"}

SQL[35] = {
  "tables": [("employees", ["employee_id","employee_name","department","salary","joining_date"], [
      (1,"A","Eng",100000,"2024-01-01"),(2,"B","Eng",60000,"2024-02-01"),
      (3,"C","HR",50000,"2024-03-01"),(4,"D","HR",45000,"2024-04-01")])],
  "query": "SELECT department, MAX(salary) AS highest_salary, MIN(salary) AS lowest_salary FROM employees GROUP BY department HAVING MAX(salary)-MIN(salary) > 30000"}

SQL[36] = {
  "tables": [("customers", ["customer_id","customer_name","city"], [
      (1,"Alice","NY"),(2,"Bob","LA")]),
     ("orders", ["order_id","customer_id","order_date","amount"], [
      (1,1,"2026-01-01",100),(2,1,"2026-01-02",100),(3,1,"2026-01-03",100),
      (4,1,"2026-01-04",100),(5,2,"2026-01-01",100),(6,2,"2026-01-02",100)])],
  "query": "SELECT c.customer_id, c.customer_name, COUNT(o.order_id) AS order_count FROM customers c JOIN orders o ON c.customer_id=o.customer_id GROUP BY c.customer_id, c.customer_name HAVING COUNT(o.order_id) > 3"}

# EXTRACT is Postgres; use strftime for the SQLite run (same result set).
SQL[37] = {
  "tables": [("orders", ["order_id","customer_id","order_date","amount"], [
      (1,101,"2026-01-05",100),(2,101,"2026-02-10",200),(3,102,"2026-01-06",300),
      (4,103,"2026-01-07",150),(5,103,"2026-03-01",150)])],
  "query": "SELECT DISTINCT customer_id FROM orders WHERE strftime('%m', order_date)='01' AND customer_id NOT IN (SELECT customer_id FROM orders WHERE strftime('%m', order_date)='02')"}

SQL[38] = {
  "tables": [("orders", ["order_id","customer_id","order_date","amount","status"], [
      (1,101,"2026-01-01",100,"completed"),(2,101,"2026-01-02",100,"cancelled"),
      (3,101,"2026-01-03",100,"pending"),(4,102,"2026-01-01",100,"completed"),
      (5,102,"2026-01-02",100,"pending")])],
  "query": "SELECT COUNT(*) AS customer_count FROM (SELECT customer_id FROM orders WHERE status IN ('completed','cancelled','pending') GROUP BY customer_id HAVING COUNT(DISTINCT status)=3) x"}

SQL[39] = {
  "tables": [("customers", ["customer_id","customer_name","city"], [
      (1,"A","Mumbai"),(2,"B","Mumbai"),(3,"C","Delhi")]),
     ("orders", ["order_id","customer_id","order_date","amount"], [
      (1,1,"2026-01-01",60000),(2,2,"2026-01-02",50000),(3,3,"2026-01-03",40000)])],
  "query": "SELECT c.city, SUM(o.amount) AS total_amount FROM customers c JOIN orders o ON c.customer_id=o.customer_id GROUP BY c.city HAVING SUM(o.amount) > 100000"}

# ---- Python questions: input variable setup (the reference does its own print) ----
PY = {}
PY[1]  = ""  # reference calls with a literal
PY[2]  = 'records = [{"id":101,"name":"A"},{"id":102,"name":"B"},{"id":101,"name":"C"},{"id":103,"name":"D"},{"id":102,"name":"E"}]'
PY[3]  = 'transactions = [{"id":1,"amount":"100","status":"success"},{"id":2,"amount":"200","status":"failed"},{"id":3,"amount":"150","status":"success"},{"id":4,"amount":None,"status":"success"}]'
PY[4]  = "numbers = [1, 2, 3, 2, 4, 2, 5, 3]"
PY[5]  = "list1 = [1,2,3,4,5]\nlist2 = [3,4,5,6,7]"
PY[6]  = 'transactions = [{"id":101,"amount":500},{"id":102,"amount":1200},{"id":103,"amount":800}]'
PY[7]  = 'emails = ["john@gmail.com","alice@yahoo.com","bob@gmail.com"]'
PY[8]  = 'source = [{"id":101,"name":"A"},{"id":102,"name":"B"},{"id":103,"name":"C"},{"id":104,"name":"D"}]\ndestination = [{"id":101,"name":"A"},{"id":103,"name":"C"}]'
PY[9]  = 'words = ["level","python","madam","hello","racecar"]'
PY[10] = "list1 = [1,2,3,4,5]\nlist2 = [2,4,6]"
PY[11] = 'words = ["cat","elephant","dog","tiger","lion"]'
PY[12] = "numbers = [10,-5,3,-2,0,8,-7]"
PY[13] = 'text = "Python is useful for data processing"'
PY[14] = 'dates = ["2025-12-20","2026-01-15","2026-05-10","2027-02-01"]'

def run_sql(spec):
    con = sqlite3.connect(":memory:")
    cur = con.cursor()
    sample_parts = []
    for name, cols, rows in spec["tables"]:
        cur.execute(f"CREATE TABLE {name} ({', '.join(cols)})")
        cur.executemany(f"INSERT INTO {name} VALUES ({','.join('?' for _ in cols)})", rows)
        sample_parts.append(f"Table: {name}\n\n" + md_table(cols, rows))
    con.commit()
    cur.execute(spec["query"])
    out_cols = [d[0] for d in cur.description]
    out_rows = [[fmt_num(v) for v in r] for r in cur.fetchall()]
    con.close()
    return "\n\n".join(sample_parts), md_table(out_cols, out_rows)

def run_py(ref_code, setup):
    # Define the sample inputs first, then run the reference verbatim (it defines
    # its function AND prints its own result). Captured stdout is the expected output.
    ns = {}
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        if setup.strip():
            exec(setup, ns)
        exec(ref_code, ns)
    return buf.getvalue().strip()

def esc(s):
    if s is None: return "NULL"
    return "'" + s.replace("'", "''").replace(";", "'||char(59)||'") + "'"

qs = json.load(open("scripts/seed-questions.json"))["questions"]
updates = []
for i, q in enumerate(qs, 1):
    if q["category"] == "sql":
        sample, expected = run_sql(SQL[i])
        updates.append(f"UPDATE question_bank SET sample_data={esc(sample)}, expected_output={esc(expected)} WHERE id='qseed{i:03d}';")
    else:
        expected = run_py(q["referenceAnswer"], PY[i])
        # Python input is already in the prompt, so sample_data stays null.
        updates.append(f"UPDATE question_bank SET expected_output={esc(expected)} WHERE id='qseed{i:03d}';")

open("scripts/enrich_update.sql", "w").write("\n".join(updates) + "\n")
print("Wrote scripts/enrich_update.sql with", len(updates), "updates")
print("\n--- sample verification (qseed015 SQL) ---")
s, e = run_sql(SQL[15]); print("SAMPLE:\n"+s+"\n\nEXPECTED:\n"+e)
print("\n--- qseed034 top-2 per category ---")
s, e = run_sql(SQL[34]); print("EXPECTED:\n"+e)
print("\n--- python q7 expected ---"); print(run_py(qs[6]["referenceAnswer"], PY[7]))
print("--- python q12 expected ---"); print(run_py(qs[11]["referenceAnswer"], PY[12]))
