DELETE FROM part1_answers;
DELETE FROM part1_assignments;
DELETE FROM question_bank;
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed001','python','Write a Python program to remove repeated (duplicate) elements from a list while keeping the original order.

Example:
Input: [1, 2, 2, 3, 1, 4, 3]
Output: [1, 2, 3, 4]','def remove_duplicates(numbers):
    result = []
    for num in numbers:
        if num not in result:
            result.append(num)
    return result

print(remove_duplicates([1, 2, 2, 3, 1, 4, 3]))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed002','python','Given a list of records, write a Python program to identify the IDs that occur more than once.

records = [
    {"id": 101, "name": "A"},
    {"id": 102, "name": "B"},
    {"id": 101, "name": "C"},
    {"id": 103, "name": "D"},
    {"id": 102, "name": "E"}
]

Expected output:
[101, 102]','def find_duplicate_ids(records):
    seen = set()
    duplicates = set()
    for record in records:
        record_id = record["id"]
        if record_id in seen:
            duplicates.add(record_id)
        else:
            seen.add(record_id)
    return list(duplicates)

print(find_duplicate_ids(records))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed003','python','Given the transaction data below, write a Python function to:
1. Keep only successful transactions.
2. Exclude records where amount is missing.
3. Calculate and return the total transaction amount.

transactions = [
    {"id": 1, "amount": "100", "status": "success"},
    {"id": 2, "amount": "200", "status": "failed"},
    {"id": 3, "amount": "150", "status": "success"},
    {"id": 4, "amount": None, "status": "success"},
]

Expected output:
250','def process_transactions(transactions):
    total = 0
    for transaction in transactions:
        if transaction["status"] != "success":
            continue
        if transaction["amount"] is None:
            continue
        total += int(transaction["amount"])
    return total

print(process_transactions(transactions))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed004','python','Given a list of integers, find the element that occurs most frequently.

Input:
numbers = [1, 2, 3, 2, 4, 2, 5, 3]

Expected Output:
2','def most_frequent(numbers):
    count = {}
    for num in numbers:
        count[num] = count.get(num, 0) + 1
    most_common = None
    max_count = 0
    for num, frequency in count.items():
        if frequency > max_count:
            max_count = frequency
            most_common = num
    return most_common

print(most_frequent(numbers))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed005','python','Given two lists, find the elements that are present in both lists.

Input:
list1 = [1, 2, 3, 4, 5]
list2 = [3, 4, 5, 6, 7]

Expected Output:
[3, 4, 5]','def common_elements(list1, list2):
    result = []
    for item in list1:
        if item in list2 and item not in result:
            result.append(item)
    return result

print(common_elements(list1, list2))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed006','python','Given transaction records, find the transaction with the highest amount.

Input:
transactions = [
    {"id": 101, "amount": 500},
    {"id": 102, "amount": 1200},
    {"id": 103, "amount": 800}
]

Expected Output:
{"id": 102, "amount": 1200}','def highest_transaction(transactions):
    highest = transactions[0]
    for transaction in transactions:
        if transaction["amount"] > highest["amount"]:
            highest = transaction
    return highest

print(highest_transaction(transactions))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed007','python','Given a list of email addresses, return the domain of each email.

Input:
emails = ["john@gmail.com", "alice@yahoo.com", "bob@gmail.com"]

Expected Output:
["gmail.com", "yahoo.com", "gmail.com"]','def extract_domains(emails):
    result = []
    for email in emails:
        domain = email.split("@")[1]
        result.append(domain)
    return result

print(extract_domains(emails))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed008','python','Compare source and destination records and return IDs that are present in the source but missing from the destination.

Input:
source = [
    {"id": 101, "name": "A"},
    {"id": 102, "name": "B"},
    {"id": 103, "name": "C"},
    {"id": 104, "name": "D"}
]
destination = [
    {"id": 101, "name": "A"},
    {"id": 103, "name": "C"}
]

Expected Output:
[102, 104]','def find_missing_records(source, destination):
    destination_ids = set()
    for record in destination:
        destination_ids.add(record["id"])
    result = []
    for record in source:
        if record["id"] not in destination_ids:
            result.append(record["id"])
    return result

print(find_missing_records(source, destination))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed009','python','Given a list of strings, write a Python function to return the strings that are palindromes.

Input:
words = ["level", "python", "madam", "hello", "racecar"]

Expected output:
["level", "madam", "racecar"]','def find_palindromes(words):
    result = []
    for word in words:
        if word == word[::-1]:
            result.append(word)
    return result

print(find_palindromes(words))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed010','python','Given two lists of integers, write a Python function to find the elements that are present in the first list but not in the second list.

Input:
list1 = [1, 2, 3, 4, 5]
list2 = [2, 4, 6]

Expected output:
[1, 3, 5]','def difference(list1, list2):
    result = []
    for item in list1:
        if item not in list2:
            result.append(item)
    return result

print(difference(list1, list2))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed011','python','Given a list of strings, write a Python function to find the longest string in the list. If multiple strings have the same length, return the first one.

Input:
words = ["cat", "elephant", "dog", "tiger", "lion"]

Expected output:
"elephant"','def longest_word(words):
    longest = words[0]
    for word in words:
        if len(word) > len(longest):
            longest = word
    return longest

print(longest_word(words))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed012','python','Given a list of numbers, write a Python function to split the list into two lists: one containing positive numbers and another containing negative numbers. Ignore 0.

Input:
numbers = [10, -5, 3, -2, 0, 8, -7]

Expected output:
Positive: [10, 3, 8]
Negative: [-5, -2, -7]','def split_numbers(numbers):
    positive = []
    negative = []
    for num in numbers:
        if num > 0:
            positive.append(num)
        elif num < 0:
            negative.append(num)
    return positive, negative

positive, negative = split_numbers(numbers)
print("Positive:", positive)
print("Negative:", negative)',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed013','python','Given a string, write a Python function to count the number of words in the string.

Input:
text = "Python is useful for data processing"

Expected output:
6','def count_words(text):
    words = text.split()
    return len(words)

print(count_words(text))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed014','python','Given a list of dates in the format YYYY-MM-DD, write a Python function to return only the dates from the year 2026.

Input:
dates = ["2025-12-20", "2026-01-15", "2026-05-10", "2027-02-01"]

Expected output:
["2026-01-15", "2026-05-10"]','def get_2026_dates(dates):
    result = []
    for date in dates:
        if date.startswith("2026-"):
            result.append(date)
    return result

print(get_2026_dates(dates))',4,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed015','sql','Table: orders
Columns: order_id (PK), customer_id, order_date, amount, status

Write a SQL query to find the total amount of completed orders for each customer. Display the customer_id and total amount, and show only customers whose total completed order amount is greater than 10,000.','SELECT customer_id, SUM(amount) AS total_amount
FROM orders
WHERE status = ''completed''
GROUP BY customer_id
HAVING SUM(amount) > 10000'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed016','sql','Table: students
Columns: student_id (PK), student_name, age, course, marks

Write a SQL query to find the students who scored more than 80 marks. Display the student name and marks, sorted by marks from highest to lowest.','SELECT student_name, marks
FROM students
WHERE marks > 80
ORDER BY marks DESC'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed017','sql','Table: employees
Columns: employee_id (PK), employee_name, department, salary

Write a SQL query to find employees whose salary is higher than the average salary of all employees.','SELECT employee_id, employee_name, salary
FROM employees
WHERE salary > (SELECT AVG(salary) FROM employees)'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed018','sql','Tables:
customers - Columns: customer_id (PK), customer_name, city
orders - Columns: order_id (PK), customer_id (FK), order_date, amount

Find all customers who have never placed an order. Display: customer_id, customer_name','SELECT c.customer_id, c.customer_name
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
WHERE o.order_id IS NULL'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed019','sql','Table: orders
Columns: order_id (PK), customer_id, order_date, amount, status

Write a SQL query to find the total number of orders and total order amount for each order status. Display status, order_count, and total_amount.','SELECT status, COUNT(*) AS order_count, SUM(amount) AS total_amount
FROM orders
GROUP BY status'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed020','sql','Table: products
Columns: product_id (PK), product_name, category, price, stock_quantity

Write a SQL query to find categories where the total available stock is less than 100 units. Display the category and total stock.','SELECT category, SUM(stock_quantity) AS total_stock
FROM products
GROUP BY category
HAVING SUM(stock_quantity) < 100'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed021','sql','Table: students
Columns: student_id (PK), student_name, course, marks, attendance

Write a SQL query to find students who have either scored less than 40 marks or have attendance below 75%. Display the student name, marks, and attendance.','SELECT student_name, marks, attendance
FROM students
WHERE marks < 40 OR attendance < 75'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed022','sql','Table: students
Columns: student_id (PK), student_name, class, section, marks, admission_date

Write a SQL query to find students whose names start with the letter ''A'' and display their name, class, and section.','SELECT student_name, class, section
FROM students
WHERE student_name LIKE ''A%'''||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed023','sql','Table: students
Columns: student_id (PK), student_name, class, section, marks, attendance

Write a SQL query to assign a rank to every student based on their marks, with the highest marks receiving rank 1. Students with the same marks should receive the same rank.','SELECT student_name, class, marks,
       RANK() OVER (ORDER BY marks DESC) AS marks_rank
FROM students'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed024','sql','Tables:
students - Columns: student_id (PK), student_name, class, section
marks - Columns: mark_id (PK), student_id (FK), subject, marks

Write a SQL query to display each student''s name along with their total marks across all subjects.','SELECT s.student_name, SUM(m.marks) AS total_marks
FROM students s
JOIN marks m ON s.student_id = m.student_id
GROUP BY s.student_id, s.student_name'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed025','sql','Tables:
students - Columns: student_id (PK), student_name, class, section
attendance - Columns: attendance_id (PK), student_id (FK), attendance_date, status

Write a SQL query to find students who were absent on more than 5 days. Display the student ID and number of absent days.','SELECT student_id, COUNT(*) AS absent_days
FROM attendance
WHERE status = ''Absent''
GROUP BY student_id
HAVING COUNT(*) > 5'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed026','sql','Table: appointments
Columns: appointment_id (PK), patient_id, doctor_id, appointment_date, status

Write a SQL query to find the number of appointments for each doctor in 2026, considering only completed appointments.','SELECT doctor_id, COUNT(*) AS appointment_count
FROM appointments
WHERE status = ''Completed''
  AND appointment_date >= ''2026-01-01''
  AND appointment_date < ''2027-01-01''
GROUP BY doctor_id'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed027','sql','Table: flights
Columns: flight_id (PK), airline, source, destination, departure_time, arrival_time, status

Write a SQL query to find the number of flights for each airline, considering only flights with a status of Completed or Delayed.','SELECT airline, COUNT(*) AS flight_count
FROM flights
WHERE status IN (''Completed'', ''Delayed'')
GROUP BY airline'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed028','sql','Table: rentals
Columns: rental_id (PK), vehicle_id, customer_id, rental_date, return_date, rental_amount, status

Write a SQL query to find the average rental amount for each vehicle. Display the vehicle_id and average rental amount, sorted from highest to lowest.','SELECT vehicle_id, AVG(rental_amount) AS average_rental_amount
FROM rentals
GROUP BY vehicle_id
ORDER BY average_rental_amount DESC'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed029','sql','Table: transactions
Columns: transaction_id (PK), customer_id, transaction_date, amount, status

For each customer, find the percentage of transactions that were successful.','SELECT customer_id,
       100.0 * SUM(CASE WHEN status = ''success'' THEN 1 ELSE 0 END) / COUNT(*) AS success_percentage
FROM transactions
GROUP BY customer_id'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed030','sql','Table: orders
Columns: order_id (PK), customer_id, order_date, amount

Find customers who placed two or more orders on the same date. Display customer ID, order date, and number of orders.','SELECT customer_id, order_date, COUNT(*) AS order_count
FROM orders
GROUP BY customer_id, order_date
HAVING COUNT(*) >= 2'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed031','sql','Table 1: source_orders - Columns: order_id (PK), customer_id, amount, updated_at
Table 2: destination_orders - Columns: order_id (PK), customer_id, amount, updated_at

Find orders that exist in the source but are missing from the destination.','SELECT s.order_id, s.customer_id, s.amount
FROM source_orders s
LEFT JOIN destination_orders d ON s.order_id = d.order_id
WHERE d.order_id IS NULL'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed032','sql','Table: transactions
Columns: transaction_id (PK), customer_id, transaction_date, amount, status

Find the largest successful transaction for each customer. Display the customer_id and the highest successful transaction amount.','SELECT customer_id, MAX(amount) AS highest_transaction
FROM transactions
WHERE status = ''success''
GROUP BY customer_id'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed033','sql','Table: employee_salary_history
Columns: id (PK), employee_id, salary, effective_date

Find the most recent salary record for each employee. Display employee ID, salary, and effective date.','SELECT employee_id, salary, effective_date
FROM (
    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY effective_date DESC) AS rn
    FROM employee_salary_history e
) x
WHERE rn = 1'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed034','sql','Table 1: products - Columns: product_id (PK), product_name, category, price
Table 2: order_items - Columns: order_id, product_id, quantity

Find the top 2 products by total quantity sold in each category.','SELECT category, product_id, product_name, total_quantity
FROM (
    SELECT p.category, p.product_id, p.product_name,
           SUM(oi.quantity) AS total_quantity,
           DENSE_RANK() OVER (PARTITION BY p.category ORDER BY SUM(oi.quantity) DESC) AS rnk
    FROM products p
    JOIN order_items oi ON p.product_id = oi.product_id
    GROUP BY p.category, p.product_id, p.product_name
) x
WHERE rnk <= 2'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed035','sql','Table: employees
Columns: employee_id (PK), employee_name, department, salary, joining_date

Find the departments where the difference between the highest and lowest salary is greater than 30,000. Display the department, highest salary, and lowest salary.','SELECT department, MAX(salary) AS highest_salary, MIN(salary) AS lowest_salary
FROM employees
GROUP BY department
HAVING MAX(salary) - MIN(salary) > 30000'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed036','sql','Table 1: customers - Columns: customer_id (PK), customer_name, city
Table 2: orders - Columns: order_id (PK), customer_id, order_date, amount

Find customers who have placed more than 3 orders. Display customer ID, customer name, and order count.','SELECT c.customer_id, c.customer_name, COUNT(o.order_id) AS order_count
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
GROUP BY c.customer_id, c.customer_name
HAVING COUNT(o.order_id) > 3'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed037','sql','Table: orders
Columns: order_id (PK), customer_id, order_date, amount

Find customers who placed an order in January but did not place any order in February.','SELECT DISTINCT customer_id
FROM orders
WHERE EXTRACT(MONTH FROM order_date) = 1
  AND customer_id NOT IN (
      SELECT customer_id FROM orders WHERE EXTRACT(MONTH FROM order_date) = 2
  )'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed038','sql','Table: orders
Columns: order_id (PK), customer_id, order_date, amount, status

Find the number of unique customers who placed at least one order in each of the statuses completed, cancelled, and pending.','SELECT COUNT(*) AS customer_count
FROM (
    SELECT customer_id
    FROM orders
    WHERE status IN (''completed'', ''cancelled'', ''pending'')
    GROUP BY customer_id
    HAVING COUNT(DISTINCT status) = 3
) x'||char(59)||'',3,'medium','active',1);
INSERT INTO question_bank (id, category, prompt, reference_answer, marks, difficulty, status, active) VALUES ('qseed039','sql','Table 1: customers - Columns: customer_id (PK), customer_name, city
Table 2: orders - Columns: order_id (PK), customer_id, order_date, amount

Find cities where customers have generated more than 100,000 in total orders.','SELECT c.city, SUM(o.amount) AS total_amount
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
GROUP BY c.city
HAVING SUM(o.amount) > 100000'||char(59)||'',3,'medium','active',1);
