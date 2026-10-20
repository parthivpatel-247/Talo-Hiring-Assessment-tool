UPDATE question_bank SET expected_output='[1, 2, 3, 4]' WHERE id='qseed001';
UPDATE question_bank SET expected_output='[101, 102]' WHERE id='qseed002';
UPDATE question_bank SET expected_output='250' WHERE id='qseed003';
UPDATE question_bank SET expected_output='2' WHERE id='qseed004';
UPDATE question_bank SET expected_output='[3, 4, 5]' WHERE id='qseed005';
UPDATE question_bank SET expected_output='{''id'': 102, ''amount'': 1200}' WHERE id='qseed006';
UPDATE question_bank SET expected_output='[''gmail.com'', ''yahoo.com'', ''gmail.com'']' WHERE id='qseed007';
UPDATE question_bank SET expected_output='[102, 104]' WHERE id='qseed008';
UPDATE question_bank SET expected_output='[''level'', ''madam'', ''racecar'']' WHERE id='qseed009';
UPDATE question_bank SET expected_output='[1, 3, 5]' WHERE id='qseed010';
UPDATE question_bank SET expected_output='elephant' WHERE id='qseed011';
UPDATE question_bank SET expected_output='Positive: [10, 3, 8]
Negative: [-5, -2, -7]' WHERE id='qseed012';
UPDATE question_bank SET expected_output='6' WHERE id='qseed013';
UPDATE question_bank SET expected_output='[''2026-01-15'', ''2026-05-10'']' WHERE id='qseed014';
UPDATE question_bank SET sample_data='Table: orders

| order_id | customer_id | order_date | amount | status |
| --- | --- | --- | --- | --- |
| 1 | 101 | 2026-01-05 | 6000 | completed |
| 2 | 101 | 2026-01-08 | 7000 | completed |
| 3 | 102 | 2026-01-06 | 4000 | completed |
| 4 | 102 | 2026-02-01 | 3000 | completed |
| 5 | 103 | 2026-01-10 | 20000 | completed |
| 6 | 103 | 2026-01-11 | 5000 | cancelled |
| 7 | 104 | 2026-01-12 | 15000 | pending |', expected_output='| customer_id | total_amount |
| --- | --- |
| 101 | 13000 |
| 103 | 20000 |' WHERE id='qseed015';
UPDATE question_bank SET sample_data='Table: students

| student_id | student_name | age | course | marks |
| --- | --- | --- | --- | --- |
| 1 | Aarav | 20 | CS | 92 |
| 2 | Bhavna | 21 | Math | 78 |
| 3 | Chirag | 20 | CS | 85 |
| 4 | Divya | 22 | Physics | 88 |
| 5 | Esha | 21 | CS | 80 |', expected_output='| student_name | marks |
| --- | --- |
| Aarav | 92 |
| Divya | 88 |
| Chirag | 85 |' WHERE id='qseed016';
UPDATE question_bank SET sample_data='Table: employees

| employee_id | employee_name | department | salary |
| --- | --- | --- | --- |
| 1 | Alice | Eng | 95000 |
| 2 | Bob | Eng | 85000 |
| 3 | Carol | Sales | 50000 |
| 4 | Dan | Sales | 40000 |
| 5 | Eve | Sales | 30000 |', expected_output='| employee_id | employee_name | salary |
| --- | --- | --- |
| 1 | Alice | 95000 |
| 2 | Bob | 85000 |' WHERE id='qseed017';
UPDATE question_bank SET sample_data='Table: customers

| customer_id | customer_name | city |
| --- | --- | --- |
| 1 | Alice | NY |
| 2 | Bob | LA |
| 3 | Carol | SF |

Table: orders

| order_id | customer_id | order_date | amount |
| --- | --- | --- | --- |
| 101 | 1 | 2026-01-01 | 500 |
| 102 | 1 | 2026-01-02 | 300 |', expected_output='| customer_id | customer_name |
| --- | --- |
| 2 | Bob |
| 3 | Carol |' WHERE id='qseed018';
UPDATE question_bank SET sample_data='Table: orders

| order_id | customer_id | order_date | amount | status |
| --- | --- | --- | --- | --- |
| 1 | 101 | 2026-01-01 | 500 | completed |
| 2 | 102 | 2026-01-02 | 300 | completed |
| 3 | 103 | 2026-01-03 | 200 | pending |
| 4 | 104 | 2026-01-04 | 400 | cancelled |
| 5 | 105 | 2026-01-05 | 600 | pending |', expected_output='| status | order_count | total_amount |
| --- | --- | --- |
| cancelled | 1 | 400 |
| completed | 2 | 800 |
| pending | 2 | 800 |' WHERE id='qseed019';
UPDATE question_bank SET sample_data='Table: products

| product_id | product_name | category | price | stock_quantity |
| --- | --- | --- | --- | --- |
| 1 | Pen | Stationery | 10 | 30 |
| 2 | Pencil | Stationery | 5 | 40 |
| 3 | Laptop | Electronics | 50000 | 60 |
| 4 | Mouse | Electronics | 500 | 80 |
| 5 | Notebook | Stationery | 20 | 20 |', expected_output='| category | total_stock |
| --- | --- |
| Stationery | 90 |' WHERE id='qseed020';
UPDATE question_bank SET sample_data='Table: students

| student_id | student_name | course | marks | attendance |
| --- | --- | --- | --- | --- |
| 1 | Alice | CS | 35 | 90 |
| 2 | Bob | CS | 85 | 70 |
| 3 | Carol | Math | 90 | 95 |
| 4 | Dave | Physics | 38 | 60 |', expected_output='| student_name | marks | attendance |
| --- | --- | --- |
| Alice | 35 | 90 |
| Bob | 85 | 70 |
| Dave | 38 | 60 |' WHERE id='qseed021';
UPDATE question_bank SET sample_data='Table: students

| student_id | student_name | class | section | marks | admission_date |
| --- | --- | --- | --- | --- | --- |
| 1 | Aarav | 10 | A | 88 | 2025-06-01 |
| 2 | Bhavna | 10 | B | 75 | 2025-06-02 |
| 3 | Ananya | 9 | A | 80 | 2025-06-03 |
| 4 | Rahul | 9 | C | 70 | 2025-06-04 |', expected_output='| student_name | class | section |
| --- | --- | --- |
| Aarav | 10 | A |
| Ananya | 9 | A |' WHERE id='qseed022';
UPDATE question_bank SET sample_data='Table: students

| student_id | student_name | class | section | marks | attendance |
| --- | --- | --- | --- | --- | --- |
| 1 | Alice | 10 | A | 90 | 88 |
| 2 | Bob | 10 | B | 85 | 80 |
| 3 | Carol | 9 | A | 90 | 95 |
| 4 | Dave | 9 | B | 70 | 60 |', expected_output='| student_name | class | marks | marks_rank |
| --- | --- | --- | --- |
| Alice | 10 | 90 | 1 |
| Carol | 9 | 90 | 1 |
| Bob | 10 | 85 | 3 |
| Dave | 9 | 70 | 4 |' WHERE id='qseed023';
UPDATE question_bank SET sample_data='Table: students

| student_id | student_name | class | section |
| --- | --- | --- | --- |
| 1 | Alice | 10 | A |
| 2 | Bob | 10 | B |

Table: marks

| mark_id | student_id | subject | marks |
| --- | --- | --- | --- |
| 1 | 1 | Math | 80 |
| 2 | 1 | Science | 90 |
| 3 | 2 | Math | 70 |
| 4 | 2 | Science | 60 |', expected_output='| student_name | total_marks |
| --- | --- |
| Alice | 170 |
| Bob | 130 |' WHERE id='qseed024';
UPDATE question_bank SET sample_data='Table: students

| student_id | student_name | class | section |
| --- | --- | --- | --- |
| 1 | Alice | 10 | A |
| 2 | Bob | 10 | B |

Table: attendance

| attendance_id | student_id | attendance_date | status |
| --- | --- | --- | --- |
| 1 | 1 | 2026-01-01 | Absent |
| 2 | 1 | 2026-01-02 | Absent |
| 3 | 1 | 2026-01-03 | Absent |
| 4 | 1 | 2026-01-04 | Absent |
| 5 | 1 | 2026-01-05 | Absent |
| 6 | 1 | 2026-01-06 | Absent |
| 7 | 1 | 2026-01-07 | Present |
| 8 | 2 | 2026-01-01 | Absent |
| 9 | 2 | 2026-01-02 | Absent |', expected_output='| student_id | absent_days |
| --- | --- |
| 1 | 6 |' WHERE id='qseed025';
UPDATE question_bank SET sample_data='Table: appointments

| appointment_id | patient_id | doctor_id | appointment_date | status |
| --- | --- | --- | --- | --- |
| 1 | 201 | 10 | 2026-02-01 | Completed |
| 2 | 202 | 10 | 2026-03-01 | Completed |
| 3 | 203 | 10 | 2025-12-01 | Completed |
| 4 | 204 | 11 | 2026-04-01 | Completed |
| 5 | 205 | 11 | 2026-05-01 | Cancelled |', expected_output='| doctor_id | appointment_count |
| --- | --- |
| 10 | 2 |
| 11 | 1 |' WHERE id='qseed026';
UPDATE question_bank SET sample_data='Table: flights

| flight_id | airline | source | destination | departure_time | arrival_time | status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | IndiGo | DEL | BOM | 08:00 | 10:00 | Completed |
| 2 | IndiGo | BOM | DEL | 12:00 | 14:00 | Delayed |
| 3 | IndiGo | DEL | GOI | 15:00 | 17:00 | Cancelled |
| 4 | AirIndia | DEL | MAA | 09:00 | 11:30 | Completed |', expected_output='| airline | flight_count |
| --- | --- |
| AirIndia | 1 |
| IndiGo | 2 |' WHERE id='qseed027';
UPDATE question_bank SET sample_data='Table: rentals

| rental_id | vehicle_id | customer_id | rental_date | return_date | rental_amount | status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | V1 | 301 | 2026-01-01 | 2026-01-03 | 1000 | returned |
| 2 | V1 | 302 | 2026-02-01 | 2026-02-02 | 2000 | returned |
| 3 | V2 | 303 | 2026-01-05 | 2026-01-06 | 3000 | returned |', expected_output='| vehicle_id | average_rental_amount |
| --- | --- |
| V2 | 3000 |
| V1 | 1500 |' WHERE id='qseed028';
UPDATE question_bank SET sample_data='Table: transactions

| transaction_id | customer_id | transaction_date | amount | status |
| --- | --- | --- | --- | --- |
| 1 | 101 | 2026-01-01 | 500 | success |
| 2 | 101 | 2026-01-02 | 300 | failed |
| 3 | 102 | 2026-01-03 | 200 | success |
| 4 | 102 | 2026-01-04 | 400 | success |', expected_output='| customer_id | success_percentage |
| --- | --- |
| 101 | 50 |
| 102 | 100 |' WHERE id='qseed029';
UPDATE question_bank SET sample_data='Table: orders

| order_id | customer_id | order_date | amount |
| --- | --- | --- | --- |
| 1 | 101 | 2026-01-01 | 100 |
| 2 | 101 | 2026-01-01 | 200 |
| 3 | 102 | 2026-01-02 | 300 |
| 4 | 101 | 2026-01-03 | 150 |', expected_output='| customer_id | order_date | order_count |
| --- | --- | --- |
| 101 | 2026-01-01 | 2 |' WHERE id='qseed030';
UPDATE question_bank SET sample_data='Table: source_orders

| order_id | customer_id | amount | updated_at |
| --- | --- | --- | --- |
| 1 | 101 | 500 | 2026-01-01 |
| 2 | 102 | 300 | 2026-01-02 |
| 3 | 103 | 200 | 2026-01-03 |

Table: destination_orders

| order_id | customer_id | amount | updated_at |
| --- | --- | --- | --- |
| 1 | 101 | 500 | 2026-01-01 |', expected_output='| order_id | customer_id | amount |
| --- | --- | --- |
| 2 | 102 | 300 |
| 3 | 103 | 200 |' WHERE id='qseed031';
UPDATE question_bank SET sample_data='Table: transactions

| transaction_id | customer_id | transaction_date | amount | status |
| --- | --- | --- | --- | --- |
| 1 | 101 | 2026-01-01 | 500 | success |
| 2 | 101 | 2026-01-02 | 1500 | success |
| 3 | 101 | 2026-01-03 | 3000 | failed |
| 4 | 102 | 2026-01-04 | 800 | success |', expected_output='| customer_id | highest_transaction |
| --- | --- |
| 101 | 1500 |
| 102 | 800 |' WHERE id='qseed032';
UPDATE question_bank SET sample_data='Table: employee_salary_history

| id | employee_id | salary | effective_date |
| --- | --- | --- | --- |
| 1 | 10 | 50000 | 2024-01-01 |
| 2 | 10 | 60000 | 2025-01-01 |
| 3 | 10 | 70000 | 2026-01-01 |
| 4 | 11 | 40000 | 2025-06-01 |
| 5 | 11 | 45000 | 2026-06-01 |', expected_output='| employee_id | salary | effective_date |
| --- | --- | --- |
| 10 | 70000 | 2026-01-01 |
| 11 | 45000 | 2026-06-01 |' WHERE id='qseed033';
UPDATE question_bank SET sample_data='Table: products

| product_id | product_name | category | price |
| --- | --- | --- | --- |
| 1 | Pen | Stationery | 10 |
| 2 | Pencil | Stationery | 5 |
| 3 | Eraser | Stationery | 3 |
| 4 | Laptop | Electronics | 50000 |
| 5 | Mouse | Electronics | 500 |

Table: order_items

| order_id | product_id | quantity |
| --- | --- | --- |
| 1 | 1 | 50 |
| 2 | 2 | 30 |
| 3 | 3 | 10 |
| 4 | 4 | 20 |
| 5 | 5 | 25 |', expected_output='| category | product_id | product_name | total_quantity |
| --- | --- | --- | --- |
| Electronics | 5 | Mouse | 25 |
| Electronics | 4 | Laptop | 20 |
| Stationery | 1 | Pen | 50 |
| Stationery | 2 | Pencil | 30 |' WHERE id='qseed034';
UPDATE question_bank SET sample_data='Table: employees

| employee_id | employee_name | department | salary | joining_date |
| --- | --- | --- | --- | --- |
| 1 | A | Eng | 100000 | 2024-01-01 |
| 2 | B | Eng | 60000 | 2024-02-01 |
| 3 | C | HR | 50000 | 2024-03-01 |
| 4 | D | HR | 45000 | 2024-04-01 |', expected_output='| department | highest_salary | lowest_salary |
| --- | --- | --- |
| Eng | 100000 | 60000 |' WHERE id='qseed035';
UPDATE question_bank SET sample_data='Table: customers

| customer_id | customer_name | city |
| --- | --- | --- |
| 1 | Alice | NY |
| 2 | Bob | LA |

Table: orders

| order_id | customer_id | order_date | amount |
| --- | --- | --- | --- |
| 1 | 1 | 2026-01-01 | 100 |
| 2 | 1 | 2026-01-02 | 100 |
| 3 | 1 | 2026-01-03 | 100 |
| 4 | 1 | 2026-01-04 | 100 |
| 5 | 2 | 2026-01-01 | 100 |
| 6 | 2 | 2026-01-02 | 100 |', expected_output='| customer_id | customer_name | order_count |
| --- | --- | --- |
| 1 | Alice | 4 |' WHERE id='qseed036';
UPDATE question_bank SET sample_data='Table: orders

| order_id | customer_id | order_date | amount |
| --- | --- | --- | --- |
| 1 | 101 | 2026-01-05 | 100 |
| 2 | 101 | 2026-02-10 | 200 |
| 3 | 102 | 2026-01-06 | 300 |
| 4 | 103 | 2026-01-07 | 150 |
| 5 | 103 | 2026-03-01 | 150 |', expected_output='| customer_id |
| --- |
| 102 |
| 103 |' WHERE id='qseed037';
UPDATE question_bank SET sample_data='Table: orders

| order_id | customer_id | order_date | amount | status |
| --- | --- | --- | --- | --- |
| 1 | 101 | 2026-01-01 | 100 | completed |
| 2 | 101 | 2026-01-02 | 100 | cancelled |
| 3 | 101 | 2026-01-03 | 100 | pending |
| 4 | 102 | 2026-01-01 | 100 | completed |
| 5 | 102 | 2026-01-02 | 100 | pending |', expected_output='| customer_count |
| --- |
| 1 |' WHERE id='qseed038';
UPDATE question_bank SET sample_data='Table: customers

| customer_id | customer_name | city |
| --- | --- | --- |
| 1 | A | Mumbai |
| 2 | B | Mumbai |
| 3 | C | Delhi |

Table: orders

| order_id | customer_id | order_date | amount |
| --- | --- | --- | --- |
| 1 | 1 | 2026-01-01 | 60000 |
| 2 | 2 | 2026-01-02 | 50000 |
| 3 | 3 | 2026-01-03 | 40000 |', expected_output='| city | total_amount |
| --- | --- |
| Mumbai | 110000 |' WHERE id='qseed039';
