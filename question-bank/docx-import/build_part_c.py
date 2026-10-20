#!/usr/bin/env python3
"""Build + verify Part C of the docx import (Part A scenario problems A1-A15).

Every question is defined below together with test cases for each example and
each hidden test. The displayed reference solution (the code inside
`reference_answer`) is exec'd and run against every test, cross-checked against
an independent brute-force implementation (plus randomised tests), and the
candidate-facing text is linted against SPEC.md. part_c.json is written only if
every assertion passes.
"""
import json
import os
import random
import re
from collections import Counter, deque

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "part_c.json")
EXISTING = os.path.join(HERE, "existing-bank-reference.json")

SECTION = "30 Problems Part A"

# docx items skipped as duplicates of the existing bank
SKIPPED = [
    ("A1", "Non-Repeating Playlist Stretch", "qb-dsa-r07 Longest Substring Without Repeating Characters"),
    ("A2", "Merge Calendar Busy Blocks", "qb-dsa-r08 Merge Intervals"),
    ("A6", "Best Day to Buy and Sell", "qb-scn-r01 Best Time to Buy and Sell Stock"),
    ("A7", "Validate Config Brackets", "qb-dsa-r06 Valid Parentheses"),
    ("A8", "Minimum Meeting Rooms", "qb-scn-r02 Minimum Railway Platforms"),
]


# --------------------------------------------------------------------------
# display formatting (Python values -> language-neutral display strings)
# --------------------------------------------------------------------------
def fmt(v):
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    if isinstance(v, str):
        return '"' + v + '"'
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    return str(v)


def call_str(name, args):
    return f"{name}(" + ", ".join(fmt(a) for a in args) + ")"


def input_str(params, args):
    return ", ".join(f"{p} = {fmt(a)}" for p, a in zip(params, args))


# --------------------------------------------------------------------------
# brute-force oracles (independent of the reference answers)
# --------------------------------------------------------------------------
def days_for(weights, cap):
    d, load = 1, 0
    for w in weights:
        if load + w > cap:
            d += 1
            load = 0
        load += w
    return d


def bf_truck(weights, days):
    cap = max(weights)
    while days_for(weights, cap) > days:
        cap += 1
    return cap


def bf_wait(prices):
    out = []
    for i, p in enumerate(prices):
        w = 0
        for j in range(i + 1, len(prices)):
            if prices[j] > p:
                w = j - i
                break
        out.append(w)
    return out


def bf_topk(logs, k):
    c = Counter(logs)
    ranked = sorted(c.items(), key=lambda kv: -kv[1])
    assert k == len(ranked) or ranked[k - 1][1] != ranked[k][1], "tie at cutoff"
    return [code for code, _ in ranked[:k]]


def bf_first_bad(n, first_bad):
    return first_bad


def bf_can_finish(num, prereqs):
    graph = [[] for _ in range(num)]
    for a, b in prereqs:
        graph[b].append(a)
    state = [0] * num  # 0 new, 1 on stack, 2 done

    def dfs(u):
        state[u] = 1
        for v in graph[u]:
            if state[v] == 1:
                return False
            if state[v] == 0 and not dfs(v):
                return False
        state[u] = 2
        return True

    return all(state[u] or dfs(u) for u in range(num))


def bf_coins(coins, amount):
    # BFS over amounts: first time we reach `amount` is the fewest coins
    if amount == 0:
        return 0
    seen = {0}
    q = deque([(0, 0)])
    while q:
        x, d = q.popleft()
        for c in coins:
            y = x + c
            if y == amount:
                return d + 1
            if y < amount and y not in seen:
                seen.add(y)
                q.append((y, d + 1))
    return -1


def bf_uptime(status, k):
    best = 0
    for i in range(len(status)):
        for j in range(i, len(status)):
            if status[i:j + 1].count(0) <= k:
                best = max(best, j - i + 1)
    return best


def loop_ok(charge, cost, s):
    n = len(charge)
    tank = 0
    for step in range(n):
        i = (s + step) % n
        tank += charge[i] - cost[i]
        if tank < 0:
            return False
    return True


def bf_station(charge, cost):
    ok = [s for s in range(len(charge)) if loop_ok(charge, cost, s)]
    assert len(ok) <= 1, f"start not unique: {ok}"
    return ok[0] if ok else -1


def bf_update(grid):
    g = [row[:] for row in grid]
    minutes = 0
    while True:
        old = sum(row.count(1) for row in g)
        if old == 0:
            return minutes
        nxt = [row[:] for row in g]
        changed = False
        for r in range(len(g)):
            for c in range(len(g[0])):
                if g[r][c] == 1:
                    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < len(g) and 0 <= nc < len(g[0]) and g[nr][nc] == 2:
                            nxt[r][c] = 2
                            changed = True
                            break
        if not changed:
            return -1
        g = nxt
        minutes += 1


def bf_lru(capacity, ops):
    order = []  # least recent first: [key, value]
    out = []
    for op in ops:
        if op[0] == "get":
            k = op[1]
            hit = [e for e in order if e[0] == k]
            if hit:
                order.remove(hit[0])
                order.append(hit[0])
                out.append(hit[0][1])
            else:
                out.append(-1)
        else:
            _, k, v = op
            order = [e for e in order if e[0] != k] + [[k, v]]
            if len(order) > capacity:
                order.pop(0)
    return out


# --------------------------------------------------------------------------
# question definitions
# --------------------------------------------------------------------------
Q = []

# ---- A3 -------------------------------------------------------------------
Q.append(dict(
    num=301, code="A3", difficulty="medium",
    title="Minimum Truck Capacity",
    topic="Scenario · Binary Search · Greedy",
    body=(
        "A warehouse ships packages along a conveyor belt. Package `i` weighs `weights[i]` kg. "
        "Each day one truck is loaded with packages **in belt order**, adding packages until the next one "
        "would exceed the truck's capacity; that package waits for the next day. Packages cannot be "
        "reordered or split.\n\n"
        "Given `weights` and an integer `days`, return the **smallest** truck capacity (in kg) that ships "
        "every package within `days` days. Implement `minTruckCapacity(weights, days)`.\n\n"
        "### Constraints\n"
        "- 1 ≤ days ≤ n ≤ 5 × 10^4, where n is the number of packages\n"
        "- 1 ≤ weights[i] ≤ 500"
    ),
    fn="min_truck_capacity", call="minTruckCapacity", params=["weights", "days"],
    examples=[
        (([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5), 15,
         "With capacity 15 the daily loads are [1, 2, 3, 4, 5], [6, 7], [8], [9], [10], which is 5 days. "
         "With capacity 14 they become [1, 2, 3, 4], [5, 6], [7], [8], [9], [10], which needs 6 days."),
        (([3, 2, 2, 4, 1, 4], 3), 6,
         "Capacity 6 gives [3, 2], [2, 4], [1, 4], which is 3 days. "
         "Capacity 5 gives [3, 2], [2], [4, 1], [4], which needs 4 days."),
    ],
    hidden=[
        (([5, 5, 5, 5], 1), 20, "one day: the capacity must be the total weight"),
        (([9, 1, 1, 1], 4), 9, "one package per day still needs the heaviest package to fit; the lower bound is max(weights)"),
    ],
    brute=bf_truck,
    reference=(
        "Binary search the capacity between max(weights) (the heaviest package must fit) and sum(weights) "
        "(everything in one day). For a candidate capacity a greedy pass counts the days needed; a bigger "
        "capacity never needs more days, so search for the smallest feasible one. O(n log(sum)) time, O(1) space.\n\n"
        "def min_truck_capacity(weights, days):\n"
        "    def days_needed(cap):\n"
        "        d, load = 1, 0\n"
        "        for w in weights:\n"
        "            if load + w > cap:\n"
        "                d += 1; load = 0\n"
        "            load += w\n"
        "        return d\n"
        "    low, high = max(weights), sum(weights)\n"
        "    while low < high:\n"
        "        mid = (low + high) // 2\n"
        "        if days_needed(mid) <= days: high = mid\n"
        "        else: low = mid + 1\n"
        "    return low"
    ),
    hint=("For a fixed capacity you can count the days needed in one greedy pass, and a bigger capacity never "
          "needs more days. How can you use that yes/no property to search for the answer instead of trying every capacity?"),
    rubric=[
        "Searches capacities in the range [max(weights), sum(weights)]; the lower bound is the heaviest package, not 1.",
        "Uses a correct greedy day count for a given capacity, keeping belt order.",
        "Binary search returns the SMALLEST feasible capacity (no off-by-one).",
        "O(n log(sum)) for full credit; trying every capacity one by one earns partial.",
    ],
    checkpoints=[
        "Sets the lower bound to max(weights) and the upper bound to sum(weights)",
        "Greedy check starts a new day when the next package would overflow",
        "Recognises that feasibility is monotonic in capacity",
        "Binary search converges on the minimum feasible capacity",
        "Handles days = 1 and days = number of packages",
        "States O(n log(sum)) complexity",
    ],
))

# ---- A4 -------------------------------------------------------------------
Q.append(dict(
    num=302, code="A4", difficulty="medium",
    title="Days Until a Better Price",
    topic="Scenario · Arrays · Monotonic Stack",
    body=(
        "A seller tracks a product's closing price each day. For every day `i`, they want to know how many days "
        "they would have to wait after day `i` to see a **strictly higher** price. If no later day has a higher "
        "price, the answer for that day is `0`.\n\n"
        "Given `prices`, return an array `wait` of the same length where `wait[i]` is that number of days. "
        "Implement `daysUntilHigher(prices)`.\n\n"
        "### Constraints\n"
        "- 1 ≤ n ≤ 10^5, where n is the number of days\n"
        "- 1 ≤ prices[i] ≤ 10^5\n"
        "- Target O(n) time."
    ),
    fn="days_until_higher", call="daysUntilHigher", params=["prices"],
    examples=[
        (([73, 74, 75, 71, 69, 72, 76, 73],), [1, 1, 4, 2, 1, 1, 0, 0],
         "Day 2 (75) waits until day 6 (76), so 4 days. Day 3 (71) waits until day 5 (72), so 2 days. "
         "Day 6 (76) and day 7 (73) never see a higher price, so 0."),
        (([50, 40, 30, 60],), [3, 2, 1, 0],
         "Prices keep falling until day 3, so days 0, 1 and 2 all wait for the 60 on day 3 (3, 2 and 1 days). "
         "Day 3 is the last day, so it gets 0."),
    ],
    hidden=[
        (([30, 30, 30],), [0, 0, 0], "an equal price is not strictly higher"),
        (([10, 20, 30, 40],), [1, 1, 1, 0], "rising prices: every day is resolved by the very next day"),
    ],
    brute=bf_wait,
    reference=(
        "Keep a stack of day indices still waiting for a higher price (their prices are non-increasing from bottom "
        "to top). For each new price, pop every index with a strictly lower price and record the gap i - j, then "
        "push i. Each index is pushed and popped at most once: O(n) time, O(n) space.\n\n"
        "def days_until_higher(prices):\n"
        "    wait = [0] * len(prices)\n"
        "    stack = []\n"
        "    for i, p in enumerate(prices):\n"
        "        while stack and prices[stack[-1]] < p:\n"
        "            j = stack.pop()\n"
        "            wait[j] = i - j\n"
        "        stack.append(i)\n"
        "    return wait"
    ),
    hint=("The days still waiting for a higher price always have non-increasing prices. Which data structure lets "
          "you resolve the most recent waiting days first when a higher price arrives?"),
    rubric=[
        "Returns, for each day, the number of days until a strictly higher price, or 0 if none.",
        "Uses a strict comparison (an equal price does not count as higher).",
        "Uses a monotonic stack (or equivalent) for O(n); an O(n^2) nested scan earns partial.",
        "Output has the same length as the input, with the last day always 0.",
    ],
    checkpoints=[
        "Stores indices (not just prices) so the gap can be computed",
        "Pops every waiting day with a strictly lower price when a new price arrives",
        "Records the wait as current index minus popped index",
        "Leaves 0 for days that are never resolved",
        "Treats equal prices as not higher",
        "O(n) amortised approach",
    ],
))

# ---- A5 -------------------------------------------------------------------
Q.append(dict(
    num=303, code="A5", difficulty="medium",
    title="Top Error Codes in Server Logs",
    topic="Scenario · Hash Map · Bucket Sort",
    body=(
        "An on-call dashboard reads the error codes a server logged during an incident (strings such as `\"E500\"`) "
        "and must show the `k` codes that occurred most often.\n\n"
        "Given an array of strings `logs` and an integer `k`, return the `k` most frequent error codes, in **any order**. "
        "Implement `topErrorCodes(logs, k)`.\n\n"
        "### Constraints\n"
        "- 1 ≤ n ≤ 10^5, where n is the number of log entries\n"
        "- 1 ≤ k ≤ number of distinct codes\n"
        "- The k most frequent codes are uniquely determined (no tie at the cutoff).\n"
        "- Aim for better than O(n log n)."
    ),
    fn="top_error_codes", call="topErrorCodes", params=["logs", "k"],
    unordered=True,
    examples=[
        ((["E1", "E2", "E1", "E3", "E2", "E1"], 2), ["E1", "E2"],
         "Counts are E1 = 3, E2 = 2, E3 = 1. The two highest are E1 and E2 (any order is accepted)."),
        ((["E404", "E500", "E404", "E401", "E500", "E404", "E502"], 1), ["E404"],
         "E404 appears 3 times, E500 twice, and E401 and E502 once each. Only the single most frequent code is returned."),
    ],
    hidden=[
        ((["E5", "E5", "E5"], 1), ["E5"], "a code's count can equal n, so a count-indexed bucket array needs n + 1 slots"),
        ((["E3", "E1", "E3", "E2", "E3", "E1"], 3), ["E3", "E1", "E2"], "k equals the number of distinct codes; any order"),
    ],
    brute=bf_topk,
    reference=(
        "Count each code with a hash map in O(n). No count can exceed n, so drop codes into buckets indexed by count "
        "and read buckets from highest to lowest until k codes are collected: O(n) overall. A size-k min-heap "
        "(O(m log k) for m distinct codes) or sorting the distinct codes by count (O(m log m)) is also accepted.\n\n"
        "from collections import Counter\n"
        "def top_error_codes(logs, k):\n"
        "    counts = Counter(logs)\n"
        "    buckets = [[] for _ in range(len(logs) + 1)]\n"
        "    for code, c in counts.items():\n"
        "        buckets[c].append(code)\n"
        "    result = []\n"
        "    for c in range(len(buckets) - 1, 0, -1):\n"
        "        for code in buckets[c]:\n"
        "            result.append(code)\n"
        "            if len(result) == k:\n"
        "                return result\n"
        "    return result"
    ),
    hint=("Start by counting each code in a hash map. To pick the top k without a full sort, notice that no count "
          "can be larger than the number of log entries."),
    rubric=[
        "Counts code frequencies correctly with a map/dictionary.",
        "Returns exactly k codes: the k with the highest counts, in any order.",
        "O(n) bucket approach or O(m log k) heap for full credit; sorting all distinct codes by count earns most of the credit.",
        "Handles a code that appears in every entry (count = n) without an index error.",
    ],
    checkpoints=[
        "Builds a frequency map of codes",
        "Selects the k highest-frequency codes",
        "Returns exactly k codes (order not required)",
        "Handles a count equal to the total number of entries",
        "Uses buckets or a size-k heap to beat a full sort",
        "States the time complexity",
    ],
))

# ---- A9 -------------------------------------------------------------------
CALLS = {"n": 0}


def run_first_bad(ns, args):
    n, first_bad = args
    CALLS["n"] = 0

    def is_bad(v):
        assert 1 <= v <= n, "isBad called out of range"
        CALLS["n"] += 1
        return v >= first_bad

    return ns["first_bad_build"](n, is_bad)


Q.append(dict(
    num=304, code="A9", difficulty="easy",
    title="Find the First Bad Build",
    topic="Scenario · Binary Search",
    body=(
        "A CI system has builds numbered `1` to `n`. One build introduced a bug, and every build after it is also bad. "
        "You are given a function `isBad(build)` that returns `true` if that build is bad and `false` otherwise, "
        "but every call runs a slow test suite.\n\n"
        "Return the number of the **first** bad build while making as few calls to `isBad` as possible. "
        "Implement `firstBadBuild(n, isBad)`.\n\n"
        "### Constraints\n"
        "- 1 ≤ first bad build ≤ n ≤ 2^31 − 1\n"
        "- Your solution should make O(log n) calls to `isBad`.\n"
        "- Compute midpoints so they cannot overflow a 32-bit integer."
    ),
    fn="first_bad_build", call="firstBadBuild", params=["n", "firstBad"],
    runner=run_first_bad,
    input_override=[
        "n = 5, first bad build = 4  (so isBad(1), isBad(2), isBad(3) are false and isBad(4), isBad(5) are true)",
        "n = 1, first bad build = 1",
    ],
    hidden_call_override=[
        "firstBadBuild(2147483647, isBad) [first bad build is 2147483647]",
        "firstBadBuild(10, isBad) [first bad build is 1]",
    ],
    examples=[
        ((5, 4), 4,
         "A binary search first checks isBad(3) = false, so the first bad build is after 3. Then isBad(4) = true, "
         "so it is 4 or earlier. Build 4 is the first bad one, found with only two calls."),
        ((1, 1), 1,
         "There is only one build, and it is bad, so the answer is 1 without needing a single call."),
    ],
    hidden=[
        ((2147483647, 2147483647), 2147483647,
         "largest n and the last build: low + (high − low) / 2 avoids overflow; at most 31 calls"),
        ((10, 1), 1, "every build is bad: the search must keep moving left down to build 1"),
    ],
    brute=bf_first_bad,
    reference=(
        "Binary search for the first true in the false…false, true…true sequence: if isBad(mid), the answer is mid "
        "or earlier (high = mid); otherwise it is after mid (low = mid + 1). Stop when low == high. O(log n) calls, "
        "O(1) space; compute mid as low + (high - low) // 2 so it cannot overflow in fixed-width languages.\n\n"
        "def first_bad_build(n, is_bad):\n"
        "    low, high = 1, n\n"
        "    while low < high:\n"
        "        mid = low + (high - low) // 2\n"
        "        if is_bad(mid): high = mid\n"
        "        else: low = mid + 1\n"
        "    return low"
    ),
    hint=("Over builds 1 to n, the results of isBad look like false, false, …, true, true. "
          "What kind of search finds the first true without checking every build?"),
    rubric=[
        "Uses binary search, making O(log n) calls to isBad; a linear scan earns partial.",
        "Keeps mid as a candidate when it is bad (high = mid, not mid − 1).",
        "Returns the first bad build correctly at the boundaries (build 1 and build n).",
        "Computes the midpoint without overflow (low + (high − low) / 2), or explicitly addresses it.",
    ],
    checkpoints=[
        "Recognises the monotonic false → true pattern",
        "Applies binary search over build numbers 1..n",
        "Moves high to mid on a bad build and low to mid + 1 on a good one",
        "Returns the correct build when the first bad build is 1 or n",
        "Computes the midpoint without overflow",
        "States O(log n) calls",
    ],
))

# ---- A10 ------------------------------------------------------------------
Q.append(dict(
    num=305, code="A10", difficulty="medium",
    title="Course Prerequisites",
    topic="Scenario · Graphs · Topological Sort",
    body=(
        "A learning platform has `numCourses` courses labelled `0` to `numCourses − 1`. Each pair `[a, b]` in "
        "`prereqs` means course `b` must be completed **before** course `a`.\n\n"
        "Return `true` if a student can finish every course in some order, otherwise `false`. "
        "Implement `canFinish(numCourses, prereqs)`.\n\n"
        "### Constraints\n"
        "- 1 ≤ numCourses ≤ 2000\n"
        "- 0 ≤ number of pairs ≤ 5000\n"
        "- 0 ≤ a, b < numCourses and a ≠ b\n"
        "- All pairs are distinct."
    ),
    fn="can_finish", call="canFinish", params=["numCourses", "prereqs"],
    examples=[
        ((4, [[1, 0], [2, 0], [3, 1], [3, 2]]), True,
         "Take 0 first, then 1 and 2, then 3, which needs both 1 and 2. Every prerequisite is met."),
        ((3, [[0, 1], [1, 2], [2, 0]]), False,
         "0 needs 1, 1 needs 2, and 2 needs 0. The three courses wait on each other in a cycle, so none can be started."),
    ],
    hidden=[
        ((3, []), True, "no prerequisites at all"),
        ((5, [[1, 0], [3, 2], [4, 3], [2, 4]]), False,
         "the cycle 2 → 3 → 4 → 2 sits in only part of the graph; courses 0 and 1 are fine"),
    ],
    brute=bf_can_finish,
    reference=(
        "Model each course as a node with an edge b → a for every pair; the courses can all be finished exactly when "
        "this directed graph has no cycle. Kahn's algorithm repeatedly takes courses with in-degree 0; if every course "
        "gets taken there is no cycle. DFS with three states (unvisited / in progress / done) is equally valid. "
        "O(V + E) time and space.\n\n"
        "from collections import deque\n"
        "def can_finish(num_courses, prereqs):\n"
        "    graph = [[] for _ in range(num_courses)]\n"
        "    indegree = [0] * num_courses\n"
        "    for a, b in prereqs:\n"
        "        graph[b].append(a)\n"
        "        indegree[a] += 1\n"
        "    queue = deque(i for i in range(num_courses) if indegree[i] == 0)\n"
        "    taken = 0\n"
        "    while queue:\n"
        "        course = queue.popleft()\n"
        "        taken += 1\n"
        "        for nxt in graph[course]:\n"
        "            indegree[nxt] -= 1\n"
        "            if indegree[nxt] == 0:\n"
        "                queue.append(nxt)\n"
        "    return taken == num_courses"
    ),
    hint=("Think of each course as a node and each prerequisite as a directed edge. "
          "What shape in that graph makes it impossible to find an order that respects every edge?"),
    rubric=[
        "Models courses and prerequisites as a directed graph with the correct edge direction (b before a).",
        "Detects a cycle, via Kahn's algorithm (count of processed courses) or DFS with three visit states.",
        "Returns true when there is no cycle (including no prerequisites) and false when any cycle exists, even in part of the graph.",
        "O(V + E) for full credit.",
    ],
    checkpoints=[
        "Builds an adjacency structure from the pairs",
        "Uses in-degrees (Kahn) or DFS visit states to detect a cycle",
        "Compares processed courses with numCourses (or reports a back edge)",
        "Handles disconnected courses and an empty prerequisite array",
        "O(V + E) approach",
    ],
))

# ---- A11 ------------------------------------------------------------------
Q.append(dict(
    num=306, code="A11", difficulty="medium",
    title="Fewest Coins for Change",
    topic="Scenario · Dynamic Programming",
    body=(
        "A vending machine must return change of exactly `amount` using the coin denominations it stocks, given in "
        "`coins`. It has an unlimited supply of each denomination and wants to dispense as **few coins as possible**.\n\n"
        "Return the minimum number of coins that add up to `amount`, or `-1` if the amount cannot be made. "
        "Implement `minCoins(coins, amount)`.\n\n"
        "### Constraints\n"
        "- 1 ≤ number of denominations ≤ 12\n"
        "- 1 ≤ coins[i] ≤ 2^31 − 1\n"
        "- 0 ≤ amount ≤ 10^4"
    ),
    fn="min_coins", call="minCoins", params=["coins", "amount"],
    examples=[
        (([1, 3, 4], 6), 2,
         "3 + 3 = 6 uses two coins. Taking the largest coin first gives 4 + 1 + 1, which uses three, "
         "so a greedy choice is not optimal here."),
        (([2], 3), -1,
         "Any number of 2s adds up to an even total, so 3 can never be made."),
    ],
    hidden=[
        (([1, 2, 5], 0), 0, "no change needed: zero coins, not -1"),
        (([1, 5, 6, 9], 11), 2, "5 + 6; greedy 9 + 1 + 1 would use 3"),
    ],
    brute=bf_coins,
    reference=(
        "Bottom-up DP: dp[x] is the fewest coins that make x, with dp[0] = 0 and dp[x] = 1 + min(dp[x - c]) over "
        "coins c ≤ x; unreachable amounts stay at infinity and map to -1. O(amount × number of coins) time, "
        "O(amount) space. BFS over amounts is also accepted; greedy is wrong.\n\n"
        "def min_coins(coins, amount):\n"
        "    INF = float('inf')\n"
        "    dp = [0] + [INF] * amount\n"
        "    for x in range(1, amount + 1):\n"
        "        for c in coins:\n"
        "            if c <= x and dp[x - c] + 1 < dp[x]:\n"
        "                dp[x] = dp[x - c] + 1\n"
        "    return dp[amount] if dp[amount] != INF else -1"
    ),
    hint=("Always taking the largest coin can fail, as Example 1 shows. Instead, work out the fewest coins for "
          "every smaller amount and build up to `amount`."),
    rubric=[
        "Uses dynamic programming (or BFS) over amounts 0..amount rather than a greedy choice.",
        "Correct recurrence dp[x] = 1 + min(dp[x − c]) with dp[0] = 0.",
        "Returns -1 for an unreachable amount and 0 for amount = 0.",
        "O(amount × number of coins) time for full credit; plain exponential recursion earns partial.",
    ],
    checkpoints=[
        "Recognises that greedy is not optimal",
        "Defines dp[x] as the fewest coins to make x, with dp[0] = 0",
        "Applies the recurrence over every coin c ≤ x",
        "Marks unreachable amounts and returns -1 for them",
        "Handles amount = 0",
        "States O(amount × coins) complexity",
    ],
))

# ---- A12 ------------------------------------------------------------------
Q.append(dict(
    num=307, code="A12", difficulty="medium",
    title="Longest Uptime With Forgiven Outages",
    topic="Scenario · Arrays · Sliding Window",
    body=(
        "A monitoring service records a server's status every minute: `1` means up and `0` means an outage. "
        "Under its SLA, up to `k` outage minutes in a stretch can be forgiven.\n\n"
        "Return the length of the longest **contiguous** stretch of minutes that contains **at most `k`** outages. "
        "Implement `longestForgivenUptime(status, k)`.\n\n"
        "### Constraints\n"
        "- 1 ≤ n ≤ 10^5, where n is the number of minutes\n"
        "- status[i] is 0 or 1\n"
        "- 0 ≤ k ≤ n"
    ),
    fn="longest_forgiven_uptime", call="longestForgivenUptime", params=["status", "k"],
    examples=[
        (([1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0], 2), 6,
         "Indices 4 to 9 are [0, 0, 1, 1, 1, 1], which has exactly 2 outages and length 6. "
         "Any longer stretch includes a third outage."),
        (([0, 0, 1, 1, 1, 0, 0], 1), 4,
         "The three up minutes plus one neighbouring outage, such as indices 1 to 4, give length 4. "
         "Adding another minute on either side brings in a second outage."),
    ],
    hidden=[
        (([0, 0, 0], 0), 0, "nothing can be forgiven and no minute is up"),
        (([0, 1, 0, 1], 4), 4, "k covers every outage, so the whole log counts"),
    ],
    brute=bf_uptime,
    reference=(
        "This is the longest window with at most k zeros. Slide a window: extend the right edge, counting zeros; "
        "while the count exceeds k, move the left edge right (decrementing when a zero leaves). Track the largest "
        "window. O(n) time, O(1) space.\n\n"
        "def longest_forgiven_uptime(status, k):\n"
        "    left = zeros = best = 0\n"
        "    for right, s in enumerate(status):\n"
        "        if s == 0:\n"
        "            zeros += 1\n"
        "        while zeros > k:\n"
        "            if status[left] == 0:\n"
        "                zeros -= 1\n"
        "            left += 1\n"
        "        best = max(best, right - left + 1)\n"
        "    return best"
    ),
    hint=("Rephrase it as: find the longest window that contains at most k zeros. Grow the window on the right, "
          "and shrink it from the left only when it holds too many zeros."),
    rubric=[
        "Finds the longest contiguous window with at most k zeros.",
        "Uses a sliding window in O(n) rather than checking every pair of endpoints (O(n^2) earns partial).",
        "Shrinks the window correctly when the zero count exceeds k.",
        "Handles k = 0 and k at least the number of outages.",
    ],
    checkpoints=[
        "Rephrases the task as at most k zeros in a window",
        "Extends the right edge and counts zeros inside the window",
        "Moves the left edge until the zero count is back to k",
        "Tracks the maximum window length",
        "Handles k = 0 (all-outage input gives 0) and k covering every outage",
        "O(n) approach",
    ],
))

# ---- A13 ------------------------------------------------------------------
Q.append(dict(
    num=308, code="A13", difficulty="medium",
    title="EV Charging Loop",
    topic="Scenario · Greedy · Arrays",
    body=(
        "A delivery van drives a circular route past `n` charging stations. At station `i` it gains `charge[i]` units "
        "of battery, and driving from station `i` to station `i + 1` (from the last station back to station `0`) uses "
        "`cost[i]` units. The van starts with an empty battery at a station of your choice, and the battery must "
        "**never drop below zero**.\n\n"
        "Return the index of the starting station from which the van can complete one full loop, or `-1` if no station "
        "works. If a solution exists, it is unique. Implement `startStation(charge, cost)`.\n\n"
        "### Constraints\n"
        "- 1 ≤ n ≤ 10^5; `charge` and `cost` both have length n\n"
        "- 0 ≤ charge[i], cost[i] ≤ 10^4"
    ),
    fn="start_station", call="startStation", params=["charge", "cost"],
    examples=[
        (([1, 2, 3, 4, 5], [3, 4, 5, 1, 2]), 3,
         "Starting at station 3, the battery after each leg is 4 − 1 = 3, 3 + 5 − 2 = 6, 6 + 1 − 3 = 4, "
         "4 + 2 − 4 = 2, then 2 + 3 − 5 = 0. It never goes negative, so the van gets back to station 3."),
        (([2, 3, 4], [3, 4, 3]), -1,
         "Total charge is 9 but total cost is 10. No starting point can make up the shortfall."),
    ],
    hidden=[
        (([4], [5]), -1, "a single station that cannot cover its own leg"),
        (([1, 1, 10], [2, 2, 1]), 2, "the start must be reset twice before the valid one is found"),
    ],
    brute=bf_station,
    reference=(
        "If total charge < total cost, return -1; otherwise a valid start exists. Scan once with a running tank: when "
        "it drops below zero after station i, no station from the current start to i can work (each would arrive at i "
        "with no more charge), so restart at i + 1 with an empty tank. O(n) time, O(1) space.\n\n"
        "def start_station(charge, cost):\n"
        "    if sum(charge) < sum(cost):\n"
        "        return -1\n"
        "    start = tank = 0\n"
        "    for i in range(len(charge)):\n"
        "        tank += charge[i] - cost[i]\n"
        "        if tank < 0:\n"
        "            start = i + 1\n"
        "            tank = 0\n"
        "    return start"
    ),
    hint=("First compare the total charge with the total cost. Then ask: if a start runs out of battery before "
          "reaching station j, could any station between that start and j do any better?"),
    rubric=[
        "Returns -1 when total charge is less than total cost.",
        "Uses the one-pass greedy reset (start = i + 1 when the running tank goes negative).",
        "Justifies why the stations between a failed start and the failure point can be skipped.",
        "O(n) for full credit; simulating from every station (O(n^2)) earns partial.",
    ],
    checkpoints=[
        "Checks total charge against total cost for the -1 case",
        "Keeps a running tank of charge minus cost",
        "Resets the start to i + 1 with an empty tank when the tank goes negative",
        "Explains why skipped stations cannot be valid starts",
        "Returns the correct index, including for a single station",
        "O(n) approach",
    ],
))

# ---- A14 ------------------------------------------------------------------
Q.append(dict(
    num=309, code="A14", difficulty="medium",
    title="Spread of a Software Update",
    topic="Scenario · Grid · Multi-source BFS",
    body=(
        "A data centre is laid out as an `m × n` grid. Each cell is `0` (empty slot), `1` (a server still on the old "
        "version) or `2` (a server already updated). Every minute, each updated server pushes the update to the old "
        "servers directly above, below, left and right of it (not diagonally).\n\n"
        "Return the minimum number of minutes until no old server remains, or `-1` if some server can never be reached. "
        "Implement `minutesToUpdate(grid)`.\n\n"
        "### Constraints\n"
        "- 1 ≤ m, n ≤ 10\n"
        "- grid[i][j] is 0, 1 or 2"
    ),
    fn="minutes_to_update", call="minutesToUpdate", params=["grid"],
    examples=[
        (([[2, 1, 1], [1, 1, 0], [0, 1, 1]],), 4,
         "Cells are (row, column). Minute 1 updates (0,1) and (1,0). Minute 2 updates (0,2) and (1,1). "
         "Minute 3 updates (2,1). Minute 4 updates (2,2), the last old server."),
        (([[2, 1, 1], [0, 1, 1], [1, 0, 1]],), -1,
         "The server at (2,0) has empty slots above it and to its right, so the update can never reach it."),
    ],
    hidden=[
        (([[0, 2]],), 0, "no old servers to begin with: 0 minutes, not -1"),
        (([[1, 1]],), -1, "old servers but no updated server to start from"),
    ],
    brute=bf_update,
    copy_args=True,
    reference=(
        "Multi-source BFS: enqueue every updated server at minute 0 and count the old servers. Process the queue one "
        "level per minute, updating old neighbours in four directions and decrementing the count. If old servers "
        "remain when the queue empties, return -1. O(m × n) time and space.\n\n"
        "from collections import deque\n"
        "def minutes_to_update(grid):\n"
        "    rows, cols = len(grid), len(grid[0])\n"
        "    queue = deque(); old = 0\n"
        "    for r in range(rows):\n"
        "        for c in range(cols):\n"
        "            if grid[r][c] == 2: queue.append((r, c))\n"
        "            elif grid[r][c] == 1: old += 1\n"
        "    minutes = 0\n"
        "    while queue and old > 0:\n"
        "        for _ in range(len(queue)):\n"
        "            r, c = queue.popleft()\n"
        "            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):\n"
        "                nr, nc = r + dr, c + dc\n"
        "                if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 1:\n"
        "                    grid[nr][nc] = 2; old -= 1\n"
        "                    queue.append((nr, nc))\n"
        "        minutes += 1\n"
        "    return minutes if old == 0 else -1"
    ),
    hint=("The update spreads from every updated server at the same time, one step per minute. Which traversal "
          "explores a grid level by level, and how can it start from several cells at once?"),
    rubric=[
        "Uses a multi-source BFS that starts from ALL updated servers at minute 0.",
        "Counts minutes by BFS level, not by the number of cells processed.",
        "Returns -1 when any old server is unreachable.",
        "Returns 0 when there are no old servers to begin with.",
    ],
    checkpoints=[
        "Enqueues every initially updated server at minute 0",
        "Spreads only in the four directions and only into old servers",
        "Advances the minute counter once per BFS level",
        "Tracks the remaining old servers and returns -1 if any are left",
        "Returns 0 when no old servers exist",
        "O(m × n) approach",
    ],
))

# ---- A15 ------------------------------------------------------------------
def run_lru(ns, args):
    capacity, ops = args
    cache = ns["LRUCache"](capacity)
    out = []
    for op in ops:
        if op[0] == "get":
            out.append(cache.get(op[1]))
        else:
            cache.put(op[1], op[2])
    return out


def ops_str(capacity, ops):
    parts = [f"{o[0]}({', '.join(str(x) for x in o[1:])})" for o in ops]
    return f"capacity = {capacity}; " + ", ".join(parts)


LRU_EX = [
    (2, [("put", 1, 1), ("put", 2, 2), ("get", 1), ("put", 3, 3), ("get", 2), ("put", 4, 4),
         ("get", 1), ("get", 3), ("get", 4)]),
    (1, [("put", 5, 50), ("get", 5), ("put", 6, 60), ("get", 5), ("get", 6)]),
]
LRU_HID = [
    (2, [("put", 1, 1), ("put", 2, 2), ("put", 1, 10), ("put", 3, 3), ("get", 1), ("get", 2)]),
    (1, [("get", 7), ("put", 7, 70), ("put", 7, 71), ("get", 7)]),
]

Q.append(dict(
    num=310, code="A15", difficulty="medium",
    title="Browser Page Cache",
    topic="Scenario · Hash Map · Design",
    body=(
        "A browser keeps recently viewed pages in a cache that holds at most `capacity` pages. When the cache is full "
        "and a new page is added, it evicts the **least recently used** page. Reading or updating a page counts as "
        "using it.\n\n"
        "Design a structure `LRUCache` with these operations:\n"
        "- `LRUCache(capacity)` creates an empty cache.\n"
        "- `get(key)` returns the page's value if present, otherwise `-1`.\n"
        "- `put(key, value)` adds or updates the page. If this pushes the size past `capacity`, evict the least "
        "recently used page.\n\n"
        "Both operations must run in **O(1)** average time.\n\n"
        "### Input\n"
        "A capacity, followed by a sequence of `put` and `get` calls.\n\n"
        "### Output\n"
        "The value returned by each `get` call, in order.\n\n"
        "### Constraints\n"
        "- 1 ≤ capacity ≤ 3000\n"
        "- 0 ≤ key ≤ 10^4, 0 ≤ value ≤ 10^5\n"
        "- At most 2 × 10^5 calls to `get` and `put`."
    ),
    fn="LRUCache", call="LRUCache", params=None,
    runner=run_lru,
    input_override=[ops_str(*a) for a in LRU_EX],
    hidden_call_override=[ops_str(*a) for a in LRU_HID],
    examples=[
        (LRU_EX[0], [1, -1, -1, 3, 4],
         "get(1) makes page 1 the most recent, so put(3, 3) evicts page 2. Then put(4, 4) evicts page 1, "
         "the least recent of 1 and 3. Pages 3 and 4 remain."),
        (LRU_EX[1], [50, -1, 60],
         "With room for one page, adding page 6 evicts page 5 immediately."),
    ],
    hidden=[
        (LRU_HID[0], [10, -1], "updating page 1 refreshes its value and recency, so put(3, 3) evicts page 2"),
        (LRU_HID[1], [-1, 71], "get on an empty cache; updating an existing key must not evict it"),
    ],
    brute=lambda capacity, ops: bf_lru(capacity, ops),
    reference=(
        "Combine a hash map (key → node) with a doubly linked list ordered by recency, with sentinel head (least "
        "recent) and tail (most recent). get moves the node to the tail; put updates or inserts at the tail and, if "
        "the size exceeds capacity, unlinks the node after head and deletes its key. Every step is O(1). An ordered "
        "map with move-to-end (e.g. Python's OrderedDict) is acceptable if the candidate explains the mechanism.\n\n"
        "class Node:\n"
        "    def __init__(self, key=0, val=0):\n"
        "        self.key, self.val, self.prev, self.next = key, val, None, None\n"
        "\n"
        "class LRUCache:\n"
        "    def __init__(self, capacity):\n"
        "        self.cap = capacity; self.map = {}\n"
        "        self.head, self.tail = Node(), Node()\n"
        "        self.head.next, self.tail.prev = self.tail, self.head\n"
        "    def _unlink(self, node):\n"
        "        node.prev.next, node.next.prev = node.next, node.prev\n"
        "    def _append(self, node):\n"
        "        node.prev, node.next = self.tail.prev, self.tail\n"
        "        self.tail.prev.next = node; self.tail.prev = node\n"
        "    def get(self, key):\n"
        "        if key not in self.map: return -1\n"
        "        node = self.map[key]\n"
        "        self._unlink(node); self._append(node)\n"
        "        return node.val\n"
        "    def put(self, key, value):\n"
        "        if key in self.map:\n"
        "            node = self.map[key]; node.val = value\n"
        "            self._unlink(node); self._append(node)\n"
        "            return\n"
        "        node = Node(key, value); self.map[key] = node; self._append(node)\n"
        "        if len(self.map) > self.cap:\n"
        "            lru = self.head.next\n"
        "            self._unlink(lru); del self.map[lru.key]"
    ),
    hint=("A hash map alone gives O(1) lookup, but you also need O(1) \"move to most recent\" and \"remove least recent\". "
          "What structure lets you unlink and re-insert a node in constant time once the map hands you a pointer to it?"),
    rubric=[
        "get returns the value (or -1) and marks the page as most recently used.",
        "put inserts or updates, marks the page most recent, and evicts the least recently used page only when over capacity.",
        "Achieves O(1) per operation with a hash map plus a doubly linked list (or an ordered map whose mechanism is explained).",
        "Updating an existing key changes its value and recency without evicting anything.",
    ],
    checkpoints=[
        "Combines a hash map (key → node) with a recency-ordered doubly linked list",
        "get moves the accessed page to the most-recent position",
        "put updates an existing key's value and recency",
        "Evicts the least recently used page only when the size exceeds capacity",
        "Both operations O(1) average",
        "Handles capacity 1 and get on a missing key",
    ],
))


# --------------------------------------------------------------------------
# build + verify
# --------------------------------------------------------------------------
DIFF = {"easy": "Easy", "medium": "Medium", "hard": "Hard"}
KEYS = ["id", "category", "difficulty", "marks", "title", "topic", "prompt", "sample_data",
        "expected_output", "reference_answer", "hint", "rubric", "checkpoints", "source"]
BANNED_CI = re.compile(r"\b(python|list|lists|dict|dictionary only|def)\b|print\(", re.I)
BANNED_CS = re.compile(r"\b(True|False|None)\b")
SNAKE = re.compile(r"\b[a-z]+_[a-z_]+\b")

failures = []
n_tests = 0


def check(cond, msg):
    if not cond:
        failures.append(msg)


def same(q, a, b):
    if q.get("unordered"):
        return sorted(a) == sorted(b)
    return a == b


def run(q, ns, args):
    if q.get("runner"):
        return q["runner"](ns, args)
    if q.get("copy_args"):
        args = json.loads(json.dumps(args))
    return ns[q["fn"]](*args)


def build(q):
    global n_tests
    tag = f"{q['code']} {q['title']}"
    code = q["reference"].split("\n\n", 1)[1]
    ns = {}
    exec(code, ns)

    # examples + hidden tests: reference vs stated value vs brute force
    for kind, cases in (("example", q["examples"]), ("hidden", q["hidden"])):
        for i, case in enumerate(cases, 1):
            args, expected = case[0], case[1]
            got = run(q, ns, args)
            bf = q["brute"](*args)
            n_tests += 1
            check(same(q, got, expected), f"{tag} {kind} {i}: reference gave {fmt(got)}, stated {fmt(expected)}")
            check(same(q, bf, expected), f"{tag} {kind} {i}: brute force gave {fmt(bf)}, stated {fmt(expected)}")

    # randomised cross-check reference vs brute force
    rnd = random.Random(q["num"])
    for _ in range(300):
        args = RANDOM_GEN[q["code"]](rnd)
        got = run(q, ns, args)
        bf = q["brute"](*args)
        n_tests += 1
        check(same(q, got, bf), f"{tag} random {args}: reference {fmt(got)} vs brute {fmt(bf)}")

    # sample_data
    blocks = []
    for i, (args, expected, expl) in enumerate(q["examples"], 1):
        inp = q["input_override"][i - 1] if q.get("input_override") else input_str(q["params"], args)
        blocks.append(f"**Example {i}**\nInput: {inp}\nOutput: {fmt(expected)}\nExplanation: {expl}")
    sample = "\n\n".join(blocks)

    # expected_output
    suffix = "  (any order)" if q.get("unordered") else ""
    lines = [f"Example {i} → {fmt(c[1])}{suffix}" for i, c in enumerate(q["examples"], 1)]
    for i, (args, expected, why) in enumerate(q["hidden"], 1):
        cs = q["hidden_call_override"][i - 1] if q.get("hidden_call_override") else call_str(q["call"], args)
        lines.append(f"Hidden test {i} → {cs} = {fmt(expected)}  ({why})")
    expected_output = "\n".join(lines)

    diff = DIFF[q["difficulty"]]
    prompt = f"## {q['title']}\n> {q['topic']} · {diff}\n\n{q['body']}"
    obj = {
        "id": f"qb-scn-d{q['num']}",
        "category": "scenario",
        "difficulty": q["difficulty"],
        "marks": 5,
        "title": q["title"],
        "topic": q["topic"],
        "prompt": prompt,
        "sample_data": sample,
        "expected_output": expected_output,
        "reference_answer": q["reference"],
        "hint": q["hint"],
        "rubric": "\n".join("- " + r for r in q["rubric"]),
        "checkpoints": "\n".join(q["checkpoints"]),
        "source": f"docx: {SECTION} · {q['code']}",
    }
    lint(obj, q, tag)
    return obj


def lint(o, q, tag):
    check(list(o.keys()) == KEYS, f"{tag}: keys {list(o.keys())}")
    check(re.fullmatch(r"qb-scn-d3\d\d", o["id"]) and 301 <= int(o["id"][-3:]) <= 399, f"{tag}: id {o['id']}")
    check(o["difficulty"] in DIFF and o["marks"] == 5, f"{tag}: difficulty/marks")
    check(o["title"] == o["title"].strip() and not re.match(r"^(Q?\d|A\d)", o["title"]), f"{tag}: title prefix")
    check(1 <= len(o["topic"].split(" · ")) <= 3, f"{tag}: topic count")
    check(o["prompt"].startswith(f"## {o['title']}\n> {o['topic']} · {DIFF[o['difficulty']]}\n\n"), f"{tag}: prompt header")
    check("### Constraints\n- " in o["prompt"], f"{tag}: constraints section")
    check("Example" not in o["prompt"], f"{tag}: examples leaked into prompt")
    ex = re.findall(r"\*\*Example \d\*\*\nInput: [^\n]+\nOutput: [^\n]+\nExplanation: [^\n]+", o["sample_data"])
    check(2 <= len(ex) <= 3 and len(ex) == o["sample_data"].count("**Example"), f"{tag}: sample_data shape")
    # stated Output lines equal the verified example values
    outs = re.findall(r"\nOutput: ([^\n]+)", o["sample_data"])
    check(outs == [fmt(c[1]) for c in q["examples"]], f"{tag}: sample Output lines mismatch")
    eo = o["expected_output"].split("\n")
    check(len(eo) == len(ex) + 2 and all(l.startswith(f"Example {i+1} → ") for i, l in enumerate(eo[:len(ex)])), f"{tag}: expected_output examples")
    check(all(re.match(rf"Hidden test {i+1} → .+ = .+  \(.+\)$", l) for i, l in enumerate(eo[len(ex):])), f"{tag}: expected_output hidden")
    check("\n\n" in o["reference_answer"] and o["reference_answer"].split("\n\n")[0].count("O(") >= 1, f"{tag}: reference complexity")
    sentences = len(re.findall(r"[.!?](\s|$)", o["hint"]))
    check(1 <= sentences <= 2, f"{tag}: hint has {sentences} sentences")
    rb = o["rubric"].split("\n")
    check(3 <= len(rb) <= 5 and all(r.startswith("- ") for r in rb), f"{tag}: rubric shape")
    cp = o["checkpoints"].split("\n")
    check(4 <= len(cp) <= 6 and not any(c.startswith(("-", "*", "•")) for c in cp), f"{tag}: checkpoints shape")
    for field in ("prompt", "sample_data", "hint"):
        t = o[field]
        m = BANNED_CI.search(t) or BANNED_CS.search(t)
        check(not m, f"{tag}: banned word {m.group(0) if m else ''!r} in {field}")
        m = SNAKE.search(t)
        check(not m, f"{tag}: snake_case identifier {m.group(0) if m else ''!r} in {field}")


# random input generators for the cross-checks
def g_truck(r):
    w = [r.randint(1, 12) for _ in range(r.randint(1, 9))]
    return (w, r.randint(1, len(w)))


def g_wait(r):
    return ([r.randint(1, 6) for _ in range(r.randint(1, 10))],)


def g_topk(r):
    while True:
        logs = [f"E{r.randint(1, 5)}" for _ in range(r.randint(1, 15))]
        ranked = sorted(Counter(logs).values(), reverse=True)
        k = r.randint(1, len(ranked))
        if k == len(ranked) or ranked[k - 1] != ranked[k]:
            return (logs, k)


def g_bad(r):
    n = r.randint(1, 200)
    return (n, r.randint(1, n))


def g_course(r):
    n = r.randint(1, 6)
    pairs = set()
    for _ in range(r.randint(0, 8)):
        a, b = r.randrange(n), r.randrange(n)
        if a != b:
            pairs.add((a, b))
    return (n, [list(p) for p in pairs])


def g_coins(r):
    return ([r.randint(1, 12) for _ in range(r.randint(1, 4))], r.randint(0, 40))


def g_uptime(r):
    s = [r.randint(0, 1) for _ in range(r.randint(1, 12))]
    return (s, r.randint(0, len(s)))


def g_station(r):
    while True:
        n = r.randint(1, 7)
        ch = [r.randint(0, 6) for _ in range(n)]
        co = [r.randint(0, 6) for _ in range(n)]
        ok = [s for s in range(n) if loop_ok(ch, co, s)]
        if len(ok) <= 1:  # problem guarantees a unique answer
            return (ch, co)


def g_grid(r):
    m, n = r.randint(1, 4), r.randint(1, 4)
    return ([[r.choice([0, 1, 1, 2]) for _ in range(n)] for _ in range(m)],)


def g_lru(r):
    ops = []
    for _ in range(r.randint(1, 15)):
        if r.random() < 0.5:
            ops.append(("get", r.randint(0, 4)))
        else:
            ops.append(("put", r.randint(0, 4), r.randint(0, 99)))
    return (r.randint(1, 3), ops)


RANDOM_GEN = {"A3": g_truck, "A4": g_wait, "A5": g_topk, "A9": g_bad, "A10": g_course,
              "A11": g_coins, "A12": g_uptime, "A13": g_station, "A14": g_grid, "A15": g_lru}


def claims():
    """Assert the numeric claims made inside example explanations."""
    check(days_for([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 15) == 5 and days_for([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 14) == 6, "A3 ex1 claim")
    check(days_for([3, 2, 2, 4, 1, 4], 6) == 3 and days_for([3, 2, 2, 4, 1, 4], 5) == 4, "A3 ex2 claim")
    # A9: two calls for example 1, zero for example 2, <= 31 for the largest n
    ns = {}
    exec(Q[3]["reference"].split("\n\n", 1)[1], ns)
    for args, limit in (((5, 4), 2), ((1, 1), 0), ((2147483647, 2147483647), 31), ((10, 1), 4)):
        run_first_bad(ns, args)
        check(CALLS["n"] <= limit, f"A9 call count {CALLS['n']} > {limit} for {args}")
    run_first_bad(ns, (5, 4))
    check(CALLS["n"] == 2, "A9 ex1 should take exactly two calls")
    # A12 ex1: window indices 4..9 has exactly two zeros
    s = [1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0]
    check(s[4:10] == [0, 0, 1, 1, 1, 1] and s[4:10].count(0) == 2, "A12 ex1 claim")
    # A13 ex1: tank sequence from station 3
    ch, co, t, seq = [1, 2, 3, 4, 5], [3, 4, 5, 1, 2], 0, []
    for step in range(5):
        i = (3 + step) % 5
        t += ch[i] - co[i]
        seq.append(t)
    check(seq == [3, 6, 4, 2, 0], f"A13 ex1 tank sequence {seq}")
    check(sum([2, 3, 4]) == 9 and sum([3, 4, 3]) == 10, "A13 ex2 totals")
    # A14 ex1: minute at which each cell updates
    g = [[2, 1, 1], [1, 1, 0], [0, 1, 1]]
    dist = {(0, 0): 0}
    q = deque([(0, 0)])
    while q:
        r, c = q.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < 3 and 0 <= nc < 3 and g[nr][nc] == 1 and (nr, nc) not in dist:
                dist[(nr, nc)] = dist[(r, c)] + 1
                q.append((nr, nc))
    check(dist == {(0, 0): 0, (0, 1): 1, (1, 0): 1, (0, 2): 2, (1, 1): 2, (2, 1): 3, (2, 2): 4}, f"A14 ex1 claim {dist}")


def main():
    with open(EXISTING, encoding="utf-8") as f:
        existing = json.load(f)
    existing_titles = {re.match(r"## (.+)", e["prompt"]).group(1).strip().lower() for e in existing}

    out = [build(q) for q in Q]
    claims()

    ids = [o["id"] for o in out]
    titles = [o["title"].lower() for o in out]
    check(len(set(ids)) == len(ids), "duplicate ids")
    check(len(set(titles)) == len(titles), "duplicate titles inside part C")
    check(not (set(titles) & existing_titles), f"title clash with existing bank: {set(titles) & existing_titles}")
    skipped_codes = {s[0] for s in SKIPPED}
    check(not (skipped_codes & {q["code"] for q in Q}), "a skipped item was also written")
    check(sorted(skipped_codes | {q["code"] for q in Q}, key=lambda c: int(c[1:])) == [f"A{i}" for i in range(1, 16)],
          "A1-A15 not fully accounted for")

    if failures:
        print("FAILED:")
        for m in failures:
            print("  -", m)
        raise SystemExit(1)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    for o in out:
        print(f"  {o['id']}  {o['difficulty']:<6}  {o['title']}  [{o['source']}]")
    for code, title, dup in SKIPPED:
        print(f"  skipped {code} {title} (duplicate of {dup})")
    print(f"PASS: {len(out)} questions, {n_tests} test cases (examples + hidden + randomised cross-checks), "
          f"all assertions passed -> {os.path.relpath(OUT, os.path.dirname(os.path.dirname(HERE)))}")


if __name__ == "__main__":
    main()
