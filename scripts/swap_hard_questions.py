#!/usr/bin/env python3
"""Remove the 3 hardest (window-function) SQL questions and replace them with
fresher-friendly ones. Keeps the bank at 30 SQL + 15 Python. Also emits:
  - new-questions-import.json : ALL new questions since the original seed
      (the earlier 6 + these 3 replacements = 9) — for a fresh import.
  - replacements-import.json  : ONLY the 3 replacements — if the earlier 6
      were already imported.
"""
import json, collections

SEED = "scripts/seed-questions.json"

# The 3 hard questions to remove — matched by a unique phrase in each prompt.
REMOVE_MARKERS = [
    "assign a rank to every student based on their marks",          # RANK()
    "most recent salary record for each employee",                   # ROW_NUMBER()
    "top 2 products by total quantity sold in each category",        # DENSE_RANK()
]

REPLACEMENTS = [
    {
        "category": "sql",
        "prompt": "Tables:\ncustomers - Columns: customer_id (PK), customer_name, city\norders - Columns: order_id (PK), customer_id (FK), order_date, amount\n\nWrite a SQL query to show how many orders each customer has placed, INCLUDING customers who have placed no orders (they should show a count of 0). Display customer_id, customer_name and order_count.",
        "referenceAnswer": "SELECT c.customer_id, c.customer_name, COUNT(o.order_id) AS order_count\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nGROUP BY c.customer_id, c.customer_name;",
        "marks": 3,
        "difficulty": "medium",
    },
    {
        "category": "sql",
        "prompt": "Table: products\nColumns: product_id (PK), product_name, category, price\n\nWrite a SQL query to list all the distinct product categories, sorted alphabetically.",
        "referenceAnswer": "SELECT DISTINCT category\nFROM products\nORDER BY category;",
        "marks": 3,
        "difficulty": "easy",
    },
    {
        "category": "sql",
        "prompt": "Table: orders\nColumns: order_id (PK), customer_id, order_date, amount\n\nWrite a SQL query to find the top 3 customers by their total order amount. Display customer_id and total amount, highest first.",
        "referenceAnswer": "SELECT customer_id, SUM(amount) AS total_amount\nFROM orders\nGROUP BY customer_id\nORDER BY total_amount DESC\nLIMIT 3;",
        "marks": 3,
        "difficulty": "medium",
    },
]

data = json.load(open(SEED))
qs = data["questions"]

def is_hard(q):
    p = q["prompt"].lower()
    return any(m in p for m in REMOVE_MARKERS)

removed = [q for q in qs if is_hard(q)]
kept = [q for q in qs if not is_hard(q)]
print("removing:", [q["prompt"][:55].replace(chr(10), " ") for q in removed])
assert len(removed) == 3, f"expected to remove 3, removed {len(removed)}"

# Guard against duplicate replacements.
def norm(p): return " ".join(p.lower().split())
seen = {norm(q["prompt"]) for q in kept}
new_reps = [q for q in REPLACEMENTS if norm(q["prompt"]) not in seen]
assert len(new_reps) == 3, "a replacement duplicates an existing question"

data["questions"] = kept + new_reps
json.dump(data, open(SEED, "w"), indent=2, ensure_ascii=False)

# Build import files.
# The earlier 6 additions live in the existing new-questions-import.json.
prev_new = json.load(open("scripts/new-questions-import.json"))["questions"]
# drop any of those that happen to be a removed hard one (none are, but be safe)
prev_new = [q for q in prev_new if not is_hard(q)]
combined = prev_new + new_reps
json.dump({"questions": combined}, open("scripts/new-questions-import.json", "w"), indent=2, ensure_ascii=False)
json.dump({"questions": new_reps}, open("scripts/replacements-import.json", "w"), indent=2, ensure_ascii=False)

c = collections.Counter(q["category"] for q in data["questions"])
print("seed totals:", dict(c), "| grand total:", len(data["questions"]))
print("new-questions-import.json:", len(combined), "questions (6 earlier + 3 replacements)")
print("replacements-import.json:", len(new_reps), "questions")
