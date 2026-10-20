#!/usr/bin/env python3
"""Build and verify 20 new DSA questions (qb-dsa-n01 .. qb-dsa-n20).

Every question carries a Python reference solution (the same code that is shown in
`reference_answer`). The script executes it against every example and hidden test,
asserts the displayed outputs, checks the JSON shape, and only then writes
part_dsa.json next to this file.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "part_dsa.json")
SOURCE = "bank v3 (Oct 2026)"
KEYS = ["id", "category", "difficulty", "marks", "title", "topic", "prompt",
        "sample_data", "expected_output", "reference_answer", "hint", "rubric",
        "checkpoints", "source"]


# ----------------------------------------------------------------- helpers
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


def build_list(values, pos=-1):
    dummy = ListNode()
    cur = dummy
    nodes = []
    for v in values:
        cur.next = ListNode(v)
        cur = cur.next
        nodes.append(cur)
    if pos != -1:
        nodes[-1].next = nodes[pos]
    return dummy.next


def list_to_array(head, limit=100000):
    out = []
    while head is not None:
        out.append(head.val)
        head = head.next
        assert len(out) <= limit, "unexpected cycle in result list"
    return out


def build_tree(level):
    """LeetCode-style level order with null for missing children."""
    if not level or level[0] is None:
        return None
    root = TreeNode(level[0])
    queue = [root]
    i = 1
    qi = 0
    while i < len(level):
        node = queue[qi]
        qi += 1
        if i < len(level) and level[i] is not None:
            node.left = TreeNode(level[i])
            queue.append(node.left)
        i += 1
        if i < len(level) and level[i] is not None:
            node.right = TreeNode(level[i])
            queue.append(node.right)
        i += 1
    return root


def fmt(v):
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    return str(v)


def ops_text(ops):
    return ", ".join(f"{name}({'' if arg is None else fmt(arg)})" for name, arg in ops)


LL_NOTE = ("In the examples, a linked list is written as an array of its node values from head to "
           "tail — for example `[1, 2, 3]` means 1 → 2 → 3, and an empty linked list is written `[]`. "
           "Your solution should work on the linked nodes themselves.")
TREE_NOTE = ("In the examples, a tree is written in **level order** as an array, with `null` marking a "
             "missing child — for example `[1, 2, 3, null, 4]` is root 1 with children 2 and 3, where 4 "
             "is the right child of 2. An empty tree is `[]`. Your solution should work on the tree nodes "
             "themselves (each node has `val`, `left` and `right`).")

Q = []


def add(**kw):
    Q.append(kw)


# =================================================================== EASY
add(
    id="qb-dsa-n01", difficulty="easy", title="Detect a Cycle in a Linked List",
    topic="Linked Lists · Two Pointers", fn="hasCycle", entry="has_cycle",
    body=f"""Given the head of a **singly linked list** (each node has a value `val` and a pointer `next`), return `true` if the linked list contains a **cycle** — that is, following `next` pointers from some node eventually leads back to that same node — otherwise return `false`. Implement `hasCycle(head)`.

In the examples, a linked list is written as an array of its node values from head to tail — for example `[1, 2, 3]` means 1 → 2 → 3, and an empty linked list is written `[]`. A second value `pos` describes the tail: the tail's `next` points to the node at index `pos` (0-based), and `pos = -1` means the tail's `next` is `null`. `pos` is only used to build the test input; it is **not** passed to your function. Your solution should work on the linked nodes themselves.

### Constraints
- 0 ≤ number of nodes ≤ 10^4
- -10^5 ≤ node value ≤ 10^5
- `pos` is `-1` or a valid index of a node
- Follow-up: can you do it with O(1) extra memory?""",
    examples=[
        dict(args=[("head", [3, 2, 0, -4]), ("pos", 1)], out=True,
             expl="The tail (-4) points back to the node at index 1 (value 2), so the walk 3 → 2 → 0 → -4 → 2 → 0 → … never ends."),
        dict(args=[("head", [1, 2]), ("pos", -1)], out=False,
             expl="The tail's `next` is `null`, so the walk stops after two nodes."),
        dict(args=[("head", [1]), ("pos", 0)], out=True,
             expl="The only node points to itself."),
    ],
    hidden=[
        dict(args=[("head", []), ("pos", -1)], out=False,
             why="empty linked list: the head is null and must not be dereferenced", named=True),
        dict(args=[("head", [1, 1, 1]), ("pos", -1)], out=False,
             why="repeated values are not a cycle; compare nodes, not values", named=True),
    ],
    run=lambda f, head, pos: f(build_list(head, pos)),
    approach="Floyd's tortoise and hare: move `slow` one step and `fast` two steps at a time; if they ever point to the same node there is a cycle, and if `fast` reaches `null` there is none. O(n) time, O(1) space. Storing visited **nodes** (not values) in a hash set is also correct with O(n) space — it misses only the follow-up.",
    code='''# ListNode has fields val and next
def has_cycle(head):
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            return True
    return False''',
    hint="Picture two runners on a track, one twice as fast as the other. What happens to the faster runner if the track loops back, and what happens if it has an end?",
    rubric=[
        "Detects a cycle by node identity (two pointers or a set of visited nodes), not by comparing values.",
        "Terminates on lists without a cycle, checking for `null` before every step.",
        "Handles an empty list and a single node that points to itself.",
        "O(n) time; O(1) extra space for full credit — a visited-node set earns most of the credit.",
    ],
    checkpoints=[
        "Moves slow by one and fast by two (or records visited nodes)",
        "Reports a cycle when both pointers reach the same node",
        "Stops when fast or fast.next is null",
        "Handles an empty list (null head)",
        "O(n) time, O(1) extra space",
    ],
)

add(
    id="qb-dsa-n02", difficulty="easy", title="Range Sum Queries",
    topic="Arrays · Prefix Sums", fn="rangeSums", entry="range_sums",
    body="""An analytics dashboard stores the number of orders received each day in an array `orders`, where `orders[i]` is the count for day `i`. Analysts send many questions of the form *"how many orders arrived from day `l` to day `r`, inclusive?"*

Given `orders` and an array `queries` where each query is a pair `[l, r]` (0-based, `l ≤ r`), return an array with the answer to each query, in the same order. Implement `rangeSums(orders, queries)`.

### Constraints
- 1 ≤ n ≤ 10^5, where n is the number of days
- 0 ≤ orders[i] ≤ 10^4
- 1 ≤ q ≤ 10^5, where q is the number of queries, and 0 ≤ l ≤ r < n
- Target O(n + q) time.""",
    examples=[
        dict(args=[("orders", [3, 1, 4, 1, 5, 9, 2]), ("queries", [[0, 2], [2, 5], [6, 6]])], out=[8, 19, 2],
             expl="Days 0–2: 3 + 1 + 4 = 8. Days 2–5: 4 + 1 + 5 + 9 = 19. Day 6 alone: 2."),
        dict(args=[("orders", [5, 0, 0, 7]), ("queries", [[0, 3], [1, 2]])], out=[12, 0],
             expl="All four days: 5 + 0 + 0 + 7 = 12. Days 1–2 had no orders, so 0."),
    ],
    hidden=[
        dict(args=[[10], [[0, 0], [0, 0]]], out=[10, 10],
             why="a single day, and the same query can repeat"),
        dict(args=[[2, 4, 6, 8], [[0, 3], [3, 3], [1, 2]]], out=[20, 8, 10],
             why="ranges ending at the last index catch off-by-one errors in the prefix array"),
    ],
    run=lambda f, orders, queries: f(orders, queries),
    approach="Build a prefix array of length n + 1 with `prefix[0] = 0` and `prefix[i + 1] = prefix[i] + orders[i]`; each query is then `prefix[r + 1] − prefix[l]`. O(n + q) time, O(n) space. Summing each range with a loop is correct but O(n·q) and earns partial credit.",
    code='''def range_sums(orders, queries):
    prefix = [0]
    for x in orders:
        prefix.append(prefix[-1] + x)
    return [prefix[r + 1] - prefix[l] for l, r in queries]''',
    hint="If you knew the total of every stretch that starts at day 0, how could you get the total of any middle stretch with a single subtraction?",
    rubric=[
        "Precomputes running totals once, before answering the queries.",
        "Answers each query in O(1) with the correct indices (inclusive `r`, no off-by-one).",
        "Returns the answers in the same order as the queries.",
        "O(n + q) for full credit; a loop per query (O(n·q)) earns partial credit.",
    ],
    checkpoints=[
        "Builds a prefix-sum array in one pass",
        "Uses prefix[r + 1] − prefix[l] (or equivalent) for inclusive ranges",
        "Handles l = r and ranges that start at day 0 or end at the last day",
        "Returns one answer per query, in order",
        "O(n + q) time",
    ],
)

add(
    id="qb-dsa-n03", difficulty="easy", title="Minimum Additions to Balance Brackets",
    topic="Strings · Stack · Greedy", fn="minAddToBalance", entry="min_add_to_balance",
    body="""A config parser rejects expressions whose round brackets do not match. You are given a string `s` made only of the characters `(` and `)`. In one move you may insert a single `(` or `)` at any position.

Return the **minimum** number of insertions needed to make `s` balanced. A string is balanced when every `(` has a matching `)` after it and every `)` has a matching `(` before it; the empty string is balanced. Implement `minAddToBalance(s)`.

### Constraints
- 0 ≤ length of s ≤ 10^5
- `s` contains only `(` and `)`
- Target O(n) time.""",
    examples=[
        dict(args=[("s", "())")], out=1,
             expl="The first two characters match. The last `)` has no `(` before it, so one `(` must be inserted."),
        dict(args=[("s", "(((")], out=3,
             expl="Each of the three `(` needs its own `)`."),
        dict(args=[("s", "()))((")], out=4,
             expl="The leading `()` matches. The next two `)` have no partner (2 insertions), and the final two `(` are never closed (2 more)."),
    ],
    hidden=[
        dict(args=[")("], out=2,
             why="equal numbers of `(` and `)` but in the wrong order; comparing totals would give 0"),
        dict(args=[""], out=0, why="the empty string is already balanced"),
    ],
    run=lambda f, s: f(s),
    approach="Scan left to right keeping `open`, the number of unmatched `(`. On `(` increment it; on `)` match one if `open > 0`, otherwise count one insertion. The answer is the insertions plus the `open` left at the end. O(n) time, O(1) space. An explicit stack is equally correct (O(n) space).",
    code='''def min_add_to_balance(s):
    open_count = 0
    insertions = 0
    for ch in s:
        if ch == '(':
            open_count += 1
        elif open_count > 0:
            open_count -= 1
        else:
            insertions += 1
    return insertions + open_count''',
    hint="Walk through the string once. When you meet a `)`, is there an unmatched `(` available for it? What is left over when you reach the end?",
    rubric=[
        "Tracks unmatched `(` while scanning (counter or stack).",
        "Counts a `)` with no available `(` as one required insertion immediately.",
        "Adds the unmatched `(` remaining at the end.",
        "Respects order — an answer that only compares the totals of `(` and `)` earns little credit.",
        "O(n) time.",
    ],
    checkpoints=[
        "Single left-to-right scan",
        "Matches each `)` with an earlier unmatched `(` when possible",
        "Counts unmatched `)` as insertions",
        "Adds the remaining unmatched `(` at the end",
        "Returns 0 for the empty string",
        "O(n) time",
    ],
)

add(
    id="qb-dsa-n04", difficulty="easy", title="Jump to the Last Relay",
    topic="Arrays · Greedy", fn="canReachEnd", entry="can_reach_end",
    body="""A data packet travels along a row of relay servers numbered `0` to `n − 1`. Relay `i` can forward the packet **up to** `nums[i]` positions ahead (any distance from 1 to `nums[i]`); a relay with `nums[i] = 0` cannot forward it at all. The packet starts at relay `0`.

Return `true` if the packet can reach the last relay, otherwise `false`. Implement `canReachEnd(nums)`.

### Constraints
- 1 ≤ n ≤ 10^5
- 0 ≤ nums[i] ≤ 10^5
- Target O(n) time.""",
    examples=[
        dict(args=[("nums", [2, 3, 1, 1, 4])], out=True,
             expl="Jump 1 step from relay 0 to relay 1, then 3 steps from relay 1 to relay 4, the last one."),
        dict(args=[("nums", [3, 2, 1, 0, 4])], out=False,
             expl="From relays 0, 1 and 2 the furthest any jump lands is relay 3, and relay 3 cannot forward the packet, so relay 4 is unreachable."),
    ],
    hidden=[
        dict(args=[[0]], out=True, why="a single relay: the packet already sits at the last one"),
        dict(args=[[2, 0, 0]], out=True,
             why="a zero is only a trap if you must land on it; jumping exactly 2 from relay 0 skips it"),
    ],
    run=lambda f, nums: f(nums),
    approach="Greedy: keep `reach`, the furthest index reachable so far. Scan i from 0; if `i > reach` the packet can never get to i, so return false; otherwise set `reach = max(reach, i + nums[i])` and return true once `reach ≥ n − 1`. O(n) time, O(1) space. A backward greedy that tracks the leftmost index known to reach the end is equally good; a DP over reachable flags (O(n^2)) is correct but earns partial credit.",
    code='''def can_reach_end(nums):
    reach = 0
    for i, jump in enumerate(nums):
        if i > reach:
            return False
        reach = max(reach, i + jump)
        if reach >= len(nums) - 1:
            return True
    return True''',
    hint="Instead of trying every sequence of jumps, keep track of the furthest relay you could reach so far. When does that number tell you the answer is no?",
    rubric=[
        "Tracks the furthest reachable index while scanning (or an equivalent backward greedy).",
        "Returns false as soon as the current index lies beyond the furthest reachable one.",
        "Treats `nums[i]` as a maximum jump, not an exact one.",
        "O(n) for full credit; trying all jump paths or an O(n^2) DP earns partial credit.",
    ],
    checkpoints=[
        "Maintains the furthest reachable index",
        "Detects an unreachable index and returns false",
        "Returns true once the last index is within reach",
        "Handles a single-element array",
        "O(n) time, O(1) space",
    ],
)

add(
    id="qb-dsa-n05", difficulty="easy", title="Diameter of a Binary Tree",
    topic="Trees · Recursion · DFS", fn="diameter", entry="diameter",
    body=f"""Given the root of a binary tree, return the length of its **diameter**: the number of **edges** on the longest path between any two nodes. The path may or may not pass through the root. Implement `diameter(root)`.

{TREE_NOTE}

### Constraints
- 1 ≤ number of nodes ≤ 10^4
- -100 ≤ node value ≤ 100""",
    examples=[
        dict(args=[("root", [1, 2, 3, 4, 5])], out=3,
             expl="The path 4 → 2 → 1 → 3 (or 5 → 2 → 1 → 3) has 3 edges."),
        dict(args=[("root", [1, 2])], out=1,
             expl="The only path joins 1 and 2, which is one edge."),
    ],
    hidden=[
        dict(args=[[1]], out=0, why="a single node: the length counts edges, not nodes"),
        dict(args=[[1, 2, None, 3, 4, 5, None, None, 6]], out=4,
             why="the longest path 5 → 3 → 2 → 4 → 6 does not pass through the root"),
    ],
    run=lambda f, root: f(build_tree(root)),
    approach="One post-order DFS: `depth(node)` returns the number of nodes on the longest downward path from `node`. The longest path that bends at a node has `depth(left) + depth(right)` edges; keep the maximum over all nodes. O(n) time, O(h) recursion stack. Recomputing heights separately for every node is correct but O(n^2) and earns partial credit.",
    code='''# TreeNode has fields val, left and right
def diameter(root):
    best = 0
    def depth(node):
        nonlocal best
        if not node:
            return 0
        left = depth(node.left)
        right = depth(node.right)
        best = max(best, left + right)
        return 1 + max(left, right)
    depth(root)
    return best''',
    hint="The longest path that bends at a given node goes down into its left subtree and down into its right subtree. What should each subtree report back to its parent?",
    rubric=[
        "For each node, combines the heights of its left and right subtrees to measure the longest path through it.",
        "Takes the maximum over all nodes, not only the root.",
        "Counts edges, not nodes (a single node gives 0).",
        "O(n) with one post-order pass for full credit; recomputing heights per node (O(n^2)) earns partial credit.",
    ],
    checkpoints=[
        "Recursive height function returning the longest downward path",
        "Updates an outer best with left height + right height at every node",
        "Does not assume the path passes through the root",
        "Returns 0 for a single node",
        "O(n) time",
    ],
)

# ================================================================= MEDIUM
add(
    id="qb-dsa-n06", difficulty="medium", title="Min Stack",
    topic="Stack · Design", fn="MinStack", entry="MinStack", ops=True,
    body="""A metrics service keeps readings on a stack and often asks for the smallest reading currently stored. Design a structure `MinStack` that supports:

- `push(x)` — push the integer `x` onto the stack.
- `pop()` — remove the top element.
- `top()` — return the top element.
- `getMin()` — return the smallest element currently in the stack.

**Every** operation must run in **O(1)** time.

### Input
A sequence of operations on an initially empty `MinStack`.

### Output
The values returned by each `top` and `getMin` call, in order.

### Constraints
- -2^31 ≤ x ≤ 2^31 − 1
- `pop`, `top` and `getMin` are only called when the stack is not empty.
- At most 3 × 10^4 operations.""",
    examples=[
        dict(args=[("push", -2), ("push", 0), ("push", -3), ("getMin", None), ("pop", None), ("top", None), ("getMin", None)],
             out=[-3, 0, -2],
             expl="After the three pushes the stack is [-2, 0, -3] from bottom to top, so the minimum is -3. Popping removes -3; the top is now 0 and the minimum goes back to -2."),
        dict(args=[("push", 5), ("push", 2), ("push", 2), ("getMin", None), ("pop", None), ("getMin", None), ("pop", None), ("getMin", None)],
             out=[2, 2, 5],
             expl="Two copies of 2 are pushed. Popping one still leaves a 2, so the minimum stays 2; after the second pop only 5 is left."),
    ],
    hidden=[
        dict(args=[("push", 2147483647), ("push", -2147483648), ("getMin", None), ("pop", None), ("getMin", None)],
             out=[-2147483648, 2147483647],
             why="32-bit extremes; tricks that store differences from the minimum can overflow"),
        dict(args=[("push", 3), ("getMin", None), ("push", 5), ("getMin", None), ("push", 2), ("getMin", None),
                   ("pop", None), ("push", 4), ("getMin", None), ("top", None)],
             out=[3, 3, 2, 3, 4],
             why="interleaved pushes and pops: after 2 is popped the minimum returns to 3, and pushing 4 later does not change it"),
    ],
    approach="Store with each element the minimum of the stack **at the moment it was pushed**: push the pair (x, min(x, current minimum)) and pop pairs together; `getMin` reads the minimum from the top pair. All operations O(1), O(n) extra space. A separate min stack that is pushed when `x ≤` its top (and popped when the popped value equals its top) is equally correct — using `<` instead of `≤` breaks on duplicate minimums.",
    code='''class MinStack:
    def __init__(self):
        self.items = []          # pairs (value, minimum so far)

    def push(self, x):
        current_min = x if not self.items else min(x, self.items[-1][1])
        self.items.append((x, current_min))

    def pop(self):
        self.items.pop()

    def top(self):
        return self.items[-1][0]

    def getMin(self):
        return self.items[-1][1]''',
    hint="When the current minimum is popped, the stack must know what the minimum was before it arrived. What could you store alongside each element so that information is never lost?",
    rubric=[
        "All four operations run in O(1) — scanning the stack inside `getMin` (O(n)) earns partial credit.",
        "Correctly restores the previous minimum after the minimum is popped.",
        "Handles duplicate minimum values (popping one copy keeps the other as the minimum).",
        "Returns values only for `top` and `getMin`, in order.",
    ],
    checkpoints=[
        "Stores the running minimum with each element (or keeps a separate min stack)",
        "push records min(x, previous minimum)",
        "pop removes the element and its recorded minimum together",
        "top and getMin read the top entry in O(1)",
        "Handles duplicate minimums correctly",
    ],
)

add(
    id="qb-dsa-n07", difficulty="medium", title="Count Stretches With Net Change K",
    topic="Arrays · Hash Map · Prefix Sums", fn="countSubarrays", entry="count_subarrays",
    body="""A warehouse logs the **net** change in stock every hour in an array `changes` (positive when items are received, negative when items are shipped, zero for no change). Given an integer `k`, return the number of **contiguous, non-empty** stretches of hours whose changes add up to exactly `k`. Implement `countSubarrays(changes, k)`.

### Constraints
- 1 ≤ n ≤ 2 × 10^4, where n is the length of `changes`
- -1000 ≤ changes[i] ≤ 1000
- -10^7 ≤ k ≤ 10^7
- Target O(n) time.""",
    examples=[
        dict(args=[("changes", [1, 1, 1]), ("k", 2)], out=2,
             expl="Hours 0–1 and hours 1–2 each add up to 2."),
        dict(args=[("changes", [1, 2, 3]), ("k", 3)], out=2,
             expl="[1, 2] (hours 0–1) and [3] (hour 2) both add up to 3."),
        dict(args=[("changes", [3, -1, -2, 4, -4]), ("k", 0)], out=3,
             expl="[3, -1, -2], [4, -4] and the whole array [3, -1, -2, 4, -4] each have a net change of 0."),
    ],
    hidden=[
        dict(args=[[0, 0, 0], 0], out=6,
             why="all 6 stretches add up to 0; the map must start with prefix sum 0 seen once and count repeats"),
        dict(args=[[1, -1, 5, -2, 3], 3], out=3,
             why="with negatives, [1, -1, 5, -2], [5, -2] and [3] all qualify; a shrinking sliding window misses some"),
    ],
    run=lambda f, changes, k: f(changes, k),
    approach="Running prefix sum plus a hash map from prefix-sum value to how many times it has occurred, starting with {0: 1}. At each index with running sum `s`, every earlier prefix equal to `s − k` starts a stretch that ends here, so add `count[s − k]`, then record `s`. O(n) time, O(n) space. A double loop over start and end with a running sum (O(n^2)) is correct and earns partial credit; a sliding window is wrong because values can be negative.",
    code='''def count_subarrays(changes, k):
    seen = {0: 1}            # prefix sum -> number of times seen
    running = 0
    total = 0
    for x in changes:
        running += x
        total += seen.get(running - k, 0)
        seen[running] = seen.get(running, 0) + 1
    return total''',
    hint="The total of hours i..j equals prefix(j) − prefix(i − 1). For a fixed end hour, which earlier prefix value would make that difference exactly k — and how could you count those quickly?",
    rubric=[
        "Uses prefix sums with a hash map of counts, initialised with sum 0 seen once.",
        "Looks up `running − k` before recording the current prefix sum.",
        "Counts every matching stretch, including overlapping ones and repeated prefix values.",
        "Works with negative and zero values (no sliding-window shortcut).",
        "O(n) for full credit; an O(n^2) scan of all stretches earns partial credit.",
    ],
    checkpoints=[
        "Maintains a running prefix sum",
        "Hash map stores how many times each prefix sum has occurred",
        "Initialises the map with prefix sum 0 → 1",
        "Adds the count of (running − k) before inserting the current sum",
        "Correct on inputs with negatives and zeros",
        "O(n) time, O(n) space",
    ],
)

add(
    id="qb-dsa-n08", difficulty="medium", title="Overlapping Maintenance Windows",
    topic="Intervals · Two Pointers", fn="bothInMaintenance", entry="both_in_maintenance",
    body="""Two database clusters each publish their planned maintenance windows. Each schedule is an array of **closed** intervals `[start, end]` (both ends included), sorted by start time, and the intervals inside one schedule are pairwise disjoint.

Return every time range during which **both** clusters are in maintenance, as an array of closed intervals sorted by start time. A range that is a single instant (start equals end) counts. Implement `bothInMaintenance(a, b)`.

### Constraints
- 0 ≤ length of a, length of b ≤ 1000
- 0 ≤ start ≤ end ≤ 10^9
- Target O(m + n) time, where m and n are the lengths of `a` and `b`.""",
    examples=[
        dict(args=[("a", [[0, 2], [5, 10], [13, 23], [24, 25]]), ("b", [[1, 5], [8, 12], [15, 24], [25, 26]])],
             out=[[1, 2], [5, 5], [8, 10], [15, 23], [24, 24], [25, 25]],
             expl="[0, 2] and [1, 5] share [1, 2]; [5, 10] touches [1, 5] at instant 5 and overlaps [8, 12] on [8, 10]; [13, 23] and [15, 24] share [15, 23]; [24, 25] touches [15, 24] at 24 and [25, 26] at 25."),
        dict(args=[("a", [[1, 3], [5, 9]]), ("b", [])], out=[],
             expl="The second cluster has no maintenance, so there is no common time."),
    ],
    hidden=[
        dict(args=[[[1, 7]], [[2, 3], [5, 6]]], out=[[2, 3], [5, 6]],
             why="one long window overlaps several in the other schedule; only the pointer whose interval ends first may move"),
        dict(args=[[[1, 2]], [[3, 4]]], out=[], why="no overlap at all"),
    ],
    run=lambda f, a, b: f(a, b),
    approach="Two pointers i and j. The overlap of a[i] and b[j] is [max of the starts, min of the ends], kept when start ≤ end. Then advance the pointer whose interval ends first — it cannot overlap anything later in the other schedule. O(m + n) time, O(1) extra space besides the output. Comparing every pair (O(m·n)) is correct but earns partial credit.",
    code='''def both_in_maintenance(a, b):
    i = j = 0
    result = []
    while i < len(a) and j < len(b):
        start = max(a[i][0], b[j][0])
        end = min(a[i][1], b[j][1])
        if start <= end:
            result.append([start, end])
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return result''',
    hint="Look at the current window in each schedule. Their common part is easy to compute — but which of the two windows can you safely discard afterwards?",
    rubric=[
        "Computes each overlap as [max of starts, min of ends] and keeps it only when start ≤ end (closed intervals, so single instants count).",
        "Advances the pointer of the interval that ends first.",
        "Returns results sorted by start and handles an empty schedule.",
        "O(m + n) for full credit; checking all pairs earns partial credit.",
    ],
    checkpoints=[
        "Uses one pointer per schedule",
        "Overlap = [max(start), min(end)] with an inclusive start ≤ end check",
        "Moves the pointer whose interval ends earlier",
        "Includes single-instant overlaps such as [5, 5]",
        "Returns [] when either schedule is empty",
        "O(m + n) time",
    ],
)

add(
    id="qb-dsa-n09", difficulty="medium", title="Spread Sensors as Far Apart as Possible",
    topic="Binary Search · Greedy · Sorting", fn="maxMinGap", entry="max_min_gap",
    body="""A data-centre aisle has `n` mounting slots at distinct positions given by `positions` (in centimetres from the aisle entrance, not necessarily sorted). You must install `k` temperature sensors, at most one per slot, spreading them out as much as possible.

Return the **largest possible minimum distance** between any two installed sensors. Implement `maxMinGap(positions, k)`.

### Constraints
- 2 ≤ k ≤ n ≤ 10^5
- 0 ≤ positions[i] ≤ 10^9, all distinct
- Target O(n log n + n log R) time, where R is max(positions) − min(positions).""",
    examples=[
        dict(args=[("positions", [1, 2, 8, 4, 9]), ("k", 3)], out=3,
             expl="The sorted slots are [1, 2, 4, 8, 9]. Sensors at 1, 4 and 8 are at least 3 apart. A gap of 4 is impossible: after 1 the first slot at least 4 away is 8, and no slot is 4 beyond 8."),
        dict(args=[("positions", [10, 1, 2, 7, 5]), ("k", 3)], out=4,
             expl="The sorted slots are [1, 2, 5, 7, 10]. Sensors at 1, 5 and 10 have gaps 4 and 5, so the minimum is 4. For a gap of 5, after 1 the next usable slot is 7, and no slot is 5 beyond 7."),
    ],
    hidden=[
        dict(args=[[5, 4, 3, 2, 1, 1000000000], 2], out=999999999,
             why="two sensors go at the two ends; the range is huge, so trying every gap one by one is too slow"),
        dict(args=[[1, 2, 3, 4, 5], 5], out=1,
             why="k = n: every slot is used, so the answer is the smallest adjacent gap"),
    ],
    run=lambda f, positions, k: f(positions, k),
    approach="Sort the positions. For a candidate gap g, a greedy pass puts a sensor at the first slot and then at every slot at least g past the last sensor; g is feasible if that places at least k sensors. Feasibility is monotonic (if g works, every smaller gap works), so binary search g between 1 and max − min for the largest feasible value. O(n log n + n log R) time, O(1) extra space beyond sorting. Trying every gap in turn is correct but too slow for large ranges and earns partial credit.",
    code='''def max_min_gap(positions, k):
    slots = sorted(positions)

    def can_place(gap):
        count, last = 1, slots[0]
        for p in slots[1:]:
            if p - last >= gap:
                count += 1
                last = p
        return count >= k

    low, high = 1, slots[-1] - slots[0]
    while low < high:
        mid = (low + high + 1) // 2
        if can_place(mid):
            low = mid
        else:
            high = mid - 1
    return low''',
    hint="If you fix a minimum gap, can you check in one pass whether k sensors fit? And if a gap works, does every smaller gap also work?",
    rubric=[
        "Sorts the positions before the greedy check.",
        "Greedy feasibility check: first sensor at the smallest slot, each next one at the first slot at least `gap` away.",
        "Binary searches the gap and returns the LARGEST feasible value (no off-by-one or infinite loop).",
        "O(n log n + n log R) for full credit; trying every gap or every combination earns partial credit.",
    ],
    checkpoints=[
        "Sorts positions",
        "Greedy check counts how many sensors fit for a given gap",
        "Recognises that feasibility is monotonic in the gap",
        "Binary search between 1 and max − min converges on the maximum feasible gap",
        "Handles k = n and k = 2",
        "States the time complexity",
    ],
)

add(
    id="qb-dsa-n10", difficulty="medium", title="Shortest Path Through a Warehouse Grid",
    topic="Matrix · Graphs · BFS", fn="shortestPath", entry="shortest_path",
    body="""A warehouse floor is an `m × n` grid where `0` is an open cell and `1` is a shelf that cannot be crossed. A robot starts at the top-left cell `(0, 0)` and must reach the bottom-right cell `(m − 1, n − 1)`. In one move it goes to an adjacent open cell **up, down, left or right** (no diagonal moves).

Return the **minimum number of moves** needed to reach the target, or `-1` if it cannot be reached (including when the start or the target cell is a shelf). Implement `shortestPath(grid)`.

### Constraints
- 1 ≤ m, n ≤ 200
- grid[i][j] is `0` or `1`
- Target O(m × n) time.""",
    examples=[
        dict(args=[("grid", [[0, 0, 0], [1, 1, 0], [0, 0, 0]])], out=4,
             expl="Right, right, down, down: (0,0) → (0,1) → (0,2) → (1,2) → (2,2)."),
        dict(args=[("grid", [[0, 1], [1, 0]])], out=-1,
             expl="Both neighbours of the start are shelves, and diagonal moves are not allowed."),
        dict(args=[("grid", [[0, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 1, 1, 1], [0, 0, 0, 0]])], out=13,
             expl="The shelves force a zig-zag: 3 moves right along row 0, 2 down column 3, 3 left along row 2, 2 down column 0 and 3 right along row 4, a total of 13."),
    ],
    hidden=[
        dict(args=[[[0]]], out=0, why="the start is already the target"),
        dict(args=[[[1, 0], [0, 0]]], out=-1, why="the start cell itself is a shelf"),
    ],
    run=lambda f, grid: f(grid),
    approach="Breadth-first search from (0, 0), storing each cell's distance and marking a cell visited when it is enqueued. BFS reaches every cell first along a shortest path, so the target's distance is the answer. O(m·n) time and space. DFS does not give shortest paths unless it explores every path (exponential), so it earns partial credit at most.",
    code='''from collections import deque

def shortest_path(grid):
    m, n = len(grid), len(grid[0])
    if grid[0][0] == 1 or grid[m - 1][n - 1] == 1:
        return -1
    dist = [[-1] * n for _ in range(m)]
    dist[0][0] = 0
    queue = deque([(0, 0)])
    while queue:
        r, c = queue.popleft()
        if (r, c) == (m - 1, n - 1):
            return dist[r][c]
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < m and 0 <= nc < n and grid[nr][nc] == 0 and dist[nr][nc] == -1:
                dist[nr][nc] = dist[r][c] + 1
                queue.append((nr, nc))
    return -1''',
    hint="Every move costs the same. Which traversal visits cells in order of their distance from the start, so that the first time you reach the target is guaranteed to be the shortest?",
    rubric=[
        "Uses BFS from the start cell with a queue, tracking the distance per cell or per level.",
        "Marks cells visited (when enqueued) so no cell is processed twice.",
        "Moves only in 4 directions, stays inside the grid and skips shelves.",
        "Returns -1 when the target is unreachable or the start/target is blocked, and 0 for a 1 × 1 open grid.",
        "O(m·n) time; a DFS that does not guarantee the shortest path earns partial credit.",
    ],
    checkpoints=[
        "BFS with a queue starting at (0, 0)",
        "Distance tracked per cell (or by level)",
        "Visited marking prevents revisiting cells",
        "Bounds and shelf checks for the 4 neighbours",
        "Returns -1 for an unreachable or blocked start/target",
        "O(m × n) time",
    ],
)

add(
    id="qb-dsa-n11", difficulty="medium", title="Count Connected Server Groups",
    topic="Graphs · Union-Find", fn="countGroups", entry="count_groups",
    body="""A network has `n` servers labelled `0` to `n − 1`. You are given an array `links` where each `links[i] = [u, v]` is an **undirected** cable between servers `u` and `v`. Servers that can reach each other through any chain of cables form one group.

Return the number of groups. Implement `countGroups(n, links)`. A union-find (disjoint set union) structure is the expected approach, but any correct method is accepted.

### Constraints
- 1 ≤ n ≤ 10^5
- 0 ≤ number of links ≤ 2 × 10^5
- 0 ≤ u, v < n and u ≠ v; the same pair may appear more than once""",
    examples=[
        dict(args=[("n", 5), ("links", [[0, 1], [1, 2], [3, 4]])], out=2,
             expl="Servers 0, 1 and 2 are connected through 1; servers 3 and 4 form a second group."),
        dict(args=[("n", 5), ("links", [[0, 1], [1, 2], [2, 3], [3, 4]])], out=1,
             expl="The cables form a single chain 0 – 1 – 2 – 3 – 4."),
    ],
    hidden=[
        dict(args=[4, []], out=4, why="no cables: every server is its own group"),
        dict(args=[4, [[0, 1], [1, 0], [2, 3], [3, 2], [0, 1]]], out=2,
             why="duplicate and reversed cables must not reduce the count again; merge only when the roots differ"),
    ],
    run=lambda f, n, links: f(n, links),
    approach="Union-find: start with n groups, each server its own parent. For each link find both roots (with path compression); if they differ, attach the smaller tree under the larger and decrease the count. O((n + E)·α(n)) time, O(n) space. Building an adjacency map and counting how many DFS/BFS searches are started is also full credit (O(n + E)).",
    code='''def count_groups(n, links):
    parent = list(range(n))
    size = [1] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]   # path halving
            x = parent[x]
        return x

    groups = n
    for u, v in links:
        ru, rv = find(u), find(v)
        if ru == rv:
            continue
        if size[ru] < size[rv]:
            ru, rv = rv, ru
        parent[rv] = ru
        size[ru] += size[rv]
        groups -= 1
    return groups''',
    hint="Start by assuming every server is alone. Each cable may join two groups into one — how can you tell quickly whether its two ends are already in the same group?",
    rubric=[
        "Starts with n separate groups and merges them using the links.",
        "Reduces the count only when the two ends are in different groups (handles duplicates and cycles).",
        "Uses union-find with path compression / union by size or rank, or a DFS/BFS over an adjacency map.",
        "Counts isolated servers as groups.",
        "Near-linear time for full credit; relabelling whole groups on every merge (O(n·E)) earns partial credit.",
    ],
    checkpoints=[
        "Initialises each server as its own parent/group",
        "find returns the root (with path compression)",
        "union merges different roots and decrements the group count",
        "Ignores links whose ends already share a root",
        "Isolated servers each count as a group",
        "States near-linear time complexity",
    ],
)

add(
    id="qb-dsa-n12", difficulty="medium", title="Longest Increasing Subsequence",
    topic="Arrays · Dynamic Programming · Binary Search", fn="lengthOfLIS", entry="length_of_lis",
    body="""A product team records a daily engagement score in `scores`. They want the longest sequence of days — not necessarily consecutive — on which the score kept **strictly increasing**.

Formally, given an integer array `scores`, return the length of its longest strictly increasing subsequence. A subsequence keeps the original order but may skip elements. Implement `lengthOfLIS(scores)`.

### Constraints
- 1 ≤ n ≤ 2500
- -10^4 ≤ scores[i] ≤ 10^4
- An O(n^2) solution is accepted; follow-up: O(n log n).""",
    examples=[
        dict(args=[("scores", [10, 9, 2, 5, 3, 7, 101, 18])], out=4,
             expl="One longest subsequence is [2, 3, 7, 18]; [2, 5, 7, 101] is another."),
        dict(args=[("scores", [0, 1, 0, 3, 2, 3])], out=4,
             expl="[0, 1, 2, 3] uses the values at indices 0, 1, 4 and 5."),
        dict(args=[("scores", [7, 7, 7, 7])], out=1,
             expl="Equal values are not strictly increasing, so only one element can be chosen."),
    ],
    hidden=[
        dict(args=[[4, 10, 4, 3, 8, 9]], out=3,
             why="[4, 8, 9]; greedily keeping the early 10 leads to a shorter answer"),
        dict(args=[[1, 3, 6, 7, 9, 4, 10, 5, 6]], out=6,
             why="[1, 3, 6, 7, 9, 10]; the answer is the maximum over all positions, not the value at the last index"),
    ],
    run=lambda f, scores: f(scores),
    approach="DP: `dp[i]` is the length of the longest increasing subsequence ending at index i, equal to 1 + max(dp[j]) over j < i with scores[j] < scores[i]; the answer is max(dp). O(n^2) time, O(n) space — full credit. Faster: keep `tails`, where tails[L] is the smallest possible last value of an increasing subsequence of length L + 1, and binary-search each value into it (O(n log n)). Both are shown below.",
    code='''def length_of_lis(scores):                 # O(n^2) DP
    dp = [1] * len(scores)
    for i in range(len(scores)):
        for j in range(i):
            if scores[j] < scores[i]:
                dp[i] = max(dp[i], dp[j] + 1)
    return max(dp)

from bisect import bisect_left

def length_of_lis_fast(scores):            # O(n log n)
    tails = []
    for x in scores:
        i = bisect_left(tails, x)          # bisect_left keeps it strictly increasing
        if i == len(tails):
            tails.append(x)
        else:
            tails[i] = x
    return len(tails)''',
    alt_entries=["length_of_lis_fast"],
    hint="For each position, ask: how long is the longest increasing subsequence that ends exactly here? Which earlier positions could come right before it?",
    rubric=[
        "Defines a correct subproblem (longest subsequence ending at each index, or the tails array).",
        "Uses a strict comparison, so equal values do not extend a subsequence.",
        "Returns the maximum over all positions, not just the last one.",
        "O(n^2) DP earns full credit (O(n log n) is the follow-up); brute force over all subsequences (O(2^n)) earns partial credit.",
    ],
    checkpoints=[
        "dp[i] initialised to 1 for every index",
        "Transition dp[i] = max(dp[i], dp[j] + 1) for j < i with scores[j] < scores[i]",
        "Strictly increasing (equal values excluded)",
        "Answer is max(dp)",
        "States O(n^2) (or O(n log n) with binary search)",
    ],
)

add(
    id="qb-dsa-n13", difficulty="medium", title="Ways to Make Change",
    topic="Arrays · Dynamic Programming", fn="countWays", entry="count_ways",
    body="""A payment kiosk gives change using the coin denominations in `coins`, each available in unlimited quantity. Given a target `amount`, return the **number of different combinations** of coins that add up to exactly `amount`. Combinations are unordered: 1 + 2 and 2 + 1 are the same combination. Implement `countWays(amount, coins)`.

### Constraints
- 0 ≤ amount ≤ 5000
- 1 ≤ number of denominations ≤ 300
- 1 ≤ coins[i] ≤ 5000, all distinct
- The answer fits in a signed 32-bit integer.""",
    examples=[
        dict(args=[("amount", 5), ("coins", [1, 2, 5])], out=4,
             expl="5; 2 + 2 + 1; 2 + 1 + 1 + 1; 1 + 1 + 1 + 1 + 1."),
        dict(args=[("amount", 3), ("coins", [2])], out=0,
             expl="Only 2s are available, and no number of 2s adds up to 3."),
        dict(args=[("amount", 10), ("coins", [10])], out=1,
             expl="A single 10 coin."),
    ],
    hidden=[
        dict(args=[0, [7]], out=1, why="there is exactly one way to make 0 — take no coins; this is the DP base case"),
        dict(args=[4, [1, 2]], out=3,
             why="1+1+1+1, 1+1+2, 2+2; looping over amounts on the outside counts orderings and wrongly gives 5"),
    ],
    run=lambda f, amount, coins: f(amount, coins),
    approach="1-D DP: ways[0] = 1; then for each coin (outer loop) and each amount a from coin up to amount (inner loop), ways[a] += ways[a − coin]. Putting coins on the outside means every combination is built in one fixed coin order, so it is counted once. O(amount × number of coins) time, O(amount) space. A 2-D table dp[i][a] over the first i coins is equally valid; plain recursion without memoisation earns partial credit.",
    code='''def count_ways(amount, coins):
    ways = [0] * (amount + 1)
    ways[0] = 1
    for coin in coins:
        for a in range(coin, amount + 1):
            ways[a] += ways[a - coin]
    return ways[amount]''',
    hint="Build the answer for every amount from 0 upwards. To avoid counting 1 + 2 and 2 + 1 separately, think about the order in which you allow the coins to be used.",
    rubric=[
        "Sets the base case ways[0] = 1.",
        "Loops over coins in the outer loop (or uses a 2-D table indexed by coin) so combinations, not orderings, are counted.",
        "Returns 0 when the amount cannot be formed.",
        "O(amount × coins) for full credit; exponential recursion earns partial credit; counting orderings (5 for amount 4 with [1, 2]) earns little credit.",
    ],
    checkpoints=[
        "DP array of size amount + 1 with ways[0] = 1",
        "Outer loop over coins, inner loop over amounts",
        "Transition ways[a] += ways[a − coin]",
        "Returns 0 for unreachable amounts and 1 for amount 0",
        "O(amount × number of coins) time",
    ],
)

add(
    id="qb-dsa-n14", difficulty="medium", title="Unique Paths Around Obstacles",
    topic="Matrix · Dynamic Programming", fn="uniquePaths", entry="unique_paths",
    body="""A delivery robot starts at the top-left cell of an `m × n` grid and must reach the bottom-right cell. It can only move **right** or **down**, one cell at a time. Cells marked `1` are blocked and cells marked `0` are open.

Return the number of distinct paths from the top-left cell to the bottom-right cell that avoid every blocked cell. If the start or the target is blocked, return `0`. Implement `uniquePaths(grid)`.

### Constraints
- 1 ≤ m, n ≤ 100
- grid[i][j] is `0` or `1`
- The answer fits in a signed 32-bit integer.""",
    examples=[
        dict(args=[("grid", [[0, 0, 0], [0, 1, 0], [0, 0, 0]])], out=2,
             expl="The blocked centre leaves two routes: right, right, down, down and down, down, right, right."),
        dict(args=[("grid", [[0, 1], [0, 0]])], out=1,
             expl="The cell to the right of the start is blocked, so the only path is down, then right."),
    ],
    hidden=[
        dict(args=[[[1, 0]]], out=0, why="the start itself is blocked"),
        dict(args=[[[0, 1, 0], [0, 0, 0]]], out=1,
             why="a block in the first row cuts off every cell after it in that row; initialising the first row to all 1s is wrong"),
    ],
    run=lambda f, grid: f(grid),
    approach="DP where ways[i][j] = 0 for a blocked cell, otherwise ways[i − 1][j] + ways[i][j − 1] (cells outside the grid count as 0), with ways[0][0] = 1 when the start is open. One reused row is enough: O(m·n) time, O(n) space. Memoised recursion is equally valid; unmemoised recursion is exponential and earns partial credit.",
    code='''def unique_paths(grid):
    m, n = len(grid), len(grid[0])
    row = [0] * n
    row[0] = 1 if grid[0][0] == 0 else 0
    for i in range(m):
        for j in range(n):
            if grid[i][j] == 1:
                row[j] = 0
            elif j > 0:
                row[j] += row[j - 1]     # from above (old row[j]) + from the left
    return row[n - 1]''',
    hint="The robot can only enter a cell from above or from the left. How does the number of ways to reach a cell relate to the counts for those two neighbours?",
    rubric=[
        "Recurrence: ways(cell) = ways(above) + ways(left), and 0 for blocked cells.",
        "Correct base cases — a block in the first row or column cuts off everything after it; a blocked start or target gives 0.",
        "Fills the table in an order where both neighbours are already computed.",
        "O(m·n) time for full credit; unmemoised recursion earns partial credit.",
    ],
    checkpoints=[
        "DP table (or rolling row) over the grid",
        "Blocked cells get 0 ways",
        "Open cells sum the top and left neighbours",
        "First row/column handled correctly after an obstacle",
        "Returns 0 when the start or target is blocked",
        "O(m × n) time",
    ],
)

add(
    id="qb-dsa-n15", difficulty="medium", title="Lowest Common Ancestor in a Binary Tree",
    topic="Trees · Recursion · DFS", fn="lowestCommonAncestor", entry="lowest_common_ancestor",
    body=f"""A company's reporting structure is stored as a binary tree (**not** a binary search tree). Given its root and two distinct node values `p` and `q` that both exist in the tree, return the value of their **lowest common ancestor**: the deepest node that has both `p` and `q` as descendants, where a node counts as a descendant of itself. All node values are unique. Implement `lowestCommonAncestor(root, p, q)`.

{TREE_NOTE}

### Constraints
- 2 ≤ number of nodes ≤ 10^5
- -10^9 ≤ node value ≤ 10^9, all values unique
- p ≠ q, and both are present in the tree""",
    examples=[
        dict(args=[("root", [3, 5, 1, 6, 2, 0, 8, None, None, 7, 4]), ("p", 5), ("q", 1)], out=3,
             expl="5 is in the root's left subtree and 1 is in its right subtree, so they first meet at the root, 3."),
        dict(args=[("root", [3, 5, 1, 6, 2, 0, 8, None, None, 7, 4]), ("p", 5), ("q", 4)], out=5,
             expl="4 is a descendant of 5 (5 → 2 → 4), and a node is a descendant of itself, so the answer is 5."),
    ],
    hidden=[
        dict(args=[[1, 2], 1, 2], out=1, why="one node is the root and the other is its child"),
        dict(args=[[3, 5, 1, 6, 2, 0, 8, None, None, 7, 4], 6, 4], out=5,
             why="both nodes are deep in the same subtree; the answer is not the root"),
    ],
    run=lambda f, root, p, q: f(build_tree(root), p, q),
    approach="Post-order recursion: if the node is null or holds p or q, return it. Otherwise recurse left and right; if both sides return a node, the current node is the LCA, else pass up whichever side is non-null. O(n) time, O(h) stack. Recording the root-to-node paths for p and q (or parent pointers) and taking the last common node is also full credit (O(n) space). BST ordering cannot be used — the tree is not a BST.",
    code='''# TreeNode has fields val, left and right
def lowest_common_ancestor(root, p, q):
    def walk(node):
        if node is None or node.val == p or node.val == q:
            return node
        left = walk(node.left)
        right = walk(node.right)
        if left and right:
            return node
        return left or right
    return walk(root).val''',
    hint="Ask each subtree a simple question: does it contain p or q? At which node do the answers from its left and right subtrees first both say yes?",
    rubric=[
        "Finds the deepest node that has both p and q in its subtree (one-pass recursion or path comparison).",
        "Handles the case where one value is an ancestor of the other.",
        "Does not assume BST ordering.",
        "O(n) time.",
    ],
    checkpoints=[
        "Base case returns the node when it is null, p or q",
        "Recurses into both subtrees",
        "Returns the current node when both sides find a target",
        "Otherwise propagates the non-null result upward",
        "Correct when p is an ancestor of q",
        "O(n) time",
    ],
)

# =================================================================== HARD
add(
    id="qb-dsa-n16", difficulty="hard", title="Reverse Nodes in Groups of K",
    topic="Linked Lists · Pointers", fn="reverseKGroup", entry="reverse_k_group",
    body=f"""Given the head of a **singly linked list** (each node has a value `val` and a pointer `next`) and a positive integer `k`, reverse the nodes **k at a time** and return the new head. If fewer than `k` nodes are left at the end, keep them in their original order. You must relink the nodes themselves — changing only the values stored in the nodes is not allowed. Implement `reverseKGroup(head, k)`.

{LL_NOTE}

### Constraints
- 1 ≤ k ≤ number of nodes ≤ 5000
- 0 ≤ node value ≤ 1000
- Follow-up: use O(1) extra memory.""",
    examples=[
        dict(args=[("head", [1, 2, 3, 4, 5]), ("k", 2)], out=[2, 1, 4, 3, 5],
             expl="Groups [1, 2] and [3, 4] are reversed. Node 5 is a group of fewer than 2 nodes, so it stays where it is."),
        dict(args=[("head", [1, 2, 3, 4, 5]), ("k", 3)], out=[3, 2, 1, 4, 5],
             expl="[1, 2, 3] is reversed; only two nodes remain, so [4, 5] keeps its order."),
    ],
    hidden=[
        dict(args=[[1, 2, 3], 1], out=[1, 2, 3], why="k = 1 leaves the linked list unchanged"),
        dict(args=[[1, 2, 3, 4, 5, 6], 3], out=[3, 2, 1, 6, 5, 4],
             why="the length is an exact multiple of k; the last group is reversed and the new tail must point to null"),
    ],
    run=lambda f, head, k: list_to_array(f(build_list(head), k)),
    approach="Use a dummy node before head and a pointer `group_prev` to the node just before the current group. Walk k nodes ahead to confirm a full group exists (stop if not); reverse those k nodes in place, then link `group_prev` to the new group head and the old group head (now its tail) to the next group, and move `group_prev` to that tail. O(n) time, O(1) extra space. A recursive version (reverse the first k, recurse on the rest) is also correct with O(n/k) stack. Copying values into an array and writing them back breaks the rules and earns partial credit at most.",
    code='''# ListNode has fields val and next
def reverse_k_group(head, k):
    dummy = ListNode(0, head)
    group_prev = dummy
    while True:
        kth = group_prev
        for _ in range(k):                 # is there a full group?
            kth = kth.next
            if kth is None:
                return dummy.next
        group_next = kth.next
        prev, cur = group_next, group_prev.next
        while cur is not group_next:       # reverse the k nodes
            nxt = cur.next
            cur.next = prev
            prev = cur
            cur = nxt
        old_first = group_prev.next        # becomes the group's tail
        group_prev.next = kth
        group_prev = old_first''',
    hint="Handle one group at a time: first check that k nodes exist, then reverse just those k links. Which nodes must you remember so the reversed group can be stitched back between its neighbours?",
    rubric=[
        "Reverses each full group of k nodes by relinking pointers, not by swapping values.",
        "Leaves a final partial group (fewer than k nodes) in its original order.",
        "Reconnects the groups correctly: previous part → new group head, reversed group's tail → next part.",
        "Handles k = 1, k = length and lengths that are exact multiples of k.",
        "O(n) time; O(1) extra space for full credit (recursion with O(n/k) stack is acceptable).",
    ],
    checkpoints=[
        "Dummy node (or special handling) for the new head",
        "Checks that k nodes remain before reversing a group",
        "In-place reversal of exactly k nodes",
        "Links the reversed group to the previous and next parts",
        "Leftover nodes (fewer than k) are not reversed",
        "O(n) time, O(1) extra space",
    ],
)

add(
    id="qb-dsa-n17", difficulty="hard", title="Sliding Window Maximum",
    topic="Arrays · Deque · Sliding Window", fn="windowMaxima", entry="window_maxima",
    body="""A monitoring service records a metric once per minute in an array `readings` (values may be negative). For alerting, it needs the **peak** value in every window of `k` consecutive minutes.

Return an array whose `i`-th element is the maximum of `readings[i .. i + k − 1]`, for every window from left to right (there are `n − k + 1` windows). Implement `windowMaxima(readings, k)`.

### Constraints
- 1 ≤ k ≤ n ≤ 10^5
- -10^4 ≤ readings[i] ≤ 10^4
- Target O(n) time.""",
    examples=[
        dict(args=[("readings", [1, 3, -1, -3, 5, 3, 6, 7]), ("k", 3)], out=[3, 3, 5, 5, 6, 7],
             expl="Windows: [1, 3, -1] → 3, [3, -1, -3] → 3, [-1, -3, 5] → 5, [-3, 5, 3] → 5, [5, 3, 6] → 6, [3, 6, 7] → 7."),
        dict(args=[("readings", [9, 8, 7, 6]), ("k", 2)], out=[9, 8, 7],
             expl="The values fall steadily, so each window's maximum is its first element."),
    ],
    hidden=[
        dict(args=[[1, 3, 1, 2, 0, 5], 3], out=[3, 3, 2, 5],
             why="3 is the largest value but leaves the window after index 3 and must be evicted"),
        dict(args=[[4, 4, 4, 1], 2], out=[4, 4, 4],
             why="duplicate maxima: a deque of values that pops equal elements and then evicts by value loses a 4 still in the window; store indices"),
    ],
    run=lambda f, readings, k: f(readings, k),
    approach="Monotonic deque of **indices** whose values decrease from front to back. For each i: drop the front if its index is outside the window (≤ i − k); pop from the back while the value there is ≤ readings[i]; push i; once i ≥ k − 1 the front holds the window maximum. Every index is pushed and popped at most once: O(n) time, O(k) space. A max-heap with lazy removal (O(n log n)) earns most of the credit; rescanning each window (O(n·k)) earns partial credit.",
    code='''from collections import deque

def window_maxima(readings, k):
    dq = deque()                     # indices; their values are decreasing
    result = []
    for i, x in enumerate(readings):
        if dq and dq[0] <= i - k:    # front has left the window
            dq.popleft()
        while dq and readings[dq[-1]] <= x:
            dq.pop()
        dq.append(i)
        if i >= k - 1:
            result.append(readings[dq[0]])
    return result''',
    hint="When a new reading arrives, can an older, smaller reading ever be the maximum of a later window? Keep only the readings that still could be, in an order that makes the current maximum easy to read.",
    rubric=[
        "Maintains a deque of candidates in decreasing order of value, removing smaller elements from the back.",
        "Evicts the front once it falls outside the window (by index), handling duplicate values correctly.",
        "Outputs exactly n − k + 1 maxima, starting when the first window is complete.",
        "O(n) for full credit; a heap (O(n log n)) earns most of the credit; an O(n·k) rescan earns partial credit.",
    ],
    checkpoints=[
        "Deque stores indices (or value–index pairs)",
        "Pops from the back while the back value ≤ the new value",
        "Removes the front when its index leaves the window",
        "Records the front's value once i ≥ k − 1",
        "Correct for k = 1, k = n and duplicate values",
        "O(n) time",
    ],
)

add(
    id="qb-dsa-n18", difficulty="hard", title="Largest Rectangle in a Histogram",
    topic="Arrays · Monotonic Stack", fn="largestRectangle", entry="largest_rectangle",
    body="""A storage dashboard draws daily disk usage as a bar chart: `heights[i]` is the height of the bar for day `i`. Every bar has width 1 and the bars stand side by side with no gaps.

Return the area of the **largest rectangle** that fits entirely inside the bars. The rectangle must be axis-aligned and span consecutive bars. Implement `largestRectangle(heights)`.

### Constraints
- 1 ≤ n ≤ 10^5
- 0 ≤ heights[i] ≤ 10^4
- Target O(n) time.""",
    examples=[
        dict(args=[("heights", [2, 1, 5, 6, 2, 3])], out=10,
             expl="The bars of height 5 and 6 (days 2–3) hold a rectangle of height 5 and width 2, so the area is 10."),
        dict(args=[("heights", [2, 4])], out=4,
             expl="Either the bar of height 4 alone (4 × 1) or both bars at height 2 (2 × 2) gives area 4."),
    ],
    hidden=[
        dict(args=[[6, 2, 5, 4, 5, 1, 6]], out=12,
             why="height 4 across days 2–4; the best rectangle uses neither the tallest bar nor the full width"),
        dict(args=[[2, 1, 2]], out=3, why="the shortest bar spans the full width: 1 × 3"),
    ],
    run=lambda f, heights: f(heights),
    approach="Monotonic stack of indices with increasing heights. When a bar lower than the stack top arrives (a sentinel height 0 at the end flushes the stack), pop the top: its height is bounded on the right by the current index i and on the left by the new stack top, so its width is i − top − 1 (or i if the stack is empty). Track the largest area. Each index is pushed and popped once: O(n) time, O(n) space. Expanding left and right from every bar (O(n^2)) earns partial credit; divide and conquer on the minimum bar (O(n log n) on average) earns most of the credit.",
    code='''def largest_rectangle(heights):
    stack = []                         # indices with increasing heights
    best = 0
    for i, h in enumerate(heights + [0]):   # sentinel 0 flushes the stack
        while stack and heights[stack[-1]] >= h:
            height = heights[stack.pop()]
            left = stack[-1] if stack else -1
            best = max(best, height * (i - left - 1))
        stack.append(i)
    return best''',
    hint="For each bar, the widest rectangle of exactly its height stretches until the first shorter bar on each side. How can you find those boundaries for every bar in a single pass?",
    rubric=[
        "For each bar, finds the nearest shorter bar on the left and on the right (stack, or two passes).",
        "Computes the width correctly at the boundaries (empty stack / sentinel) with no off-by-one.",
        "Takes the maximum of height × width over all bars.",
        "O(n) for full credit; O(n^2) expansion from each bar earns partial credit.",
    ],
    checkpoints=[
        "Maintains a stack of indices in increasing height order",
        "Pops when the current bar is lower and computes the area for the popped height",
        "Width uses the new stack top (or −1) as the left boundary",
        "Flushes the stack at the end (sentinel 0 or a final loop)",
        "Correct when the shortest bar spans the whole chart, e.g. [2, 1, 2]",
        "O(n) time",
    ],
)

add(
    id="qb-dsa-n19", difficulty="hard", title="Merge K Sorted Arrays",
    topic="Heap · Arrays · Divide and Conquer", fn="mergeKSorted", entry="merge_k_sorted",
    body="""A data pipeline reads event timestamps from `k` shards. Each shard returns its timestamps as an array sorted in non-decreasing order. Merge all shards into a **single** array sorted in non-decreasing order, keeping duplicates. Implement `mergeKSorted(shards)`.

### Constraints
- 0 ≤ k ≤ 10^4
- 0 ≤ length of each shard ≤ 500, and the total number of timestamps N ≤ 10^5
- -10^9 ≤ timestamp ≤ 10^9
- Target O(N log k) time.""",
    examples=[
        dict(args=[("shards", [[1, 4, 5], [1, 3, 4], [2, 6]])], out=[1, 1, 2, 3, 4, 4, 5, 6],
             expl="Repeatedly taking the smallest front value across the three shards gives 1, 1, 2, 3, 4, 4, 5, 6."),
        dict(args=[("shards", [[], [7], []])], out=[7],
             expl="Empty shards contribute nothing."),
    ],
    hidden=[
        dict(args=[[]], out=[], why="no shards at all"),
        dict(args=[[[-5, 0, 9], [-6], [10, 11, 12]]], out=[-6, -5, 0, 9, 10, 11, 12],
             why="negative values, and a shard that runs out early must simply drop out of the heap"),
    ],
    run=lambda f, shards: f(shards),
    approach="Min-heap of (value, shard index, position) holding the current front of every non-empty shard. Pop the smallest, append it, and push the next element from the same shard. The heap never holds more than k entries: O(N log k) time, O(k) extra space. Divide-and-conquer merging (merge shards in pairs, log k rounds) is also O(N log k) and full credit. Concatenating and sorting (O(N log N)) or merging shards one by one into a growing result (O(N·k)) earns partial credit.",
    code='''import heapq

def merge_k_sorted(shards):
    heap = [(shard[0], s, 0) for s, shard in enumerate(shards) if shard]
    heapq.heapify(heap)
    merged = []
    while heap:
        value, s, pos = heapq.heappop(heap)
        merged.append(value)
        if pos + 1 < len(shards[s]):
            heapq.heappush(heap, (shards[s][pos + 1], s, pos + 1))
    return merged''',
    hint="At any moment the next output value must be the front of one of the shards. Which data structure lets you find the smallest of k front values quickly, over and over?",
    rubric=[
        "Keeps one candidate per shard in a min-heap (or merges in pairs over log k rounds).",
        "After taking a value, advances only that shard and adds its next element.",
        "Handles empty shards, no shards and duplicate values.",
        "O(N log k) for full credit; sorting everything (O(N log N)) or sequential merging (O(N·k)) earns partial credit.",
    ],
    checkpoints=[
        "Initialises the heap with the first element of each non-empty shard",
        "Heap entries record which shard and position each value came from",
        "Pops the smallest, appends it and pushes the next element of the same shard",
        "Skips empty shards and returns [] for no shards",
        "Keeps duplicates in sorted order",
        "O(N log k) time, O(k) extra space",
    ],
)

add(
    id="qb-dsa-n20", difficulty="hard", title="Edit Distance Between Two Names",
    topic="Strings · Dynamic Programming", fn="minEdits", entry="min_edits",
    body="""A customer-data pipeline matches city names typed by users against a master table of cities. To measure how close two spellings are, it uses the **edit distance**: the minimum number of single-character operations needed to turn `word1` into `word2`, where one operation is

- **insert** a character,
- **delete** a character, or
- **replace** a character with a different one.

Given `word1` and `word2`, return their edit distance. Implement `minEdits(word1, word2)`.

### Constraints
- 0 ≤ length of word1, length of word2 ≤ 500
- Both strings contain only lowercase English letters
- Target O(m × n) time, where m and n are the two lengths.""",
    examples=[
        dict(args=[("word1", "horse"), ("word2", "ros")], out=3,
             expl="horse → rorse (replace h with r) → rose (delete r) → ros (delete e)."),
        dict(args=[("word1", "intention"), ("word2", "execution")], out=5,
             expl="intention → inention (delete t) → enention (replace i with e) → exention (replace n with x) → exection (replace n with c) → execution (insert u)."),
    ],
    hidden=[
        dict(args=["", "abc"], out=3,
             why="one string is empty: the first row/column of the table must be 0, 1, 2, …"),
        dict(args=["kitten", "sitting"], out=3,
             why="two replacements and one insertion; counting mismatched positions fails when the lengths differ"),
    ],
    run=lambda f, w1, w2: f(w1, w2),
    approach="DP table `dp[i][j]` = edit distance between the first i characters of word1 and the first j characters of word2, with dp[i][0] = i and dp[0][j] = j. If word1[i − 1] == word2[j − 1] then dp[i][j] = dp[i − 1][j − 1]; otherwise dp[i][j] = 1 + min(dp[i − 1][j] (delete), dp[i][j − 1] (insert), dp[i − 1][j − 1] (replace)). O(m·n) time; O(n) space with two rows. Memoised recursion on (i, j) is equally valid; plain recursion is exponential and earns partial credit.",
    code='''def min_edits(word1, word2):
    m, n = len(word1), len(word2)
    prev = list(range(n + 1))          # row for i = 0
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        for j in range(1, n + 1):
            if word1[i - 1] == word2[j - 1]:
                cur[j] = prev[j - 1]
            else:
                cur[j] = 1 + min(prev[j], cur[j - 1], prev[j - 1])
        prev = cur
    return prev[n]''',
    hint="Compare the last characters of the two prefixes. If they match, what is left to solve? If they do not, each of the three operations shrinks the problem in a different way.",
    rubric=[
        "Defines the DP over prefixes of both strings with correct base cases (i and j).",
        "Uses the matching-character case at no cost and 1 + min of the three operations otherwise.",
        "Handles empty strings.",
        "O(m·n) time for full credit; unmemoised recursion earns partial credit; a greedy character comparison earns little credit.",
    ],
    checkpoints=[
        "dp[i][j] defined on prefixes of word1 and word2",
        "Base cases dp[i][0] = i and dp[0][j] = j",
        "No-cost transition when the characters match",
        "1 + min(delete, insert, replace) when they differ",
        "Returns dp[m][n]",
        "O(m × n) time",
    ],
)


# ------------------------------------------------------------ verification
def run_ops(cls, ops):
    obj = cls()
    out = []
    for name, arg in ops:
        if name in ("push",):
            getattr(obj, name)(arg)
        elif name == "pop":
            obj.pop()
        else:
            out.append(getattr(obj, name)())
    return out


FORBIDDEN = [r"\bPython\b", r"\bdict\b", r"\bdef\b", r"print\(", r"\bTrue\b", r"\bFalse\b", r"\bNone\b"]


def check_neutral(text, where):
    for pat in FORBIDDEN:
        assert not re.search(pat, text), f"{where}: forbidden token {pat}"
    # 'list' is only allowed as part of 'linked list(s)'
    for m in re.finditer(r"\blists?\b", text, flags=re.I):
        before = text[max(0, m.start() - 7):m.start()].lower()
        assert before.endswith("linked "), f"{where}: uses the word 'list' outside 'linked list'"


def build():
    out = []
    n_tests = 0
    for q in Q:
        ns = {"ListNode": ListNode, "TreeNode": TreeNode}
        exec(q["code"], ns)
        entries = [q["entry"]] + q.get("alt_entries", [])
        is_ops = q.get("ops", False)

        def call(entry, args):
            f = ns[entry]
            if is_ops:
                return run_ops(f, args)
            return q["run"](f, *args)

        # examples
        sample_parts, exp_lines = [], []
        for i, ex in enumerate(q["examples"], 1):
            values = ex["args"] if is_ops else [v for _, v in ex["args"]]
            for e in entries:
                got = call(e, values)
                assert got == ex["out"], f"{q['id']} example {i} [{e}]: got {got!r}, expected {ex['out']!r}"
                n_tests += 1
            inp = ops_text(ex["args"]) if is_ops else ", ".join(f"{k} = {fmt(v)}" for k, v in ex["args"])
            sample_parts.append(f"**Example {i}**\nInput: {inp}\nOutput: {fmt(ex['out'])}\nExplanation: {ex['expl']}")
            exp_lines.append(f"Example {i} → {fmt(ex['out'])}")
        # hidden tests
        assert len(q["hidden"]) == 2, q["id"]
        for i, h in enumerate(q["hidden"], 1):
            if is_ops:
                values = h["args"]
                shown = ops_text(h["args"])
            elif h.get("named"):
                values = [v for _, v in h["args"]]
                shown = q["fn"] + "(" + ", ".join(f"{k} = {fmt(v)}" for k, v in h["args"]) + ")"
            else:
                values = h["args"]
                shown = q["fn"] + "(" + ", ".join(fmt(v) for v in h["args"]) + ")"
            for e in entries:
                got = call(e, values)
                assert got == h["out"], f"{q['id']} hidden {i} [{e}]: got {got!r}, expected {h['out']!r}"
                n_tests += 1
            exp_lines.append(f"Hidden test {i} → {shown} = {fmt(h['out'])}  ({h['why']})")

        diff = q["difficulty"]
        prompt = f"## {q['title']}\n> {q['topic']} · {diff.capitalize()}\n\n{q['body']}"
        obj = {
            "id": q["id"],
            "category": "dsa",
            "difficulty": diff,
            "marks": 5,
            "title": q["title"],
            "topic": q["topic"],
            "prompt": prompt,
            "sample_data": "\n\n".join(sample_parts),
            "expected_output": "\n".join(exp_lines),
            "reference_answer": q["approach"] + "\n\n" + q["code"],
            "hint": q["hint"],
            "rubric": "\n".join("- " + r for r in q["rubric"]),
            "checkpoints": "\n".join(q["checkpoints"]),
            "source": SOURCE,
        }
        # shape / style checks
        assert list(obj.keys()) == KEYS, q["id"]
        assert 2 <= len(q["examples"]) <= 3, q["id"]
        assert 3 <= len(q["rubric"]) <= 5, q["id"]
        assert 4 <= len(q["checkpoints"]) <= 6, q["id"]
        assert 1 <= len(q["topic"].split(" · ")) <= 3, q["id"]
        assert "### Constraints" in prompt and "Example" not in q["body"], q["id"]
        assert q["fn"] in prompt, q["id"]
        for field in ("prompt", "sample_data", "hint"):
            check_neutral(obj[field], f"{q['id']}.{field}")
        out.append(obj)

    ids = [o["id"] for o in out]
    assert ids == [f"qb-dsa-n{i:02d}" for i in range(1, 21)], ids
    assert len(set(ids)) == len(ids)
    titles = [o["title"].lower() for o in out]
    assert len(set(titles)) == len(titles), "duplicate titles"
    mix = {d: sum(o["difficulty"] == d for o in out) for d in ("easy", "medium", "hard")}
    assert mix == {"easy": 5, "medium": 10, "hard": 5}, mix

    # no clash with existing titles
    existing = set()
    with open(os.path.join(HERE, "existing-titles.tsv"), encoding="utf-8") as fh:
        next(fh)
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 3:
                existing.add(parts[2].strip().lower())
    clash = [t for t in titles if t in existing]
    assert not clash, f"title clash with existing bank: {clash}"
    return out, n_tests, mix


if __name__ == "__main__":
    try:
        questions, n_tests, mix = build()
    except AssertionError as e:
        print("VERIFY FAILED:", e)
        sys.exit(1)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(questions, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"OK: {len(questions)} dsa questions verified ({n_tests} test executions across examples + hidden tests; "
          f"easy={mix['easy']} medium={mix['medium']} hard={mix['hard']}) -> {os.path.relpath(OUT)}")
