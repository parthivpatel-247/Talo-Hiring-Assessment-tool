#!/usr/bin/env python3
"""Build and verify 20 new scenario questions (qb-scn-n01 .. qb-scn-n20).

Story problems: the reference solution shown to admins is exec'd and run against
every example and hidden test. Debugging problems: both the buggy behaviour
(stated "Actual output") and the fixed behaviour ("Expected output") are
implemented and asserted. The JSON is written only if every assertion passes.
"""
import copy
import json
import os
import random
import re
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "part_scenario.json")
SOURCE = "bank v3 (Oct 2026)"
KEYS = ["id", "category", "difficulty", "marks", "title", "topic", "prompt",
        "sample_data", "expected_output", "reference_answer", "hint", "rubric",
        "checkpoints", "source"]

CHECKS = 0


def fmt(v):
    return json.dumps(v, ensure_ascii=False, separators=(", ", ": "))


def canon(v):
    return json.dumps(json.loads(json.dumps(v)), sort_keys=True)


def same(result, display):
    """Compare a computed value with its displayed text exactly."""
    global CHECKS
    CHECKS += 1
    if isinstance(result, str) and result.startswith("error"):
        return result == display
    try:
        parsed = json.loads(display)
    except ValueError:
        return False
    return canon(result) == canon(parsed)


def call_str(fname, args):
    return f"{fname}({', '.join(fmt(a) for a in args)})"


def input_str(params, args):
    return ", ".join(f"{p} = {fmt(a)}" for p, a in zip(params, args))


QUESTIONS = []


# ---------------------------------------------------------------------------
# Story problems
# ---------------------------------------------------------------------------
def story(qid, diff, title, topic, body, fname, params, ref_code, ref_name,
          examples, hidden, approach, hint, rubric, checkpoints):
    ns = {}
    exec(ref_code, ns)
    ref = ns[ref_name]
    sample_parts, exp_lines = [], []
    for i, (args, disp, expl) in enumerate(examples, 1):
        res = ref(*copy.deepcopy(args))
        assert same(res, disp), f"{qid} example {i}: got {fmt(res)}, shown {disp}"
        sample_parts.append(f"**Example {i}**\nInput: {input_str(params, args)}\n"
                            f"Output: {disp}\nExplanation: {expl}")
        exp_lines.append(f"Example {i} → {disp}")
    for i, (args, disp, why) in enumerate(hidden, 1):
        res = ref(*copy.deepcopy(args))
        assert same(res, disp), f"{qid} hidden {i}: got {fmt(res)}, shown {disp}"
        exp_lines.append(f"Hidden test {i} → {call_str(fname, args)} = {disp}  ({why})")
    QUESTIONS.append({
        "id": qid, "category": "scenario", "difficulty": diff, "marks": 5,
        "title": title, "topic": topic,
        "prompt": f"## {title}\n> {topic} · {diff.capitalize()}\n\n{body.strip()}",
        "sample_data": "\n\n".join(sample_parts),
        "expected_output": "\n".join(exp_lines),
        "reference_answer": approach.strip() + "\n\n" + ref_code.strip(),
        "hint": hint, "rubric": rubric.strip(), "checkpoints": checkpoints.strip(),
        "source": SOURCE,
    })
    return ref


# ---------------------------------------------------------------------------
# Debugging problems
# ---------------------------------------------------------------------------
def debug(qid, diff, title, topic, body, code, fname, params, fixed, buggy,
          examples, hidden, fix_line, reference, hint, rubric, checkpoints):
    sample_parts = [f"**Buggy pseudocode**\n```\n{code.strip()}\n```"]
    exp_lines = []
    for i, (args, exp, act, expl) in enumerate(examples, 1):
        r_fix = fixed(*copy.deepcopy(args))
        r_bug = buggy(*copy.deepcopy(args))
        assert same(r_fix, exp), f"{qid} example {i} fixed: {fmt(r_fix)} vs {exp}"
        assert same(r_bug, act), f"{qid} example {i} buggy: {r_bug!r} vs {act}"
        sample_parts.append(f"**Example {i}**\nInput: {input_str(params, args)}\n"
                            f"Expected output: {exp}\nActual output: {act}\n"
                            f"Explanation: {expl}")
        exp_lines.append(f"Example {i} → {exp}")
    for i, (args, exp, act, why) in enumerate(hidden, 1):
        r_fix = fixed(*copy.deepcopy(args))
        r_bug = buggy(*copy.deepcopy(args))
        assert same(r_fix, exp), f"{qid} hidden {i} fixed: {fmt(r_fix)} vs {exp}"
        assert same(r_bug, act), f"{qid} hidden {i} buggy: {r_bug!r} vs {act}"
        exp_lines.append(f"Hidden test {i} → {call_str(fname, args)} = {exp}  "
                         f"({why}; buggy version gives {act})")
    exp_lines.append(f"The fix: {fix_line}")
    QUESTIONS.append({
        "id": qid, "category": "scenario", "difficulty": diff, "marks": 5,
        "title": title, "topic": topic,
        "prompt": f"## {title}\n> {topic} · {diff.capitalize()}\n\n{body.strip()}",
        "sample_data": "\n\n".join(sample_parts),
        "expected_output": "\n".join(exp_lines),
        "reference_answer": reference.strip(),
        "hint": hint, "rubric": rubric.strip(), "checkpoints": checkpoints.strip(),
        "source": SOURCE,
    })


# ===========================================================================
# n01 Pipeline With the Worst Sync Lag (easy)
# ===========================================================================
story(
    "qb-scn-n01", "easy", "Pipeline With the Worst Sync Lag", "Scenario · Arrays · Hash Map",
    """
A data platform copies rows from source databases into a warehouse through several named pipelines. For every copied row it logs a record `[pipeline, committedAt, loadedAt]`: the pipeline's name, the second the row was committed in the source, and the second it landed in the warehouse. The row's **sync lag** is `loadedAt − committedAt`.

The on-call engineer wants to know which pipeline produced the single worst lag. Return the name of the pipeline whose **largest** lag is the highest. If several pipelines share that largest lag, return the name that comes first alphabetically. Implement `worstLagPipeline(records)`.

### Constraints
- 1 ≤ n ≤ 10^5, where n is the number of records
- 0 ≤ committedAt ≤ loadedAt ≤ 10^9
- Pipeline names are 1–30 lowercase letters or hyphens.
- Records are in no particular order.
""",
    "worstLagPipeline", ["records"],
    '''
def worst_lag_pipeline(records):
    worst = {}
    for name, committed, loaded in records:
        lag = loaded - committed
        if lag > worst.get(name, -1):
            worst[name] = lag
    return min(worst, key=lambda name: (-worst[name], name))
''', "worst_lag_pipeline",
    [
        ([[["orders", 100, 130], ["users", 100, 105], ["orders", 200, 210], ["payments", 50, 90]]],
         '"payments"',
         "The largest lags are orders 30 (130 − 100), users 5 and payments 40, so payments has the worst lag."),
        ([[["crm", 0, 60], ["billing", 10, 70], ["crm", 100, 101]]],
         '"billing"',
         "crm's largest lag is 60 and billing's is also 60. The tie goes to the alphabetically first name, billing."),
    ],
    [
        ([[["solo", 5, 5]]], '"solo"', "a single record with zero lag is still a valid answer"),
        ([[["a-sync", 0, 10], ["b-sync", 0, 4], ["b-sync", 10, 14], ["b-sync", 20, 29]]], '"a-sync"',
         "compare each pipeline's largest lag (10 vs 9), not its total lag (10 vs 17)"),
    ],
    "One pass keeps a map from pipeline name to the largest lag seen so far; then pick the name with the highest value, breaking ties by name. O(n) time, O(p) extra space for p pipelines. Sorting the records by lag (descending) and name first also works in O(n log n).",
    "You only need to remember one number per pipeline while you scan the records. Which number is it?",
    """
- Computes the lag as loadedAt − committedAt for every record.
- Tracks the maximum lag per pipeline (not the sum or the average).
- Returns the pipeline with the highest maximum lag, breaking ties alphabetically.
- O(n) (or O(n log n) with sorting) for full credit; rescanning all records for every pipeline earns partial credit.
""",
    """
Computes each record's lag correctly
Keeps a per-pipeline maximum in a map/dictionary
Chooses the pipeline whose maximum lag is the largest
Breaks ties by the alphabetically smaller name
Handles a single record and a lag of zero
O(n) time
""")

# ===========================================================================
# n02 Cache Hits With Expiring Entries (easy)
# ===========================================================================
story(
    "qb-scn-n02", "easy", "Cache Hits With Expiring Entries", "Scenario · Hash Map · Simulation",
    """
A metadata service caches schema lookups so that pipelines do not query the source database on every request. You are given `requests`, an array of `[time, key]` pairs sorted by `time` (seconds, non-decreasing), and a time-to-live `ttl` in seconds.

The cache starts empty and has no size limit. For each request:
- If `key` is in the cache and `time − storedAt < ttl`, the request is a **hit**. A hit does **not** change `storedAt`.
- Otherwise it is a **miss**: the value is fetched and stored for `key` with `storedAt = time`, replacing any expired entry.

Return `[hits, misses]`. Implement `cacheStats(requests, ttl)`.

### Constraints
- 0 ≤ n ≤ 10^5, where n is the number of requests
- 0 ≤ time ≤ 10^9
- 1 ≤ ttl ≤ 10^9
- Keys are non-empty strings and are compared exactly.
""",
    "cacheStats", ["requests", "ttl"],
    '''
def cache_stats(requests, ttl):
    stored_at = {}
    hits = misses = 0
    for time, key in requests:
        if key in stored_at and time - stored_at[key] < ttl:
            hits += 1
        else:
            misses += 1
            stored_at[key] = time
    return [hits, misses]
''', "cache_stats",
    [
        ([[[0, "orders"], [10, "orders"], [30, "users"], [60, "orders"], [65, "users"]], 60], "[2, 3]",
         "orders at 0 is a miss and at 10 a hit. users at 30 is a miss. At 60 the orders entry is exactly 60 seconds old, which is not less than 60, so it is a miss and is stored again. users at 65 is 35 seconds old: a hit."),
        ([[[5, "a"], [5, "a"], [6, "b"], [7, "a"]], 1], "[1, 3]",
         "The second request for a at time 5 is 0 seconds old, a hit. b is new, a miss. At time 7 the a entry is 2 seconds old, past the ttl of 1, so it is a miss."),
    ],
    [
        ([[], 30], "[0, 0]", "no requests at all"),
        ([[[0, "k"], [50, "k"], [99, "k"], [100, "k"], [150, "k"]], 100], "[3, 2]",
         "a hit must not refresh storedAt; refreshing on hits would wrongly give [4, 1]"),
    ],
    "Keep a map from key to the time it was last stored. For each request compare time − storedAt with ttl; update the map only on a miss. O(n) time, O(k) space for k distinct keys.",
    "For each key, what single piece of information decides whether the next request for it is a hit?",
    """
- Uses a map/dictionary from key to the time the entry was stored.
- Treats an entry as expired when time − storedAt ≥ ttl (exactly ttl is a miss).
- Updates storedAt only on a miss, never on a hit.
- Returns [hits, misses] in O(n); an approach that rescans earlier requests each time earns partial credit.
""",
    """
Stores the time each key was cached in a map/dictionary
Counts a hit only when the key exists and time − storedAt < ttl
Treats the boundary time − storedAt = ttl as a miss
Refreshes storedAt on misses only
Handles an empty request array
Returns [hits, misses] in O(n)
""")

# ===========================================================================
# n03 SLA Breaches With a Paused Clock (medium)
# ===========================================================================
story(
    "qb-scn-n03", "medium", "SLA Breaches With a Paused Clock", "Scenario · Hash Map · Sorting",
    """
A support desk promises that a ticket spends at most `slaMinutes` minutes in the **open** state. While the team is waiting for the customer to reply, the SLA clock is paused.

You are given `events`, an array of status changes `[ticketId, time, status]`, where `status` is `"open"`, `"waiting"` (clock paused) or `"resolved"` (clock stopped for good) and `time` is in minutes. The events of all tickets are mixed together and are **not** sorted. A ticket that is not resolved keeps counting open time up to the current time `now`.

A ticket **breaches** the SLA if its total open time is **strictly greater** than `slaMinutes`. Return the ids of all breached tickets in ascending order. Implement `breachedTickets(events, slaMinutes, now)`.

### Constraints
- 1 ≤ n ≤ 10^5, where n is the number of events; 1 ≤ ticketId ≤ 10^9
- For each ticket the earliest event is `"open"`, its event times are distinct, and two consecutive events never have the same status.
- No event follows a `"resolved"` event of the same ticket.
- 0 ≤ time ≤ now ≤ 10^9 and 1 ≤ slaMinutes ≤ 10^9
""",
    "breachedTickets", ["events", "slaMinutes", "now"],
    '''
def breached_tickets(events, sla_minutes, now):
    by_ticket = {}
    for ticket, time, status in events:
        by_ticket.setdefault(ticket, []).append((time, status))
    breached = []
    for ticket, changes in by_ticket.items():
        changes.sort()
        open_minutes = 0
        for i, (time, status) in enumerate(changes):
            if status == "open":
                end = changes[i + 1][0] if i + 1 < len(changes) else now
                open_minutes += end - time
        if open_minutes > sla_minutes:
            breached.append(ticket)
    return sorted(breached)
''', "breached_tickets",
    [
        ([[[1, 0, "open"], [1, 30, "waiting"], [1, 100, "open"], [1, 150, "resolved"],
           [2, 10, "open"], [2, 50, "resolved"], [3, 20, "open"]], 60, 100], "[1, 3]",
         "Ticket 1 is open for 0–30 and 100–150, 80 minutes in total (the 70 minutes spent waiting do not count). Ticket 2 is open for 40 minutes. Ticket 3 is still open at now = 100, so it has 80 minutes. Tickets 1 and 3 exceed 60."),
        ([[[7, 90, "resolved"], [7, 0, "open"], [7, 40, "waiting"], [7, 70, "open"],
           [8, 4, "open"], [8, 65, "waiting"]], 60, 200], "[8]",
         "Put in time order, ticket 7 is open for 0–40 and 70–90: exactly 60 minutes, which is not a breach. Ticket 8 is open from 4 to 65 (61 minutes) and has been waiting ever since, so it breaches."),
    ],
    [
        ([[[5, 0, "open"]], 30, 30], "[]",
         "still open but exactly at the limit; only strictly greater is a breach"),
        ([[[4, 0, "open"], [4, 10, "waiting"], [4, 20, "open"], [4, 30, "waiting"], [4, 40, "open"],
           [2, 0, "open"], [2, 100, "resolved"]], 25, 50], "[2, 4]",
         "several pauses are all skipped (10 + 10 + 10 = 30 > 25) and the ids come back in ascending order"),
    ],
    "Group the events by ticket, sort each ticket's events by time, and add the length of every segment that starts with an \"open\" event (it ends at the next event, or at now if there is none). Compare the total with slaMinutes and sort the breached ids. O(n log n) time, O(n) space.",
    "Group the events by ticket and put each ticket's events in time order. Which of the gaps between consecutive events should the SLA clock count?",
    """
- Groups events by ticket and orders each ticket's events by time (the input is unsorted).
- Counts only time spent in "open" segments; waiting time is excluded.
- Counts an unresolved open ticket up to now.
- Uses a strict comparison (> slaMinutes) and returns the ids sorted ascending; partial credit if the time accounting is right but the boundary or ordering is wrong.
""",
    """
Groups events per ticket in a map/dictionary
Sorts each ticket's events by time
Adds only the open segments, ending each at the next event
Extends the last open segment to now when the ticket is unresolved
Uses open time > slaMinutes as the breach test
Returns breached ids in ascending order
""")

# ===========================================================================
# n04 Minutes With Clashing Sync Runs (medium)
# ===========================================================================
story(
    "qb-scn-n04", "medium", "Minutes With Clashing Sync Runs", "Scenario · Arrays · Difference Array",
    """
Several pipelines load into the same warehouse, and runs that overlap slow each other down. Each pipeline is described by `[start, interval, duration]`, in minutes of one day (minute `0` to minute `1439`). Its runs start at `start`, `start + interval`, `start + 2 × interval`, … for every start time **before minute 1440**, and a run that starts at minute `s` is active during minutes `s` to `s + duration − 1`. A run that would continue past midnight is cut off after minute `1439`; only today counts.

Return the number of minutes in the day during which **two or more** runs are active at the same time. Implement `clashMinutes(pipelines)`.

### Constraints
- 1 ≤ n ≤ 100, where n is the number of pipelines
- 0 ≤ start ≤ 1439 and 1 ≤ interval ≤ 1440
- 1 ≤ duration ≤ interval, so a pipeline's run always ends before its own next run starts
""",
    "clashMinutes", ["pipelines"],
    '''
def clash_minutes(pipelines):
    DAY = 1440
    change = [0] * (DAY + 1)          # difference array of active runs
    for start, interval, duration in pipelines:
        s = start
        while s < DAY:
            change[s] += 1
            change[min(s + duration, DAY)] -= 1
            s += interval
    clashes = running = 0
    for minute in range(DAY):
        running += change[minute]
        if running >= 2:
            clashes += 1
    return clashes
''', "clash_minutes",
    [
        ([[[0, 60, 20], [10, 120, 15]]], "120",
         "The first pipeline is active at minutes 0–19, 60–79, 120–139, …. The second starts at 10, 130, 250, …, 1330 (12 runs) and is active for 15 minutes each time. Each of its runs overlaps a run of the first pipeline for 10 minutes (for example 130–139), so 12 × 10 = 120."),
        ([[[0, 1440, 30], [20, 1440, 30], [25, 1440, 10]]], "15",
         "Each pipeline runs once: minutes 0–29, 20–49 and 25–34. At least two runs are active during minutes 20–34, which is 15 minutes. Three are active during 25–29, but each minute is counted only once."),
    ],
    [
        ([[[1430, 60, 30], [1435, 1440, 30]]], "5",
         "runs are cut off at midnight, so only minutes 1435–1439 clash"),
        ([[[0, 30, 10]]], "0", "a single pipeline never clashes with itself"),
    ],
    "The day has only 1440 minutes, so build a difference array: +1 at each run's start and −1 at min(start + duration, 1440), then a running sum gives the number of active runs per minute; count minutes with at least 2. O(R + 1440) time for R runs in total, O(1440) space. A simpler per-minute counter array (add 1 to every minute of every run) is also acceptable at these limits.",
    "There are only 1440 minutes in a day. Could you record, for every minute, how many runs are active?",
    """
- Generates every run of every pipeline whose start is before minute 1440.
- Cuts runs off at the end of the day.
- Counts minutes with two or more active runs, each minute once (not pairs of overlapping runs).
- Uses a per-minute counter or difference array; comparing every pair of runs is acceptable if correct but earns partial credit for efficiency.
""",
    """
Expands each pipeline into its run start times below 1440
Marks each run as active for exactly duration minutes
Cuts off runs at minute 1439
Counts active runs per minute (counter or difference array)
Counts each minute with ≥ 2 active runs exactly once
Handles a single pipeline (answer 0)
""")

# ===========================================================================
# n05 Replay Change Events Into Final Rows (hard)
# ===========================================================================
story(
    "qb-scn-n05", "hard", "Replay Change Events Into Final Rows", "Scenario · Hash Map · Sorting",
    """
A change-data-capture (CDC) connector streams every change made to a `customers` table. Each event is `[lsn, op, id, fields]`:
- `lsn` is the log sequence number; a larger `lsn` means a later change.
- `op` is `"insert"`, `"update"` or `"delete"`.
- `id` is the row's primary key.
- `fields` is a map of column → value: the **full row** for an insert, only the **changed columns** for an update, and an empty map `{}` for a delete.

The network is unreliable, so events may arrive **out of order** and the same event may be delivered **more than once** (same `lsn`). Rebuild the final table by applying each distinct event exactly once, in increasing `lsn` order:
- **insert**: the row becomes exactly `fields`, replacing any existing row with that `id`;
- **update**: the given columns overwrite those columns of the existing row and all other columns keep their values; an update for a row that does not exist is ignored;
- **delete**: the row is removed.

Return the final rows as an array of `[id, row]` pairs sorted by `id` ascending (the columns inside a row may appear in any order). Implement `replayChanges(events)`.

### Constraints
- 0 ≤ n ≤ 10^5, where n is the number of events
- 1 ≤ lsn ≤ 10^12; ids are positive integers
- Repeated deliveries of the same lsn are identical.
- Column names are strings; values are strings or integers.
""",
    "replayChanges", ["events"],
    '''
def replay_changes(events):
    rows = {}
    last_lsn = None
    for lsn, op, row_id, fields in sorted(events, key=lambda e: e[0]):
        if lsn == last_lsn:            # duplicate delivery
            continue
        last_lsn = lsn
        if op == "insert":
            rows[row_id] = dict(fields)
        elif op == "update":
            if row_id in rows:
                rows[row_id].update(fields)
        else:                          # delete
            rows.pop(row_id, None)
    return [[row_id, rows[row_id]] for row_id in sorted(rows)]
''', "replay_changes",
    [
        ([[[3, "update", 1, {"city": "Pune"}], [1, "insert", 1, {"name": "Asha", "city": "Delhi"}],
           [2, "insert", 2, {"name": "Ravi", "city": "Goa"}], [4, "delete", 2, {}],
           [3, "update", 1, {"city": "Pune"}]]],
         '[[1, {"name": "Asha", "city": "Pune"}]]',
         "In lsn order: insert row 1, insert row 2, update row 1 (city becomes Pune, name is kept), delete row 2. The second copy of lsn 3 is ignored. Applying events in arrival order instead would try to update row 1 before it exists."),
        ([[[2, "update", 5, {"plan": "pro"}], [5, "insert", 5, {"plan": "free", "seats": 1}],
           [6, "update", 5, {"seats": 3}], [3, "insert", 7, {"plan": "free"}],
           [4, "delete", 7, {}], [8, "insert", 7, {"plan": "team"}]]],
         '[[5, {"plan": "free", "seats": 3}], [7, {"plan": "team"}]]',
         "lsn 2 updates row 5 before it is inserted, so it is ignored. Row 7 is inserted (lsn 3), deleted (lsn 4) and inserted again as a team row (lsn 8). Row 5 is inserted at lsn 5 and its seats change to 3 at lsn 6."),
    ],
    [
        ([[]], "[]", "no events gives an empty table"),
        ([[[2, "update", 1, {"a": 2}], [1, "insert", 1, {"a": 1, "b": 1}], [2, "update", 1, {"a": 2}],
           [3, "update", 1, {"b": 5}]]], '[[1, {"a": 2, "b": 5}]]',
         "updates merge into the row instead of replacing it, and the duplicate lsn 2 is applied once"),
    ],
    "Sort the events by lsn and skip an event whose lsn equals the previous one (or keep a set of applied lsns), then apply them to a map from id to row: insert replaces, update merges only if the row exists, delete removes. Finally sort the ids. O(n log n + F) time for F fields in total, O(n) space. Deduplicating first with a map keyed by lsn and then sorting is equally valid.",
    "First decide in which order the events must be applied and how to recognise a repeated delivery. Then think about what each op does to a map from id to row.",
    """
- Applies events in increasing lsn order, not in arrival order.
- Applies each lsn only once (duplicates are skipped).
- Insert replaces the row, update merges only the given columns, delete removes the row; an update to a missing row is ignored, and a row can be re-inserted after a delete.
- Returns [id, row] pairs sorted by id; correct ordering and dedup but replacing rows on update earns partial credit.
- O(n log n) for full credit.
""",
    """
Sorts events by lsn before applying them
Skips repeated deliveries of the same lsn
Insert sets the full row; delete removes it
Update merges changed columns and keeps the others
Ignores an update for a row that does not exist and allows re-insert after delete
Returns rows sorted by id in O(n log n)
""")

# ===========================================================================
# n06 Minutes When At Least K Regions Were Down (hard)
# ===========================================================================
story(
    "qb-scn-n06", "hard", "Minutes When At Least K Regions Were Down", "Scenario · Intervals · Sweep Line",
    """
A status page monitors a service from several regions. Probes in each region report outages as `[region, start, end]`, meaning the service was down in that region from minute `start` up to but **not including** minute `end`. Several probes may report the same outage, so the reports for one region can overlap or repeat; a region counts as down at minute `t` if **any** of its reports covers `t`.

The incident team wants to know how long the outage was widespread. Return the total number of minutes during which **at least `k` different regions** were down at the same time. Implement `multiRegionDowntime(outages, k)`.

### Constraints
- 1 ≤ n ≤ 10^5, where n is the number of reports
- 0 ≤ start < end ≤ 10^9
- 1 ≤ k ≤ 10^5
- Region names are short lowercase strings; reports are in no particular order.
""",
    "multiRegionDowntime", ["outages", "k"],
    '''
def multi_region_downtime(outages, k):
    by_region = {}
    for region, start, end in outages:
        by_region.setdefault(region, []).append((start, end))
    points = []
    for spans in by_region.values():          # merge each region's reports
        spans.sort()
        cur_s, cur_e = spans[0]
        for s, e in spans[1:]:
            if s <= cur_e:
                cur_e = max(cur_e, e)
            else:
                points += [(cur_s, 1), (cur_e, -1)]
                cur_s, cur_e = s, e
        points += [(cur_s, 1), (cur_e, -1)]
    points.sort()
    total, down, prev = 0, 0, None
    for t, delta in points:                   # sweep the timeline
        if prev is not None and down >= k:
            total += t - prev
        down += delta
        prev = t
    return total
''', "multi_region_downtime",
    [
        ([[["us", 0, 30], ["eu", 10, 40], ["ap", 20, 25], ["eu", 35, 50]], 2], "20",
         "Per region: us is down 0–30, eu 10–50 (its two reports overlap and merge) and ap 20–25. At least two regions are down from minute 10 to minute 30, which is 20 minutes; ap lies inside that span and adds nothing."),
        ([[["us", 0, 10], ["us", 5, 15], ["eu", 12, 20]], 2], "3",
         "us is down 0–15 (two overlapping reports from the same region) and eu 12–20. Two different regions are down only from 12 to 15. Counting reports instead of regions would wrongly add minutes 5–10."),
    ],
    [
        ([[["us", 0, 10], ["us", 5, 15], ["eu", 12, 20]], 3], "0", "fewer than k regions ever exist"),
        ([[["us", 0, 10], ["eu", 10, 20]], 2], "0",
         "end is exclusive, so outages that only touch at minute 10 never overlap"),
    ],
    "Group the reports by region and merge each region's intervals (sort + merge) so every region contributes at most one +1/−1 per merged span. Then sweep all span endpoints in time order, keeping a count of regions currently down and adding the elapsed time whenever that count is at least k. O(n log n) time, O(n) space. Coordinates go up to 10^9, so a per-minute array is not possible.",
    "Two reports from the same region must never count as two regions. Clean up each region's reports first, then think about walking along the timeline.",
    """
- Merges overlapping or duplicate reports within each region before counting regions.
- Uses a sweep over sorted endpoints (or an equivalent) to count regions down at each moment.
- Adds time only while at least k distinct regions are down, treating end as exclusive.
- O(n log n) for full credit; a correct per-minute simulation (infeasible for 10^9) or a sweep that counts reports instead of regions earns partial credit.
""",
    """
Groups reports by region
Merges overlapping and duplicate intervals inside each region
Creates +1/−1 events from the merged spans
Sweeps events in time order with a running count of regions down
Adds elapsed time only while the count is ≥ k (end exclusive)
O(n log n) time
""")

# ===========================================================================
# n07 Cheapest Batch Size for a Warehouse Load (medium)
# ===========================================================================
story(
    "qb-scn-n07", "medium", "Cheapest Batch Size for a Warehouse Load", "Scenario · Math · Greedy",
    """
A pipeline must load `rows` rows into a warehouse and can use any one batch size `b` from the array `sizes`. With size `b` the rows are split into `ceil(rows / b)` batches: every batch holds `b` rows except possibly the last one, which holds the remainder.

The warehouse charges each batch a fixed `fee` plus 1 unit per row, but it always bills **at least `minRows` rows** per batch. So a batch of `r` rows costs `fee + max(r, minRows)`.

Return `[b, cost]`: the batch size with the lowest total cost, and that cost. If several sizes tie, return the smallest of them. Implement `cheapestBatch(rows, sizes, fee, minRows)`.

### Constraints
- 1 ≤ rows ≤ 10^9
- 1 ≤ length(sizes) ≤ 10^4; sizes are distinct and 1 ≤ sizes[i] ≤ 10^9 (a size larger than `rows` means a single batch)
- 0 ≤ fee ≤ 10^6 and 1 ≤ minRows ≤ 10^9
- Totals can exceed 2^31 − 1, so use 64-bit integers.
""",
    "cheapestBatch", ["rows", "sizes", "fee", "minRows"],
    '''
def cheapest_batch(rows, sizes, fee, min_rows):
    best = None
    for b in sorted(sizes):                   # ascending, so ties keep the smaller size
        full, rest = divmod(rows, b)
        cost = full * (fee + max(b, min_rows))
        if rest:
            cost += fee + max(rest, min_rows)
        if best is None or cost < best[1]:
            best = [b, cost]
    return best
''', "cheapest_batch",
    [
        ([2500, [500, 1000, 2000], 50, 800], "[2000, 2900]",
         "Size 500: 5 batches, each billed as 800 rows, 5 × (50 + 800) = 4250. Size 1000: batches of 1000, 1000 and 500 (billed as 800) cost 1050 + 1050 + 850 = 2950. Size 2000: batches of 2000 and 500 cost 2050 + 850 = 2900, the cheapest."),
        ([1000, [1000, 250, 500], 0, 100], "[250, 1000]",
         "With no fee and every batch above minRows, each size costs exactly 1000. The smallest size, 250, wins the tie even though it is not first in sizes."),
    ],
    [
        ([1, [10, 1], 5, 3], "[1, 8]",
         "a single row: both sizes give one batch billed as 3 rows, so they tie and the smaller size wins"),
        ([1000000000, [3, 1000000], 1, 1], "[1000000, 1000001000]",
         "huge input: compute batch counts with division instead of looping batch by batch, and keep 64-bit totals"),
    ],
    "For each size b compute full = rows DIV b and rest = rows MOD b; the cost is full × (fee + max(b, minRows)) plus fee + max(rest, minRows) if rest > 0. Keep the minimum, preferring the smaller size on ties. O(s log s) with the sort (O(s) if you compare sizes on ties instead), O(1) extra space.",
    "You do not need to simulate the batches one by one. How many full batches are there, and how big is the last one?",
    """
- Computes the number of full batches and the size of the last partial batch with integer division and remainder.
- Applies the minimum billing (max(r, minRows)) to full batches and to the partial batch separately.
- Picks the cheapest size and breaks ties by the smaller size.
- O(1) work per size for full credit; simulating each batch earns partial credit (too slow for rows = 10^9).
""",
    """
Uses rows DIV b and rows MOD b for full and partial batches
Bills each batch fee + max(rows in batch, minRows)
Handles a size larger than rows (one batch)
Chooses the minimum total cost
Breaks ties by the smaller batch size
Uses 64-bit arithmetic and O(1) work per size
""")

# ===========================================================================
# n08 Earliest Finish Time for Dependent Jobs (hard)
# ===========================================================================
story(
    "qb-scn-n08", "hard", "Earliest Finish Time for Dependent Jobs", "Scenario · Graphs · Topological Sort",
    """
A nightly ETL run has `n` jobs labelled `0` to `n − 1`; job `i` takes `durations[i]` minutes. Each pair `[a, b]` in `deps` means job `b` must **finish** before job `a` can start. There are unlimited workers, so every job starts at the moment all of its dependencies have finished, and jobs with no dependencies start at minute `0`.

Return the earliest minute at which every job has finished, or `-1` if the dependencies contain a cycle (then the run can never complete). Implement `earliestFinish(durations, deps)`.

### Constraints
- 1 ≤ n ≤ 10^4 and 1 ≤ durations[i] ≤ 10^4
- 0 ≤ number of pairs ≤ 5 × 10^4
- 0 ≤ a, b < n, a ≠ b, and all pairs are distinct
""",
    "earliestFinish", ["durations", "deps"],
    '''
from collections import deque

def earliest_finish(durations, deps):
    n = len(durations)
    after = [[] for _ in range(n)]
    indegree = [0] * n
    for a, b in deps:
        after[b].append(a)
        indegree[a] += 1
    start = [0] * n
    queue = deque(i for i in range(n) if indegree[i] == 0)
    done = finish_all = 0
    while queue:
        job = queue.popleft()
        done += 1
        finish = start[job] + durations[job]
        finish_all = max(finish_all, finish)
        for nxt in after[job]:
            start[nxt] = max(start[nxt], finish)
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
    return finish_all if done == n else -1
''', "earliest_finish",
    [
        ([[3, 2, 4, 1], [[2, 0], [3, 1], [3, 2]]], "8",
         "Jobs 0 and 1 start at 0 and finish at 3 and 2. Job 2 waits for job 0 and runs 3–7. Job 3 waits for jobs 1 and 2, so it starts at 7 and finishes at 8."),
        ([[5, 1, 1], [[1, 2], [2, 1]]], "-1",
         "Jobs 1 and 2 each wait for the other, so neither can ever start; job 0 finishing at 5 does not help."),
    ],
    [
        ([[4, 9, 2], []], "9",
         "independent jobs run in parallel: the answer is the longest job, not the sum 15"),
        ([[1, 5, 2, 1], [[1, 0], [2, 0], [3, 1], [3, 2]]], "7",
         "job 3 must wait for the slower branch (1 + 5), not the faster one (1 + 2)"),
    ],
    "Process jobs in topological order (Kahn's algorithm): a job's start time is the maximum finish time of its dependencies, and the answer is the largest finish time. If fewer than n jobs are processed, there is a cycle, so return -1. O(n + m) time and space for m pairs. A DFS computing the longest path with memoisation and three visit states (to detect cycles) is equally valid.",
    "A job's start time depends only on the finish times of its dependencies. In what order can you visit the jobs so those finish times are always known first?",
    """
- Builds the dependency graph with the correct direction (b before a).
- Computes each job's start as the maximum finish time of its dependencies (longest path, not a sum over all jobs).
- Detects a cycle (including one in only part of the graph) and returns -1.
- O(n + m) for full credit; a correct but repeated-relaxation approach (e.g. O(n × m)) earns partial credit.
""",
    """
Builds adjacency and in-degrees from the pairs with the right direction
Processes jobs in topological order (Kahn or DFS)
Sets start = max finish of dependencies; finish = start + duration
Returns the maximum finish over all jobs
Returns -1 when a cycle prevents some jobs from running
O(n + m) time
""")

# ===========================================================================
# n09 Rolling-Window API Rate Limiter (medium)
# ===========================================================================
story(
    "qb-scn-n09", "medium", "Rolling-Window API Rate Limiter", "Scenario · Queue · Sliding Window",
    """
A public API protects itself with a per-client rate limit: a client may have at most `limit` **accepted** requests in any rolling window of `window` seconds. A request from client `c` at time `t` is accepted if fewer than `limit` of `c`'s previously accepted requests have a time greater than `t − window`; otherwise it is rejected. Rejected requests do **not** count towards the limit.

You are given `requests`, an array of `[time, clientId]` pairs sorted by `time` (seconds, non-decreasing). Return an array of booleans in the same order, `true` for each accepted request and `false` for each rejected one. Implement `rateLimit(requests, limit, window)`.

### Constraints
- 1 ≤ n ≤ 10^5, where n is the number of requests
- 0 ≤ time ≤ 10^9
- 1 ≤ limit ≤ 10^4 and 1 ≤ window ≤ 10^9
- Each client is limited separately; client ids are strings.
""",
    "rateLimit", ["requests", "limit", "window"],
    '''
from collections import deque

def rate_limit(requests, limit, window):
    accepted = {}                    # client -> deque of accepted times
    result = []
    for time, client in requests:
        q = accepted.setdefault(client, deque())
        while q and q[0] <= time - window:
            q.popleft()
        if len(q) < limit:
            q.append(time)
            result.append(True)
        else:
            result.append(False)
    return result
''', "rate_limit",
    [
        ([[[1, "a"], [2, "a"], [3, "a"], [11, "a"], [12, "a"]], 2, 10], "[true, true, false, true, true]",
         "At time 3 the accepted requests at 1 and 2 are both after 3 − 10, so the limit of 2 is reached. At 11 only the request at 2 is after 1. At 12 the request at 2 is no longer after 2, leaving only 11, so it is accepted."),
        ([[[0, "x"], [0, "y"], [1, "x"], [5, "x"], [6, "x"]], 1, 5], "[true, true, false, true, false]",
         "x and y are limited separately, so y's first request is accepted. x's request at 5 is accepted because its accepted request at 0 is not after 5 − 5 = 0. The one at 6 is rejected because the accepted request at 5 is after 1."),
    ],
    [
        ([[[0, "a"], [1, "a"], [2, "a"], [3, "a"]], 1, 3], "[true, false, false, true]",
         "the rejected requests at 1 and 2 must not count; if they did, time 3 would also be rejected"),
        ([[[5, "c"], [5, "c"], [5, "c"], [5, "c"], [6, "c"]], 3, 1], "[true, true, true, false, true]",
         "a burst in the same second hits the limit; at 6 the requests at 5 are no longer after 6 − 1"),
    ],
    "Keep, per client, a queue of accepted request times. For each request, drop times ≤ t − window from the front, then accept (and push t) if the queue holds fewer than limit times. Each time is pushed and popped at most once, so O(n) amortised time and O(n) space. A per-client array with a moving start pointer is equivalent.",
    "For each client, keep only the accepted times that can still matter. When can an old accepted time be thrown away for good?",
    """
- Tracks accepted requests separately for each client.
- Counts only accepted requests that are inside the window (time > t − window, boundary excluded).
- Does not record rejected requests.
- Uses a queue/pointer for O(n) amortised time for full credit; rescanning all earlier requests each time earns partial credit.
""",
    """
Keeps a separate structure per client in a map/dictionary
Removes accepted times ≤ t − window before checking
Accepts when fewer than limit times remain and records the time
Never records rejected requests
Returns one boolean per request in input order
O(n) amortised time
""")

# ===========================================================================
# n10 Grouping Alerts Into Incidents (medium)
# ===========================================================================
story(
    "qb-scn-n10", "medium", "Grouping Alerts Into Incidents", "Scenario · Hash Map · Sorting",
    """
A monitoring system fires an alert `[time, service]` (time in minutes) whenever a health check fails. To avoid paging on-call engineers repeatedly, alerts are grouped into **incidents** per service: when a service's alerts are put in time order, an alert joins the current incident if it comes at most `gap` minutes after the **previous alert of the same service**; otherwise it starts a new incident. Alerts of different services never share an incident.

Given `alerts` (in no particular order) and `gap`, return one `[service, incidents]` pair for each service that has alerts, sorted by the number of incidents from highest to lowest, with ties broken by service name alphabetically. Implement `incidentCounts(alerts, gap)`.

### Constraints
- 1 ≤ n ≤ 10^5, where n is the number of alerts
- 0 ≤ time ≤ 10^9 and 0 ≤ gap ≤ 10^9
- Service names are lowercase strings; several alerts may share the same time.
""",
    "incidentCounts", ["alerts", "gap"],
    '''
def incident_counts(alerts, gap):
    times = {}
    for time, service in alerts:
        times.setdefault(service, []).append(time)
    counts = []
    for service, ts in times.items():
        ts.sort()
        incidents = 1
        for prev, cur in zip(ts, ts[1:]):
            if cur - prev > gap:
                incidents += 1
        counts.append([service, incidents])
    counts.sort(key=lambda pair: (-pair[1], pair[0]))
    return counts
''', "incident_counts",
    [
        ([[[0, "db"], [4, "db"], [9, "db"], [30, "db"], [2, "api"], [50, "api"]], 5],
         '[["api", 2], ["db", 2]]',
         "db's alerts at 0, 4 and 9 are each at most 5 minutes after the previous one, so they form one incident; 30 starts a second. api's alerts at 2 and 50 are 48 minutes apart, so 2 incidents. Both have 2, so api comes first alphabetically."),
        ([[[20, "queue"], [0, "queue"], [10, "queue"], [31, "queue"], [5, "cache"]], 10],
         '[["queue", 2], ["cache", 1]]',
         "In time order queue fires at 0, 10, 20 and 31. The alert at 20 is 20 minutes after the incident began but only 10 after the previous alert, so it still joins; 31 is 11 after 20 and starts incident 2. cache has a single alert."),
    ],
    [
        ([[[7, "x"], [7, "x"], [7, "x"]], 0], '[["x", 1]]',
         "alerts at the same minute are 0 apart, which is within a gap of 0"),
        ([[[0, "a"], [100, "a"], [200, "a"], [0, "b"], [1, "b"]], 99], '[["a", 3], ["b", 1]]',
         "a gap of exactly 100 is more than 99, so each a alert is its own incident"),
    ],
    "Group alert times by service, sort each group, and count 1 plus the number of consecutive gaps greater than gap. Then sort the pairs by count descending and name ascending. O(n log n) time, O(n) space.",
    "Handle each service on its own. Once its alerts are in time order, where exactly does a new incident begin?",
    """
- Groups alerts by service and sorts each service's alerts by time.
- Compares each alert with the previous alert of the same service (chaining), not with the first alert of the incident.
- Treats a difference of exactly gap as the same incident.
- Sorts the result by incidents descending, then name ascending; correct counts with wrong ordering earns partial credit.
""",
    """
Groups alert times per service in a map/dictionary
Sorts each service's times
Starts a new incident only when the difference from the previous alert > gap
Handles equal times and a gap of 0
Sorts by incidents descending, then service name ascending
O(n log n) time
""")

# ===========================================================================
# n11 Prorated Bill for Mid-Month Plan Changes (medium)
# ===========================================================================
story(
    "qb-scn-n11", "medium", "Prorated Bill for Mid-Month Plan Changes", "Scenario · Dates · Math",
    """
A SaaS product bills customers per calendar month, prorated by day. For one month you are given `year`, `month` (1–12) and `changes`, an array of `[day, price]` pairs sorted by `day`: from that day of the month (inclusive) the customer is on a plan whose full monthly price is `price` rupees. A price of `0` means the subscription was cancelled. Before the first change there is no subscription.

Each day spent on a plan costs `price ÷ daysInMonth`, where `daysInMonth` is the real length of that month. February has 29 days in a leap year: a year divisible by 4, except years divisible by 100 that are not divisible by 400.

Return the month's total charge rounded to 2 decimal places (round half up). Round only once, at the end. Implement `proratedBill(year, month, changes)`.

### Constraints
- 1900 ≤ year ≤ 2400 and 1 ≤ month ≤ 12
- 1 ≤ length(changes) ≤ 31; days are distinct, sorted and valid for the month
- 0 ≤ price ≤ 10^6
""",
    "proratedBill", ["year", "month", "changes"],
    '''
from fractions import Fraction
from math import floor

def prorated_bill(year, month, changes):
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    month_days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    days = month_days[month - 1]
    total = Fraction(0)
    for i, (day, price) in enumerate(changes):
        last_day = changes[i + 1][0] - 1 if i + 1 < len(changes) else days
        total += Fraction(price * (last_day - day + 1), days)
    return floor(total * 100 + Fraction(1, 2)) / 100     # round half up, once
''', "prorated_bill",
    [
        ([2026, 4, [[1, 900], [21, 1500]]], "1100.00",
         "April has 30 days. Days 1–20 at 900 cost 20 × 900 ÷ 30 = 600 and days 21–30 at 1500 cost 10 × 1500 ÷ 30 = 500."),
        ([2024, 2, [[15, 2900], [25, 0]]], "1000.00",
         "2024 is a leap year, so February has 29 days and each day at 2900 costs 100. The plan runs on days 15–24 (10 days); from day 25 the price is 0."),
    ],
    [
        ([2100, 2, [[8, 2800]]], "2100.00",
         "2100 is not a leap year: 21 days of a 28-day month; assuming 29 days would give 2124.14"),
        ([2026, 1, [[1, 1000], [11, 2000], [31, 500]]], "1629.03",
         "a 31-day month with a change on the last day: 50500 ÷ 31 = 1629.032…"),
    ],
    "Work out daysInMonth (with the leap-year rule), then for each change the plan lasts from its day to the day before the next change (or the month's last day). Add price × activeDays ÷ daysInMonth for every segment using exact arithmetic (fractions, or integer paise with a single division), and round half up once at the end. O(c) time for c changes. Floating-point with a final round is acceptable if the rounding is done once.",
    "Each change starts a segment. Where does each segment end, and how many days long is a month in a given year?",
    """
- Uses the correct month length, including the full leap-year rule (÷4, not ÷100 unless ÷400).
- Splits the month into segments from each change day to the day before the next change (or the month's end).
- Charges price × days ÷ daysInMonth per segment, treating price 0 as cancelled.
- Rounds once at the end to 2 decimal places; correct segments with a wrong month length or rounding earns partial credit.
""",
    """
Computes days in the month for every month
Applies the leap-year rule including the 100/400 exceptions
Finds each segment's length from consecutive change days
Charges price × days ÷ daysInMonth per segment
Ignores days before the first change and handles price 0
Rounds the total once to 2 decimals
""")

# ===========================================================================
# n12 Fewest Workers to Finish Before the Deadline (hard)
# ===========================================================================
min_workers = story(
    "qb-scn-n12", "hard", "Fewest Workers to Finish Before the Deadline", "Scenario · Binary Search · Heap",
    """
A batch system has a queue of jobs; job `i` takes `durations[i]` minutes and jobs must be **started in queue order**. With `w` workers, all workers are free at minute `0`, and whenever a worker becomes free it immediately takes the next job from the front of the queue. If several workers are free at the same moment, any of them may take the job; the timing is the same.

The team wants to rent as few workers as possible. Return the smallest `w` (between 1 and the number of jobs) for which every job has finished by minute `deadline` (finishing exactly at `deadline` is fine), or `-1` if no number of workers is enough. Implement `minWorkers(durations, deadline)`.

### Constraints
- 1 ≤ n ≤ 10^5, where n is the number of jobs
- 1 ≤ durations[i] ≤ 10^4 and 1 ≤ deadline ≤ 10^9
- Aim to do better than simulating every possible `w` from 1 to n.
""",
    "minWorkers", ["durations", "deadline"],
    '''
import heapq

def min_workers(durations, deadline):
    if max(durations) > deadline:
        return -1                      # even starting at 0 a job is too long

    def finish_time(w):
        free = [0] * w                 # min-heap of times when each worker is free
        end = 0
        for d in durations:
            t = heapq.heappop(free)
            heapq.heappush(free, t + d)
            end = max(end, t + d)
        return end

    low, high = 1, len(durations)
    while low < high:
        mid = (low + high) // 2
        if finish_time(mid) <= deadline:
            high = mid
        else:
            low = mid + 1
    return low
''', "min_workers",
    [
        ([[4, 2, 3, 1, 5], 8], "3",
         "With 2 workers, the 4- and 2-minute jobs start at 0; the 3-minute job starts at 2 and the 1-minute job at 4, both ending at 5, so the 5-minute job ends at 10 > 8. With 3 workers the first three jobs start at 0, the 1-minute job runs 2–3, and the 5-minute job runs 3–8, finishing exactly at the deadline."),
        ([[6, 2], 5], "-1",
         "The 6-minute job cannot finish by minute 5 even if it starts at minute 0."),
    ],
    [
        ([[5, 5, 5, 5], 20], "1", "a single worker finishing exactly at the deadline is enough"),
        ([[1, 1, 1, 1, 1, 1, 1, 1, 1, 10], 10], "10",
         "the long job is last in the queue and must start at minute 0, so every worker is needed; 9 workers finish at 11"),
    ],
    "Adding a worker never makes any job start later, so the finish time is non-increasing in w and we can binary search the smallest w in [1, n]. For a candidate w, simulate with a min-heap of worker free times: each job goes to the earliest free worker. Return -1 first if some job is longer than the deadline. O(n log n × log n) time, O(n) space. Linear search over w with the same simulation is correct but earns partial credit.",
    "For a fixed number of workers you can compute the finish time with a simulation. If w workers are enough, are w + 1 workers always enough too? How can you use that?",
    """
- Simulates a fixed worker count correctly (each job goes to the earliest free worker, in queue order), e.g. with a min-heap.
- Uses the monotonic property (more workers never finish later) to binary search the smallest w.
- Returns -1 when the longest job alone exceeds the deadline, and accepts finishing exactly at the deadline.
- O(n log² n) for full credit; trying every w from 1 to n with a correct simulation earns partial credit.
""",
    """
Simulates w workers with a min-heap (or equivalent) of free times
Assigns jobs strictly in queue order to the earliest free worker
Checks finish time ≤ deadline (inclusive)
Binary searches w in [1, n] using monotonicity
Returns -1 when max(durations) > deadline
O(n log² n) time
""")

# extra randomized check: the reference binary search equals a linear scan
def _finish(durations, w):
    import heapq
    free = [0] * w
    end = 0
    for d in durations:
        t = heapq.heappop(free)
        heapq.heappush(free, t + d)
        end = max(end, t + d)
    return end


rng = random.Random(7)
for _ in range(400):
    ds = [rng.randint(1, 12) for _ in range(rng.randint(1, 9))]
    dl = rng.randint(1, 40)
    linear = next((w for w in range(1, len(ds) + 1) if _finish(ds, w) <= dl), -1)
    assert min_workers(ds, dl) == linear, (ds, dl)
    CHECKS += 1


# ===========================================================================
# n13 Debugging: Weekly Signup Total Counts Eight Days (easy)
# ===========================================================================
def _weekly(signups, end, first):
    total = 0
    for d in range(end - first, end + 1):
        if d < 0 or d >= len(signups):
            return f"error — index {d} is out of range"
        total += signups[d]
    return total


debug(
    "qb-scn-n13", "easy", "Debugging: Weekly Signup Total Counts Eight Days", "Debugging · Arrays · Loops",
    """
A growth dashboard shows the number of signups in the **7 days** ending on day `end`, that is, days `end − 6` to `end`. `signups[d]` holds the number of signups on day `d`. The function below returns totals that are too high, and for the very first full week it crashes.

Pseudocode note: `FOR d FROM a TO b` runs with d = a, a + 1, …, b (**both ends included**). Arrays are 0-indexed, and reading an index outside `0 … length(arr) − 1` is an error.

Do three things: (1) point out the bug, (2) explain **why** the totals are too high, and (3) rewrite the faulty line correctly.

### Constraints
- 6 ≤ end ≤ length(signups) − 1 ≤ 10^5
- 0 ≤ signups[d] ≤ 10^6
""",
    """
FUNCTION weeklySignups(signups, end):
    total ← 0
    FOR d FROM end − 7 TO end:
        total ← total + signups[d]
    RETURN total
""",
    "weeklySignups", ["signups", "end"],
    lambda s, e: _weekly(s, e, 6), lambda s, e: _weekly(s, e, 7),
    [
        ([[5, 1, 2, 3, 4, 5, 6, 7], 7], "28", "33",
         "The loop visits d = 0 … 7, which is eight days. Day 0 (5 signups) is outside the week but is still added."),
        ([[2, 2, 2, 2, 2, 2, 2, 2, 2, 2], 9], "14", "16",
         "Every day has 2 signups; eight days give 16 instead of 14."),
    ],
    [
        ([[1, 1, 1, 1, 1, 1, 1], 6], "7", "error — index -1 is out of range",
         "the first full week starts at day 0, so end − 7 is -1"),
        ([[0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0], 14], "0", "10",
         "a spike on day 7 sits just outside the week ending on day 14"),
    ],
    "FOR d FROM end − 6 TO end.",
    """
Bug: the loop starts at `end − 7` instead of `end − 6`.
Why: the range is inclusive at both ends, so `end − 7 … end` contains 8 days, not 7. The extra day `end − 7` is added to every total, which makes it too high, and when end = 6 the loop reads index -1, which does not exist, so the program crashes.
Fix: start one day later so exactly 7 days are summed.

Corrected pseudocode:
FUNCTION weeklySignups(signups, end):
    total ← 0
    FOR d FROM end − 6 TO end:
        total ← total + signups[d]
    RETURN total
""",
    "Count how many values d takes when it runs from end − 7 to end, both ends included.",
    """
- Identifies the loop start (end − 7) as the bug.
- Explains that an inclusive range from end − 7 to end covers 8 days, adding one extra day.
- Explains the crash when end = 6 (index -1).
- Fix starts the loop at end − 6 (or loops 7 times from end backwards).
""",
    """
Points to the FOR d FROM end − 7 TO end line
Counts 8 iterations for an inclusive range of that size
Explains the extra day makes totals too high
Explains the index -1 error for end = 6
Gives the fix FOR d FROM end − 6 TO end
""")


# ===========================================================================
# n14 Debugging: Sync Success Rate Shows 0% (easy)
# ===========================================================================
def _rate_fixed(ok, total):
    return 0 if total == 0 else (ok * 100) // total


def _rate_buggy(ok, total):
    return 0 if total == 0 else (ok // total) * 100


debug(
    "qb-scn-n14", "easy", "Debugging: Sync Success Rate Shows 0%", "Debugging · Math · Data Types",
    """
A pipeline health page shows the percentage of syncs that succeeded, rounded **down** to a whole number. The function runs without error, but it shows `0` for almost every pipeline; only pipelines where every sync succeeded show a sensible value.

Pseudocode note: `DIV` is **integer** division (it discards the fraction, so 7 DIV 2 = 3) and `×` is multiplication. The part in parentheses is evaluated first.

Do three things: (1) point out the bug, (2) explain **why** the result is 0 unless every sync succeeded, and (3) fix it.

### Constraints
- 0 ≤ succeeded ≤ total ≤ 10^9
- The function must return 0 when `total` is 0.
- Keep the result a whole-number percentage rounded down (64-bit integers are available).
""",
    """
FUNCTION successRate(succeeded, total):
    IF total = 0:
        RETURN 0
    RETURN (succeeded DIV total) × 100
""",
    "successRate", ["succeeded", "total"], _rate_fixed, _rate_buggy,
    [
        ([45, 50], "90", "0", "45 DIV 50 is 0 because 45 < 50, and 0 × 100 is still 0."),
        ([50, 50], "100", "100", "50 DIV 50 = 1, so the bug stays hidden when every sync succeeds."),
        ([1, 3], "33", "0", "1 × 100 = 100, and 100 DIV 3 = 33 (33.3 rounded down)."),
    ],
    [
        ([0, 0], "0", "0", "no syncs yet: the guard against dividing by zero must stay"),
        ([999, 1000], "99", "0", "99.9 is rounded down, not up to 100"),
    ],
    "RETURN (succeeded × 100) DIV total.",
    """
Bug: `(succeeded DIV total) × 100` divides before multiplying.
Why: succeeded is never larger than total, so the integer division succeeded DIV total is 0 whenever at least one sync failed (and 1 only when all succeeded). The fraction is thrown away before it is scaled to a percentage, so multiplying by 100 afterwards cannot bring it back.
Fix: multiply by 100 first, then divide, so only the part below 1% is discarded.

Corrected pseudocode:
FUNCTION successRate(succeeded, total):
    IF total = 0:
        RETURN 0
    RETURN (succeeded × 100) DIV total
(Equivalent: use real division and round down, e.g. floor(succeeded / total × 100).)
""",
    "Work out succeeded DIV total by hand for 45 and 50. What is left to multiply by 100?",
    """
- Identifies the order of operations with integer division as the bug.
- Explains that succeeded DIV total is 0 whenever succeeded < total.
- Fix multiplies by 100 before the integer division (or uses real division then rounds down).
- Keeps the total = 0 guard.
""",
    """
Points to the (succeeded DIV total) × 100 line
Explains integer division discards the fraction first
Explains why only 100% survives the bug
Fix computes (succeeded × 100) DIV total or uses real division and floor
Keeps returning 0 when total is 0
""")


# ===========================================================================
# n15 Debugging: Per-Pipeline Row Totals Keep Growing (easy)
# ===========================================================================
def _totals(pipelines, reset):
    totals, s = [], 0
    for runs in pipelines:
        if reset:
            s = 0
        for r in runs:
            s += r
        totals.append(s)
    return totals


debug(
    "qb-scn-n15", "easy", "Debugging: Per-Pipeline Row Totals Keep Growing", "Debugging · Arrays · Loops",
    """
A daily report should return, for each pipeline, the total number of rows it synced. `pipelines[i]` is an array holding the row count of each run of pipeline `i`. The first total is always right, but every later total seems to include the pipelines before it.

Pseudocode note: `append x TO arr` adds `x` at the end of `arr`.

Do three things: (1) point out the bug, (2) explain **why** the later totals are too large, and (3) fix it.

### Constraints
- 0 ≤ length(pipelines) ≤ 10^4
- Each pipeline has 0 to 10^3 runs, and 0 ≤ row count ≤ 10^9
- The output has one total per pipeline, in the same order.
""",
    """
FUNCTION rowTotals(pipelines):
    totals ← []
    sum ← 0
    FOR each runs IN pipelines:
        FOR each r IN runs:
            sum ← sum + r
        append sum TO totals
    RETURN totals
""",
    "rowTotals", ["pipelines"],
    lambda p: _totals(p, True), lambda p: _totals(p, False),
    [
        ([[[10, 20], [5], [1, 1, 1]]], "[30, 5, 3]", "[30, 35, 38]",
         "sum is never reset, so the second pipeline starts counting from 30 and the third from 35."),
        ([[[0], [7, 3]]], "[0, 10]", "[0, 10]",
         "The first pipeline adds nothing, so the leftover sum is 0 and the bug stays hidden."),
    ],
    [
        ([[[4], [], [6]]], "[4, 0, 6]", "[4, 4, 10]", "a pipeline with no runs must report 0"),
        ([[]], "[]", "[]", "no pipelines at all"),
    ],
    "move sum ← 0 inside the outer loop, just before the inner loop.",
    """
Bug: `sum ← 0` is set once, before the outer loop, instead of once per pipeline.
Why: the accumulator keeps the rows of every pipeline processed so far, so each appended value is a running total across pipelines instead of that pipeline's own total. Only the first pipeline (when sum really starts at 0) is right.
Fix: reset the accumulator at the start of each pipeline.

Corrected pseudocode:
FUNCTION rowTotals(pipelines):
    totals ← []
    FOR each runs IN pipelines:
        sum ← 0
        FOR each r IN runs:
            sum ← sum + r
        append sum TO totals
    RETURN totals
""",
    "Trace the value of sum just before the inner loop starts for the second pipeline. What should it be at that point?",
    """
- Identifies that sum is initialised outside the outer loop and never reset.
- Explains that each total includes the rows of the earlier pipelines (running total).
- Fix resets sum to 0 for each pipeline, before the inner loop.
- Fixed version returns 0 for a pipeline with no runs.
""",
    """
Points to the sum ← 0 line placed before the outer loop
Explains the accumulator carries over between pipelines
Fix moves sum ← 0 inside the outer loop
Gives the corrected output [30, 5, 3]
Confirms an empty pipeline reports 0
""")


# ===========================================================================
# n16 Debugging: Late-Night Orders Land on the Wrong Day (medium)
# ===========================================================================
def _ist(ts_list, offset):
    counts = {}
    for ts in ts_list:
        local = datetime.strptime(ts, "%Y-%m-%d %H:%M") + timedelta(minutes=offset)
        day = local.strftime("%Y-%m-%d")
        counts[day] = counts.get(day, 0) + 1
    return counts


debug(
    "qb-scn-n16", "medium", "Debugging: Late-Night Orders Land on the Wrong Day", "Debugging · Dates · Time Zones",
    """
An e-commerce client in India wants a count of orders per **IST calendar day**. Order timestamps are stored in UTC as `"YYYY-MM-DD HH:MM"`, and India Standard Time is UTC **+5 hours 30 minutes** all year (there is no daylight saving). Most days look right, but some orders placed shortly after midnight IST are counted on the previous day.

Pseudocode note: `addMinutes(ts, m)` returns the timestamp `m` minutes later, correctly rolling over the hour, day, month and year. `dateOf(ts)` returns its `"YYYY-MM-DD"` part. The keys of the returned map may be in any order.

Do three things: (1) point out the bug, (2) explain **which** orders get the wrong day and why, and (3) fix it.

### Constraints
- 0 ≤ number of orders ≤ 10^5
- Every timestamp is a valid UTC time in the format above.
""",
    """
FUNCTION ordersPerIstDay(timestamps):
    counts ← empty map
    FOR each ts IN timestamps:
        local ← addMinutes(ts, 5 × 60)
        day ← dateOf(local)
        IF day NOT IN counts:
            counts[day] ← 0
        counts[day] ← counts[day] + 1
    RETURN counts
""",
    "ordersPerIstDay", ["timestamps"],
    lambda t: _ist(t, 330), lambda t: _ist(t, 300),
    [
        ([["2026-10-05 18:40", "2026-10-05 10:00", "2026-10-05 19:10"]],
         '{"2026-10-05": 1, "2026-10-06": 2}', '{"2026-10-05": 2, "2026-10-06": 1}',
         "In IST the orders are at 00:10 on 6 Oct, 15:30 on 5 Oct and 00:40 on 6 Oct. Adding only 5 hours puts the first one at 23:40 on 5 Oct."),
        ([["2026-10-31 18:45"]], '{"2026-11-01": 1}', '{"2026-10-31": 1}',
         "18:45 UTC on 31 Oct is 00:15 IST on 1 Nov; the buggy shift gives 23:45 on 31 Oct, so the order even lands in the wrong month."),
    ],
    [
        ([["2026-12-31 18:30"]], '{"2027-01-01": 1}', '{"2026-12-31": 1}',
         "exactly midnight IST, and the year rolls over"),
        ([["2026-03-01 18:29", "2026-03-01 19:00"]], '{"2026-03-01": 1, "2026-03-02": 1}',
         '{"2026-03-01": 1, "2026-03-02": 1}',
         "only UTC times from 18:30 to 18:59 are misdated; these two sit just outside that range"),
    ],
    "local ← addMinutes(ts, 5 × 60 + 30), i.e. shift by 330 minutes.",
    """
Bug: the conversion `addMinutes(ts, 5 × 60)` shifts by 5 hours (300 minutes), but IST is UTC + 5 hours 30 minutes (330 minutes).
Why: every local time comes out 30 minutes too early. That only changes the date for orders whose real IST time is between 00:00 and 00:29, i.e. UTC times from 18:30 to 18:59: they are pushed back to 23:30–23:59 of the previous day (which can also be the previous month or year).
Fix: shift by the full offset of 330 minutes. Because India has no daylight saving, a fixed offset is correct all year.

Corrected pseudocode:
FUNCTION ordersPerIstDay(timestamps):
    counts ← empty map
    FOR each ts IN timestamps:
        local ← addMinutes(ts, 5 × 60 + 30)
        day ← dateOf(local)
        IF day NOT IN counts:
            counts[day] ← 0
        counts[day] ← counts[day] + 1
    RETURN counts
""",
    "Convert 18:40 UTC to IST by hand, then compare with what the function computes. How far apart are they?",
    """
- Identifies the offset 5 × 60 (300 minutes) as the bug; IST needs 330 minutes.
- Explains that local times are 30 minutes early, which only changes the date for IST 00:00–00:29 (UTC 18:30–18:59).
- Notes that the wrong day can also cross a month or year boundary.
- Fix uses a 330-minute offset (or 5 h 30 min); explaining but not fixing earns partial credit.
""",
    """
Points to the addMinutes(ts, 5 × 60) line
States that IST is UTC + 330 minutes, not 300
Identifies UTC 18:30–18:59 (IST 00:00–00:29) as the affected orders
Explains the date (and possibly month/year) rolls back by one day
Gives the fix addMinutes(ts, 330)
""")


# ===========================================================================
# n17 Debugging: Removing Failed Jobs Skips Some (medium)
# ===========================================================================
def _remove_buggy(jobs, failed):
    jobs = list(jobs)
    i = 0
    while i < len(jobs):
        if jobs[i] in failed:
            del jobs[i]
        i += 1
    return jobs


def _remove_fixed(jobs, failed):
    jobs = list(jobs)
    i = 0
    while i < len(jobs):
        if jobs[i] in failed:
            del jobs[i]
        else:
            i += 1
    return jobs


debug(
    "qb-scn-n17", "medium", "Debugging: Removing Failed Jobs Skips Some", "Debugging · Arrays · Mutation",
    """
Before a retry run, a scheduler removes every job whose id is in `failed` from the queue `jobs`, keeping the other jobs in their original order. The function works when failed jobs are spread out, but when two failed jobs sit next to each other, one of them survives.

Pseudocode note: `removeAt(arr, i)` deletes `arr[i]` and shifts every later element one place to the left, so `length(arr)` shrinks by 1. `x IN failed` is `true` when `x` is one of the failed ids (shown as an array in the examples). `length(jobs)` is re-evaluated each time the `WHILE` condition is checked.

Do three things: (1) point out the bug, (2) explain **why** a failed job right after another failed job is missed, and (3) fix it.

### Constraints
- 0 ≤ length(jobs) ≤ 10^4
- Job ids are positive integers and may repeat.
- You may change `jobs` in place or return a new array.
""",
    """
FUNCTION removeFailed(jobs, failed):
    i ← 0
    WHILE i < length(jobs):
        IF jobs[i] IN failed:
            removeAt(jobs, i)
        i ← i + 1
    RETURN jobs
""",
    "removeFailed", ["jobs", "failed"], _remove_fixed, _remove_buggy,
    [
        ([[101, 102, 103, 104], [102, 103]], "[101, 104]", "[101, 103, 104]",
         "Removing 102 at index 1 shifts 103 into index 1, but i then moves on to 2, so 103 is never checked."),
        ([[7, 8, 9], [8]], "[7, 9]", "[7, 9]",
         "A single failed job between two good ones is removed correctly, which is why simple tests pass."),
        ([[1, 2, 3, 4], [1, 2, 3, 4]], "[]", "[2, 4]",
         "Every removal makes the loop skip the next job, so every second job survives."),
    ],
    [
        ([[5, 5, 6], [5]], "[6]", "[5, 6]", "the same failed id twice in a row"),
        ([[], [1]], "[]", "[]", "empty queue: the loop never runs"),
    ],
    "advance i only when nothing was removed (put i ← i + 1 in an ELSE), or walk from the end, or build a new array of kept jobs.",
    """
Bug: `i ← i + 1` runs even right after `removeAt(jobs, i)`.
Why: removing the element at index i shifts the next element into index i. Incrementing i then jumps over that element without checking it, so when two failed jobs are adjacent the second one is skipped and stays in the queue. The array is being changed while it is being walked by index.
Fix: only move forward when the current element was kept (or iterate from the last index down to 0, or copy the kept jobs into a new array).

Corrected pseudocode:
FUNCTION removeFailed(jobs, failed):
    i ← 0
    WHILE i < length(jobs):
        IF jobs[i] IN failed:
            removeAt(jobs, i)
        ELSE:
            i ← i + 1
    RETURN jobs
(Alternative: kept ← []; FOR each j IN jobs: IF j NOT IN failed: append j TO kept; RETURN kept.)
""",
    "Trace the array and i for [101, 102, 103, 104]. After 102 is removed, which element is at index 1, and which index is checked next?",
    """
- Identifies that i is incremented even after an element is removed.
- Explains that removal shifts the next element into the current index, so it is skipped.
- Fix increments i only when nothing is removed, iterates backwards, or builds a new array.
- Fixed version handles adjacent and repeated failed ids, and an empty queue.
""",
    """
Points to the unconditional i ← i + 1 after removeAt
Explains elements shift left after a removal
Explains the element moved into index i is never checked
Gives a correct fix (ELSE branch, reverse loop, or new array)
Confirms [101, 104] and [] for all-failed input
""")


# ===========================================================================
# n18 Debugging: Payment Webhooks Lose Updates (medium)
# ===========================================================================
def _webhook_buggy(events):
    status, last = {}, 0
    for pid, ver, st in events:
        if ver > last:
            status[pid] = st
            last = ver
    return status


def _webhook_fixed(events):
    status, version = {}, {}
    for pid, ver, st in events:
        if pid not in version or ver > version[pid]:
            status[pid] = st
            version[pid] = ver
    return status


debug(
    "qb-scn-n18", "medium", "Debugging: Payment Webhooks Lose Updates", "Debugging · Hash Map · Deduplication",
    """
A payment gateway sends webhook events about payments. Each payment's versions start at 1 and go up by one with every change; events can arrive out of order, and retried deliveries repeat an event exactly. The function should return, for every payment, the status carried by the **highest version** seen for that payment. With one payment it works, but when several payments are mixed, some come back with an old status or are missing entirely.

Pseudocode note: each event `e` has fields `e.paymentId`, `e.version` and `e.status`; in the examples an event is written `[paymentId, version, status]`. The keys of the returned map may be in any order.

Do three things: (1) point out the bug, (2) explain **why** statuses are lost when payments are mixed, and (3) fix it.

### Constraints
- 0 ≤ number of events ≤ 10^5
- 1 ≤ version ≤ 10^6
- A retried event is identical to the original.
""",
    """
FUNCTION latestStatus(events):
    status ← empty map
    lastVersion ← 0
    FOR each e IN events:
        IF e.version > lastVersion:
            status[e.paymentId] ← e.status
            lastVersion ← e.version
    RETURN status
""",
    "latestStatus", ["events"], _webhook_fixed, _webhook_buggy,
    [
        ([[["p1", 1, "created"], ["p1", 2, "paid"], ["p2", 1, "created"]]],
         '{"p1": "paid", "p2": "created"}', '{"p1": "paid"}',
         "After p1 reaches version 2, lastVersion is 2, so p2's version-1 event fails the check and p2 is never stored."),
        ([[["p1", 2, "paid"], ["p1", 1, "created"], ["p1", 2, "paid"]]],
         '{"p1": "paid"}', '{"p1": "paid"}',
         "With a single payment, one shared lastVersion is correct: the late version-1 event and the retry are both skipped, so the bug is invisible."),
        ([[["a", 1, "created"], ["b", 1, "created"], ["b", 2, "failed"], ["a", 2, "paid"]]],
         '{"a": "paid", "b": "failed"}', '{"a": "created", "b": "failed"}',
         "b's first event is skipped (1 is not greater than 1), b's version 2 raises lastVersion to 2, and then a's version-2 event is rejected, so a stays created."),
    ],
    [
        ([[["x", 3, "refunded"], ["y", 5, "paid"], ["x", 4, "disputed"]]],
         '{"x": "disputed", "y": "paid"}', '{"x": "refunded", "y": "paid"}',
         "a newer x event arrives after a higher version of y"),
        ([[]], "{}", "{}", "no events"),
    ],
    "keep a version per payment and compare with that payment's own version: IF e.paymentId NOT IN version OR e.version > version[e.paymentId].",
    """
Bug: the dedup check compares every event with a single `lastVersion` shared by all payments.
Why: versions are only meaningful within one payment. Once any payment reaches version v, every event of another payment with a version ≤ v is treated as old, so that payment keeps a stale status or is never stored. With only one payment the shared variable happens to equal that payment's own version, which is why simple tests pass.
Fix: store the latest version per payment id and compare each event with the version stored for its own payment.

Corrected pseudocode:
FUNCTION latestStatus(events):
    status ← empty map
    version ← empty map
    FOR each e IN events:
        IF e.paymentId NOT IN version OR e.version > version[e.paymentId]:
            status[e.paymentId] ← e.status
            version[e.paymentId] ← e.version
    RETURN status
""",
    "Trace lastVersion through the first example. Which payment does the value 2 actually belong to when p2's event arrives?",
    """
- Identifies the single shared lastVersion as the bug.
- Explains that versions from one payment block older-numbered but newer events of another payment.
- Fix keeps a version per paymentId (map) and compares with that payment's own version.
- Fixed version still ignores out-of-order old versions and retried duplicates.
""",
    """
Points to lastVersion / the IF e.version > lastVersion check
Explains versions are per payment, not global
Explains why a single payment hides the bug
Fix stores and compares a version per paymentId
Confirms the corrected output for the mixed example
""")


# ===========================================================================
# n19 Debugging: One Bad Batch Stops the Whole Load (medium)
# ===========================================================================
def _loaded(batches, early_return):
    loaded = 0
    for batch in batches:
        valid = True
        for row in batch:
            if row is None:
                valid = False
                if early_return:
                    return loaded
                break
        if valid:
            loaded += len(batch)
    return loaded


debug(
    "qb-scn-n19", "medium", "Debugging: One Bad Batch Stops the Whole Load", "Debugging · Arrays · Nested Loops",
    """
A loader receives `batches`, an array of batches, where each batch is an array of rows. A row equal to `null` is corrupt. The rule is: a batch that contains **any** null row is rejected as a whole, but every other batch must still be loaded. The function returns the number of rows loaded. In production, as soon as one bad batch appears, nothing after it is loaded.

Pseudocode note: `RETURN` ends the whole function immediately. `BREAK` leaves only the innermost loop it is in.

Do three things: (1) point out the bug, (2) explain **why** good batches after a bad one are not loaded, and (3) fix it.

### Constraints
- 0 ≤ length(batches) ≤ 10^4
- Each batch has 0 to 10^4 rows; an empty batch is valid and loads 0 rows.
""",
    """
FUNCTION rowsLoaded(batches):
    loaded ← 0
    FOR each batch IN batches:
        valid ← true
        FOR each row IN batch:
            IF row = null:
                valid ← false
                RETURN loaded
        IF valid:
            loaded ← loaded + length(batch)
    RETURN loaded
""",
    "rowsLoaded", ["batches"],
    lambda b: _loaded(b, False), lambda b: _loaded(b, True),
    [
        ([[[1, 2], [3, None, 5], [6, 7, 8]]], "5", "2",
         "The second batch is correctly rejected, but RETURN ends the function right there, so the third batch (3 rows) is never loaded."),
        ([[[1], [2, 3]]], "3", "3",
         "With no corrupt rows the early exit never runs, so the bug is invisible."),
        ([[[None], [4, 5]]], "2", "0",
         "The very first batch is bad, so the function stops before loading anything."),
    ],
    [
        ([[[1, 2, None], [None, 3]]], "0", "0", "every batch is bad"),
        ([[[9, 9], [], [None], [1]]], "3", "2",
         "an empty batch is valid and adds 0, and the batch after a bad one must still load"),
    ],
    "replace RETURN loaded inside the inner loop with BREAK.",
    """
Bug: `RETURN loaded` inside the inner loop, at the first null row.
Why: RETURN leaves the whole function, not just the current batch. The intent is to stop checking the current batch and move on to the next one, but the outer loop is abandoned too, so every batch after the first bad one is never looked at.
Fix: leave only the inner loop with BREAK (valid is already false, so the bad batch is skipped) and let the outer loop continue. Simply deleting the RETURN also works, at the cost of scanning the rest of the bad batch.

Corrected pseudocode:
FUNCTION rowsLoaded(batches):
    loaded ← 0
    FOR each batch IN batches:
        valid ← true
        FOR each row IN batch:
            IF row = null:
                valid ← false
                BREAK
        IF valid:
            loaded ← loaded + length(batch)
    RETURN loaded
""",
    "When the null in the second batch is found, which loop should stop, and which loop does RETURN actually stop?",
    """
- Identifies the RETURN inside the inner loop as the bug.
- Explains that RETURN exits the whole function, so later batches are never processed.
- Fix replaces it with BREAK (or removes it) so only the current batch is rejected.
- Fixed version still rejects every batch with a null and counts empty batches as valid.
""",
    """
Points to RETURN loaded inside the inner loop
Explains RETURN ends the function, not just the batch
Fix uses BREAK (or removes the RETURN)
Shows the corrected result 5 for the first example
Confirms batches after a bad batch are loaded
""")


# ===========================================================================
# n20 Debugging: Downtime Total Is Wrong for Nested Outages (hard)
# ===========================================================================
def _downtime(outages, sort_by_start, use_max):
    if not outages:
        return 0
    arr = sorted(outages, key=lambda o: o[0] if sort_by_start else o[1])
    total = 0
    cur_s, cur_e = arr[0]
    for s, e in arr[1:]:
        if s <= cur_e:
            cur_e = max(cur_e, e) if use_max else e
        else:
            total += cur_e - cur_s
            cur_s, cur_e = s, e
    return total + (cur_e - cur_s)


debug(
    "qb-scn-n20", "hard", "Debugging: Downtime Total Is Wrong for Nested Outages", "Debugging · Intervals · Sorting",
    """
A status page adds up a service's total downtime from its outage records. Each outage `o` covers the minutes from `o.start` up to but **not including** `o.end`. Outages can overlap or lie entirely inside one another, and overlapping time must be counted only once. The function below gives correct totals for simple cases but goes wrong when one outage lies inside another.

There are **two** bugs. Fixing only one of them still leaves some inputs wrong.

Pseudocode note: an outage is written `[start, end]` in the examples. `SORT arr BY field ASCENDING` sorts `arr` in place by that field. `max(a, b)` returns the larger value. Arrays are 0-indexed, and `FOR i FROM a TO b` includes both ends and does not run when b < a.

Do three things: (1) point out **both** bugs, (2) explain **why** each one produces a wrong total, and (3) fix them.

### Constraints
- 0 ≤ number of outages ≤ 10^5
- 0 ≤ start < end ≤ 10^9
- Outages are in no particular order.
""",
    """
FUNCTION totalDowntime(outages):
    IF length(outages) = 0:
        RETURN 0
    SORT outages BY end ASCENDING
    total ← 0
    curStart ← outages[0].start
    curEnd ← outages[0].end
    FOR i FROM 1 TO length(outages) − 1:
        s ← outages[i].start
        e ← outages[i].end
        IF s ≤ curEnd:
            curEnd ← e
        ELSE:
            total ← total + (curEnd − curStart)
            curStart ← s
            curEnd ← e
    total ← total + (curEnd − curStart)
    RETURN total
""",
    "totalDowntime", ["outages"],
    lambda o: _downtime(o, True, True), lambda o: _downtime(o, False, False),
    [
        ([[[0, 10], [2, 3], [4, 5]]], "10", "7",
         "Sorted by end the order is [2, 3], [4, 5], [0, 10]. [4, 5] does not touch [2, 3], so a 1-minute block is closed; then [0, 10] is merged into [4, 5] without moving the block's start back to 0, giving 1 + 6 = 7."),
        ([[[1, 4], [6, 9]]], "6", "6",
         "Two separate outages: neither bug shows."),
        ([[[2, 3], [1, 10]]], "9", "8",
         "Sorted by end, [2, 3] comes first, so the merged block keeps start 2 and becomes [2, 10]: 8 minutes instead of 9."),
    ],
    [
        ([[[0, 10], [2, 3]]], "10", "8",
         "an outage inside another; after fixing only the sort it still gives 3, because curEnd ← e shrinks the block's end to 3"),
        ([[[1, 3], [2, 6], [8, 10]]], "7", "7",
         "ordinary overlaps already in order are handled correctly"),
    ],
    "SORT outages BY start ASCENDING, and curEnd ← max(curEnd, e).",
    """
Bug 1: `SORT outages BY end ASCENDING` uses the wrong sort key; merging needs the outages sorted by start.
Why: the merge assumes each new outage starts no earlier than the current block. Sorted by end, a long outage that started earlier (such as [0, 10]) comes after shorter ones, so it is merged into a block whose curStart is too late (giving 8 instead of 9 for [[2, 3], [1, 10]]), or a block is closed too early and the earlier start is lost (7 instead of 10 for [[0, 10], [2, 3], [4, 5]]).
Bug 2: `curEnd ← e` replaces the block's end instead of extending it.
Why: when an outage lies inside the current block, its end is smaller than curEnd, so the block shrinks. This bug is hidden by bug 1 (sorted by end, e is never smaller than curEnd), but once the sort is fixed, [[0, 10], [2, 3]] gives 3 instead of 10.
Fix: sort by start, and extend the block's end with max.

Corrected pseudocode:
FUNCTION totalDowntime(outages):
    IF length(outages) = 0:
        RETURN 0
    SORT outages BY start ASCENDING
    total ← 0
    curStart ← outages[0].start
    curEnd ← outages[0].end
    FOR i FROM 1 TO length(outages) − 1:
        s ← outages[i].start
        e ← outages[i].end
        IF s ≤ curEnd:
            curEnd ← max(curEnd, e)
        ELSE:
            total ← total + (curEnd − curStart)
            curStart ← s
            curEnd ← e
    total ← total + (curEnd − curStart)
    RETURN total
""",
    "Trace the loop for [[0, 10], [2, 3]] twice: once as written, and once after changing only the sort to use start. Is it right either time?",
    """
- Identifies the sort key (end instead of start) as a bug and explains why merging requires sorting by start.
- Identifies curEnd ← e (instead of max(curEnd, e)) as the second bug and explains how a nested outage shrinks the block.
- Explains that the second bug is masked while sorting by end (fixing only one bug is not enough).
- Gives both fixes; finding and fixing only one bug earns partial credit.
""",
    """
Points to SORT outages BY end as the wrong sort key
Explains a sort by end can merge an earlier-starting outage without moving curStart
Points to curEnd ← e and explains a nested outage shrinks the block
Notes the second bug only shows after the sort is fixed
Gives both fixes: sort by start and curEnd ← max(curEnd, e)
Confirms the corrected totals 10 and 9
""")


# ===========================================================================
# Global validation
# ===========================================================================
def validate():
    global CHECKS
    ids = [q["id"] for q in QUESTIONS]
    assert ids == [f"qb-scn-n{i:02d}" for i in range(1, 21)], ids
    assert len(set(ids)) == len(ids), "duplicate ids"
    titles = [q["title"] for q in QUESTIONS]
    assert len(set(titles)) == len(titles), "duplicate titles"

    existing = set()
    with open(os.path.join(HERE, "existing-titles.tsv"), encoding="utf-8") as fh:
        for line in fh.read().splitlines()[1:]:
            parts = line.split("\t")
            if len(parts) >= 3:
                existing.add(parts[2].strip().lower())
    for t in titles:
        assert t.lower() not in existing, f"title clashes with existing: {t}"

    diffs = [q["difficulty"] for q in QUESTIONS]
    assert diffs.count("easy") == 5 and diffs.count("medium") == 10 and diffs.count("hard") == 5, diffs
    dbg = [q for q in QUESTIONS if q["title"].startswith("Debugging: ")]
    assert len(dbg) == 8, len(dbg)

    banned = [r"python", r"\blist", r"\bdict", r"\bdef\b", r"print\(", r"\bTrue\b",
              r"\bFalse\b", r"\bNone\b"]
    for q in QUESTIONS:
        assert list(q.keys()) == KEYS, (q["id"], list(q.keys()))
        assert q["category"] == "scenario" and q["marks"] == 5 and q["source"] == SOURCE
        assert 1 <= len(q["topic"].split(" · ")) <= 3, q["topic"]
        header = f"## {q['title']}\n> {q['topic']} · {q['difficulty'].capitalize()}\n\n"
        assert q["prompt"].startswith(header), q["id"]
        assert "### Constraints" in q["prompt"], q["id"]
        assert "**Example" not in q["prompt"], q["id"]
        for field in ("prompt", "sample_data", "hint"):
            for pat in banned:
                assert not re.search(pat, q[field], re.IGNORECASE if pat == "python" else 0), \
                    (q["id"], field, pat)
        n_ex = q["sample_data"].count("**Example ")
        assert 2 <= n_ex <= 3, (q["id"], n_ex)
        for block in q["sample_data"].split("**Example ")[1:]:
            if q["title"].startswith("Debugging: "):
                assert "Input: " in block and "Expected output: " in block \
                    and "Actual output: " in block, q["id"]
            else:
                assert "Input: " in block and "\nOutput: " in block, q["id"]
        hidden = [l for l in q["expected_output"].splitlines() if l.startswith("Hidden test")]
        assert len(hidden) == 2, q["id"]
        rub = q["rubric"].splitlines()
        assert 3 <= len(rub) <= 5 and all(l.startswith("- ") for l in rub), q["id"]
        cps = q["checkpoints"].splitlines()
        assert 4 <= len(cps) <= 6 and not any(l.startswith("- ") for l in cps), q["id"]
        if q["title"].startswith("Debugging: "):
            assert q["topic"].startswith("Debugging"), q["id"]
            assert "**Buggy pseudocode**" in q["sample_data"], q["id"]
            assert "Expected output: " in q["sample_data"] and "Actual output: " in q["sample_data"]
        else:
            assert q["topic"].startswith("Scenario"), q["id"]
        CHECKS += 1


validate()
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(QUESTIONS, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
d = [q["difficulty"] for q in QUESTIONS]
print(f"OK: {len(QUESTIONS)} scenario questions verified ({d.count('easy')} easy / "
      f"{d.count('medium')} medium / {d.count('hard')} hard; "
      f"{sum(q['title'].startswith('Debugging: ') for q in QUESTIONS)} debugging), "
      f"{CHECKS} checks passed -> {os.path.relpath(OUT)}")
