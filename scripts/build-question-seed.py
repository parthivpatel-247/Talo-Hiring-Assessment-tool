#!/usr/bin/env python3
"""Build src/data/question-seed.json: the reviewed DSA + Scenario bank that ships with Talo.

Sources (all verified by their own build scripts):
  question-bank/docx-import/existing-bank-reference.json  24 DSA/scenario questions (bank v2, Oct 2026)
  question-bank/docx-import/part_{a,b,c,d}.json           49 questions imported from "DSA Scenario sheet 1.docx"
  loadtest/questions-seed.sql                             the 10 original SQL and Python questions (v1 bank)
  question-bank/expansion/part_{sql,coding,scenario,dsa}.json  95 questions (bank v3, Oct 2026)

The Worker inserts these with INSERT OR IGNORE on upgrade, so questions already in a
database (and any admin edits to them) are never overwritten.
"""
import json, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
d = root / "question-bank" / "docx-import"
out = []
def tt(prompt):
    title = topic = None
    for l in prompt.split("\n"):
        l = l.strip()
        if title is None and l.startswith("## "): title = l[3:].strip()
        if topic is None and l.startswith("> "):
            topic = re.sub(r"\s*·\s*(Easy|Medium|Hard)\s*$", "", l[2:].strip(), flags=re.I)
    return title, topic
for q in json.load(open(d / "existing-bank-reference.json")):
    t, p = tt(q["prompt"])
    out.append({**q, "title": t, "topic": p, "source": "bank v2 (Oct 2026)"})
for part in "abcd":
    out.extend(json.load(open(d / f"part_{part}.json")))

# The original v1 SQL and Python questions keep their ids, so INSERT OR IGNORE leaves
# the production copies (and any admin edits) untouched.
import sqlite3
V1_TITLES = {
    "qb-sql-01": ("Total Spent per Customer", "Aggregation · Sorting"),
    "qb-sql-02": ("Second-Highest Salary", "Subqueries · DISTINCT"),
    "qb-sql-03": ("Customers With No Orders", "Joins · Anti-join"),
    "qb-sql-04": ("Top 3 Products by Revenue", "Joins · Aggregation · LIMIT"),
    "qb-sql-05": ("Flag Duplicate Emails", "GROUP BY · HAVING"),
    "qb-sql-06": ("Signups per Month", "Dates · Aggregation"),
    "qb-py-01": ("Most Frequent Word", "Strings · Hash maps"),
    "qb-py-02": ("Merge Two Sorted ID Lists", "Arrays · Two pointers"),
    "qb-py-03": ("Count Log Levels", "Strings · Counting"),
    "qb-py-04": ("Remove Consecutive Duplicate Messages", "Arrays · Iteration"),
}
con = sqlite3.connect(":memory:")
con.execute("CREATE TABLE question_bank (id TEXT PRIMARY KEY, category TEXT, prompt TEXT, reference_answer TEXT, sample_data TEXT, rubric TEXT, marks INTEGER, difficulty TEXT, status TEXT, active INTEGER, expected_output TEXT, created_at TEXT)")
con.executescript((root / "loadtest" / "questions-seed.sql").read_text())
for r in con.execute("SELECT id, category, difficulty, marks, prompt, sample_data, expected_output, reference_answer, hint, rubric FROM question_bank WHERE category IN ('sql','python') ORDER BY id"):
    qid, cat, diff, marks, prompt, sample, exp, ref, hint, rubric = r
    title, topic = V1_TITLES[qid]
    if cat == "python":  # coding questions are answered in any language
        neutral = lambda t: t and (t.replace(" (or collections.Counter)", "").replace("a dict mapping", "a map from").replace("a dict {", "a map {")
                                    .replace("Count with a dict", "Count with a map").replace("frequency dict", "frequency map").replace("a dict", "a map"))
        prompt, hint, sample = neutral(prompt), neutral(hint), neutral(sample)
    out.append({"id": qid, "category": "coding" if cat == "python" else cat, "difficulty": diff or "medium", "marks": marks,
                "title": title, "topic": topic, "prompt": prompt, "sample_data": sample, "expected_output": exp,
                "reference_answer": ref, "hint": hint, "rubric": rubric, "checkpoints": None, "source": "bank v1"})

for part in ("sql", "coding", "scenario", "dsa"):
    out.extend(json.load(open(root / "question-bank" / "expansion" / f"part_{part}.json")))
keys = ["id","category","difficulty","marks","title","topic","prompt","sample_data","expected_output","reference_answer","hint","rubric","checkpoints","source"]
clean = [{k: q.get(k) for k in keys} for q in out]
ids = [q["id"] for q in clean]
assert len(ids) == len(set(ids)), "duplicate ids"
assert all(q["category"] in ("sql","coding","dsa","scenario") for q in clean)
assert all(q["difficulty"] in ("easy","medium","hard") for q in clean)
(root / "src" / "data" / "question-seed.json").write_text(json.dumps(clean, ensure_ascii=False, indent=1))
from collections import Counter
print(f"wrote {len(clean)} questions:", dict(Counter(q["category"] for q in clean)))
