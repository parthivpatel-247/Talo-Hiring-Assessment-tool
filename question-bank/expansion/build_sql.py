#!/usr/bin/env python3
"""Build and verify 30 new SQL questions (qb-sql-n01 .. qb-sql-n30).

Every example table and every hidden-test variation is loaded into an in-memory
SQLite database, the reference query is executed, and the result (column names,
values and row order) must match the displayed expected result exactly.
The JSON is written only if every assertion passes.
"""
import json
import os
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "part_sql.json")
SOURCE = "bank v3 (Oct 2026)"
KEYS = ["id", "category", "difficulty", "marks", "title", "topic", "prompt",
        "sample_data", "expected_output", "reference_answer", "hint", "rubric",
        "checkpoints", "source"]

DIALECT_NOTE = "Write standard SQL; any dialect (MySQL, PostgreSQL, SQLite…) is fine."
DATE_NOTE = ("Dates and timestamps are stored as ISO text (`YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`). "
             "Use whatever date functions your dialect has (`substr`/`strftime` in SQLite, "
             "`DATE_TRUNC`/`TO_CHAR` in PostgreSQL, `DATE_FORMAT` in MySQL); any SQL dialect is fine.")

QUESTIONS = []


def Q(**kw):
    QUESTIONS.append(kw)


# ---------------------------------------------------------------- formatting
def fmt(v):
    if v is None:
        return "NULL"
    if isinstance(v, float):
        return f"{v:.2f}"
    return str(v)


def md_table(cols, rows):
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in rows:
        out.append("| " + " | ".join(fmt(v) for v in r) + " |")
    if not rows:
        out.append("")
        out.append("_(no rows)_")
    return "\n".join(out)


def compact(cols, rows):
    if not rows:
        return "no rows"
    return "; ".join("(" + ", ".join(f"{c}={fmt(v)}" for c, v in zip(cols, r)) + ")" for r in rows)


# ---------------------------------------------------------------- execution
def load(tables):
    con = sqlite3.connect(":memory:")
    for name, (cols, rows) in tables.items():
        con.execute(f"CREATE TABLE {name} ({', '.join(cols)})")
        con.executemany(f"INSERT INTO {name} VALUES ({', '.join('?' * len(cols))})", rows)
    return con


def same(expected, actual):
    if expected is None or actual is None:
        return expected is None and actual is None
    if isinstance(expected, float):
        return isinstance(actual, (int, float)) and abs(expected - actual) < 1e-9
    if isinstance(expected, int):
        return isinstance(actual, int) and not isinstance(actual, bool) and expected == actual
    return expected == actual


def run_check(qid, label, con, sql, cols, rows):
    cur = con.execute(sql)
    got_cols = [d[0] for d in cur.description]
    got = cur.fetchall()
    assert got_cols == cols, f"{qid} {label}: columns {got_cols} != {cols}"
    assert len(got) == len(rows), f"{qid} {label}: {len(got)} rows {got} != {len(rows)} rows {rows}"
    for i, (e, a) in enumerate(zip(rows, got)):
        assert len(e) == len(a) and all(same(x, y) for x, y in zip(e, a)), \
            f"{qid} {label} row {i}: got {a}, expected {e}"


# ================================================================ QUESTIONS
# ---------------------------------------------------------------- EASY (9)
Q(id="qb-sql-n01", difficulty="easy", title="Failed Runs in a Date Window",
  topic="Filtering · Sorting",
  body="The on-call engineer wants every **failed** pipeline run that started during the week of 2 March 2026 to 8 March 2026 (both days included, the whole of each day).\n\nWrite a query that returns these runs with the newest run first.",
  schema=["`pipeline_runs(run_id INT, pipeline_id INT, status TEXT, started_at TEXT, rows_loaded INT)` — `status` is one of `'success'`, `'failed'`, `'running'`; `started_at` is a timestamp like `2026-03-05 14:00:00`."],
  columns=["run_id", "pipeline_id", "started_at"],
  order="Order by `started_at` descending (newest first); if two runs started at the same moment, the smaller `run_id` comes first.",
  notes=[DATE_NOTE, "A run at `2026-03-08 21:45:00` is inside the window; a run at `2026-03-09 00:05:00` is not."],
  examples=[
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "started_at", "rows_loaded"], [
          (1, 10, "success", "2026-03-01 23:50:00", 500),
          (2, 10, "failed", "2026-03-02 00:10:00", 0),
          (3, 11, "failed", "2026-03-05 14:00:00", 0),
          (4, 12, "success", "2026-03-05 15:30:00", 1200),
          (5, 11, "failed", "2026-03-08 21:45:00", 0),
          (6, 12, "failed", "2026-03-09 00:05:00", 0),
          (7, 10, "running", "2026-03-07 09:00:00", None)])},
           rows=[(5, 11, "2026-03-08 21:45:00"), (3, 11, "2026-03-05 14:00:00"), (2, 10, "2026-03-02 00:10:00")],
           explain="Runs 2, 3 and 5 are failed and inside the window. Run 5 started late on 8 March, which still counts (comparing with `<= '2026-03-08'` would wrongly drop it). Run 6 is after the window, run 1 is before it, and runs 4 and 7 did not fail."),
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "started_at", "rows_loaded"], [
          (1, 20, "failed", "2026-03-04 10:00:00", 0),
          (2, 21, "failed", "2026-03-04 10:00:00", 0),
          (3, 20, "success", "2026-03-04 11:00:00", 300),
          (4, 22, "failed", "2026-02-28 10:00:00", 0)])},
           rows=[(1, 20, "2026-03-04 10:00:00"), (2, 21, "2026-03-04 10:00:00")],
           explain="Runs 1 and 2 started at the same moment, so the tie is broken by `run_id` ascending. Run 4 failed but is before the window."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO pipeline_runs VALUES (8, 13, 'failed', '2026-03-02 00:00:00', 0)"],
           desc="Example 1 plus failed run 8 at exactly 2026-03-02 00:00:00",
           rows=[(5, 11, "2026-03-08 21:45:00"), (3, 11, "2026-03-05 14:00:00"), (2, 10, "2026-03-02 00:10:00"), (8, 13, "2026-03-02 00:00:00")],
           why="the start of the window is inclusive"),
      dict(base=1, sql=["DELETE FROM pipeline_runs WHERE run_id IN (1, 2)"],
           desc="Example 2 without runs 1 and 2",
           rows=[], why="no failed run in the window returns an empty result, not an error"),
  ],
  approach="Filter on status and a half-open timestamp range (`>= '2026-03-02'` and `< '2026-03-09'`), then sort. ISO text timestamps sort and compare correctly as strings. O(n log n) for the sort.",
  sql="""SELECT run_id, pipeline_id, started_at
FROM pipeline_runs
WHERE status = 'failed'
  AND started_at >= '2026-03-02'
  AND started_at <  '2026-03-09'
ORDER BY started_at DESC, run_id ASC;""",
  alternatives="`DATE(started_at) BETWEEN '2026-03-02' AND '2026-03-08'` (or `CAST(started_at AS DATE)`) is equally correct. `started_at BETWEEN '2026-03-02' AND '2026-03-08'` on the raw timestamp is wrong because it drops runs later on 8 March.",
  hint="A timestamp such as `2026-03-08 21:45:00` is greater than the text `2026-03-08`. How can you write the end of the window so the whole last day is included?",
  rubric=["Filters `status = 'failed'`.",
          "Includes the whole of 8 March (half-open range or comparing on the date part); partial credit if only the end boundary is wrong.",
          "Orders by `started_at` descending with `run_id` ascending as the tie-breaker.",
          "Returns exactly `run_id`, `pipeline_id`, `started_at`."],
  checkpoints=["Filters on status = 'failed'",
               "Lower bound includes 2026-03-02 00:00:00",
               "Upper bound includes all of 2026-03-08 but excludes 2026-03-09",
               "ORDER BY started_at DESC",
               "Tie-break ORDER BY run_id ASC",
               "Selects the three required columns"])

Q(id="qb-sql-n02", difficulty="easy", title="Connectors With Repeated Sync Failures",
  topic="Aggregation · HAVING",
  body="The support team wants to proactively contact customers whose connectors keep failing. A connector needs attention if it has **at least 3 failed** sync jobs.\n\nWrite a query that returns each such connector with its number of failed jobs.",
  schema=["`sync_jobs(job_id INT, connector_id INT, status TEXT)` — `status` is `'success'` or `'failed'`."],
  columns=["connector_id", "failed_jobs"],
  order="Order by `failed_jobs` descending, then `connector_id` ascending.",
  notes=["Only failed jobs count towards the threshold; successful jobs are ignored."],
  examples=[
      dict(tables={"sync_jobs": (["job_id", "connector_id", "status"], [
          (1, 101, "failed"), (2, 101, "success"), (3, 101, "failed"), (4, 102, "failed"), (5, 101, "failed"),
          (6, 103, "failed"), (7, 103, "failed"), (8, 103, "failed"), (9, 102, "success"), (10, 103, "failed")])},
           rows=[(103, 4), (101, 3)],
           explain="Connector 103 has 4 failed jobs and 101 has exactly 3, so both qualify. Connector 102 has only 1 failure."),
      dict(tables={"sync_jobs": (["job_id", "connector_id", "status"], [
          (1, 201, "failed"), (2, 201, "success"), (3, 201, "success"), (4, 201, "success"), (5, 202, "failed"), (6, 202, "failed")])},
           rows=[],
           explain="Connector 201 has 4 jobs but only 1 failure (counting all jobs would wrongly include it). Connector 202 has 2 failures, below the threshold."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO sync_jobs VALUES (11, 101, 'failed'), (12, 102, 'failed'), (13, 102, 'failed')"],
           desc="Example 1 plus failed jobs 11 (connector 101), 12 and 13 (connector 102)",
           rows=[(101, 4), (103, 4), (102, 3)], why="tie on failed_jobs is broken by connector_id ascending"),
      dict(base=1, sql=["INSERT INTO sync_jobs VALUES (7, 202, 'failed')"],
           desc="Example 2 plus a third failed job for connector 202",
           rows=[(202, 3)], why="exactly 3 failures qualifies (>= 3, not > 3)"),
  ],
  approach="Keep only failed rows with WHERE, group by connector, and filter the groups with HAVING COUNT(*) >= 3. O(n) to scan plus O(k log k) to sort the k connectors.",
  sql="""SELECT connector_id, COUNT(*) AS failed_jobs
FROM sync_jobs
WHERE status = 'failed'
GROUP BY connector_id
HAVING COUNT(*) >= 3
ORDER BY failed_jobs DESC, connector_id ASC;""",
  alternatives="Conditional aggregation without WHERE also works: `HAVING SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) >= 3`, selecting the same SUM as `failed_jobs`.",
  hint="Filtering individual rows and filtering groups happen at different stages of a query. Which clause filters on an aggregate like a count?",
  rubric=["Counts only failed jobs (WHERE status = 'failed' or a conditional count).",
          "Groups by `connector_id` and filters groups with HAVING (not WHERE on the aggregate).",
          "Uses `>= 3`; using `> 3` loses credit for the boundary.",
          "Orders by `failed_jobs` DESC then `connector_id` ASC."],
  checkpoints=["Restricts the count to failed jobs",
               "GROUP BY connector_id",
               "HAVING COUNT(*) >= 3",
               "Aliases the count as failed_jobs",
               "Correct two-level ORDER BY"])

Q(id="qb-sql-n03", difficulty="easy", title="Assigned vs Unassigned Tickets",
  topic="NULL Handling · Aggregation",
  body="Support tickets are created with a `priority`. A ticket that no agent has picked up yet has `assignee_id` = NULL.\n\nFor every priority, report how many tickets exist in total, how many are assigned to an agent, and how many are still unassigned.",
  schema=["`tickets(ticket_id INT, priority TEXT, assignee_id INT)` — `assignee_id` is NULL while the ticket is unassigned. `priority` is never NULL."],
  columns=["priority", "total_tickets", "assigned_tickets", "unassigned_tickets"],
  order="Order by `priority` alphabetically.",
  notes=["Counts must be 0 (not NULL) when a priority has no tickets of that kind."],
  examples=[
      dict(tables={"tickets": (["ticket_id", "priority", "assignee_id"], [
          (1, "high", 7), (2, "high", None), (3, "low", 8), (4, "medium", None), (5, "high", 7), (6, "medium", None), (7, "low", 9)])},
           rows=[("high", 3, 2, 1), ("low", 2, 2, 0), ("medium", 2, 0, 2)],
           explain="`COUNT(*)` counts every row, while `COUNT(assignee_id)` skips the NULLs, so the difference is the number of unassigned tickets. Ticket 5 being assigned to the same agent as ticket 1 does not matter."),
      dict(tables={"tickets": (["ticket_id", "priority", "assignee_id"], [
          (1, "urgent", None), (2, "urgent", None), (3, "low", 4)])},
           rows=[("low", 1, 1, 0), ("urgent", 2, 0, 2)],
           explain="Both urgent tickets are unassigned, so assigned_tickets is 0 for that priority."),
  ],
  hidden=[
      dict(base=1, sql=["DELETE FROM tickets WHERE ticket_id = 3"],
           desc="Example 2 with only the two unassigned urgent tickets",
           rows=[("urgent", 2, 0, 2)], why="a group where every assignee is NULL still reports total 2 and assigned 0"),
      dict(base=0, sql=["UPDATE tickets SET assignee_id = NULL WHERE priority = 'low'"],
           desc="Example 1 with both low tickets unassigned",
           rows=[("high", 3, 2, 1), ("low", 2, 0, 2), ("medium", 2, 0, 2)], why="COUNT(assignee_id) ignores NULLs; COUNT(*) does not"),
  ],
  approach="Group by priority. `COUNT(*)` gives the total, `COUNT(assignee_id)` counts only non-NULL assignees, and their difference is the unassigned count. One pass, O(n).",
  sql="""SELECT priority,
       COUNT(*)                      AS total_tickets,
       COUNT(assignee_id)            AS assigned_tickets,
       COUNT(*) - COUNT(assignee_id) AS unassigned_tickets
FROM tickets
GROUP BY priority
ORDER BY priority;""",
  alternatives="`SUM(CASE WHEN assignee_id IS NULL THEN 1 ELSE 0 END)` for the unassigned count (and `IS NOT NULL` for assigned) is equally good. `COUNT(DISTINCT assignee_id)` is wrong: it counts agents, not tickets.",
  hint="`COUNT(*)` and `COUNT(some_column)` do not always return the same number. What does each one do with NULL values?",
  rubric=["Groups by `priority`.",
          "Uses COUNT(*) for the total and COUNT(assignee_id) (or a CASE on IS NOT NULL) for assigned.",
          "Computes unassigned correctly, including 0 when none; using `= NULL` instead of `IS NULL` loses credit.",
          "Does not use COUNT(DISTINCT assignee_id).",
          "Correct column names and alphabetical order."],
  checkpoints=["GROUP BY priority",
               "total_tickets uses COUNT(*)",
               "assigned_tickets counts non-NULL assignee_id",
               "unassigned_tickets counts NULL assignee_id (IS NULL, not = NULL)",
               "ORDER BY priority"])

Q(id="qb-sql-n04", difficulty="easy", title="Daily Active Users",
  topic="DISTINCT · Date Bucketing",
  body="The product dashboard shows **daily active users**: for each calendar day, the number of *different* users who produced at least one event that day.\n\nSome events are anonymous heartbeats with `user_id` = NULL; they must not be counted as a user.",
  schema=["`events(event_id INT, user_id INT, event_type TEXT, event_time TEXT)` — `event_time` is a timestamp like `2026-04-01 09:00:00`."],
  columns=["activity_date", "active_users"],
  order="Order by `activity_date` ascending.",
  notes=[DATE_NOTE, "`activity_date` should be the date part only, e.g. `2026-04-01`. Only days that have events appear."],
  examples=[
      dict(tables={"events": (["event_id", "user_id", "event_type", "event_time"], [
          (1, 1, "login", "2026-04-01 09:00:00"), (2, 1, "sync", "2026-04-01 09:05:00"), (3, 2, "login", "2026-04-01 22:30:00"),
          (4, 1, "login", "2026-04-02 08:00:00"), (5, 3, "login", "2026-04-02 10:00:00"), (6, 3, "sync", "2026-04-02 10:02:00"),
          (7, 2, "login", "2026-04-03 23:59:00")])},
           rows=[("2026-04-01", 2), ("2026-04-02", 2), ("2026-04-03", 1)],
           explain="On 1 April user 1 has two events but is counted once, so the users are {1, 2}. On 2 April the users are {1, 3}. Grouping by the full timestamp instead of the date would give one row per event."),
      dict(tables={"events": (["event_id", "user_id", "event_type", "event_time"], [
          (1, 5, "login", "2026-04-10 00:00:00"), (2, 5, "login", "2026-04-10 12:00:00"),
          (3, 5, "login", "2026-04-10 23:59:59"), (4, 6, "sync", "2026-04-11 00:00:01")])},
           rows=[("2026-04-10", 1), ("2026-04-11", 1)],
           explain="Events at the very start and end of a day belong to that day; event 4 is one second into 11 April."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO events VALUES (8, 4, 'login', '2026-04-03 00:00:00'), (9, 2, 'sync', '2026-04-03 01:00:00')"],
           desc="Example 1 plus a login by user 4 and a second event by user 2 on 3 April",
           rows=[("2026-04-01", 2), ("2026-04-02", 2), ("2026-04-03", 2)], why="user 2 appears twice on 3 April but counts once"),
      dict(base=1, sql=["INSERT INTO events VALUES (5, NULL, 'heartbeat', '2026-04-11 05:00:00')"],
           desc="Example 2 plus an anonymous heartbeat (user_id NULL) on 11 April",
           rows=[("2026-04-10", 1), ("2026-04-11", 1)], why="COUNT(DISTINCT user_id) ignores the NULL user"),
  ],
  approach="Truncate each timestamp to its date, group by that date and count distinct non-NULL user ids. O(n) with hashing (or O(n log n) with sorting).",
  sql="""SELECT substr(event_time, 1, 10)  AS activity_date,
       COUNT(DISTINCT user_id)     AS active_users
FROM events
GROUP BY substr(event_time, 1, 10)
ORDER BY activity_date;""",
  alternatives="`DATE(event_time)` (SQLite/MySQL) or `CAST(event_time AS DATE)` / `event_time::date` (PostgreSQL) for the day. A subquery that first selects DISTINCT (day, user_id) and then counts per day is also fine. `COUNT(*)` or `COUNT(user_id)` without DISTINCT is wrong.",
  hint="Two things need to collapse here: many events per user, and many timestamps per day. Which SQL feature handles each one?",
  rubric=["Buckets by calendar date, not the full timestamp.",
          "Counts DISTINCT users; COUNT(*) earns at most partial credit.",
          "NULL user_id is not counted as a user.",
          "Correct column names and ascending date order."],
  checkpoints=["Extracts the date part of event_time",
               "GROUP BY the date expression",
               "COUNT(DISTINCT user_id)",
               "Anonymous NULL users excluded",
               "ORDER BY activity_date"])

Q(id="qb-sql-n05", difficulty="easy", title="Order Size Bands",
  topic="CASE Expressions",
  body="Finance wants every order labelled with a size band:\n\n- `small` — amount below 100\n- `medium` — amount from 100 up to (but not including) 500\n- `large` — amount 500 or more\n- `unknown` — amount is NULL (the payment amount was not captured)\n\nReturn every order with its band.",
  schema=["`orders(order_id INT, customer_id INT, amount DECIMAL)` — `amount` may be NULL."],
  columns=["order_id", "amount", "size_band"],
  order="Order by `order_id` ascending.",
  notes=["Be careful at the boundaries: exactly 100 is `medium` and exactly 500 is `large`."],
  examples=[
      dict(tables={"orders": (["order_id", "customer_id", "amount"], [
          (1, 1, 45), (2, 2, 100), (3, 1, 499), (4, 3, 500), (5, 2, 1250), (6, 3, None)])},
           rows=[(1, 45, "small"), (2, 100, "medium"), (3, 499, "medium"), (4, 500, "large"), (5, 1250, "large"), (6, None, "unknown")],
           explain="Order 2 sits exactly on the lower edge of `medium` and order 4 exactly on the lower edge of `large`. Order 6 has no amount, so it is `unknown`."),
      dict(tables={"orders": (["order_id", "customer_id", "amount"], [
          (10, 4, 99.5), (11, 4, 0.0), (12, 5, 500.01)])},
           rows=[(10, 99.5, "small"), (11, 0.0, "small"), (12, 500.01, "large")],
           explain="Decimal amounts follow the same rules; 0 is still a valid `small` order."),
  ],
  hidden=[
      dict(base=0, sql=["UPDATE orders SET amount = 99.99 WHERE order_id = 2"],
           desc="Example 1 with order 2 changed to 99.99",
           rows=[(1, 45, "small"), (2, 99.99, "small"), (3, 499, "medium"), (4, 500, "large"), (5, 1250, "large"), (6, None, "unknown")],
           why="just below the 100 boundary"),
      dict(base=1, sql=["UPDATE orders SET amount = NULL"],
           desc="Example 2 with every amount NULL",
           rows=[(10, None, "unknown"), (11, None, "unknown"), (12, None, "unknown")],
           why="NULL fails every comparison, so a CASE ending in ELSE 'large' would mislabel these"),
  ],
  approach="A searched CASE expression evaluated top to bottom: test for NULL first, then the bands in increasing order so each WHEN only needs an upper bound. O(n).",
  sql="""SELECT order_id,
       amount,
       CASE
         WHEN amount IS NULL THEN 'unknown'
         WHEN amount < 100   THEN 'small'
         WHEN amount < 500   THEN 'medium'
         ELSE 'large'
       END AS size_band
FROM orders
ORDER BY order_id;""",
  alternatives="Explicit ranges (`amount >= 100 AND amount < 500`) are fine. Putting the NULL check last is fine only if `large` is tested explicitly (`WHEN amount >= 500`) and NULL falls to `ELSE 'unknown'`.",
  hint="Every comparison with NULL is neither true nor false. Where in your CASE does a NULL amount end up?",
  rubric=["Uses a CASE expression producing the four labels.",
          "Boundaries correct: 100 is medium, 500 is large.",
          "NULL amounts labelled `unknown`; a CASE where NULL falls into ELSE 'large' earns partial credit.",
          "Returns all orders with the required columns, ordered by order_id."],
  checkpoints=["CASE expression aliased as size_band",
               "amount < 100 → small",
               "100 ≤ amount < 500 → medium",
               "amount ≥ 500 → large",
               "amount IS NULL → unknown",
               "ORDER BY order_id"])

Q(id="qb-sql-n06", difficulty="easy", title="Customers and Their Account Managers",
  topic="Joins · COALESCE",
  body="Each customer company may have an account manager. The account-management export must list **every** customer with the name of their manager. If a customer has no manager, or their `manager_id` points to a manager who is no longer in the `account_managers` table, show the text `Unassigned`.",
  schema=["`customers(customer_id INT, company TEXT, manager_id INT)` — `manager_id` may be NULL.",
          "`account_managers(manager_id INT, manager_name TEXT)`"],
  columns=["customer_id", "company", "manager_name"],
  order="Order by `customer_id` ascending.",
  notes=["Every customer must appear exactly once (each `manager_id` matches at most one manager)."],
  examples=[
      dict(tables={"customers": (["customer_id", "company", "manager_id"], [
          (1, "Acme Retail", 10), (2, "Bolt Logistics", None), (3, "Cobalt Pay", 11), (4, "Delta Foods", 10)]),
          "account_managers": (["manager_id", "manager_name"], [(10, "Priya"), (11, "Rahul"), (12, "Sneha")])},
           rows=[(1, "Acme Retail", "Priya"), (2, "Bolt Logistics", "Unassigned"), (3, "Cobalt Pay", "Rahul"), (4, "Delta Foods", "Priya")],
           explain="Bolt Logistics has no manager, so an INNER JOIN would drop it; a LEFT JOIN keeps it with a NULL name that COALESCE turns into `Unassigned`. Sneha manages nobody and does not appear."),
      dict(tables={"customers": (["customer_id", "company", "manager_id"], [(5, "Echo Media", 13), (6, "Fern Health", 12)]),
                   "account_managers": (["manager_id", "manager_name"], [(12, "Sneha")])},
           rows=[(5, "Echo Media", "Unassigned"), (6, "Fern Health", "Sneha")],
           explain="Manager 13 does not exist in `account_managers`, so Echo Media is `Unassigned` too."),
  ],
  hidden=[
      dict(base=0, sql=["DELETE FROM account_managers WHERE manager_id = 11"],
           desc="Example 1 after manager 11 (Rahul) is removed",
           rows=[(1, "Acme Retail", "Priya"), (2, "Bolt Logistics", "Unassigned"), (3, "Cobalt Pay", "Unassigned"), (4, "Delta Foods", "Priya")],
           why="a dangling manager_id must still keep the customer"),
      dict(base=1, sql=["DELETE FROM account_managers"],
           desc="Example 2 with an empty account_managers table",
           rows=[(5, "Echo Media", "Unassigned"), (6, "Fern Health", "Unassigned")], why="LEFT JOIN against an empty table keeps every customer"),
  ],
  approach="LEFT JOIN customers to account_managers so unmatched customers survive, and replace the NULL manager name with COALESCE. O(n + m) with a hash join.",
  sql="""SELECT c.customer_id,
       c.company,
       COALESCE(m.manager_name, 'Unassigned') AS manager_name
FROM customers c
LEFT JOIN account_managers m ON m.manager_id = c.manager_id
ORDER BY c.customer_id;""",
  alternatives="`CASE WHEN m.manager_name IS NULL THEN 'Unassigned' ELSE m.manager_name END`, `IFNULL` (MySQL/SQLite) or `ISNULL` (SQL Server) are fine. A correlated scalar subquery for the name wrapped in COALESCE also works.",
  hint="Think about which customers an inner join would lose, and what value appears in the manager columns when a left join finds no match.",
  rubric=["Uses a LEFT JOIN (or equivalent) so every customer appears; an INNER JOIN earns partial credit at most.",
          "Replaces missing names with `Unassigned` using COALESCE/CASE/IFNULL.",
          "Handles both NULL manager_id and a manager_id with no matching row.",
          "Correct columns and order."],
  checkpoints=["customers is the preserved (left) table",
               "Join condition on manager_id",
               "COALESCE(manager_name, 'Unassigned') or equivalent",
               "Works for a manager_id that does not exist",
               "ORDER BY customer_id"])

Q(id="qb-sql-n07", difficulty="easy", title="Overdue Unpaid Invoices",
  topic="NULL Handling · Filtering",
  body="Collections runs a report on **31 May 2026**. An invoice is overdue if its `due_date` is before 2026-05-31 and it has not been paid (`paid_date` is NULL). Some customers have made a partial payment, recorded in `amount_paid`; if nothing has been paid yet, `amount_paid` is NULL.\n\nReturn the overdue invoices with the balance still owed.",
  schema=["`invoices(invoice_id INT, customer_id INT, amount DECIMAL, amount_paid DECIMAL, due_date TEXT, paid_date TEXT)` — `amount_paid` and `paid_date` may be NULL; dates look like `2026-05-10`."],
  columns=["invoice_id", "customer_id", "balance"],
  order="Order by `due_date` ascending (oldest debt first), then `invoice_id`.",
  notes=[DATE_NOTE, "`balance` = `amount` minus whatever has been paid (treat a NULL `amount_paid` as 0).",
         "An invoice due on 2026-05-31 itself is not yet overdue."],
  examples=[
      dict(tables={"invoices": (["invoice_id", "customer_id", "amount", "amount_paid", "due_date", "paid_date"], [
          (1, 1, 1000, None, "2026-05-10", None), (2, 1, 500, 500, "2026-05-15", "2026-05-14"),
          (3, 2, 800, 300, "2026-05-20", None), (4, 3, 1200, None, "2026-06-05", None),
          (5, 2, 400, None, "2026-05-31", None)])},
           rows=[(1, 1, 1000), (3, 2, 500)],
           explain="Invoice 1 owes the full 1000 (`1000 - NULL` would be NULL, hence COALESCE). Invoice 3 was partly paid and owes 500. Invoice 2 is paid, invoice 4 is not due yet, and invoice 5 is due today."),
      dict(tables={"invoices": (["invoice_id", "customer_id", "amount", "amount_paid", "due_date", "paid_date"], [
          (6, 4, 250, 0, "2026-04-30", None), (7, 4, 900, 900, "2026-04-01", "2026-04-20"), (8, 5, 600, None, "2026-04-15", None)])},
           rows=[(8, 5, 600), (6, 4, 250)],
           explain="Invoice 8 is due earlier than invoice 6, so it is listed first. Invoice 7 is paid."),
  ],
  hidden=[
      dict(base=0, sql=["UPDATE invoices SET due_date = '2026-05-30' WHERE invoice_id = 4"],
           desc="Example 1 with invoice 4 due on 2026-05-30",
           rows=[(1, 1, 1000), (3, 2, 500), (4, 3, 1200)], why="one day before the report date is overdue"),
      dict(base=1, sql=["UPDATE invoices SET amount_paid = 600, paid_date = '2026-05-01' WHERE invoice_id = 8"],
           desc="Example 2 after invoice 8 is paid on 2026-05-01",
           rows=[(6, 4, 250)], why="a late but completed payment is no longer overdue"),
  ],
  approach="Filter `paid_date IS NULL AND due_date < '2026-05-31'` and compute `amount - COALESCE(amount_paid, 0)`. ISO dates compare correctly as text. O(n log n) for the sort.",
  sql="""SELECT invoice_id,
       customer_id,
       amount - COALESCE(amount_paid, 0) AS balance
FROM invoices
WHERE paid_date IS NULL
  AND due_date < '2026-05-31'
ORDER BY due_date, invoice_id;""",
  alternatives="`CURRENT_DATE` would be used in production; here the fixed date keeps the answer reproducible. `IFNULL`/`ISNULL`/`CASE` instead of COALESCE are fine. `paid_date = NULL` is wrong because it is never true.",
  hint="Two different NULL problems are hiding here: one in the WHERE clause and one in the arithmetic. What does `x - NULL` evaluate to?",
  rubric=["Uses `paid_date IS NULL` (not `= NULL`).",
          "Strictly before 2026-05-31 (`<`, not `<=`).",
          "Balance uses COALESCE (or equivalent) so unpaid invoices show the full amount, not NULL.",
          "Orders by due_date then invoice_id; correct column names."],
  checkpoints=["paid_date IS NULL",
               "due_date < '2026-05-31'",
               "balance = amount - COALESCE(amount_paid, 0)",
               "Partial payments reduce the balance",
               "ORDER BY due_date, invoice_id"])

Q(id="qb-sql-n08", difficulty="easy", title="Average Rows per Successful Run",
  topic="Aggregation · Filtering",
  body="Each pipeline run records how many rows it loaded. Failed runs always record 0 rows, which would drag the average down, so the capacity team wants statistics over **successful runs only**.\n\nFor each pipeline that has at least one successful run, return how many successful runs it had and the average rows loaded per successful run.",
  schema=["`pipeline_runs(run_id INT, pipeline_id INT, status TEXT, rows_loaded INT)` — `status` is `'success'` or `'failed'`."],
  columns=["pipeline_id", "successful_runs", "avg_rows"],
  order="Order by `pipeline_id` ascending.",
  notes=["Round `avg_rows` to 2 decimal places. Make sure the average is not truncated to an integer in your dialect.",
         "Pipelines with no successful run do not appear."],
  examples=[
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "rows_loaded"], [
          (1, 1, "success", 100), (2, 1, "failed", 0), (3, 1, "success", 250), (4, 2, "failed", 0),
          (5, 2, "failed", 0), (6, 3, "success", 90), (7, 3, "success", 91), (8, 3, "success", 94)])},
           rows=[(1, 2, 175.0), (3, 3, 91.67)],
           explain="Pipeline 1 averages (100 + 250) / 2 = 175 over its successful runs; including the failed run would give 116.67. Pipeline 3 averages 275 / 3 = 91.67. Pipeline 2 never succeeded."),
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "rows_loaded"], [
          (1, 5, "success", 10), (2, 5, "success", 11), (3, 5, "failed", 0)])},
           rows=[(5, 2, 10.5)],
           explain="(10 + 11) / 2 = 10.5; integer division would give 10."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO pipeline_runs VALUES (9, 2, 'success', 300)"],
           desc="Example 1 plus one successful run of 300 rows for pipeline 2",
           rows=[(1, 2, 175.0), (2, 1, 300.0), (3, 3, 91.67)], why="a pipeline with a single success appears"),
      dict(base=1, sql=["INSERT INTO pipeline_runs VALUES (4, 5, 'failed', 0), (5, 5, 'failed', 0)"],
           desc="Example 2 plus two more failed runs",
           rows=[(5, 2, 10.5)], why="failed runs must not change the average (would become 5.25)"),
  ],
  approach="Filter to successful runs before grouping, then COUNT and AVG per pipeline, rounding the average. O(n).",
  sql="""SELECT pipeline_id,
       COUNT(*)                  AS successful_runs,
       ROUND(AVG(rows_loaded), 2) AS avg_rows
FROM pipeline_runs
WHERE status = 'success'
GROUP BY pipeline_id
ORDER BY pipeline_id;""",
  alternatives="`ROUND(SUM(rows_loaded) * 1.0 / COUNT(*), 2)` is equivalent. Conditional aggregation without WHERE (`AVG(CASE WHEN status = 'success' THEN rows_loaded END)`) also works but then needs `HAVING` to drop pipelines without successes.",
  hint="Should the failed runs be removed before or after the rows are grouped?",
  rubric=["Excludes failed runs from both the count and the average.",
          "Groups by pipeline_id and uses AVG (or SUM/COUNT with non-integer division).",
          "Rounds to 2 decimals; integer-truncated averages earn partial credit.",
          "Pipelines without successes are absent; correct columns and order."],
  checkpoints=["WHERE status = 'success' (or equivalent conditional aggregate)",
               "GROUP BY pipeline_id",
               "COUNT(*) AS successful_runs",
               "ROUND(AVG(rows_loaded), 2) AS avg_rows",
               "ORDER BY pipeline_id"])

Q(id="qb-sql-n09", difficulty="easy", title="Countries With Paying Customers",
  topic="Joins · DISTINCT",
  body="Sales wants the list of countries where the company has **at least one customer who has placed an order**. Each country should appear only once, however many customers or orders it has.",
  schema=["`customers(customer_id INT, name TEXT, country TEXT)` — `country` may be NULL.",
          "`orders(order_id INT, customer_id INT, amount DECIMAL)` — a few old orders reference customers that were deleted."],
  columns=["country"],
  order="Order by `country` alphabetically.",
  notes=["Ignore customers whose `country` is NULL, and ignore orders whose customer no longer exists."],
  examples=[
      dict(tables={"customers": (["customer_id", "name", "country"], [
          (1, "Asha", "India"), (2, "Ben", "UK"), (3, "Chen", "Singapore"), (4, "Dev", "India"), (5, "Eva", "Germany")]),
          "orders": (["order_id", "customer_id", "amount"], [(1, 1, 500), (2, 1, 300), (3, 4, 200), (4, 3, 150), (5, 1, 50)])},
           rows=[("India",), ("Singapore",)],
           explain="India has two ordering customers and four orders but is listed once. Ben (UK) and Eva (Germany) never ordered."),
      dict(tables={"customers": (["customer_id", "name", "country"], [(1, "Farah", "UAE"), (2, "Gus", "USA")]),
                   "orders": (["order_id", "customer_id", "amount"], [(1, 2, 99), (2, 2, 10), (3, 9, 40)])},
           rows=[("USA",)],
           explain="Order 3 belongs to customer 9, who no longer exists, so it contributes no country."),
  ],
  hidden=[
      dict(base=0, sql=["DELETE FROM orders"], desc="Example 1 with no orders at all",
           rows=[], why="no paying customers gives an empty result"),
      dict(base=0, sql=["INSERT INTO customers VALUES (6, 'Ira', NULL)", "INSERT INTO orders VALUES (6, 6, 70)"],
           desc="Example 1 plus customer 6 with a NULL country who places an order",
           rows=[("India",), ("Singapore",)], why="a NULL country must not appear as a row"),
  ],
  approach="Inner join customers to orders (which drops non-buyers and orphan orders), filter out NULL countries and take DISTINCT countries. O(n + m) with a hash join.",
  sql="""SELECT DISTINCT c.country
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
WHERE c.country IS NOT NULL
ORDER BY c.country;""",
  alternatives="`WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)` with DISTINCT, `customer_id IN (SELECT customer_id FROM orders)`, or `GROUP BY country` instead of DISTINCT are all fine.",
  hint="A join repeats a customer once per order. How do you collapse the result so each country appears a single time?",
  rubric=["Restricts to customers who have at least one order (inner join, EXISTS or IN).",
          "Removes duplicates with DISTINCT or GROUP BY.",
          "Excludes NULL countries.",
          "Single `country` column in alphabetical order."],
  checkpoints=["Links customers to orders on customer_id",
               "Customers without orders are excluded",
               "DISTINCT (or GROUP BY) on country",
               "country IS NOT NULL",
               "ORDER BY country"])

# ---------------------------------------------------------------- MEDIUM (14)
Q(id="qb-sql-n10", difficulty="medium", title="Connectors That Never Synced Successfully",
  topic="Anti-Join · LEFT JOIN",
  body="A connector is considered **broken on setup** if it has never had a successful sync. That covers connectors with no sync jobs at all and connectors whose jobs all failed or were cancelled.\n\nReturn every such connector.",
  schema=["`connectors(connector_id INT, name TEXT, source_type TEXT)`",
          "`sync_jobs(job_id INT, connector_id INT, status TEXT)` — `status` is `'success'`, `'failed'` or `'cancelled'`. Because of an old bug, a few jobs have `connector_id` = NULL."],
  columns=["connector_id", "name"],
  order="Order by `connector_id` ascending.",
  notes=["Jobs with a NULL `connector_id` belong to no connector, but they must not break your query."],
  examples=[
      dict(tables={"connectors": (["connector_id", "name", "source_type"], [
          (1, "orders_db", "mysql"), (2, "crm", "salesforce"), (3, "ads", "google_ads"), (4, "billing", "postgres")]),
          "sync_jobs": (["job_id", "connector_id", "status"], [
              (1, 1, "success"), (2, 1, "failed"), (3, 2, "failed"), (4, 2, "failed"), (5, 4, "cancelled"), (6, 4, "success")])},
           rows=[(2, "crm"), (3, "ads")],
           explain="`crm` has only failed jobs and `ads` has no jobs at all. `orders_db` and `billing` each have a success. A plain LEFT JOIN with `WHERE s.job_id IS NULL` would find only `ads`, because `crm` does have (failed) jobs."),
      dict(tables={"connectors": (["connector_id", "name", "source_type"], [(5, "events", "kafka"), (6, "tickets", "zendesk")]),
                   "sync_jobs": (["job_id", "connector_id", "status"], [(1, 5, "failed"), (2, 5, "cancelled"), (3, 7, "success")])},
           rows=[(5, "events"), (6, "tickets")],
           explain="The successful job 3 belongs to connector 7, which is not in `connectors`, so it does not help either connector."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO sync_jobs VALUES (8, 3, 'success')"],
           desc="Example 1 plus a successful job for connector 3",
           rows=[(2, "crm")], why="one success removes the connector"),
      dict(base=0, sql=["INSERT INTO sync_jobs VALUES (7, NULL, 'success')"],
           desc="Example 1 plus a successful job with connector_id NULL",
           rows=[(2, "crm"), (3, "ads")], why="`NOT IN (SELECT connector_id ...)` returns no rows at all once the subquery contains a NULL"),
  ],
  approach="Anti-join: LEFT JOIN only the successful jobs (the status test goes in the ON clause) and keep connectors where no job matched. NOT EXISTS is the cleanest alternative. O(n + m) with a hash join.",
  sql="""SELECT c.connector_id, c.name
FROM connectors c
LEFT JOIN sync_jobs s
       ON s.connector_id = c.connector_id
      AND s.status = 'success'
WHERE s.job_id IS NULL
ORDER BY c.connector_id;""",
  alternatives="`WHERE NOT EXISTS (SELECT 1 FROM sync_jobs s WHERE s.connector_id = c.connector_id AND s.status = 'success')` is equally correct. `NOT IN (SELECT connector_id FROM sync_jobs WHERE status = 'success')` is only correct if it also filters `connector_id IS NOT NULL`. Putting `s.status = 'success'` in the WHERE clause of a LEFT JOIN is wrong.",
  hint="With a LEFT JOIN, a condition in the ON clause and the same condition in the WHERE clause behave differently. Which placement lets you look for the absence of a successful job?",
  rubric=["Returns connectors with no successful job, including those with no jobs at all.",
          "Status filter is in the ON clause (or inside NOT EXISTS); filtering in WHERE earns partial credit.",
          "Robust to NULL connector_id in sync_jobs (NOT EXISTS / LEFT JOIN, or NOT IN with an IS NOT NULL filter).",
          "Correct columns and order."],
  checkpoints=["Anti-join pattern (LEFT JOIN … IS NULL, NOT EXISTS, or safe NOT IN)",
               "Restricts the matched jobs to status = 'success'",
               "Connectors with zero jobs are returned",
               "Connectors with only failed/cancelled jobs are returned",
               "No breakage from NULL connector_id",
               "ORDER BY connector_id"])

Q(id="qb-sql-n11", difficulty="medium", title="Employees Who Earn More Than Their Manager",
  topic="Self Join",
  body="The HR analytics team is auditing pay. Each employee row points to their manager through `manager_id`, which is another `emp_id` in the same table (NULL for the head of the team).\n\nReturn every employee whose salary is **strictly greater** than their direct manager's salary, together with the manager's name and salary.",
  schema=["`employees(emp_id INT, name TEXT, salary INT, manager_id INT)` — `manager_id` may be NULL, and occasionally points to a manager who has left (no matching row)."],
  columns=["employee", "employee_salary", "manager", "manager_salary"],
  order="Order by `employee_salary` descending, then `employee` alphabetically.",
  notes=["Equal salaries do not count. Employees without a manager in the table are not returned."],
  examples=[
      dict(tables={"employees": (["emp_id", "name", "salary", "manager_id"], [
          (1, "Anil", 90000, None), (2, "Bhavna", 95000, 1), (3, "Chirag", 60000, 1), (4, "Divya", 70000, 3), (5, "Esha", 60000, 3)])},
           rows=[("Bhavna", 95000, "Anil", 90000), ("Divya", 70000, "Chirag", 60000)],
           explain="Bhavna earns more than Anil, and Divya earns more than Chirag. Esha earns exactly the same as Chirag, so she is not included. Anil has no manager."),
      dict(tables={"employees": (["emp_id", "name", "salary", "manager_id"], [
          (1, "Farhan", 50000, None), (2, "Gita", 40000, 1), (3, "Hari", 45000, 2)])},
           rows=[("Hari", 45000, "Gita", 40000)],
           explain="Only the direct manager matters: Hari earns more than Gita, though less than Gita's manager Farhan."),
  ],
  hidden=[
      dict(base=0, sql=["UPDATE employees SET salary = 61000 WHERE emp_id = 5"],
           desc="Example 1 with Esha's salary raised to 61000",
           rows=[("Bhavna", 95000, "Anil", 90000), ("Divya", 70000, "Chirag", 60000), ("Esha", 61000, "Chirag", 60000)],
           why="the strict comparison now passes"),
      dict(base=1, sql=["UPDATE employees SET manager_id = 9 WHERE emp_id = 3"],
           desc="Example 2 with Hari's manager_id pointing to a missing emp_id 9",
           rows=[], why="a manager who is not in the table has no salary to compare"),
  ],
  approach="Join the table to itself: one copy plays the employee, the other the manager, matched on `e.manager_id = m.emp_id`, then compare salaries. O(n) with a hash join.",
  sql="""SELECT e.name   AS employee,
       e.salary AS employee_salary,
       m.name   AS manager,
       m.salary AS manager_salary
FROM employees e
JOIN employees m ON m.emp_id = e.manager_id
WHERE e.salary > m.salary
ORDER BY e.salary DESC, e.name;""",
  alternatives="A correlated subquery `WHERE e.salary > (SELECT m.salary FROM employees m WHERE m.emp_id = e.manager_id)` works for filtering but needs another lookup for the manager's name; the self join is preferred.",
  hint="The manager is just another row of the same table. How can you put an employee's row and their manager's row side by side?",
  rubric=["Self join with the correct direction (`e.manager_id = m.emp_id`); reversing the roles earns little credit.",
          "Strict `>` comparison of salaries.",
          "Uses table aliases to return both names and both salaries with the required column names.",
          "Correct ordering."],
  checkpoints=["Two aliases of employees",
               "Join condition e.manager_id = m.emp_id",
               "Filter e.salary > m.salary",
               "Returns employee, employee_salary, manager, manager_salary",
               "ORDER BY employee_salary DESC, employee"])

Q(id="qb-sql-n12", difficulty="medium", title="Running Total of Daily Revenue",
  topic="Window Functions · Running Total",
  body="The finance dashboard shows revenue per day and the cumulative revenue up to and including that day. Several orders can fall on the same day, and refunds are stored as negative amounts.\n\nWrite a query that returns one row per day that has orders.",
  schema=["`orders(order_id INT, order_date TEXT, amount DECIMAL)` — `order_date` looks like `2026-06-01`; refunds have negative `amount`."],
  columns=["order_date", "daily_revenue", "running_revenue"],
  order="Order by `order_date` ascending.",
  notes=[DATE_NOTE, "Days with no orders do not appear (do not generate missing dates)."],
  examples=[
      dict(tables={"orders": (["order_id", "order_date", "amount"], [
          (1, "2026-06-01", 100), (2, "2026-06-01", 50), (3, "2026-06-02", 200),
          (4, "2026-06-04", 75), (5, "2026-06-04", 25), (6, "2026-06-05", 300)])},
           rows=[("2026-06-01", 150, 150), ("2026-06-02", 200, 350), ("2026-06-04", 100, 450), ("2026-06-05", 300, 750)],
           explain="Orders are first summed per day; the running total then adds each day's figure to the previous total. 3 June has no orders and is not listed."),
      dict(tables={"orders": (["order_id", "order_date", "amount"], [
          (1, "2026-07-10", 40), (2, "2026-07-09", 60), (3, "2026-07-10", -40)])},
           rows=[("2026-07-09", 60, 60), ("2026-07-10", 0, 60)],
           explain="Rows are not stored in date order. On 10 July a refund cancels the sale, so the day nets to 0 and the running total stays at 60."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO orders VALUES (7, '2026-05-31', 10)"],
           desc="Example 1 plus a 10-unit order on 2026-05-31 (inserted last)",
           rows=[("2026-05-31", 10, 10), ("2026-06-01", 150, 160), ("2026-06-02", 200, 360), ("2026-06-04", 100, 460), ("2026-06-05", 300, 760)],
           why="the running total follows date order, not insertion order"),
      dict(base=1, sql=["DELETE FROM orders WHERE order_id = 2"],
           desc="Example 2 without order 2",
           rows=[("2026-07-10", 0, 0)], why="a net-zero day is still a day with orders"),
  ],
  approach="Aggregate to one row per day first (CTE or subquery), then apply `SUM(...) OVER (ORDER BY order_date)` over the daily rows. O(n + d log d) for d distinct days.",
  sql="""WITH daily AS (
    SELECT order_date, SUM(amount) AS daily_revenue
    FROM orders
    GROUP BY order_date
)
SELECT order_date,
       daily_revenue,
       SUM(daily_revenue) OVER (ORDER BY order_date
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_revenue
FROM daily
ORDER BY order_date;""",
  alternatives="Without window functions: a correlated subquery `(SELECT SUM(amount) FROM orders o2 WHERE o2.order_date <= d.order_date)` or a self join on `d2.order_date <= d1.order_date` with GROUP BY (O(d^2), acceptable for full marks if correct). `SUM(SUM(amount)) OVER (ORDER BY order_date)` in a single GROUP BY query is also valid.",
  hint="If you put the window function directly on the raw orders, you get one output row per order. What has to happen to the orders before the running sum?",
  rubric=["Produces exactly one row per day with orders (aggregates before or inside the window).",
          "Running total ordered by date, including the current day.",
          "Handles negative amounts and unsorted input naturally.",
          "Correct columns and order; a correlated-subquery approach earns full credit if correct."],
  checkpoints=["Groups orders by order_date",
               "daily_revenue = SUM(amount) per day",
               "Running sum ordered by order_date",
               "Running total includes the current day",
               "One row per day, ordered by date"])

Q(id="qb-sql-n13", difficulty="medium", title="Latest Run Status per Pipeline",
  topic="Window Functions · Top-1 per Group",
  body="The pipelines overview page shows, for every pipeline, its **most recent** run and that run's status. The most recent run is the one with the latest `started_at`; if two runs of the same pipeline started at exactly the same time, the one with the larger `run_id` counts as the latest.\n\nReturn one row per pipeline.",
  schema=["`pipeline_runs(run_id INT, pipeline_id INT, status TEXT, started_at TEXT)` — run ids are not guaranteed to increase with time."],
  columns=["pipeline_id", "run_id", "status", "started_at"],
  order="Order by `pipeline_id` ascending.",
  notes=[DATE_NOTE],
  examples=[
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "started_at"], [
          (1, 1, "success", "2026-03-01 08:00:00"), (2, 1, "failed", "2026-03-02 08:00:00"),
          (3, 2, "success", "2026-03-01 09:00:00"), (4, 2, "success", "2026-03-03 09:00:00"),
          (5, 1, "success", "2026-03-01 23:00:00"), (6, 3, "running", "2026-03-03 10:00:00")])},
           rows=[(1, 2, "failed", "2026-03-02 08:00:00"), (2, 4, "success", "2026-03-03 09:00:00"), (3, 6, "running", "2026-03-03 10:00:00")],
           explain="Pipeline 1's latest run is run 2 (2 March), even though run 5 has a larger id. Taking `MAX(started_at)` with GROUP BY and selecting `status` alongside it does not reliably return the status of that run."),
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "started_at"], [
          (10, 7, "failed", "2026-04-01 12:00:00"), (11, 7, "success", "2026-04-01 12:00:00"), (12, 7, "failed", "2026-03-31 12:00:00")])},
           rows=[(7, 11, "success", "2026-04-01 12:00:00")],
           explain="Runs 10 and 11 tie on `started_at`; the larger `run_id` (11) wins."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO pipeline_runs VALUES (7, 2, 'failed', '2026-03-03 09:00:00')"],
           desc="Example 1 plus failed run 7 for pipeline 2 at the same time as run 4",
           rows=[(1, 2, "failed", "2026-03-02 08:00:00"), (2, 7, "failed", "2026-03-03 09:00:00"), (3, 6, "running", "2026-03-03 10:00:00")],
           why="exactly one row per pipeline even with a timestamp tie"),
      dict(base=1, sql=["INSERT INTO pipeline_runs VALUES (9, 7, 'success', '2026-04-02 00:00:00')"],
           desc="Example 2 plus run 9 (smaller id) started later, at 2026-04-02 00:00:00",
           rows=[(7, 9, "success", "2026-04-02 00:00:00")], why="latest is by time first; run_id is only the tie-breaker"),
  ],
  approach="Number the runs inside each pipeline with `ROW_NUMBER() OVER (PARTITION BY pipeline_id ORDER BY started_at DESC, run_id DESC)` and keep row number 1. O(n log n) for the per-partition sort.",
  sql="""WITH ranked AS (
    SELECT run_id, pipeline_id, status, started_at,
           ROW_NUMBER() OVER (PARTITION BY pipeline_id
                              ORDER BY started_at DESC, run_id DESC) AS rn
    FROM pipeline_runs
)
SELECT pipeline_id, run_id, status, started_at
FROM ranked
WHERE rn = 1
ORDER BY pipeline_id;""",
  alternatives="A NOT EXISTS / correlated subquery that rejects any run with a later (started_at, run_id) in the same pipeline is fine. Joining back on `MAX(started_at)` per pipeline works but returns two rows on a timestamp tie unless the run_id tie-break is also applied.",
  hint="You need the whole row of the latest run, not just the latest timestamp. Is there a way to number the runs within each pipeline?",
  rubric=["Returns the complete row of the latest run per pipeline (not MAX(started_at) with an unrelated status).",
          "Partitions by pipeline and orders by started_at descending.",
          "Applies the run_id tie-break so each pipeline returns exactly one row.",
          "Correct columns and order."],
  checkpoints=["ROW_NUMBER (or equivalent) partitioned by pipeline_id",
               "Ordered by started_at DESC",
               "Tie-break on run_id DESC",
               "Filters to the first row per pipeline",
               "One row per pipeline, ordered by pipeline_id"])

Q(id="qb-sql-n14", difficulty="medium", title="Two Longest Sessions per User",
  topic="Window Functions · Top-N per Group",
  body="For a user-engagement report, return each user's **two longest** sessions by `duration_sec`. If durations tie, the session with the smaller `session_id` ranks higher. Users with only one session get one row. Each user must get **at most two** rows, even when there are ties.",
  schema=["`sessions(session_id INT, user_id INT, duration_sec INT)`"],
  columns=["user_id", "session_id", "duration_sec", "rank_in_user"],
  order="Order by `user_id`, then `rank_in_user` (1 before 2).",
  notes=["`rank_in_user` is 1 for the longest session and 2 for the second longest."],
  examples=[
      dict(tables={"sessions": (["session_id", "user_id", "duration_sec"], [
          (1, 1, 300), (2, 1, 1200), (3, 1, 900), (4, 2, 60), (5, 3, 500), (6, 3, 500), (7, 3, 450), (8, 1, 100)])},
           rows=[(1, 2, 1200, 1), (1, 3, 900, 2), (2, 4, 60, 1), (3, 5, 500, 1), (3, 6, 500, 2)],
           explain="User 1's two longest are sessions 2 and 3. User 2 has only one session. User 3's sessions 5 and 6 tie at 500; session 5 has the smaller id so it ranks first."),
      dict(tables={"sessions": (["session_id", "user_id", "duration_sec"], [(10, 9, 30), (11, 9, 40), (12, 9, 40), (13, 9, 50)])},
           rows=[(9, 13, 50, 1), (9, 11, 40, 2)],
           explain="Sessions 11 and 12 tie for second place; only one is allowed, and the smaller id wins."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO sessions VALUES (9, 2, 1000)"],
           desc="Example 1 plus a 1000-second session 9 for user 2",
           rows=[(1, 2, 1200, 1), (1, 3, 900, 2), (2, 9, 1000, 1), (2, 4, 60, 2), (3, 5, 500, 1), (3, 6, 500, 2)],
           why="the new session takes rank 1 and the old one moves to rank 2"),
      dict(base=1, sql=["INSERT INTO sessions VALUES (14, 9, 50)"],
           desc="Example 2 plus session 14 also lasting 50 seconds",
           rows=[(9, 13, 50, 1), (9, 14, 50, 2)], why="RANK/DENSE_RANK would return 3 or 4 rows here; ROW_NUMBER returns exactly two"),
  ],
  approach="`ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY duration_sec DESC, session_id)` gives a unique position per user; keep positions 1 and 2. O(n log n).",
  sql="""WITH ranked AS (
    SELECT user_id, session_id, duration_sec,
           ROW_NUMBER() OVER (PARTITION BY user_id
                              ORDER BY duration_sec DESC, session_id ASC) AS rank_in_user
    FROM sessions
)
SELECT user_id, session_id, duration_sec, rank_in_user
FROM ranked
WHERE rank_in_user <= 2
ORDER BY user_id, rank_in_user;""",
  alternatives="Without window functions, a correlated subquery counting sessions of the same user that rank above the current one (`duration_sec > s.duration_sec OR (duration_sec = s.duration_sec AND session_id < s.session_id)`) and keeping counts 0 and 1 is valid. RANK or DENSE_RANK are wrong here because ties can produce more than two rows.",
  hint="RANK, DENSE_RANK and ROW_NUMBER treat ties differently. Which one guarantees at most two rows per user?",
  rubric=["Partitions by user and orders by duration descending with the session_id tie-break.",
          "Uses ROW_NUMBER (or equivalent) so at most two rows per user; RANK/DENSE_RANK earns partial credit.",
          "Filters the window result in an outer query/CTE (not in WHERE of the same SELECT).",
          "Correct columns including rank_in_user, and correct ordering."],
  checkpoints=["PARTITION BY user_id",
               "ORDER BY duration_sec DESC, session_id ASC inside the window",
               "ROW_NUMBER chosen over RANK/DENSE_RANK",
               "Outer filter rank_in_user <= 2",
               "Users with one session still appear",
               "ORDER BY user_id, rank_in_user"])

Q(id="qb-sql-n15", difficulty="medium", title="Day-over-Day Change in Rows Synced",
  topic="Window Functions · LAG",
  body="Each connector writes one stats row per day it runs. To spot sudden drops, the monitoring team wants, for every stats row, the rows synced on that connector's **previous recorded day** and the change from it.\n\nThe previous recorded day is the most recent earlier `stat_date` for the same connector; it need not be the calendar day before. A connector's first row has no previous day.",
  schema=["`connector_daily_stats(connector_id INT, stat_date TEXT, rows_synced INT)` — at most one row per connector per day."],
  columns=["connector_id", "stat_date", "rows_synced", "prev_rows", "change"],
  order="Order by `connector_id`, then `stat_date`.",
  notes=[DATE_NOTE, "`prev_rows` and `change` are NULL on a connector's first row. `change` = `rows_synced` − `prev_rows`."],
  examples=[
      dict(tables={"connector_daily_stats": (["connector_id", "stat_date", "rows_synced"], [
          (1, "2026-08-01", 1000), (1, "2026-08-02", 1500), (1, "2026-08-03", 1200), (2, "2026-08-01", 300), (2, "2026-08-03", 450)])},
           rows=[(1, "2026-08-01", 1000, None, None), (1, "2026-08-02", 1500, 1000, 500), (1, "2026-08-03", 1200, 1500, -300),
                 (2, "2026-08-01", 300, None, None), (2, "2026-08-03", 450, 300, 150)],
           explain="Connector 2 skipped 2 August, so its 3 August row compares with 1 August. Connector 2's first row must not pick up connector 1's last value, so the window is partitioned by connector."),
      dict(tables={"connector_daily_stats": (["connector_id", "stat_date", "rows_synced"], [
          (5, "2026-08-10", 0), (5, "2026-08-11", 0), (5, "2026-08-12", 80)])},
           rows=[(5, "2026-08-10", 0, None, None), (5, "2026-08-11", 0, 0, 0), (5, "2026-08-12", 80, 0, 80)],
           explain="A previous value of 0 is a real value, not a missing one: `prev_rows` is 0, not NULL."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO connector_daily_stats VALUES (2, '2026-08-02', 100)"],
           desc="Example 1 plus a 2026-08-02 row of 100 for connector 2",
           rows=[(1, "2026-08-01", 1000, None, None), (1, "2026-08-02", 1500, 1000, 500), (1, "2026-08-03", 1200, 1500, -300),
                 (2, "2026-08-01", 300, None, None), (2, "2026-08-02", 100, 300, -200), (2, "2026-08-03", 450, 100, 350)],
           why="a row inserted out of order changes the comparison for later days"),
      dict(base=1, sql=["DELETE FROM connector_daily_stats", "INSERT INTO connector_daily_stats VALUES (9, '2026-08-05', 10)"],
           desc="a table with a single row (9, 2026-08-05, 10)",
           rows=[(9, "2026-08-05", 10, None, None)], why="a single row has no previous day"),
  ],
  approach="`LAG(rows_synced) OVER (PARTITION BY connector_id ORDER BY stat_date)` fetches the previous recorded value; subtract it for the change (NULL propagates on the first row). O(n log n).",
  sql="""SELECT connector_id,
       stat_date,
       rows_synced,
       LAG(rows_synced) OVER (PARTITION BY connector_id ORDER BY stat_date)               AS prev_rows,
       rows_synced - LAG(rows_synced) OVER (PARTITION BY connector_id ORDER BY stat_date) AS change
FROM connector_daily_stats
ORDER BY connector_id, stat_date;""",
  alternatives="A self join to the row with the greatest earlier `stat_date` for the same connector (via a correlated subquery for MAX(stat_date) < current) gives the same result. Joining on `stat_date = current date − 1 day` is wrong because it misses gaps.",
  hint="You need a value from the row just before the current one, within the same connector. Which window function looks backwards?",
  rubric=["Uses LAG (or an equivalent self join) to get the previous recorded day's value.",
          "Partitions by connector_id and orders by stat_date.",
          "First row per connector has NULL prev_rows and change; a calendar-day-minus-one join earns partial credit.",
          "change = rows_synced − prev_rows; correct columns and order."],
  checkpoints=["LAG(rows_synced) or equivalent",
               "PARTITION BY connector_id",
               "ORDER BY stat_date inside the window",
               "change computed as the difference",
               "NULLs on each connector's first row",
               "ORDER BY connector_id, stat_date"])

Q(id="qb-sql-n16", difficulty="medium", title="Revenue Share by Plan",
  topic="Aggregation · Percent of Total",
  body="Leadership wants to know what share of total invoiced revenue comes from each subscription plan. Each customer is on one plan.\n\nReturn every plan that has at least one invoice, with its revenue and its percentage of the overall revenue.",
  schema=["`customers(customer_id INT, plan TEXT)`",
          "`invoices(invoice_id INT, customer_id INT, amount DECIMAL)` — every invoice's customer exists."],
  columns=["plan", "revenue", "pct_of_total"],
  order="Order by `revenue` descending, then `plan` alphabetically.",
  notes=["`pct_of_total` = 100 × plan revenue / total revenue, rounded to 2 decimals. Watch out for integer division in your dialect.",
         "Plans whose customers have no invoices are not listed."],
  examples=[
      dict(tables={"customers": (["customer_id", "plan"], [(1, "starter"), (2, "business"), (3, "starter"), (4, "enterprise"), (5, "business")]),
                   "invoices": (["invoice_id", "customer_id", "amount"], [(1, 1, 100), (2, 2, 400), (3, 3, 100), (4, 4, 1000), (5, 5, 400), (6, 2, 200)])},
           rows=[("business", 1000, 45.45), ("enterprise", 1000, 45.45), ("starter", 200, 9.09)],
           explain="Total revenue is 2200. Business (400 + 400 + 200) and enterprise (1000) tie at 1000, so they are ordered by name. 200 / 2200 = 9.09%."),
      dict(tables={"customers": (["customer_id", "plan"], [(1, "starter"), (2, "pro")]),
                   "invoices": (["invoice_id", "customer_id", "amount"], [(1, 1, 1), (2, 1, 1), (3, 2, 1)])},
           rows=[("starter", 2, 66.67), ("pro", 1, 33.33)],
           explain="Total revenue is 3. With integer columns, `2 / 3 * 100` evaluates to 0 in many dialects (integer division), so multiply by `100.0` first: 200.0 / 3 = 66.67."),
  ],
  hidden=[
      dict(base=1, sql=["INSERT INTO customers VALUES (3, 'enterprise')"],
           desc="Example 2 plus an enterprise customer with no invoices",
           rows=[("starter", 2, 66.67), ("pro", 1, 33.33)], why="a plan with no revenue does not appear and does not change the total"),
      dict(base=1, sql=["DELETE FROM invoices WHERE invoice_id = 2"],
           desc="Example 2 without invoice 2",
           rows=[("pro", 1, 50.0), ("starter", 1, 50.0)], why="tie on revenue ordered by plan; integer division would show 0"),
  ],
  approach="Join invoices to customers, sum per plan, and divide by the grand total obtained with `SUM(...) OVER ()` (or a scalar subquery). O(n + m).",
  sql="""WITH plan_revenue AS (
    SELECT c.plan, SUM(i.amount) AS revenue
    FROM invoices i
    JOIN customers c ON c.customer_id = i.customer_id
    GROUP BY c.plan
)
SELECT plan,
       revenue,
       ROUND(100.0 * revenue / SUM(revenue) OVER (), 2) AS pct_of_total
FROM plan_revenue
ORDER BY revenue DESC, plan;""",
  alternatives="`ROUND(100.0 * SUM(i.amount) / (SELECT SUM(amount) FROM invoices), 2)` in a single GROUP BY query, or a CROSS JOIN to a one-row totals CTE, are equally correct.",
  hint="Each plan's row needs the grand total too. How can a grouped query see a number computed over all rows?",
  rubric=["Joins invoices to customers and sums per plan.",
          "Divides by the overall total (window SUM OVER (), scalar subquery or totals CTE).",
          "Avoids integer division and rounds to 2 decimals; truncated percentages earn partial credit.",
          "Correct columns and order including the tie-break."],
  checkpoints=["JOIN on customer_id",
               "GROUP BY plan with SUM(amount)",
               "Grand total computed over all invoices",
               "100.0 (or CAST) to avoid integer division",
               "ROUND(..., 2)",
               "ORDER BY revenue DESC, plan"])

Q(id="qb-sql-n17", difficulty="medium", title="Customers Using Both Postgres and Salesforce",
  topic="Aggregation · HAVING · Set Logic",
  body="Marketing is writing a case study about customers who combine a database source with a CRM source. Find every customer who has **at least one** `postgres` connector **and at least one** `salesforce` connector. Other connector types do not matter.",
  schema=["`connectors(connector_id INT, customer_id INT, source_type TEXT)`"],
  columns=["customer_id"],
  order="Order by `customer_id` ascending.",
  notes=["A customer can have several connectors of the same type."],
  examples=[
      dict(tables={"connectors": (["connector_id", "customer_id", "source_type"], [
          (1, 10, "postgres"), (2, 10, "salesforce"), (3, 11, "postgres"), (4, 11, "postgres"), (5, 12, "salesforce"),
          (6, 12, "mysql"), (7, 13, "salesforce"), (8, 13, "postgres"), (9, 13, "hubspot")])},
           rows=[(10,), (13,)],
           explain="Customer 11 has two connectors of the allowed types, but both are postgres, so `HAVING COUNT(*) = 2` would wrongly include it. Customer 12 has no postgres connector."),
      dict(tables={"connectors": (["connector_id", "customer_id", "source_type"], [
          (1, 20, "postgres"), (2, 20, "mysql"), (3, 21, "salesforce"), (4, 21, "salesforce")])},
           rows=[],
           explain="Neither customer has both types. A single-row condition like `source_type = 'postgres' AND source_type = 'salesforce'` is never true for any row."),
  ],
  hidden=[
      dict(base=1, sql=["INSERT INTO connectors VALUES (5, 20, 'salesforce')"],
           desc="Example 2 plus a salesforce connector for customer 20",
           rows=[(20,)], why="customer 20 now has both types"),
      dict(base=0, sql=["INSERT INTO connectors VALUES (10, 11, 'salesforce')"],
           desc="Example 1 plus a salesforce connector for customer 11",
           rows=[(10,), (11,), (13,)], why="duplicates of one type plus one of the other still qualifies once"),
  ],
  approach="Keep only postgres and salesforce rows, group by customer and require two distinct types with `HAVING COUNT(DISTINCT source_type) = 2`. O(n).",
  sql="""SELECT customer_id
FROM connectors
WHERE source_type IN ('postgres', 'salesforce')
GROUP BY customer_id
HAVING COUNT(DISTINCT source_type) = 2
ORDER BY customer_id;""",
  alternatives="`INTERSECT` of the two customer sets, two EXISTS subqueries, a self join on customer_id with one side postgres and the other salesforce (plus DISTINCT), or `HAVING SUM(CASE WHEN source_type='postgres' THEN 1 ELSE 0 END) > 0 AND SUM(CASE WHEN source_type='salesforce' THEN 1 ELSE 0 END) > 0` are all correct.",
  hint="No single row can be both postgres and salesforce. Look at each customer's group of rows instead, and be careful about duplicates of the same type.",
  rubric=["Considers each customer's set of connectors (GROUP BY/HAVING, INTERSECT, EXISTS or self join).",
          "Requires both types; COUNT(*) instead of COUNT(DISTINCT) earns partial credit.",
          "Each qualifying customer appears once.",
          "Single customer_id column ordered ascending."],
  checkpoints=["Restricts to the two relevant source types",
               "GROUP BY customer_id (or equivalent set logic)",
               "COUNT(DISTINCT source_type) = 2 (or two existence checks)",
               "No duplicate customers in output",
               "ORDER BY customer_id"])

Q(id="qb-sql-n18", difficulty="medium", title="Deduplicate Replayed Events",
  topic="Window Functions · Deduplication",
  body="A replay of the ingestion queue loaded some events more than once. Copies share the same `event_id`, and a later copy may carry a **corrected** `event_type`. The rule is: for each `event_id`, keep only the copy with the **latest** `loaded_at`.\n\nReturn the cleaned events.",
  schema=["`raw_events(event_id INT, user_id INT, event_type TEXT, loaded_at TEXT)` — copies of the same event always have different `loaded_at` values."],
  columns=["event_id", "user_id", "event_type", "loaded_at"],
  order="Order by `event_id` ascending.",
  notes=[DATE_NOTE, "Rows are not stored in `loaded_at` order."],
  examples=[
      dict(tables={"raw_events": (["event_id", "user_id", "event_type", "loaded_at"], [
          (1, 100, "signup", "2026-09-01 10:00:00"), (2, 100, "login", "2026-09-01 10:05:00"), (1, 100, "signup", "2026-09-02 03:00:00"),
          (3, 101, "purchase", "2026-09-01 11:00:00"), (3, 101, "refund", "2026-09-02 03:00:00"), (4, 102, "login", "2026-09-01 12:00:00")])},
           rows=[(1, 100, "signup", "2026-09-02 03:00:00"), (2, 100, "login", "2026-09-01 10:05:00"),
                 (3, 101, "refund", "2026-09-02 03:00:00"), (4, 102, "login", "2026-09-01 12:00:00")],
           explain="Event 3's corrected copy says `refund`. `GROUP BY event_id` with `MAX(loaded_at)` and `MAX(event_type)` would mix columns from different copies (it would return `refund` here only by alphabetical luck)."),
      dict(tables={"raw_events": (["event_id", "user_id", "event_type", "loaded_at"], [
          (7, 200, "login", "2026-09-05 08:00:00"), (7, 200, "logout", "2026-09-05 07:00:00"), (7, 200, "login", "2026-09-04 23:00:00")])},
           rows=[(7, 200, "login", "2026-09-05 08:00:00")],
           explain="Three copies: the one loaded at 08:00 on 5 September is the latest, so its `login` wins even though `logout` was loaded in between."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO raw_events VALUES (4, 102, 'checkout', '2026-09-03 00:00:00')"],
           desc="Example 1 plus a later copy of event 4 with event_type 'checkout'",
           rows=[(1, 100, "signup", "2026-09-02 03:00:00"), (2, 100, "login", "2026-09-01 10:05:00"),
                 (3, 101, "refund", "2026-09-02 03:00:00"), (4, 102, "checkout", "2026-09-03 00:00:00")],
           why="MAX(event_type) would return the old value 'login' here, because 'login' sorts after 'checkout'"),
      dict(base=1, sql=["INSERT INTO raw_events VALUES (8, 201, 'signup', '2026-09-05 09:00:00')"],
           desc="Example 2 plus a single-copy event 8",
           rows=[(7, 200, "login", "2026-09-05 08:00:00"), (8, 201, "signup", "2026-09-05 09:00:00")],
           why="events with one copy are kept unchanged"),
  ],
  approach="Number the copies of each event with `ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY loaded_at DESC)` and keep number 1, so every column comes from the same winning row. O(n log n).",
  sql="""WITH numbered AS (
    SELECT event_id, user_id, event_type, loaded_at,
           ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY loaded_at DESC) AS rn
    FROM raw_events
)
SELECT event_id, user_id, event_type, loaded_at
FROM numbered
WHERE rn = 1
ORDER BY event_id;""",
  alternatives="Join back to `SELECT event_id, MAX(loaded_at) ... GROUP BY event_id` on both columns (safe because loaded_at is unique per event), or `NOT EXISTS` a later copy. `SELECT DISTINCT *` is wrong because the copies differ in loaded_at.",
  hint="Aggregating each column separately can mix values from different copies. How can you pick one whole row per event_id?",
  rubric=["Returns exactly one row per event_id.",
          "All columns come from the copy with the latest loaded_at (ROW_NUMBER, join-back on MAX, or NOT EXISTS).",
          "Independent MAX() per column or DISTINCT earns little credit.",
          "Correct columns and order."],
  checkpoints=["Partitions/groups by event_id",
               "Chooses the latest loaded_at",
               "Takes the whole winning row, not per-column aggregates",
               "Single-copy events are kept",
               "ORDER BY event_id"])

Q(id="qb-sql-n19", difficulty="medium", title="Customers Spending Above Their Region's Average",
  topic="Subqueries · CTEs · Aggregation",
  body="Regional sales managers want to see their top customers. A customer's **total spend** is the sum of their orders. A region's **average** is the average of the total spend of the customers in that region **who have placed at least one order**.\n\nReturn every customer whose total spend is strictly above their region's average.",
  schema=["`customers(customer_id INT, name TEXT, region TEXT)`",
          "`orders(order_id INT, customer_id INT, amount DECIMAL)`"],
  columns=["customer_id", "name", "region", "total_spent", "region_avg"],
  order="Order by `region`, then `total_spent` descending, then `customer_id`.",
  notes=["Round `region_avg` to 2 decimals in the output (compare using the unrounded value).",
         "The region average is over customers, not over individual orders."],
  examples=[
      dict(tables={"customers": (["customer_id", "name", "region"], [
          (1, "Asha", "North"), (2, "Ben", "North"), (3, "Chen", "North"), (4, "Dev", "South"), (5, "Eva", "South"), (6, "Farah", "South")]),
          "orders": (["order_id", "customer_id", "amount"], [(1, 1, 500), (2, 1, 300), (3, 2, 200), (4, 3, 100), (5, 4, 700), (6, 5, 700), (7, 2, 100)])},
           rows=[(1, "Asha", "North", 800, 400.0)],
           explain="North totals are 800, 300 and 100, averaging 400, so only Asha is above. Averaging individual North orders (240) would wrongly include Ben. South totals are 700 and 700 (Farah has no orders and is left out), so nobody is strictly above 700."),
      dict(tables={"customers": (["customer_id", "name", "region"], [(1, "Gus", "West"), (2, "Ira", "West"), (3, "Jay", "West")]),
                   "orders": (["order_id", "customer_id", "amount"], [(1, 1, 10), (2, 2, 20), (3, 3, 40)])},
           rows=[(3, "Jay", "West", 40, 23.33)],
           explain="The average is 70 / 3 = 23.33, so only Jay qualifies."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO orders VALUES (8, 6, 100)"],
           desc="Example 1 plus a 100 order for Farah",
           rows=[(1, "Asha", "North", 800, 400.0), (4, "Dev", "South", 700, 500.0), (5, "Eva", "South", 700, 500.0)],
           why="South average drops to 500; the tie on total_spent is ordered by customer_id"),
      dict(base=1, sql=["DELETE FROM orders WHERE order_id = 3"],
           desc="Example 2 without Jay's order",
           rows=[(2, "Ira", "West", 20, 15.0)], why="customers without orders are excluded from the average (otherwise it would be 10)"),
  ],
  approach="CTE 1: total per customer (inner join, so only customers with orders). CTE 2 (or a window AVG partitioned by region): average of those totals per region. Keep customers whose total exceeds it. O(n + m).",
  sql="""WITH totals AS (
    SELECT c.customer_id, c.name, c.region, SUM(o.amount) AS total_spent
    FROM customers c
    JOIN orders o ON o.customer_id = c.customer_id
    GROUP BY c.customer_id, c.name, c.region
), with_avg AS (
    SELECT t.*, AVG(total_spent) OVER (PARTITION BY region) AS region_avg
    FROM totals t
)
SELECT customer_id, name, region, total_spent, ROUND(region_avg, 2) AS region_avg
FROM with_avg
WHERE total_spent > region_avg
ORDER BY region, total_spent DESC, customer_id;""",
  alternatives="A second CTE `region_avgs AS (SELECT region, AVG(total_spent) ... GROUP BY region)` joined to totals, or a correlated subquery `WHERE total_spent > (SELECT AVG(t2.total_spent) FROM totals t2 WHERE t2.region = t.region)`, are equally correct.",
  hint="There are two levels of aggregation here: orders into customers, then customers into regions. Build the first level before computing the second.",
  rubric=["Computes total spend per customer first.",
          "Averages customer totals per region (not order amounts), excluding customers with no orders.",
          "Strict `>` comparison; uses the unrounded average for the comparison.",
          "Correct columns, rounding and three-level ordering."],
  checkpoints=["Per-customer SUM(amount)",
               "Per-region AVG over customer totals",
               "Customers without orders excluded from the average",
               "Strictly greater than the region average",
               "region_avg rounded to 2 decimals",
               "ORDER BY region, total_spent DESC, customer_id"])

Q(id="qb-sql-n20", difficulty="medium", title="Rank Support Agents by Resolved Tickets",
  topic="Window Functions · DENSE_RANK · LEFT JOIN",
  body="For the monthly support leaderboard, count each agent's **resolved** tickets and rank the agents: the most resolved tickets get rank 1, agents with equal counts share a rank, and the next distinct count gets the **next** rank number (no gaps, e.g. 1, 1, 2). Agents who resolved nothing must still appear with 0.",
  schema=["`agents(agent_id INT, name TEXT)` — names are unique.",
          "`tickets(ticket_id INT, agent_id INT, status TEXT)` — `status` is `'open'` or `'resolved'`; `agent_id` is NULL for unassigned tickets."],
  columns=["agent_rank", "name", "resolved_tickets"],
  order="Order by `agent_rank`, then `name` alphabetically.",
  notes=[],
  examples=[
      dict(tables={"agents": (["agent_id", "name"], [(1, "Kavya"), (2, "Leo"), (3, "Meera"), (4, "Nikhil")]),
                   "tickets": (["ticket_id", "agent_id", "status"], [
                       (1, 1, "resolved"), (2, 1, "resolved"), (3, 2, "resolved"), (4, 2, "resolved"),
                       (5, 3, "resolved"), (6, 3, "open"), (7, 1, "open"), (8, 2, "open")])},
           rows=[(1, "Kavya", 2), (1, "Leo", 2), (2, "Meera", 1), (3, "Nikhil", 0)],
           explain="Kavya and Leo tie with 2 and share rank 1; Meera gets rank 2 (not 3). Nikhil has no tickets but appears with 0. Open tickets do not count."),
      dict(tables={"agents": (["agent_id", "name"], [(1, "Omar"), (2, "Pooja")]),
                   "tickets": (["ticket_id", "agent_id", "status"], [(1, 1, "open"), (2, 2, "open")])},
           rows=[(1, "Omar", 0), (1, "Pooja", 0)],
           explain="Nobody resolved anything, so both agents have 0 and share rank 1."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO tickets VALUES (9, 4, 'resolved'), (10, 4, 'resolved'), (11, 4, 'resolved')"],
           desc="Example 1 plus three resolved tickets for Nikhil",
           rows=[(1, "Nikhil", 3), (2, "Kavya", 2), (2, "Leo", 2), (3, "Meera", 1)], why="RANK would give Meera 4; DENSE_RANK gives 3"),
      dict(base=0, sql=["UPDATE tickets SET agent_id = NULL WHERE ticket_id = 5"],
           desc="Example 1 with ticket 5 unassigned",
           rows=[(1, "Kavya", 2), (1, "Leo", 2), (2, "Meera", 0), (2, "Nikhil", 0)], why="COUNT(*) after a LEFT JOIN would give Meera 1 (her open ticket) instead of 0"),
  ],
  approach="LEFT JOIN agents to their resolved tickets (status condition in ON), count with `COUNT(t.ticket_id)` so agents without matches get 0, then apply `DENSE_RANK() OVER (ORDER BY resolved_tickets DESC)`. O(n + m + a log a).",
  sql="""WITH counts AS (
    SELECT a.agent_id, a.name, COUNT(t.ticket_id) AS resolved_tickets
    FROM agents a
    LEFT JOIN tickets t
           ON t.agent_id = a.agent_id
          AND t.status = 'resolved'
    GROUP BY a.agent_id, a.name
)
SELECT DENSE_RANK() OVER (ORDER BY resolved_tickets DESC) AS agent_rank,
       name,
       resolved_tickets
FROM counts
ORDER BY agent_rank, name;""",
  alternatives="`SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END)` after a plain LEFT JOIN on agent_id also gives 0 for agents without resolved tickets. Without window functions, the dense rank equals 1 + the number of distinct higher counts (correlated subquery).",
  hint="Two separate things to get right: agents with no resolved tickets must still show up with 0, and the ranking must not skip numbers after a tie.",
  rubric=["Counts only resolved tickets per agent, with agents having none shown as 0 (LEFT JOIN + COUNT(column) or conditional SUM).",
          "Uses DENSE_RANK (or equivalent); RANK earns partial credit.",
          "Orders the ranking by resolved count descending.",
          "Correct columns and ordering."],
  checkpoints=["agents is the preserved side of the join",
               "Only status = 'resolved' counted",
               "COUNT(t.ticket_id), not COUNT(*), so zero-ticket agents get 0",
               "DENSE_RANK() OVER (ORDER BY resolved_tickets DESC)",
               "ORDER BY agent_rank, name"])

Q(id="qb-sql-n21", difficulty="medium", title="Monthly Pipeline Success Rate",
  topic="Date Bucketing · Conditional Aggregation",
  body="The reliability report shows, for each calendar month, how many pipeline runs there were, how many failed, and what percentage succeeded. Cancelled runs count towards the total but are neither successes nor failures.",
  schema=["`pipeline_runs(run_id INT, status TEXT, started_at TEXT)` — `status` is `'success'`, `'failed'` or `'cancelled'`."],
  columns=["run_month", "total_runs", "failed_runs", "success_rate"],
  order="Order by `run_month` ascending.",
  notes=[DATE_NOTE,
         "`run_month` is text in the form `YYYY-MM`. Months without runs do not appear.",
         "`success_rate` = 100 × successful runs / total runs, rounded to 2 decimals. Avoid integer division."],
  examples=[
      dict(tables={"pipeline_runs": (["run_id", "status", "started_at"], [
          (1, "success", "2026-01-03 10:00:00"), (2, "failed", "2026-01-15 11:00:00"), (3, "success", "2026-01-31 23:59:00"),
          (4, "success", "2026-02-01 00:00:00"), (5, "cancelled", "2026-02-10 09:00:00"), (6, "failed", "2026-02-11 09:00:00"),
          (7, "failed", "2026-03-05 12:00:00")])},
           rows=[("2026-01", 3, 1, 66.67), ("2026-02", 3, 1, 33.33), ("2026-03", 1, 1, 0.0)],
           explain="January has 2 successes out of 3. February has 1 success, 1 failure and 1 cancellation, so 1 / 3 = 33.33%. Run 3 at 23:59 on 31 January belongs to January."),
      dict(tables={"pipeline_runs": (["run_id", "status", "started_at"], [
          (1, "success", "2025-12-31 22:00:00"), (2, "success", "2026-12-01 08:00:00"), (3, "failed", "2026-12-02 08:00:00")])},
           rows=[("2025-12", 1, 0, 100.0), ("2026-12", 2, 1, 50.0)],
           explain="December 2025 and December 2026 are different months; bucketing by month number alone would merge them."),
  ],
  hidden=[
      dict(base=0, sql=["UPDATE pipeline_runs SET status = 'success' WHERE run_id = 5"],
           desc="Example 1 with cancelled run 5 changed to success",
           rows=[("2026-01", 3, 1, 66.67), ("2026-02", 3, 1, 66.67), ("2026-03", 1, 1, 0.0)], why="the cancelled run was counted in the total but not as a success"),
      dict(base=0, sql=["DELETE FROM pipeline_runs WHERE run_id IN (2, 6, 7)"],
           desc="Example 1 without any failed runs",
           rows=[("2026-01", 2, 0, 100.0), ("2026-02", 2, 0, 50.0)], why="failed_runs must be 0, not NULL, and the cancellation still lowers February's rate"),
  ],
  approach="Bucket by the `YYYY-MM` prefix, then use conditional aggregation (`SUM(CASE WHEN ... THEN 1 ELSE 0 END)`) for failures and successes in one pass. O(n).",
  sql="""SELECT substr(started_at, 1, 7) AS run_month,
       COUNT(*) AS total_runs,
       SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS failed_runs,
       ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate
FROM pipeline_runs
GROUP BY substr(started_at, 1, 7)
ORDER BY run_month;""",
  alternatives="`strftime('%Y-%m', started_at)` (SQLite), `TO_CHAR(started_at, 'YYYY-MM')` (PostgreSQL) or `DATE_FORMAT(started_at, '%Y-%m')` (MySQL) for the month. `COUNT(CASE WHEN status = 'failed' THEN 1 END)` or PostgreSQL's `COUNT(*) FILTER (WHERE ...)` are fine too.",
  hint="You can count several different things in the same GROUP BY by putting a CASE expression inside an aggregate.",
  rubric=["Buckets by year and month (YYYY-MM).",
          "Uses conditional aggregation for failed and successful counts in one query.",
          "Cancelled runs are in the total only; success_rate avoids integer division and is rounded.",
          "Correct column names and month order."],
  checkpoints=["Month bucket includes the year",
               "COUNT(*) for total_runs",
               "Conditional count for failed_runs (0 when none)",
               "Conditional count of successes divided by total, × 100.0",
               "ROUND(..., 2)",
               "ORDER BY run_month"])

Q(id="qb-sql-n22", difficulty="medium", title="Days From Signup to First Order",
  topic="LEFT JOIN · Aggregation · Dates",
  body="Growth wants to know how quickly new customers start buying. For every customer, return the date of their **first** order and the number of days between signing up and that first order. Customers who have never ordered must still appear, with NULL in both columns.",
  schema=["`customers(customer_id INT, signup_date TEXT)`",
          "`orders(order_id INT, customer_id INT, order_date TEXT)` — dates look like `2026-01-12`; an order is never before the signup date."],
  columns=["customer_id", "first_order_date", "days_to_first_order"],
  order="Order by `customer_id` ascending.",
  notes=[DATE_NOTE,
         "`days_to_first_order` is a whole number of days (an order on the signup day is 0). Use your dialect's date difference: `julianday(a) - julianday(b)` in SQLite, `a::date - b::date` in PostgreSQL, `DATEDIFF(a, b)` in MySQL."],
  examples=[
      dict(tables={"customers": (["customer_id", "signup_date"], [(1, "2026-01-10"), (2, "2026-01-15"), (3, "2026-02-01"), (4, "2026-02-20")]),
                   "orders": (["order_id", "customer_id", "order_date"], [
                       (1, 1, "2026-01-12"), (2, 1, "2026-01-11"), (3, 2, "2026-03-01"), (4, 3, "2026-02-01"), (5, 2, "2026-02-14")])},
           rows=[(1, "2026-01-11", 1), (2, "2026-02-14", 30), (3, "2026-02-01", 0), (4, None, None)],
           explain="Customer 1's first order is order 2 (11 January), not the first row. Customer 2 waited from 15 January to 14 February, which is 30 days. Customer 3 ordered on signup day. Customer 4 never ordered."),
      dict(tables={"customers": (["customer_id", "signup_date"], [(5, "2027-12-30"), (6, "2028-02-28")]),
                   "orders": (["order_id", "customer_id", "order_date"], [(1, 5, "2028-03-01"), (2, 6, "2028-03-01"), (3, 6, "2028-03-05")])},
           rows=[(5, "2028-03-01", 62), (6, "2028-03-01", 2)],
           explain="2028 is a leap year, so 28 February to 1 March is 2 days; subtracting day-of-month numbers or assuming 30-day months gives wrong answers."),
  ],
  hidden=[
      dict(base=0, sql=["DELETE FROM orders WHERE customer_id = 1"],
           desc="Example 1 with all of customer 1's orders removed",
           rows=[(1, None, None), (2, "2026-02-14", 30), (3, "2026-02-01", 0), (4, None, None)], why="customer kept with NULLs"),
      dict(base=0, sql=["INSERT INTO orders VALUES (6, 4, '2026-02-20')"],
           desc="Example 1 plus an order by customer 4 on their signup day",
           rows=[(1, "2026-01-11", 1), (2, "2026-02-14", 30), (3, "2026-02-01", 0), (4, "2026-02-20", 0)], why="same-day order is 0, not NULL"),
  ],
  approach="LEFT JOIN customers to orders, take `MIN(order_date)` per customer, and compute the day difference from the signup date with a real date function. O(n + m).",
  sql="""SELECT c.customer_id,
       MIN(o.order_date) AS first_order_date,
       CAST(julianday(MIN(o.order_date)) - julianday(c.signup_date) AS INTEGER) AS days_to_first_order
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id, c.signup_date
ORDER BY c.customer_id;""",
  alternatives="Compute first orders in a CTE (`SELECT customer_id, MIN(order_date) ... GROUP BY customer_id`) and LEFT JOIN it to customers. PostgreSQL: `MIN(o.order_date)::date - c.signup_date::date`; MySQL: `DATEDIFF(MIN(o.order_date), c.signup_date)`.",
  hint="Find each customer's earliest order first, and make sure customers with no orders survive the join.",
  rubric=["LEFT JOIN (or equivalent) so customers without orders appear with NULLs.",
          "Uses MIN(order_date) per customer.",
          "Computes the difference with a proper date function (handles month lengths and leap years).",
          "Correct columns and order."],
  checkpoints=["customers preserved via LEFT JOIN",
               "MIN(order_date) per customer",
               "Date difference via a date function, not string arithmetic",
               "Signup-day order gives 0",
               "NULLs for customers with no orders",
               "ORDER BY customer_id"])

Q(id="qb-sql-n23", difficulty="medium", title="Failures Followed by a Recovery",
  topic="Window Functions · LEAD",
  body="A failed pipeline run is **recovered** if the very next run of the **same pipeline** (by `started_at`) succeeded. If the next run failed again or was cancelled, or there is no next run yet, it is not recovered.\n\nList every recovered failure together with the run that recovered it.",
  schema=["`pipeline_runs(run_id INT, pipeline_id INT, status TEXT, started_at TEXT)` — `status` is `'success'`, `'failed'` or `'cancelled'`; run ids do not always follow time order."],
  columns=["pipeline_id", "failed_run_id", "recovery_run_id"],
  order="Order by `pipeline_id`, then the failed run's `started_at`.",
  notes=[DATE_NOTE, "Runs of the same pipeline never share a `started_at`."],
  examples=[
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "started_at"], [
          (1, 1, "success", "2026-03-01 01:00:00"), (2, 2, "failed", "2026-03-01 01:30:00"), (3, 1, "failed", "2026-03-01 02:00:00"),
          (4, 2, "success", "2026-03-01 02:30:00"), (5, 1, "success", "2026-03-01 03:00:00"), (6, 1, "failed", "2026-03-01 04:00:00"),
          (7, 1, "failed", "2026-03-01 05:00:00"), (8, 1, "success", "2026-03-01 06:00:00"), (9, 2, "failed", "2026-03-01 07:00:00")])},
           rows=[(1, 3, 5), (1, 7, 8), (2, 2, 4)],
           explain="Run 3's next run in pipeline 1 is run 5 (success). Run 6 is followed by another failure, run 7, which is then recovered by run 8. Run 2 (pipeline 2) is recovered by run 4, even though the next row overall is run 3 of pipeline 1. Run 9 has no next run yet."),
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "started_at"], [
          (1, 5, "failed", "2026-04-01 10:00:00"), (2, 5, "cancelled", "2026-04-01 11:00:00"), (3, 5, "success", "2026-04-01 12:00:00")])},
           rows=[],
           explain="The run directly after the failure was cancelled, so the later success does not count as a recovery."),
  ],
  hidden=[
      dict(base=1, sql=["INSERT INTO pipeline_runs VALUES (4, 5, 'failed', '2026-04-01 13:00:00'), (5, 5, 'success', '2026-04-01 14:00:00')"],
           desc="Example 2 plus a failure at 13:00 and a success at 14:00",
           rows=[(5, 4, 5)], why="only the directly-followed failure counts"),
      dict(base=0, sql=["INSERT INTO pipeline_runs VALUES (10, 1, 'success', '2026-03-01 04:30:00')"],
           desc="Example 1 plus run 10 (success) for pipeline 1 at 04:30",
           rows=[(1, 3, 5), (1, 6, 10), (1, 7, 8), (2, 2, 4)], why="next run is by time, not by run_id; the output is ordered by the failed run's time"),
  ],
  approach="Use `LEAD(status)` and `LEAD(run_id)` partitioned by pipeline and ordered by started_at to look at the next run, then keep failed rows whose next status is success. O(n log n).",
  sql="""WITH with_next AS (
    SELECT pipeline_id, run_id, status, started_at,
           LEAD(run_id) OVER (PARTITION BY pipeline_id ORDER BY started_at) AS next_run_id,
           LEAD(status) OVER (PARTITION BY pipeline_id ORDER BY started_at) AS next_status
    FROM pipeline_runs
)
SELECT pipeline_id,
       run_id      AS failed_run_id,
       next_run_id AS recovery_run_id
FROM with_next
WHERE status = 'failed'
  AND next_status = 'success'
ORDER BY pipeline_id, started_at;""",
  alternatives="A self join to the next run (same pipeline, smallest started_at greater than the failed run's, found with a correlated MIN subquery or NOT EXISTS of anything in between) is a valid non-window answer.",
  hint="For each run you need to peek at the following run of the same pipeline. Which window function looks forward, and how do you keep pipelines separate?",
  rubric=["Looks at the immediately next run within the same pipeline (LEAD with PARTITION BY pipeline_id, or an equivalent self join).",
          "Orders by started_at, not run_id.",
          "Filters failed runs whose next status is success; ignores later successes after a cancel/failure.",
          "Returns both run ids with correct column names and ordering."],
  checkpoints=["LEAD (or next-run self join) partitioned by pipeline_id",
               "Window ordered by started_at",
               "Condition status = 'failed' AND next_status = 'success'",
               "Failures with no next run are excluded",
               "recovery_run_id is the next run's id",
               "ORDER BY pipeline_id, started_at"])

# ---------------------------------------------------------------- HARD (7)
Q(id="qb-sql-n24", difficulty="hard", title="Longest Success Streak per Pipeline",
  topic="Window Functions · Gaps and Islands",
  body="The reliability team celebrates stable pipelines. For each pipeline, find the length of its **longest streak of consecutive successful runs**, where consecutive means adjacent in `started_at` order within that pipeline. Any non-success run (`failed` or `cancelled`) breaks a streak. Pipelines that never succeeded have a longest streak of 0.",
  schema=["`pipeline_runs(run_id INT, pipeline_id INT, status TEXT, started_at TEXT)` — run ids do not always follow time order; runs of the same pipeline never share a `started_at`."],
  columns=["pipeline_id", "longest_streak"],
  order="Order by `pipeline_id` ascending.",
  notes=[DATE_NOTE, "Every pipeline that has at least one run appears."],
  examples=[
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "started_at"], [
          (1, 1, "success", "2026-03-01 08:00:00"), (2, 1, "success", "2026-03-02 08:00:00"), (3, 1, "failed", "2026-03-03 08:00:00"),
          (4, 1, "success", "2026-03-04 08:00:00"), (5, 1, "success", "2026-03-05 08:00:00"), (6, 1, "success", "2026-03-06 08:00:00"),
          (7, 1, "failed", "2026-03-07 08:00:00"), (8, 2, "failed", "2026-03-01 09:00:00"), (9, 2, "failed", "2026-03-02 09:00:00"),
          (10, 3, "success", "2026-03-01 10:00:00")])},
           rows=[(1, 3), (2, 0), (3, 1)],
           explain="Pipeline 1 runs S S F S S S F, so its streaks are 2 and 3 and the longest is 3. Pipeline 2 never succeeded (0). Pipeline 3 has a single success."),
      dict(tables={"pipeline_runs": (["run_id", "pipeline_id", "status", "started_at"], [
          (21, 4, "success", "2026-04-01 08:00:00"), (22, 4, "success", "2026-04-02 08:00:00"), (23, 4, "success", "2026-04-05 08:00:00"),
          (24, 4, "failed", "2026-04-03 08:00:00"), (25, 4, "success", "2026-04-04 08:00:00")])},
           rows=[(4, 2)],
           explain="In time order the runs are 21 S, 22 S, 24 F, 25 S, 23 S, so the longest streak is 2. Ordering by run_id (S S S F S) would wrongly give 3."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO pipeline_runs VALUES (11, 2, 'success', '2026-03-03 09:00:00'), (12, 2, 'success', '2026-03-04 09:00:00')"],
           desc="Example 1 plus two successes at the end of pipeline 2",
           rows=[(1, 3), (2, 2), (3, 1)], why="a streak at the very end of the history counts"),
      dict(base=0, sql=["UPDATE pipeline_runs SET status = 'success' WHERE run_id = 3"],
           desc="Example 1 with run 3 changed to success",
           rows=[(1, 6), (2, 0), (3, 1)], why="two streaks merge into one of length 6"),
  ],
  approach="Gaps and islands: within each pipeline, `ROW_NUMBER()` over all runs minus `ROW_NUMBER()` over runs of the same status is constant inside each block of consecutive equal statuses. Count the success blocks, take the max per pipeline, and LEFT JOIN from the list of pipelines with COALESCE for 0. O(n log n).",
  sql="""WITH numbered AS (
    SELECT pipeline_id, status,
           ROW_NUMBER() OVER (PARTITION BY pipeline_id ORDER BY started_at)
         - ROW_NUMBER() OVER (PARTITION BY pipeline_id, status ORDER BY started_at) AS grp
    FROM pipeline_runs
), streaks AS (
    SELECT pipeline_id, grp, COUNT(*) AS streak_len
    FROM numbered
    WHERE status = 'success'
    GROUP BY pipeline_id, grp
), pipelines AS (
    SELECT DISTINCT pipeline_id FROM pipeline_runs
)
SELECT p.pipeline_id,
       COALESCE(MAX(s.streak_len), 0) AS longest_streak
FROM pipelines p
LEFT JOIN streaks s ON s.pipeline_id = p.pipeline_id
GROUP BY p.pipeline_id
ORDER BY p.pipeline_id;""",
  alternatives="Alternative island key: a running count of non-success runs, `SUM(CASE WHEN status <> 'success' THEN 1 ELSE 0 END) OVER (PARTITION BY pipeline_id ORDER BY started_at)`; successes sharing the same running count form one streak. A recursive CTE walking runs in order is also acceptable.",
  hint="Try to give every run in the same unbroken block of successes the same group label. Comparing a run's position among all runs with its position among successes is one way.",
  rubric=["Orders runs by started_at within each pipeline.",
          "Correctly identifies consecutive blocks (row-number difference or running count of breaks).",
          "Takes the maximum block length per pipeline and returns 0 for pipelines with no success.",
          "Partial credit for counting total successes or ordering by run_id; full credit needs correct streaks.",
          "Correct columns and order."],
  checkpoints=["Per-pipeline ordering by started_at",
               "Island/group key for consecutive successes",
               "COUNT per success island",
               "MAX island length per pipeline",
               "Pipelines without successes return 0",
               "ORDER BY pipeline_id"])

Q(id="qb-sql-n25", difficulty="hard", title="Month-1 Retention by Signup Cohort",
  topic="CTEs · Cohort Analysis · Date Bucketing",
  body="Users are grouped into **cohorts** by the calendar month they signed up. A user is **retained** if they have at least one activity in the calendar month **immediately after** their signup month (for a December signup, that is January of the next year). Activity in the signup month itself or two or more months later does not count.\n\nFor each cohort, report its size, how many users were retained and the retention percentage.",
  schema=["`signups(user_id INT, signup_date TEXT)` — one row per user.",
          "`activity(user_id INT, activity_date TEXT)` — many rows per user, possibly several on the same day."],
  columns=["cohort_month", "cohort_size", "retained_users", "retention_pct"],
  order="Order by `cohort_month` ascending.",
  notes=[DATE_NOTE,
         "`cohort_month` is `YYYY-MM`. `retention_pct` = 100 × retained_users / cohort_size, rounded to 2 decimals.",
         "A cohort with no retained users still appears, with 0."],
  examples=[
      dict(tables={"signups": (["user_id", "signup_date"], [(1, "2026-01-05"), (2, "2026-01-20"), (3, "2026-01-31"), (4, "2026-02-10"), (5, "2026-02-28")]),
                   "activity": (["user_id", "activity_date"], [
                       (1, "2026-01-06"), (1, "2026-02-03"), (1, "2026-02-10"), (2, "2026-01-25"), (2, "2026-03-02"),
                       (3, "2026-02-01"), (4, "2026-03-15"), (5, "2026-04-01")])},
           rows=[("2026-01", 3, 2, 66.67), ("2026-02", 2, 1, 50.0)],
           explain="January cohort: user 1 is active in February (twice, counted once) and user 3 on 1 February, but user 2 is only active in January and March. February cohort: user 4 is active in March; user 5 only in April. Note that user 3's activity is one day after signup yet still counts because it is in the next calendar month."),
      dict(tables={"signups": (["user_id", "signup_date"], [(10, "2025-12-15"), (11, "2025-12-31"), (12, "2026-01-01")]),
                   "activity": (["user_id", "activity_date"], [(10, "2026-01-02"), (11, "2025-12-31"), (12, "2026-03-01")])},
           rows=[("2025-12", 2, 1, 50.0), ("2026-01", 1, 0, 0.0)],
           explain="User 10 signed up in December 2025 and was active in January 2026, which is the next month across the year boundary. The January 2026 cohort retained nobody but still appears."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO activity VALUES (2, '2026-02-27')"],
           desc="Example 1 plus a February activity for user 2",
           rows=[("2026-01", 3, 3, 100.0), ("2026-02", 2, 1, 50.0)], why="the whole January cohort is now retained"),
      dict(base=1, sql=["INSERT INTO activity VALUES (12, '2026-02-28'), (12, '2026-02-01')"],
           desc="Example 2 plus two February activities for user 12",
           rows=[("2025-12", 2, 1, 50.0), ("2026-01", 1, 1, 100.0)], why="several qualifying activities count the user once (not 200%)"),
  ],
  approach="Convert each date to a month index (`year * 12 + month`) so 'next month' is simply `+ 1`, even across years. Find the distinct retained users with a join on `activity_month = signup_month + 1`, then LEFT JOIN that set to the cohorts and aggregate. O(n + m).",
  sql="""WITH cohorts AS (
    SELECT user_id,
           substr(signup_date, 1, 7) AS cohort_month,
           CAST(substr(signup_date, 1, 4) AS INTEGER) * 12 + CAST(substr(signup_date, 6, 2) AS INTEGER) AS m
    FROM signups
), active_months AS (
    SELECT DISTINCT user_id,
           CAST(substr(activity_date, 1, 4) AS INTEGER) * 12 + CAST(substr(activity_date, 6, 2) AS INTEGER) AS m
    FROM activity
), retained AS (
    SELECT DISTINCT c.user_id
    FROM cohorts c
    JOIN active_months a ON a.user_id = c.user_id AND a.m = c.m + 1
)
SELECT c.cohort_month,
       COUNT(*)         AS cohort_size,
       COUNT(r.user_id) AS retained_users,
       ROUND(100.0 * COUNT(r.user_id) / COUNT(*), 2) AS retention_pct
FROM cohorts c
LEFT JOIN retained r ON r.user_id = c.user_id
GROUP BY c.cohort_month
ORDER BY c.cohort_month;""",
  alternatives="Dialect month arithmetic is fine: `strftime('%Y-%m', signup_date, 'start of month', '+1 month')` in SQLite, `DATE_TRUNC('month', signup_date) + INTERVAL '1 month'` in PostgreSQL, `DATE_FORMAT(DATE_ADD(signup_date, INTERVAL 1 MONTH), '%Y-%m')` in MySQL. An EXISTS subquery per user (`CASE WHEN EXISTS (...) THEN 1 ELSE 0 END`) summed per cohort also works.",
  hint="Work out what 'the next calendar month' means as a value you can compare with. Then make sure each user is counted at most once, however many activities they have.",
  rubric=["Groups users into cohorts by signup year-month.",
          "Defines retention as activity in the next calendar month, including the December → January rollover.",
          "Counts each retained user once (DISTINCT / EXISTS), and keeps cohorts with 0 retained.",
          "Computes the percentage without integer division and rounds it.",
          "Partial credit for '30 days after signup' or ignoring the year rollover."],
  checkpoints=["Cohort = signup YYYY-MM",
               "Next-month comparison handles year boundaries",
               "Activity in the signup month does not count",
               "Retained users counted once",
               "Cohorts with 0 retained still listed",
               "retention_pct = ROUND(100.0 * retained / size, 2)"])

Q(id="qb-sql-n26", difficulty="hard", title="Sessionize a Clickstream",
  topic="Window Functions · LAG · Running Sum",
  body="Raw click events have no session id. Define sessions per user: a user's first click starts a session, and a new session starts whenever the gap since that user's **previous** click is **more than 30 minutes**. A gap of exactly 30 minutes stays in the same session.\n\nThe length of a session is the time from its first click to its last click, in minutes (0 for a single-click session). For each user, return the number of sessions and the length of their longest session.",
  schema=["`clicks(user_id INT, click_time TEXT)` — timestamps are on whole minutes; a user never has two clicks at the same time; rows are not stored in time order."],
  columns=["user_id", "session_count", "longest_session_minutes"],
  order="Order by `user_id` ascending.",
  notes=[DATE_NOTE,
         "Compute time differences with your dialect's functions, e.g. `strftime('%s', t)` (seconds) in SQLite, `EXTRACT(EPOCH FROM ...)` in PostgreSQL, `TIMESTAMPDIFF(MINUTE, a, b)` in MySQL."],
  examples=[
      dict(tables={"clicks": (["user_id", "click_time"], [
          (1, "2026-05-01 10:00:00"), (1, "2026-05-01 10:10:00"), (1, "2026-05-01 10:40:00"), (1, "2026-05-01 11:20:00"), (1, "2026-05-01 11:25:00"),
          (2, "2026-05-01 09:00:00"), (2, "2026-05-01 12:00:00"), (2, "2026-05-01 12:31:00"), (3, "2026-05-01 15:00:00")])},
           rows=[(1, 2, 40), (2, 3, 0), (3, 1, 0)],
           explain="User 1: 10:00, 10:10, 10:40 form one session (the 30-minute gap does not split it), lasting 40 minutes; the 40-minute gap before 11:20 starts a second session of 5 minutes. User 2's gaps are 180 and 31 minutes, so every click is its own session. User 3 has one click."),
      dict(tables={"clicks": (["user_id", "click_time"], [
          (7, "2026-05-02 01:00:00"), (7, "2026-05-01 23:50:00"), (7, "2026-05-02 00:15:00")])},
           rows=[(7, 2, 25)],
           explain="Sorted by time: 23:50, 00:15 (25-minute gap across midnight, same session), 01:00 (45-minute gap, new session). The longest session is 25 minutes."),
  ],
  hidden=[
      dict(base=0, sql=["INSERT INTO clicks VALUES (1, '2026-05-01 11:50:00'), (1, '2026-05-01 12:20:00')"],
           desc="Example 1 plus clicks by user 1 at 11:50 and 12:20",
           rows=[(1, 2, 60), (2, 3, 0), (3, 1, 0)], why="the second session grows to 11:20–12:20 = 60 minutes and becomes the longest"),
      dict(base=1, sql=["INSERT INTO clicks VALUES (9, '2026-05-03 08:00:00'), (9, '2026-05-03 08:30:00'), (9, '2026-05-03 09:00:00'), (9, '2026-05-03 09:30:00')"],
           desc="Example 2 plus user 9 clicking every 30 minutes from 08:00 to 09:30",
           rows=[(7, 2, 25), (9, 1, 90)], why="gaps of exactly 30 chain into one session longer than 30 minutes"),
  ],
  approach="LAG gives each click's previous click time; flag a click as a session start when there is no previous click or the gap exceeds 1800 seconds. A running SUM of the flags assigns a session number. Group by (user, session) for each session's length, then aggregate per user. O(n log n).",
  sql="""WITH ordered AS (
    SELECT user_id,
           CAST(strftime('%s', click_time) AS INTEGER) AS ts,
           LAG(CAST(strftime('%s', click_time) AS INTEGER))
               OVER (PARTITION BY user_id ORDER BY click_time) AS prev_ts
    FROM clicks
), flagged AS (
    SELECT user_id, ts,
           CASE WHEN prev_ts IS NULL OR ts - prev_ts > 1800 THEN 1 ELSE 0 END AS is_new
    FROM ordered
), numbered AS (
    SELECT user_id, ts,
           SUM(is_new) OVER (PARTITION BY user_id ORDER BY ts
                             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_no
    FROM flagged
), per_session AS (
    SELECT user_id, session_no, (MAX(ts) - MIN(ts)) / 60 AS minutes
    FROM numbered
    GROUP BY user_id, session_no
)
SELECT user_id,
       COUNT(*)     AS session_count,
       MAX(minutes) AS longest_session_minutes
FROM per_session
GROUP BY user_id
ORDER BY user_id;""",
  alternatives="Any dialect's timestamp difference is fine (avoid floating-point day fractions that can make an exact 30-minute gap look like 30.0000001). session_count alone can be computed as `SUM(is_new)` per user; the running sum is needed for the session lengths.",
  hint="First decide, click by click, whether a click starts a new session by comparing it with the previous click of the same user. How could you turn those start markers into a session number?",
  rubric=["Uses LAG (or equivalent) per user ordered by time to find gaps.",
          "Starts a new session only when the gap is strictly greater than 30 minutes (and on the first click).",
          "Assigns session numbers with a running sum (or equivalent) and computes per-session length as last − first click.",
          "Returns session_count and longest_session_minutes per user; counting sessions correctly but not lengths earns partial credit."],
  checkpoints=["Per-user ordering by click_time",
               "Gap computed against the previous click with a real time difference",
               "New session when gap > 30 minutes or first click",
               "Running SUM of session-start flags as session id",
               "Session length = MAX − MIN within session, in minutes",
               "COUNT of sessions and MAX length per user"])

Q(id="qb-sql-n27", difficulty="hard", title="Find Gaps in Invoice Numbers",
  topic="Window Functions · LEAD · Gaps",
  body="Auditors require invoice numbers to be continuous. Between the smallest and the largest invoice number in the table, find every **range of missing numbers** and report it as a single row with its first and last missing number.\n\nNumbers below the smallest or above the largest existing invoice are not gaps.",
  schema=["`invoices(invoice_no INT, customer_id INT, amount DECIMAL)` — `invoice_no` is unique; rows are not stored in order."],
  columns=["gap_start", "gap_end"],
  order="Order by `gap_start` ascending.",
  notes=["A single missing number is reported with `gap_start` = `gap_end`. Report each range once, not one row per missing number."],
  examples=[
      dict(tables={"invoices": (["invoice_no", "customer_id", "amount"], [
          (1001, 1, 250), (1002, 2, 90), (1005, 1, 400), (1006, 3, 120), (1007, 2, 75), (1010, 3, 60)])},
           rows=[(1003, 1004), (1008, 1009)],
           explain="1003–1004 are missing between 1002 and 1005, and 1008–1009 between 1007 and 1010."),
      dict(tables={"invoices": (["invoice_no", "customer_id", "amount"], [(505, 7, 10), (501, 7, 20), (503, 8, 30), (502, 8, 40)])},
           rows=[(504, 504)],
           explain="After sorting, only 504 is missing, so the range starts and ends at 504."),
  ],
  hidden=[
      dict(base=1, sql=["DELETE FROM invoices WHERE invoice_no = 505"],
           desc="Example 2 without invoice 505",
           rows=[], why="501–503 is continuous; nothing after the maximum is a gap"),
      dict(base=0, sql=["INSERT INTO invoices VALUES (1100, 4, 500)"],
           desc="Example 1 plus invoice 1100",
           rows=[(1003, 1004), (1008, 1009), (1011, 1099)], why="a large gap is one row, not 89 rows"),
  ],
  approach="Sort by invoice number and use `LEAD(invoice_no)` to see the next existing number; wherever the next number is more than 1 higher, the gap runs from `current + 1` to `next − 1`. O(n log n).",
  sql="""WITH with_next AS (
    SELECT invoice_no,
           LEAD(invoice_no) OVER (ORDER BY invoice_no) AS next_no
    FROM invoices
)
SELECT invoice_no + 1 AS gap_start,
       next_no - 1    AS gap_end
FROM with_next
WHERE next_no - invoice_no > 1
ORDER BY gap_start;""",
  alternatives="Without windows: gap starts are `i.invoice_no + 1` where no invoice equals `i.invoice_no + 1` and `i.invoice_no` is not the maximum; each gap end is `(SELECT MIN(invoice_no) FROM invoices j WHERE j.invoice_no > i.invoice_no) - 1`. Generating every number with a recursive CTE and anti-joining also works but should still collapse to ranges.",
  hint="Look at each invoice number together with the next existing number in sorted order. What does a difference greater than 1 tell you?",
  rubric=["Compares each invoice number with the next one in sorted order (LEAD or MIN of greater numbers).",
          "Reports start as current + 1 and end as next − 1.",
          "One row per gap range; listing individual missing numbers earns partial credit.",
          "Does not report anything outside min..max; correct columns and order."],
  checkpoints=["Orders by invoice_no",
               "LEAD(invoice_no) or next-number subquery",
               "Condition next − current > 1",
               "gap_start = current + 1, gap_end = next − 1",
               "Single missing number gives equal start and end",
               "ORDER BY gap_start"])

Q(id="qb-sql-n28", difficulty="hard", title="Ordered Signup Funnel",
  topic="CTEs · Funnel Conversion",
  body="Product wants an **ordered** three-step funnel for the website:\n\n1. `visit` — the user has at least one `visit` event.\n2. `signup` — the user has a `signup` event at or after their **first visit**.\n3. `create_pipeline` — the user has a `create_pipeline` event at or after their **first qualifying signup** (the earliest signup that counted for step 2).\n\nA user counts at a step only if they reached all earlier steps in order. Report the number of users at each step and the percentage of the previous step's users who reached it.",
  schema=["`events(user_id INT, event_type TEXT, event_time TEXT)` — `event_type` is `'visit'`, `'signup'` or `'create_pipeline'`; users can repeat events."],
  columns=["step_no", "step_name", "users", "pct_of_previous"],
  order="Order by `step_no` (1, 2, 3). All three steps always appear, even with 0 users.",
  notes=[DATE_NOTE,
         "`pct_of_previous` = 100 × users / users at the previous step, rounded to 2 decimals. It is NULL for step 1, and NULL when the previous step has 0 users.",
         "Events at exactly the same timestamp count as being in order."],
  examples=[
      dict(tables={"events": (["user_id", "event_type", "event_time"], [
          (1, "visit", "2026-06-01 10:00:00"), (1, "signup", "2026-06-01 10:05:00"), (1, "create_pipeline", "2026-06-01 10:30:00"),
          (2, "visit", "2026-06-01 11:00:00"), (2, "signup", "2026-06-01 11:10:00"),
          (3, "signup", "2026-06-01 09:00:00"), (3, "visit", "2026-06-01 09:30:00"), (3, "create_pipeline", "2026-06-01 09:40:00"),
          (4, "visit", "2026-06-01 12:00:00"), (4, "visit", "2026-06-01 12:05:00"), (4, "signup", "2026-06-01 12:10:00"), (4, "signup", "2026-06-01 12:20:00"),
          (5, "create_pipeline", "2026-06-01 13:00:00")])},
           rows=[(1, "visit", 4, None), (2, "signup", 3, 75.0), (3, "create_pipeline", 1, 33.33)],
           explain="Users 1–4 visited. User 3 signed up before visiting, so they stop at step 1. User 4's repeated events count once. Only user 1 created a pipeline after signing up. User 5 never visited and is not in the funnel at all."),
      dict(tables={"events": (["user_id", "event_type", "event_time"], [
          (7, "visit", "2026-06-01 08:00:00"), (7, "create_pipeline", "2026-06-01 08:10:00"), (7, "signup", "2026-06-01 08:20:00"),
          (8, "visit", "2026-06-01 08:00:00"), (8, "signup", "2026-06-01 08:00:00"), (8, "create_pipeline", "2026-06-01 08:00:00")])},
           rows=[(1, "visit", 2, None), (2, "signup", 2, 100.0), (3, "create_pipeline", 1, 50.0)],
           explain="User 7 created a pipeline before signing up, so step 3 is not reached. User 8's events share one timestamp, which counts as in order."),
  ],
  hidden=[
      dict(base=0, sql=["DELETE FROM events WHERE event_type = 'signup'"],
           desc="Example 1 with every signup event removed",
           rows=[(1, "visit", 4, None), (2, "signup", 0, 0.0), (3, "create_pipeline", 0, None)], why="empty steps still appear and division by zero gives NULL"),
      dict(base=1, sql=["INSERT INTO events VALUES (7, 'create_pipeline', '2026-06-01 08:25:00')"],
           desc="Example 2 plus a create_pipeline for user 7 after their signup",
           rows=[(1, "visit", 2, None), (2, "signup", 2, 100.0), (3, "create_pipeline", 2, 100.0)], why="a later qualifying event completes the funnel"),
  ],
  approach="Build each step from the previous one: first visit per user; earliest signup at or after it; then users with a create_pipeline at or after that signup. Stack the three counts with UNION ALL and compute the percentage against the previous row with LAG, guarding against division by zero with NULLIF. O(n) per step with hashing.",
  sql="""WITH step1 AS (
    SELECT user_id, MIN(event_time) AS t1
    FROM events
    WHERE event_type = 'visit'
    GROUP BY user_id
), step2 AS (
    SELECT s1.user_id, MIN(e.event_time) AS t2
    FROM step1 s1
    JOIN events e ON e.user_id = s1.user_id
                 AND e.event_type = 'signup'
                 AND e.event_time >= s1.t1
    GROUP BY s1.user_id
), step3 AS (
    SELECT DISTINCT s2.user_id
    FROM step2 s2
    JOIN events e ON e.user_id = s2.user_id
                 AND e.event_type = 'create_pipeline'
                 AND e.event_time >= s2.t2
), counts AS (
    SELECT 1 AS step_no, 'visit' AS step_name, (SELECT COUNT(*) FROM step1) AS users
    UNION ALL
    SELECT 2, 'signup', (SELECT COUNT(*) FROM step2)
    UNION ALL
    SELECT 3, 'create_pipeline', (SELECT COUNT(*) FROM step3)
)
SELECT step_no,
       step_name,
       users,
       ROUND(100.0 * users / NULLIF(LAG(users) OVER (ORDER BY step_no), 0), 2) AS pct_of_previous
FROM counts
ORDER BY step_no;""",
  alternatives="EXISTS subqueries per step instead of joins, or one per-user row with conditional MIN timestamps (`MIN(CASE WHEN event_type='visit' THEN event_time END)` …) followed by careful comparisons, are acceptable if they respect 'at or after the first qualifying' event. The percentages can also be computed with scalar subqueries instead of LAG.",
  hint="Build the funnel one step at a time, carrying forward the timestamp at which each user completed the previous step. Each later step only looks at events at or after that time.",
  rubric=["Enforces event order: signup at or after first visit, create_pipeline at or after the qualifying signup.",
          "Counts distinct users per step; repeated events do not inflate counts.",
          "Always returns three rows, including steps with 0 users.",
          "Percent of previous step computed without integer division, NULL for step 1 and for a 0-user previous step.",
          "Unordered counts (just distinct users per event type) earn partial credit."],
  checkpoints=["First visit time per user",
               "Signup must be >= first visit",
               "create_pipeline must be >= qualifying signup",
               "Distinct user counts per step",
               "Three rows always present (UNION ALL of counts)",
               "pct_of_previous with NULLIF / NULL handling and rounding"])

Q(id="qb-sql-n29", difficulty="hard", title="Peak Concurrent Sync Jobs",
  topic="Window Functions · Running Sum · Intervals",
  body="Worker capacity planning needs the **maximum number of sync jobs running at the same time**, and the earliest moment that maximum is reached.\n\nA job is running from `started_at` (inclusive) until `ended_at` (exclusive): a job ending at 10:00 and another starting at 10:00 do not overlap. A job with `ended_at` = NULL is still running and has not ended.",
  schema=["`sync_jobs(job_id INT, connector_id INT, started_at TEXT, ended_at TEXT)` — `ended_at` may be NULL; when present it is after `started_at`."],
  columns=["peak_concurrency", "peak_start"],
  order="Return exactly one row. If the maximum is reached several times, `peak_start` is the earliest moment it is reached.",
  notes=[DATE_NOTE],
  examples=[
      dict(tables={"sync_jobs": (["job_id", "connector_id", "started_at", "ended_at"], [
          (1, 10, "2026-07-01 10:00:00", "2026-07-01 10:30:00"), (2, 11, "2026-07-01 10:10:00", "2026-07-01 10:20:00"),
          (3, 12, "2026-07-01 10:15:00", "2026-07-01 10:45:00"), (4, 13, "2026-07-01 10:30:00", "2026-07-01 11:00:00"),
          (5, 14, "2026-07-01 10:40:00", "2026-07-01 10:50:00")])},
           rows=[(3, "2026-07-01 10:15:00")],
           explain="From 10:15 jobs 1, 2 and 3 run together (3). At 10:30 job 1 ends exactly as job 4 starts, so the count stays at 2. At 10:40 jobs 3, 4 and 5 reach 3 again, but 10:15 is earlier."),
      dict(tables={"sync_jobs": (["job_id", "connector_id", "started_at", "ended_at"], [
          (1, 20, "2026-07-02 09:00:00", "2026-07-02 10:00:00"), (2, 21, "2026-07-02 10:00:00", "2026-07-02 11:00:00"),
          (3, 22, "2026-07-02 10:30:00", None), (4, 23, "2026-07-02 11:00:00", "2026-07-02 12:00:00")])},
           rows=[(2, "2026-07-02 10:30:00")],
           explain="Jobs 1→2 and 2→4 are hand-overs, not overlaps. Job 3 never ends, so from 10:30 there are 2 jobs. Treating the NULL end as 'already ended' or sorting it first would undercount."),
  ],
  hidden=[
      dict(base=1, sql=["UPDATE sync_jobs SET ended_at = '2026-07-02 11:00:01' WHERE job_id = 2"],
           desc="Example 2 with job 2 ending one second after 11:00",
           rows=[(3, "2026-07-02 11:00:00")], why="jobs 2, 3 and 4 now overlap at 11:00"),
      dict(base=0, sql=["INSERT INTO sync_jobs VALUES (6, 15, '2026-07-01 10:15:00', '2026-07-01 10:16:00')"],
           desc="Example 1 plus job 6 running 10:15–10:16",
           rows=[(4, "2026-07-01 10:15:00")], why="two jobs starting at the same moment both count"),
  ],
  approach="Turn every job into a +1 event at its start and a −1 event at its end (a NULL end becomes a far-future time). Sort events by time with −1 before +1 at the same instant (end-exclusive), take a running sum, and pick the highest value with the earliest time. O(n log n).",
  sql="""WITH points AS (
    SELECT started_at AS t, 1 AS delta FROM sync_jobs
    UNION ALL
    SELECT COALESCE(ended_at, '9999-12-31 23:59:59') AS t, -1 AS delta FROM sync_jobs
), running AS (
    SELECT t,
           SUM(delta) OVER (ORDER BY t, delta
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS concurrent
    FROM points
)
SELECT concurrent AS peak_concurrency,
       t          AS peak_start
FROM running
ORDER BY concurrent DESC, t ASC
LIMIT 1;""",
  alternatives="Self join: for each job start s, count jobs j with `j.started_at <= s AND (j.ended_at > s OR j.ended_at IS NULL)`; the maximum always occurs at some job's start. That is O(n^2) but fully correct. Use `FETCH FIRST 1 ROW ONLY` / `TOP 1` where LIMIT is not supported.",
  hint="Concurrency only changes when a job starts or ends. What if you listed those moments as +1 and −1 and added them up in time order?",
  rubric=["Correctly models overlap with end-exclusive intervals (ends processed before starts at the same time, or `ended_at > s` in a self join).",
          "Treats NULL ended_at as still running.",
          "Finds the maximum concurrency and the earliest time it occurs.",
          "Sweep line (O(n log n)) or self join (O(n^2)) both earn full credit if correct; ignoring hand-over or NULL cases earns partial."],
  checkpoints=["Start events +1 and end events −1 (or per-start overlap count)",
               "NULL ended_at handled as never ending",
               "End before start at equal timestamps (no false overlap on hand-over)",
               "Running sum in time order",
               "Maximum value selected",
               "Earliest time of the maximum returned"])

Q(id="qb-sql-n30", difficulty="hard", title="First Day an Account Went Negative",
  topic="Window Functions · Running Total · Top-1 per Group",
  body="Customer prepaid accounts are tracked in a ledger: credits are positive amounts and usage charges are negative. Every account starts at a balance of 0.\n\nFinance wants, for each account whose **end-of-day** balance ever dropped below zero, the **first** date that happened and the balance at the end of that day. End-of-day means after all of that day's entries are applied, so the order of entries within a day does not matter.",
  schema=["`ledger(entry_id INT, account_id INT, entry_date TEXT, amount DECIMAL)` — several entries can share a date; rows are not stored in date order."],
  columns=["account_id", "first_negative_date", "balance_that_day"],
  order="Order by `account_id` ascending.",
  notes=[DATE_NOTE, "Accounts that never went below zero are not returned. A balance of exactly 0 is not negative."],
  examples=[
      dict(tables={"ledger": (["entry_id", "account_id", "entry_date", "amount"], [
          (1, 1, "2026-06-01", 500), (2, 1, "2026-06-02", -300), (3, 1, "2026-06-03", -300), (4, 1, "2026-06-04", 200), (5, 1, "2026-06-05", -500),
          (6, 2, "2026-06-01", 100), (7, 2, "2026-06-02", -100), (8, 2, "2026-06-03", 50), (9, 3, "2026-06-02", -20)])},
           rows=[(1, "2026-06-03", -100), (3, "2026-06-02", -20)],
           explain="Account 1's end-of-day balances are 500, 200, −100, 100, −400; the first negative day is 3 June at −100 (5 June is later). Account 2 reaches exactly 0 but never below. Account 3 starts with a charge."),
      dict(tables={"ledger": (["entry_id", "account_id", "entry_date", "amount"], [
          (1, 5, "2026-06-11", -60), (2, 5, "2026-06-10", -100), (3, 5, "2026-06-10", 150)])},
           rows=[(5, "2026-06-11", -10)],
           explain="On 10 June a −100 charge and a +150 credit net to +50, so the end-of-day balance is 50, not negative. On 11 June it falls to −10."),
  ],
  hidden=[
      dict(base=0, sql=["UPDATE ledger SET amount = -50 WHERE entry_id = 8"],
           desc="Example 1 with account 2's 2026-06-03 entry changed to -50",
           rows=[(1, "2026-06-03", -100), (2, "2026-06-03", -50), (3, "2026-06-02", -20)], why="account 2 now goes negative"),
      dict(base=1, sql=["INSERT INTO ledger VALUES (4, 5, '2026-06-09', 20)"],
           desc="Example 2 plus a +20 credit on 2026-06-09",
           rows=[], why="an earlier credit keeps the balance at 70 then 10, never negative"),
  ],
  approach="Collapse entries to one net amount per account and day, take a running SUM per account in date order for the end-of-day balance, keep negative days and pick the earliest per account with ROW_NUMBER (or MIN). O(n log n).",
  sql="""WITH daily AS (
    SELECT account_id, entry_date, SUM(amount) AS net
    FROM ledger
    GROUP BY account_id, entry_date
), balances AS (
    SELECT account_id, entry_date,
           SUM(net) OVER (PARTITION BY account_id ORDER BY entry_date
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
    FROM daily
), negatives AS (
    SELECT account_id, entry_date, balance,
           ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY entry_date) AS rn
    FROM balances
    WHERE balance < 0
)
SELECT account_id,
       entry_date AS first_negative_date,
       balance    AS balance_that_day
FROM negatives
WHERE rn = 1
ORDER BY account_id;""",
  alternatives="A correlated subquery for the balance (`SELECT SUM(amount) FROM ledger l2 WHERE l2.account_id = d.account_id AND l2.entry_date <= d.entry_date`) instead of the window, and `MIN(entry_date)` joined back for the balance, are both fine. A running sum over individual entries (not per day) is wrong when one day has both charges and credits.",
  hint="First get one balance per account per day, then find where it first dips below zero. Remember that a window function's result cannot be filtered in the same SELECT's WHERE clause.",
  rubric=["Computes end-of-day balances (aggregates per day before or within the running sum).",
          "Running total partitioned by account and ordered by date.",
          "Selects the first date with balance < 0 per account and returns that day's balance.",
          "Excludes accounts that never go negative; a per-entry running sum earns partial credit.",
          "Correct columns and order."],
  checkpoints=["Net amount per account per day",
               "Running SUM partitioned by account_id ordered by entry_date",
               "Strict balance < 0 filter (0 is not negative)",
               "Earliest negative day per account (ROW_NUMBER or MIN)",
               "Returns the balance for that day",
               "ORDER BY account_id"])


# ================================================================ BUILD
def build(q):
    qid = q["id"]
    diff = q["difficulty"].capitalize()
    cols = q["columns"]
    # --- prompt
    lines = [f"## {q['title']}", f"> {q['topic']} · {diff}", "", q["body"], "", "### Input"]
    lines += [f"- {s}" for s in q["schema"]]
    lines += ["", "### Notes", f"- {DIALECT_NOTE}",
              "- Return exactly these columns, in this order: " + ", ".join(f"`{c}`" for c in cols) + ".",
              f"- {q['order']}"]
    lines += [f"- {n}" for n in q["notes"]]
    prompt = "\n".join(lines)

    # --- verify examples & build sample_data / expected_output
    sample_parts, exp_lines = [], []
    for i, ex in enumerate(q["examples"], 1):
        con = load(ex["tables"])
        run_check(qid, f"example {i}", con, q["sql"], cols, ex["rows"])
        con.close()
        part = [f"**Example {i}**", "Input:", ""]
        for name, (tcols, trows) in ex["tables"].items():
            part += [f"**Table: {name}**", md_table(tcols, trows), ""]
        part += ["Output:", "", "**Expected result**", md_table(cols, ex["rows"]), "",
                 f"Explanation: {ex['explain']}"]
        sample_parts.append("\n".join(part))
        exp_lines.append(f"Example {i} → {compact(cols, ex['rows'])}")
    assert 2 <= len(q["examples"]) <= 3, qid
    assert len(q["hidden"]) == 2, qid
    for j, h in enumerate(q["hidden"], 1):
        con = load(q["examples"][h["base"]]["tables"])
        for stmt in h["sql"]:
            con.execute(stmt)
        run_check(qid, f"hidden {j}", con, q["sql"], cols, h["rows"])
        con.close()
        exp_lines.append(f"Hidden test {j} → {h['desc']} = {compact(cols, h['rows'])}  ({h['why']})")

    ref = f"{q['approach']}\n\n{q['sql']}\n\nAlternatives: {q['alternatives']}"
    assert 3 <= len(q["rubric"]) <= 5, qid
    assert 4 <= len(q["checkpoints"]) <= 6, qid
    obj = {
        "id": qid, "category": "sql", "difficulty": q["difficulty"], "marks": 3,
        "title": q["title"], "topic": q["topic"], "prompt": prompt,
        "sample_data": "\n\n".join(sample_parts),
        "expected_output": "\n".join(exp_lines),
        "reference_answer": ref, "hint": q["hint"],
        "rubric": "\n".join(f"- {r}" for r in q["rubric"]),
        "checkpoints": "\n".join(q["checkpoints"]),
        "source": SOURCE,
    }
    return obj


def main():
    objs = [build(q) for q in QUESTIONS]
    ids = [o["id"] for o in objs]
    assert ids == [f"qb-sql-n{i:02d}" for i in range(1, 31)], ids
    assert len(set(ids)) == len(ids)
    titles = [o["title"] for o in objs]
    assert len(set(t.lower() for t in titles)) == len(titles), "duplicate titles"
    for o in objs:
        assert list(o.keys()) == KEYS, o["id"]
        assert o["prompt"].startswith(f"## {o['title']}\n> {o['topic']} · {o['difficulty'].capitalize()}\n\n"), o["id"]
        assert DIALECT_NOTE in o["prompt"], o["id"]
        for k in KEYS:
            assert o[k] not in (None, ""), (o["id"], k)
    mix = {d: sum(o["difficulty"] == d for o in objs) for d in ("easy", "medium", "hard")}
    assert mix == {"easy": 9, "medium": 14, "hard": 7}, mix
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(objs, f, ensure_ascii=False, indent=2)
        f.write("\n")
    n_ex = sum(len(q["examples"]) for q in QUESTIONS)
    n_hid = sum(len(q["hidden"]) for q in QUESTIONS)
    print(f"OK: {len(objs)} SQL questions verified ({n_ex} examples + {n_hid} hidden tests, all reference queries pass on SQLite {sqlite3.sqlite_version}); "
          f"mix easy={mix['easy']} medium={mix['medium']} hard={mix['hard']} → {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
