#!/usr/bin/env python3
"""Generates scripts/seed-questions.sql from the provided question bank.
Run: python3 scripts/gen_seed.py   (then wrangler d1 execute --file that .sql)"""
import os

PY = [
 ("Write a Python program to remove repeated (duplicate) elements from a list while keeping the original order.\n\nExample:\nInput: [1, 2, 2, 3, 1, 4, 3]\nOutput: [1, 2, 3, 4]",
  "def remove_duplicates(numbers):\n    result = []\n    for num in numbers:\n        if num not in result:\n            result.append(num)\n    return result\n\nprint(remove_duplicates([1, 2, 2, 3, 1, 4, 3]))"),
 ("Given a list of records, write a Python program to identify the IDs that occur more than once.\n\nrecords = [\n    {\"id\": 101, \"name\": \"A\"},\n    {\"id\": 102, \"name\": \"B\"},\n    {\"id\": 101, \"name\": \"C\"},\n    {\"id\": 103, \"name\": \"D\"},\n    {\"id\": 102, \"name\": \"E\"}\n]\n\nExpected output:\n[101, 102]",
  "def find_duplicate_ids(records):\n    seen = set()\n    duplicates = set()\n    for record in records:\n        record_id = record[\"id\"]\n        if record_id in seen:\n            duplicates.add(record_id)\n        else:\n            seen.add(record_id)\n    return list(duplicates)\n\nprint(find_duplicate_ids(records))"),
 ("Given the transaction data below, write a Python function to:\n1. Keep only successful transactions.\n2. Exclude records where amount is missing.\n3. Calculate and return the total transaction amount.\n\ntransactions = [\n    {\"id\": 1, \"amount\": \"100\", \"status\": \"success\"},\n    {\"id\": 2, \"amount\": \"200\", \"status\": \"failed\"},\n    {\"id\": 3, \"amount\": \"150\", \"status\": \"success\"},\n    {\"id\": 4, \"amount\": None, \"status\": \"success\"},\n]\n\nExpected output:\n250",
  "def process_transactions(transactions):\n    total = 0\n    for transaction in transactions:\n        if transaction[\"status\"] != \"success\":\n            continue\n        if transaction[\"amount\"] is None:\n            continue\n        total += int(transaction[\"amount\"])\n    return total\n\nprint(process_transactions(transactions))"),
 ("Given a list of integers, find the element that occurs most frequently.\n\nInput:\nnumbers = [1, 2, 3, 2, 4, 2, 5, 3]\n\nExpected Output:\n2",
  "def most_frequent(numbers):\n    count = {}\n    for num in numbers:\n        count[num] = count.get(num, 0) + 1\n    most_common = None\n    max_count = 0\n    for num, frequency in count.items():\n        if frequency > max_count:\n            max_count = frequency\n            most_common = num\n    return most_common\n\nprint(most_frequent(numbers))"),
 ("Given two lists, find the elements that are present in both lists.\n\nInput:\nlist1 = [1, 2, 3, 4, 5]\nlist2 = [3, 4, 5, 6, 7]\n\nExpected Output:\n[3, 4, 5]",
  "def common_elements(list1, list2):\n    result = []\n    for item in list1:\n        if item in list2 and item not in result:\n            result.append(item)\n    return result\n\nprint(common_elements(list1, list2))"),
 ("Given transaction records, find the transaction with the highest amount.\n\nInput:\ntransactions = [\n    {\"id\": 101, \"amount\": 500},\n    {\"id\": 102, \"amount\": 1200},\n    {\"id\": 103, \"amount\": 800}\n]\n\nExpected Output:\n{\"id\": 102, \"amount\": 1200}",
  "def highest_transaction(transactions):\n    highest = transactions[0]\n    for transaction in transactions:\n        if transaction[\"amount\"] > highest[\"amount\"]:\n            highest = transaction\n    return highest\n\nprint(highest_transaction(transactions))"),
 ("Given a list of email addresses, return the domain of each email.\n\nInput:\nemails = [\"john@gmail.com\", \"alice@yahoo.com\", \"bob@gmail.com\"]\n\nExpected Output:\n[\"gmail.com\", \"yahoo.com\", \"gmail.com\"]",
  "def extract_domains(emails):\n    result = []\n    for email in emails:\n        domain = email.split(\"@\")[1]\n        result.append(domain)\n    return result\n\nprint(extract_domains(emails))"),
 ("Compare source and destination records and return IDs that are present in the source but missing from the destination.\n\nInput:\nsource = [\n    {\"id\": 101, \"name\": \"A\"},\n    {\"id\": 102, \"name\": \"B\"},\n    {\"id\": 103, \"name\": \"C\"},\n    {\"id\": 104, \"name\": \"D\"}\n]\ndestination = [\n    {\"id\": 101, \"name\": \"A\"},\n    {\"id\": 103, \"name\": \"C\"}\n]\n\nExpected Output:\n[102, 104]",
  "def find_missing_records(source, destination):\n    destination_ids = set()\n    for record in destination:\n        destination_ids.add(record[\"id\"])\n    result = []\n    for record in source:\n        if record[\"id\"] not in destination_ids:\n            result.append(record[\"id\"])\n    return result\n\nprint(find_missing_records(source, destination))"),
 ("Given a list of strings, write a Python function to return the strings that are palindromes.\n\nInput:\nwords = [\"level\", \"python\", \"madam\", \"hello\", \"racecar\"]\n\nExpected output:\n[\"level\", \"madam\", \"racecar\"]",
  "def find_palindromes(words):\n    result = []\n    for word in words:\n        if word == word[::-1]:\n            result.append(word)\n    return result\n\nprint(find_palindromes(words))"),
 ("Given two lists of integers, write a Python function to find the elements that are present in the first list but not in the second list.\n\nInput:\nlist1 = [1, 2, 3, 4, 5]\nlist2 = [2, 4, 6]\n\nExpected output:\n[1, 3, 5]",
  "def difference(list1, list2):\n    result = []\n    for item in list1:\n        if item not in list2:\n            result.append(item)\n    return result\n\nprint(difference(list1, list2))"),
 ("Given a list of strings, write a Python function to find the longest string in the list. If multiple strings have the same length, return the first one.\n\nInput:\nwords = [\"cat\", \"elephant\", \"dog\", \"tiger\", \"lion\"]\n\nExpected output:\n\"elephant\"",
  "def longest_word(words):\n    longest = words[0]\n    for word in words:\n        if len(word) > len(longest):\n            longest = word\n    return longest\n\nprint(longest_word(words))"),
 ("Given a list of numbers, write a Python function to split the list into two lists: one containing positive numbers and another containing negative numbers. Ignore 0.\n\nInput:\nnumbers = [10, -5, 3, -2, 0, 8, -7]\n\nExpected output:\nPositive: [10, 3, 8]\nNegative: [-5, -2, -7]",
  "def split_numbers(numbers):\n    positive = []\n    negative = []\n    for num in numbers:\n        if num > 0:\n            positive.append(num)\n        elif num < 0:\n            negative.append(num)\n    return positive, negative\n\npositive, negative = split_numbers(numbers)\nprint(\"Positive:\", positive)\nprint(\"Negative:\", negative)"),
 ("Given a string, write a Python function to count the number of words in the string.\n\nInput:\ntext = \"Python is useful for data processing\"\n\nExpected output:\n6",
  "def count_words(text):\n    words = text.split()\n    return len(words)\n\nprint(count_words(text))"),
 ("Given a list of dates in the format YYYY-MM-DD, write a Python function to return only the dates from the year 2026.\n\nInput:\ndates = [\"2025-12-20\", \"2026-01-15\", \"2026-05-10\", \"2027-02-01\"]\n\nExpected output:\n[\"2026-01-15\", \"2026-05-10\"]",
  "def get_2026_dates(dates):\n    result = []\n    for date in dates:\n        if date.startswith(\"2026-\"):\n            result.append(date)\n    return result\n\nprint(get_2026_dates(dates))"),
]

SQL = [
 ("Table: orders\nColumns: order_id (PK), customer_id, order_date, amount, status\n\nWrite a SQL query to find the total amount of completed orders for each customer. Display the customer_id and total amount, and show only customers whose total completed order amount is greater than 10,000.",
  "SELECT customer_id, SUM(amount) AS total_amount\nFROM orders\nWHERE status = 'completed'\nGROUP BY customer_id\nHAVING SUM(amount) > 10000;"),
 ("Table: students\nColumns: student_id (PK), student_name, age, course, marks\n\nWrite a SQL query to find the students who scored more than 80 marks. Display the student name and marks, sorted by marks from highest to lowest.",
  "SELECT student_name, marks\nFROM students\nWHERE marks > 80\nORDER BY marks DESC;"),
 ("Table: employees\nColumns: employee_id (PK), employee_name, department, salary\n\nWrite a SQL query to find employees whose salary is higher than the average salary of all employees.",
  "SELECT employee_id, employee_name, salary\nFROM employees\nWHERE salary > (SELECT AVG(salary) FROM employees);"),
 ("Tables:\ncustomers - Columns: customer_id (PK), customer_name, city\norders - Columns: order_id (PK), customer_id (FK), order_date, amount\n\nFind all customers who have never placed an order. Display: customer_id, customer_name",
  "SELECT c.customer_id, c.customer_name\nFROM customers c\nLEFT JOIN orders o ON c.customer_id = o.customer_id\nWHERE o.order_id IS NULL;"),
 ("Table: orders\nColumns: order_id (PK), customer_id, order_date, amount, status\n\nWrite a SQL query to find the total number of orders and total order amount for each order status. Display status, order_count, and total_amount.",
  "SELECT status, COUNT(*) AS order_count, SUM(amount) AS total_amount\nFROM orders\nGROUP BY status;"),
 ("Table: products\nColumns: product_id (PK), product_name, category, price, stock_quantity\n\nWrite a SQL query to find categories where the total available stock is less than 100 units. Display the category and total stock.",
  "SELECT category, SUM(stock_quantity) AS total_stock\nFROM products\nGROUP BY category\nHAVING SUM(stock_quantity) < 100;"),
 ("Table: students\nColumns: student_id (PK), student_name, course, marks, attendance\n\nWrite a SQL query to find students who have either scored less than 40 marks or have attendance below 75%. Display the student name, marks, and attendance.",
  "SELECT student_name, marks, attendance\nFROM students\nWHERE marks < 40 OR attendance < 75;"),
 ("Table: students\nColumns: student_id (PK), student_name, class, section, marks, admission_date\n\nWrite a SQL query to find students whose names start with the letter 'A' and display their name, class, and section.",
  "SELECT student_name, class, section\nFROM students\nWHERE student_name LIKE 'A%';"),
 ("Table: students\nColumns: student_id (PK), student_name, class, section, marks, attendance\n\nWrite a SQL query to assign a rank to every student based on their marks, with the highest marks receiving rank 1. Students with the same marks should receive the same rank.",
  "SELECT student_name, class, marks,\n       RANK() OVER (ORDER BY marks DESC) AS marks_rank\nFROM students;"),
 ("Tables:\nstudents - Columns: student_id (PK), student_name, class, section\nmarks - Columns: mark_id (PK), student_id (FK), subject, marks\n\nWrite a SQL query to display each student's name along with their total marks across all subjects.",
  "SELECT s.student_name, SUM(m.marks) AS total_marks\nFROM students s\nJOIN marks m ON s.student_id = m.student_id\nGROUP BY s.student_id, s.student_name;"),
 ("Tables:\nstudents - Columns: student_id (PK), student_name, class, section\nattendance - Columns: attendance_id (PK), student_id (FK), attendance_date, status\n\nWrite a SQL query to find students who were absent on more than 5 days. Display the student ID and number of absent days.",
  "SELECT student_id, COUNT(*) AS absent_days\nFROM attendance\nWHERE status = 'Absent'\nGROUP BY student_id\nHAVING COUNT(*) > 5;"),
 ("Table: appointments\nColumns: appointment_id (PK), patient_id, doctor_id, appointment_date, status\n\nWrite a SQL query to find the number of appointments for each doctor in 2026, considering only completed appointments.",
  "SELECT doctor_id, COUNT(*) AS appointment_count\nFROM appointments\nWHERE status = 'Completed'\n  AND appointment_date >= '2026-01-01'\n  AND appointment_date < '2027-01-01'\nGROUP BY doctor_id;"),
 ("Table: flights\nColumns: flight_id (PK), airline, source, destination, departure_time, arrival_time, status\n\nWrite a SQL query to find the number of flights for each airline, considering only flights with a status of Completed or Delayed.",
  "SELECT airline, COUNT(*) AS flight_count\nFROM flights\nWHERE status IN ('Completed', 'Delayed')\nGROUP BY airline;"),
 ("Table: rentals\nColumns: rental_id (PK), vehicle_id, customer_id, rental_date, return_date, rental_amount, status\n\nWrite a SQL query to find the average rental amount for each vehicle. Display the vehicle_id and average rental amount, sorted from highest to lowest.",
  "SELECT vehicle_id, AVG(rental_amount) AS average_rental_amount\nFROM rentals\nGROUP BY vehicle_id\nORDER BY average_rental_amount DESC;"),
 ("Table: transactions\nColumns: transaction_id (PK), customer_id, transaction_date, amount, status\n\nFor each customer, find the percentage of transactions that were successful.",
  "SELECT customer_id,\n       100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*) AS success_percentage\nFROM transactions\nGROUP BY customer_id;"),
 ("Table: orders\nColumns: order_id (PK), customer_id, order_date, amount\n\nFind customers who placed two or more orders on the same date. Display customer ID, order date, and number of orders.",
  "SELECT customer_id, order_date, COUNT(*) AS order_count\nFROM orders\nGROUP BY customer_id, order_date\nHAVING COUNT(*) >= 2;"),
 ("Table 1: source_orders - Columns: order_id (PK), customer_id, amount, updated_at\nTable 2: destination_orders - Columns: order_id (PK), customer_id, amount, updated_at\n\nFind orders that exist in the source but are missing from the destination.",
  "SELECT s.order_id, s.customer_id, s.amount\nFROM source_orders s\nLEFT JOIN destination_orders d ON s.order_id = d.order_id\nWHERE d.order_id IS NULL;"),
 ("Table: transactions\nColumns: transaction_id (PK), customer_id, transaction_date, amount, status\n\nFind the largest successful transaction for each customer. Display the customer_id and the highest successful transaction amount.",
  "SELECT customer_id, MAX(amount) AS highest_transaction\nFROM transactions\nWHERE status = 'success'\nGROUP BY customer_id;"),
 ("Table: employee_salary_history\nColumns: id (PK), employee_id, salary, effective_date\n\nFind the most recent salary record for each employee. Display employee ID, salary, and effective date.",
  "SELECT employee_id, salary, effective_date\nFROM (\n    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY effective_date DESC) AS rn\n    FROM employee_salary_history e\n) x\nWHERE rn = 1;"),
 ("Table 1: products - Columns: product_id (PK), product_name, category, price\nTable 2: order_items - Columns: order_id, product_id, quantity\n\nFind the top 2 products by total quantity sold in each category.",
  "SELECT category, product_id, product_name, total_quantity\nFROM (\n    SELECT p.category, p.product_id, p.product_name,\n           SUM(oi.quantity) AS total_quantity,\n           DENSE_RANK() OVER (PARTITION BY p.category ORDER BY SUM(oi.quantity) DESC) AS rnk\n    FROM products p\n    JOIN order_items oi ON p.product_id = oi.product_id\n    GROUP BY p.category, p.product_id, p.product_name\n) x\nWHERE rnk <= 2;"),
 ("Table: employees\nColumns: employee_id (PK), employee_name, department, salary, joining_date\n\nFind the departments where the difference between the highest and lowest salary is greater than 30,000. Display the department, highest salary, and lowest salary.",
  "SELECT department, MAX(salary) AS highest_salary, MIN(salary) AS lowest_salary\nFROM employees\nGROUP BY department\nHAVING MAX(salary) - MIN(salary) > 30000;"),
 ("Table 1: customers - Columns: customer_id (PK), customer_name, city\nTable 2: orders - Columns: order_id (PK), customer_id, order_date, amount\n\nFind customers who have placed more than 3 orders. Display customer ID, customer name, and order count.",
  "SELECT c.customer_id, c.customer_name, COUNT(o.order_id) AS order_count\nFROM customers c\nJOIN orders o ON c.customer_id = o.customer_id\nGROUP BY c.customer_id, c.customer_name\nHAVING COUNT(o.order_id) > 3;"),
 ("Table: orders\nColumns: order_id (PK), customer_id, order_date, amount\n\nFind customers who placed an order in January but did not place any order in February.",
  "SELECT DISTINCT customer_id\nFROM orders\nWHERE EXTRACT(MONTH FROM order_date) = 1\n  AND customer_id NOT IN (\n      SELECT customer_id FROM orders WHERE EXTRACT(MONTH FROM order_date) = 2\n  );"),
 ("Table: orders\nColumns: order_id (PK), customer_id, order_date, amount, status\n\nFind the number of unique customers who placed at least one order in each of the statuses completed, cancelled, and pending.",
  "SELECT COUNT(*) AS customer_count\nFROM (\n    SELECT customer_id\n    FROM orders\n    WHERE status IN ('completed', 'cancelled', 'pending')\n    GROUP BY customer_id\n    HAVING COUNT(DISTINCT status) = 3\n) x;"),
 ("Table 1: customers - Columns: customer_id (PK), customer_name, city\nTable 2: orders - Columns: order_id (PK), customer_id, order_date, amount\n\nFind cities where customers have generated more than 100,000 in total orders.",
  "SELECT c.city, SUM(o.amount) AS total_amount\nFROM customers c\nJOIN orders o ON c.customer_id = o.customer_id\nGROUP BY c.city\nHAVING SUM(o.amount) > 100000;"),
]

import json

# JSON is the seeding format: it goes through the admin "Bulk import (JSON)" box
# (or the API), which inserts via parameterized statements — so semicolons and
# quotes inside the SQL/Python answers are handled safely.
questions = []
for prompt, ans in PY:
    questions.append({"category": "python", "prompt": prompt, "referenceAnswer": ans, "marks": 4, "difficulty": "medium"})
for prompt, ans in SQL:
    questions.append({"category": "sql", "prompt": prompt, "referenceAnswer": ans, "marks": 3, "difficulty": "medium"})

path = os.path.join(os.path.dirname(__file__), "seed-questions.json")
open(path, "w").write(json.dumps({"questions": questions}, indent=2))
print(f"Wrote {path}: {len(PY)} python + {len(SQL)} sql questions")
