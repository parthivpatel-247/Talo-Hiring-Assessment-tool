# Talo question bank expansion spec

Talo is a proctored campus-hiring assessment for Hevo Data (a data-pipeline company).
Students write answers (code in ANY language, SQL, pseudocode, or prose) in a text
editor; there is NO code execution. An AI grader marks answers against the admin-only
fields (reference answer, expected output, rubric, checkpoints). Candidates only ever
see `prompt`, `sample_data` and `hint`.

Audience: final-year engineering students in India (B.Tech / MCA). Questions should be
solvable in 8–15 minutes each, written clearly in plain English, and feel like real
work at a data company (orders, events, logs, users, pipelines, payments, inventory),
without needing domain knowledge.

## Style reference
`src/data/question-seed.json` holds the current bank. Match the style and level of
detail of the `qb-dsa-d4xx` and `qb-scn-d3xx` items exactly. Read several before writing.
`question-bank/expansion/existing-titles.tsv` lists every existing question. Do NOT write
a question that is the same problem as an existing one (same task, even if renamed or
re-skinned with a different story), and no duplicates within your own list.

## Output (one JSON array, UTF-8) — every object has exactly these keys
| key | rules |
|---|---|
| `id` | the id prefix and number range given in your task |
| `category` | given in your task: `sql`, `coding`, `dsa` or `scenario` |
| `difficulty` | `easy`, `medium` or `hard`, in the mix given in your task |
| `marks` | given in your task |
| `title` | short, specific, Title Case |
| `topic` | 1–3 topics joined by ` · ` e.g. `"Joins · Aggregation"` |
| `prompt` | markdown, exactly: `## <title>` newline `> <topic> · <Easy|Medium|Hard>` blank line, problem paragraphs (`backticks` for identifiers/values, **bold** sparingly), optional `### Input` / `### Output`, then `### Constraints` (for SQL: `### Notes`) with `- ` bullets. No examples in the prompt. |
| `sample_data` | the examples. Shape: `**Example 1**` newline `Input: ...` newline `Output: ...` newline `Explanation: ...` (blank line between examples), 2–3 examples, every example has Input AND Output. FOR SQL: show each table as a markdown table under a bold heading, e.g. `**Table: orders**` newline then `| order_id | customer_id | amount |` header, `|---|---|---|` separator and rows; then `**Expected result**` with a markdown table. Keep tables small (4–10 rows) but rich enough to exercise the edge cases (NULLs, ties, duplicates, customers with no orders...). |
| `expected_output` | `Example 1 → <value>` per example (for SQL: the result rows in order, as `col=value` lists or a compact table), plus 2 lines `Hidden test N → <input or variation> = <value>  (<why it matters>)` covering edge cases |
| `reference_answer` | approach in 1–3 sentences with complexity, then a clean reference solution (SQL for sql questions — standard SQL that also runs on SQLite/PostgreSQL; Python is fine otherwise, admin-only). Mention acceptable alternatives (e.g. window function vs subquery). |
| `hint` | 1–2 sentences that nudge without giving the solution |
| `rubric` | 3–5 `- ` bullets of what a full-credit answer must do, including what earns partial credit |
| `checkpoints` | 4–6 lines (newline-separated, no bullets) — itemised marking checkpoints |
| `source` | `"bank v3 (Oct 2026)"` |

## Language-neutral wording (non-SQL questions)
- Never say "Python", "list", "dict", "def", "print()" in `prompt`, `sample_data`, `hint`.
  Say "array", "map/dictionary", "function", "return".
- Booleans `true` / `false`; missing value `null`; arrays `[1, 2, 3]`; strings in double quotes.
- Function names in camelCase, e.g. `firstRepeated(arr)`.

## Verification (mandatory)
Write ONE Python 3 script (path given in your task) that defines every question and,
for each, runs the reference solution against EVERY example and hidden test and
asserts the displayed outputs are exactly right:
- SQL: create the example tables in `sqlite3` (in-memory), run the reference query,
  and compare to the displayed expected result (order matters when the question asks
  for an order). Hidden tests: modified tables. The reference query must run on SQLite.
- Others: a Python reference implementation; normalise True/False/None to true/false/null.
- Debugging (scenario): implement BOTH the buggy behaviour (assert the stated "Actual
  output") and the fixed behaviour (assert "Expected output").
The script writes the JSON only if every assertion passes, and prints a summary. Run it
until it passes. Also assert every object has exactly the keys above and ids are unique.

## Final message (your reply)
1. Number of questions written, ids and titles (one line each).
2. Confirmation that the verify script passed (paste its summary line).
Keep the reply short.
