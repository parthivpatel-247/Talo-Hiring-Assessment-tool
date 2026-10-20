#!/usr/bin/env python3
"""Append 6 new, non-duplicating questions (5 SQL + 1 Python) to the canonical
seed and also emit an import-only file (just the new ones) for the admin Bulk
Import box, so the live DB never gets duplicates."""
import json, collections

SEED = "scripts/seed-questions.json"
NEW = [
    # ---- SQL x5 (fresher-friendly, distinct from existing patterns) ----
    {
        "category": "sql",
        "prompt": "Table: products\nColumns: product_id (PK), product_name, category, price\n\nWrite a SQL query to list the 5 cheapest products. Display product_name and price, with the lowest price first.",
        "referenceAnswer": "SELECT product_name, price\nFROM products\nORDER BY price ASC\nLIMIT 5;",
        "marks": 3,
        "difficulty": "easy",
    },
    {
        "category": "sql",
        "prompt": "Table: employees\nColumns: employee_id (PK), employee_name, department, salary\n\nWrite a SQL query to find the second highest salary in the table. (If several employees share the highest salary, the answer is still the next distinct salary below it.)",
        "referenceAnswer": "SELECT MAX(salary) AS second_highest_salary\nFROM employees\nWHERE salary < (SELECT MAX(salary) FROM employees);",
        "marks": 3,
        "difficulty": "medium",
    },
    {
        "category": "sql",
        "prompt": "Tables:\ncustomers - Columns: customer_id (PK), customer_name, city\norders - Columns: order_id (PK), customer_id (FK), order_date, amount\n\nWrite a SQL query to list every order above 5000 along with the name of the customer who placed it. Display order_id, customer_name and amount, newest orders first.",
        "referenceAnswer": "SELECT o.order_id, c.customer_name, o.amount\nFROM orders o\nJOIN customers c ON c.customer_id = o.customer_id\nWHERE o.amount > 5000\nORDER BY o.order_date DESC;",
        "marks": 3,
        "difficulty": "medium",
    },
    {
        "category": "sql",
        "prompt": "Table: payments\nColumns: payment_id (PK), customer_id, payment_date, amount, status\n\nWrite a SQL query to find the total amount of successful payments collected in the first quarter of 2026 (1 January 2026 to 31 March 2026, inclusive).",
        "referenceAnswer": "SELECT SUM(amount) AS total_amount\nFROM payments\nWHERE status = 'success'\n  AND payment_date BETWEEN '2026-01-01' AND '2026-03-31';",
        "marks": 3,
        "difficulty": "medium",
    },
    {
        "category": "sql",
        "prompt": "Table: products\nColumns: product_id (PK), product_name, price\n\nWrite a SQL query that shows each product with a price_category label: 'Low' when price is below 500, 'Medium' when price is between 500 and 2000 (inclusive), and 'High' when price is above 2000. Display product_name, price and price_category.",
        "referenceAnswer": "SELECT product_name, price,\n       CASE\n         WHEN price < 500 THEN 'Low'\n         WHEN price <= 2000 THEN 'Medium'\n         ELSE 'High'\n       END AS price_category\nFROM products;",
        "marks": 3,
        "difficulty": "medium",
    },
    # ---- Python x1 (group-and-sum into a dict — distinct shape from existing) ----
    {
        "category": "python",
        "prompt": "Given a list of sales records, write a Python function that returns the total amount for each category as a dictionary.\n\nInput:\nsales = [\n    {\"category\": \"A\", \"amount\": 100},\n    {\"category\": \"B\", \"amount\": 50},\n    {\"category\": \"A\", \"amount\": 25},\n    {\"category\": \"C\", \"amount\": 75},\n    {\"category\": \"B\", \"amount\": 20}\n]\n\nExpected output:\n{\"A\": 125, \"B\": 70, \"C\": 75}",
        "referenceAnswer": "def totals_by_category(sales):\n    result = {}\n    for record in sales:\n        category = record[\"category\"]\n        result[category] = result.get(category, 0) + record[\"amount\"]\n    return result\n\nprint(totals_by_category(sales))",
        "marks": 4,
        "difficulty": "medium",
    },
]

data = json.load(open(SEED))
existing = data["questions"]

# Guard against duplicates: compare normalized prompt text.
def norm(p): return " ".join(p.lower().split())
seen = {norm(q["prompt"]) for q in existing}
to_add = [q for q in NEW if norm(q["prompt"]) not in seen]
skipped = [q for q in NEW if norm(q["prompt"]) in seen]
if skipped:
    print("SKIPPED as duplicate:", [q["prompt"][:40] for q in skipped])

data["questions"] = existing + to_add
json.dump(data, open(SEED, "w"), indent=2, ensure_ascii=False)

# Import-only file (just the new ones) for the admin Bulk Import box.
json.dump({"questions": to_add}, open("scripts/new-questions-import.json", "w"), indent=2, ensure_ascii=False)

c = collections.Counter(q["category"] for q in data["questions"])
print("added:", len(to_add))
print("new totals:", dict(c), "| grand total:", len(data["questions"]))
