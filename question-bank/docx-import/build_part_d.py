#!/usr/bin/env python3
"""Build + verify docx Part B (Plain DSA Problems, B1-B15) -> part_d.json.

Every displayed example / hidden-test value is written here as the exact text
shown to graders, then checked against the reference solution embedded in the
question's `reference_answer` (the code string is exec'd, so the shipped code is
the verified code). part_d.json is written only if every assertion passes.
"""
import json
import os
import random
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "part_d.json")


# ---------------------------------------------------------------- helpers
def fmt(v):
    """Language-neutral display: true/false/null, double-quoted strings."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    return str(v)


class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


def build_list(vals):
    dummy = ListNode()
    cur = dummy
    for v in vals:
        cur.next = ListNode(v)
        cur = cur.next
    return dummy.next


def list_to_array(head):
    out = []
    seen = 0
    while head:
        out.append(head.val)
        head = head.next
        seen += 1
        assert seen < 10_000, "cycle in linked list"
    return out


def build_tree(vals):
    """Level-order array with None for missing children -> TreeNode root."""
    if not vals or vals[0] is None:
        return None
    root = TreeNode(vals[0])
    q = deque([root])
    i = 1
    while q and i < len(vals):
        node = q.popleft()
        if i < len(vals) and vals[i] is not None:
            node.left = TreeNode(vals[i])
            q.append(node.left)
        i += 1
        if i < len(vals) and vals[i] is not None:
            node.right = TreeNode(vals[i])
            q.append(node.right)
        i += 1
    assert i >= len(vals) or all(v is None for v in vals[i:]), "dangling values in tree array"
    return root


def ident(x):
    return x


def canon_triplets(v):
    return sorted(tuple(sorted(t)) for t in v)


def canon_subsets(v):
    return sorted(tuple(sorted(s)) for s in v)


def load(code, name):
    ns = {"ListNode": ListNode, "TreeNode": TreeNode}
    exec(code, ns)
    return ns[name]


# ---------------------------------------------------------------- questions
Q = []

# ---- B2 Container With Most Water
Q.append(dict(
    num=401, src="B2", title="Container With Most Water",
    topic="Arrays · Two Pointers · Greedy", difficulty="medium",
    body=(
        "You are given an integer array `height` of length `n`. Picture `n` vertical lines: "
        "line `i` stands at position `x = i` and has height `height[i]`.\n\n"
        "Choose two lines that, together with the x-axis, form a container. The water it holds is "
        "**(distance between the two lines) × (height of the shorter line)**. Return the maximum "
        "amount of water any container can store. The container cannot be tilted."
    ),
    constraints=["2 ≤ n ≤ 10^5", "0 ≤ height[i] ≤ 10^4", "Target O(n) time."],
    fn="maxArea", argn=["height"], py="max_area",
    examples=[
        ([[1, 8, 6, 2, 5, 4, 8, 3, 7]], "49",
         "Lines at index 1 (height 8) and index 8 (height 7) are 7 apart. The shorter line is 7, so the area is 7 × 7 = 49. No other pair holds more."),
        ([[4, 3, 2, 1, 4]], "16",
         "The two lines of height 4 at index 0 and index 4 are 4 apart, giving 4 × 4 = 16."),
    ],
    hidden=[
        ([[1, 1]], "1", "only two lines; width 1 × height 1"),
        ([[2, 3, 10, 5, 7, 8, 9]], "36", "the best pair (10 and 9) is not the widest pair; the shorter side must be the one that moves"),
    ],
    approach=(
        "Two pointers start at both ends. Record the area, then move the pointer at the shorter line inward — "
        "moving the taller one can only shrink the width without raising the limiting height. O(n) time, O(1) space."
    ),
    code=(
        "def max_area(height):\n"
        "    left, right = 0, len(height) - 1\n"
        "    best = 0\n"
        "    while left < right:\n"
        "        best = max(best, (right - left) * min(height[left], height[right]))\n"
        "        if height[left] < height[right]:\n"
        "            left += 1\n"
        "        else:\n"
        "            right -= 1\n"
        "    return best"
    ),
    hint="Start with the widest possible container. Which of the two lines is limiting the area — and which pointer is worth moving inward?",
    rubric=[
        "Computes the area as (distance between indices) × (shorter height).",
        "Uses two pointers from both ends, always moving the pointer at the shorter line.",
        "Explains (or implies) why moving the taller line can never increase the area.",
        "O(n) for full credit; an O(n^2) all-pairs scan earns partial credit.",
    ],
    checkpoints=[
        "Area formula uses the shorter line and the index distance",
        "Starts with pointers at both ends",
        "Moves the pointer at the shorter line each step",
        "Tracks the best area seen",
        "O(n) time, O(1) space",
    ],
))

# ---- B3 Search in a Rotated Sorted Array
Q.append(dict(
    num=402, src="B3", title="Search in a Rotated Sorted Array",
    topic="Arrays · Binary Search", difficulty="medium",
    body=(
        "An array of **distinct** integers was sorted in ascending order and then possibly rotated at an unknown pivot. "
        "For example, `[0, 1, 2, 4, 5, 6, 7]` might become `[4, 5, 6, 7, 0, 1, 2]`.\n\n"
        "Given the rotated array `nums` and an integer `target`, return the index of `target`, or `-1` if it is not present. "
        "Your algorithm must run in **O(log n)** time."
    ),
    constraints=["1 ≤ length(nums) ≤ 5000", "-10^4 ≤ nums[i], target ≤ 10^4",
                 "All values in `nums` are distinct.", "`nums` is an ascending array, possibly rotated."],
    fn="searchRotated", argn=["nums", "target"], py="search_rotated",
    examples=[
        ([[4, 5, 6, 7, 0, 1, 2], 0], "4", "0 sits at index 4, right after the rotation point where 7 drops to 0."),
        ([[4, 5, 6, 7, 0, 1, 2], 3], "-1", "3 is not in the array, so the search ends without a match."),
    ],
    hidden=[
        ([[3, 1], 1], "1", "low = mid on a two-element window; the sorted-half test must use <=, not <"),
        ([[1, 2, 3, 4, 5], 4], "3", "array not rotated at all"),
    ],
    approach=(
        "Modified binary search: at each step at least one half, [low, mid] or [mid, high], is sorted (nums[low] <= nums[mid] "
        "means the left half is). If target lies inside the sorted half's range search there, otherwise search the other half. "
        "O(log n) time, O(1) space."
    ),
    code=(
        "def search_rotated(nums, target):\n"
        "    low, high = 0, len(nums) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if nums[mid] == target:\n"
        "            return mid\n"
        "        if nums[low] <= nums[mid]:            # left half sorted\n"
        "            if nums[low] <= target < nums[mid]:\n"
        "                high = mid - 1\n"
        "            else:\n"
        "                low = mid + 1\n"
        "        else:                                 # right half sorted\n"
        "            if nums[mid] < target <= nums[high]:\n"
        "                low = mid + 1\n"
        "            else:\n"
        "                high = mid - 1\n"
        "    return -1"
    ),
    hint="When you split at mid, at least one half is still fully sorted. How can you tell which one, and whether the target lies inside it?",
    rubric=[
        "Uses a binary-search approach that runs in O(log n); a linear scan earns partial credit at most.",
        "Correctly identifies which half is sorted at each step.",
        "Chooses the half to keep by checking whether target is within the sorted half's range.",
        "Returns -1 when absent and handles unrotated and one- or two-element arrays.",
    ],
    checkpoints=[
        "Uses binary search, not a linear scan",
        "Determines the sorted half (e.g. nums[low] <= nums[mid])",
        "Range check on the sorted half decides the direction",
        "Returns the correct index, or -1 when absent",
        "Handles unrotated and two-element arrays (low = mid)",
    ],
    buggy=[(
        # strict < in the sorted-half test misses the low == mid case
        "def search_rotated(nums, target):\n"
        "    low, high = 0, len(nums) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if nums[mid] == target: return mid\n"
        "        if nums[low] < nums[mid]:\n"
        "            if nums[low] <= target < nums[mid]: high = mid - 1\n"
        "            else: low = mid + 1\n"
        "        else:\n"
        "            if nums[mid] < target <= nums[high]: low = mid + 1\n"
        "            else: high = mid - 1\n"
        "    return -1",
        "search_rotated", [[3, 1], 1])],
))

# ---- B4 Number of Islands
Q.append(dict(
    num=403, src="B4", title="Number of Islands",
    topic="Matrix · Graphs · DFS/BFS", difficulty="medium",
    body=(
        "You are given an `m × n` grid of characters where `\"1\"` is land and `\"0\"` is water. An **island** is a group of land "
        "cells connected **horizontally or vertically** (not diagonally). Assume everything outside the grid is water.\n\n"
        "Return the number of islands."
    ),
    constraints=["1 ≤ m, n ≤ 300", "`grid[i][j]` is `\"0\"` or `\"1\"`."],
    fn="numIslands", argn=["grid"], py="num_islands", copy_args=True,
    examples=[
        ([[["1", "1", "0", "0", "0"], ["1", "1", "0", "0", "0"], ["0", "0", "1", "0", "0"], ["0", "0", "0", "1", "1"]]], "3",
         "The 2 × 2 block in the top-left is one island. The single cell at row 2, column 2 (0-indexed) is a second. The two cells at the bottom-right form a third."),
        ([[["1", "0", "1"], ["0", "1", "0"], ["1", "0", "1"]]], "5",
         "Every land cell touches the others only diagonally, and diagonal cells are not connected. So each of the five land cells is its own island."),
    ],
    hidden=[
        ([[["0", "0"], ["0", "0"]]], "0", "all water"),
        ([[["1", "0", "1"], ["1", "0", "1"], ["1", "1", "1"]]], "1", "U-shape: the two arms only join on the bottom row, so a row-by-row count would wrongly see 2"),
    ],
    approach=(
        "Scan every cell; each land cell not yet visited starts a new island, and a DFS/BFS from it marks all 4-directionally "
        "connected land as visited (here by overwriting it with \"0\"). Each cell is processed once: O(m·n) time, O(m·n) worst-case stack."
    ),
    code=(
        "def num_islands(grid):\n"
        "    rows, cols = len(grid), len(grid[0])\n"
        "    count = 0\n"
        "    for r in range(rows):\n"
        "        for c in range(cols):\n"
        "            if grid[r][c] == \"1\":\n"
        "                count += 1\n"
        "                grid[r][c] = \"0\"\n"
        "                stack = [(r, c)]\n"
        "                while stack:\n"
        "                    cr, cc = stack.pop()\n"
        "                    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):\n"
        "                        nr, nc = cr + dr, cc + dc\n"
        "                        if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == \"1\":\n"
        "                            grid[nr][nc] = \"0\"\n"
        "                            stack.append((nr, nc))\n"
        "    return count"
    ),
    hint="Each time you reach land you haven't visited yet, you've found a new island. How do you make sure the rest of that island is never counted again?",
    rubric=[
        "Counts a new island only when it reaches unvisited land.",
        "Floods (DFS/BFS) all horizontally/vertically connected land from that cell and marks it visited.",
        "Does not connect diagonal cells and stays inside the grid bounds.",
        "O(m·n) overall.",
    ],
    checkpoints=[
        "Iterates over every cell of the grid",
        "Increments the count only on an unvisited land cell",
        "DFS/BFS marks all connected land as visited",
        "Uses 4-directional neighbours only, with bounds checks",
        "O(m·n) time",
    ],
))

# ---- B5 Longest Consecutive Sequence
Q.append(dict(
    num=404, src="B5", title="Longest Consecutive Sequence",
    topic="Arrays · Hash Set", difficulty="medium",
    body=(
        "Given an unsorted array of integers `nums`, return the length of the longest run of consecutive integers "
        "(such as `4, 5, 6, 7`) that can be formed from its values. The values can appear anywhere in the array, and "
        "duplicates count only once.\n\n"
        "Your algorithm must run in **O(n)** time."
    ),
    constraints=["0 ≤ length(nums) ≤ 10^5", "-10^9 ≤ nums[i] ≤ 10^9"],
    fn="longestConsecutive", argn=["nums"], py="longest_consecutive",
    examples=[
        ([[100, 4, 200, 1, 3, 2]], "4",
         "The values 1, 2, 3 and 4 are all present, a run of length 4. 100 and 200 have no neighbours, so they form runs of length 1."),
        ([[0, 3, 7, 2, 5, 8, 4, 6, 0, 1]], "9",
         "Every value from 0 to 8 is present, a run of length 9. The duplicate 0 is counted only once."),
    ],
    hidden=[
        ([[]], "0", "empty input"),
        ([[1, 2, 0, 1]], "3", "the duplicate 1 is counted once; the run is 0, 1, 2"),
    ],
    approach=(
        "Put every value in a hash set. Only start counting from x when x − 1 is absent (x begins a run), then step "
        "x + 1, x + 2, … while present. Each value is visited at most twice: O(n) time, O(n) space. Sorting is O(n log n) and earns partial credit."
    ),
    code=(
        "def longest_consecutive(nums):\n"
        "    values = set(nums)\n"
        "    best = 0\n"
        "    for x in values:\n"
        "        if x - 1 not in values:\n"
        "            length = 1\n"
        "            while x + length in values:\n"
        "                length += 1\n"
        "            best = max(best, length)\n"
        "    return best"
    ),
    hint="How can you answer 'is x present?' in O(1)? Then think about which values are worth starting a count from.",
    rubric=[
        "Uses a hash set for O(1) membership checks.",
        "Starts counting only from the start of a run (x − 1 absent), keeping the total work O(n).",
        "Counts duplicates once and returns 0 for empty input.",
        "A sorting-based O(n log n) solution earns partial credit.",
    ],
    checkpoints=[
        "Builds a hash set of the values",
        "Starts a run only when x − 1 is not present",
        "Extends the run while x + 1, x + 2, … exist",
        "Handles empty input and duplicates",
        "O(n) time overall",
    ],
))

# ---- B7 Three Sum to Zero
Q.append(dict(
    num=405, src="B7", title="Three Sum to Zero",
    topic="Arrays · Sorting · Two Pointers", difficulty="medium",
    body=(
        "Given an integer array `nums`, return all **unique** triplets `[nums[i], nums[j], nums[k]]` where `i`, `j` and `k` are "
        "distinct indices and the three values sum to `0`.\n\n"
        "The answer must not contain duplicate triplets (two triplets with the same three values count as the same). "
        "Triplets, and the values inside each triplet, may be returned in any order."
    ),
    constraints=["3 ≤ length(nums) ≤ 3000", "-10^5 ≤ nums[i] ≤ 10^5"],
    fn="threeSum", argn=["nums"], py="three_sum", copy_args=True, canon=canon_triplets,
    order_note="any order of triplets and of values inside a triplet",
    examples=[
        ([[-1, 0, 1, 2, -1, -4]], "[[-1, -1, 2], [-1, 0, 1]]",
         "-1 + -1 + 2 = 0 and -1 + 0 + 1 = 0. The array has two -1 values, so [-1, 0, 1] can be formed in two ways, but it is listed only once."),
        ([[0, 0, 0, 0]], "[[0, 0, 0]]",
         "Many index choices give 0 + 0 + 0, but they all form the same triplet, so it appears once."),
    ],
    hidden=[
        ([[0, 1, 1]], "[]", "no triplet sums to zero"),
        ([[-2, 0, 1, 1, 2]], "[[-2, 0, 2], [-2, 1, 1]]", "a triplet may use equal values at different indices; still no duplicates"),
    ],
    approach=(
        "Sort, then fix each nums[i] (skipping repeated values) and find pairs summing to −nums[i] with two pointers moving inward; "
        "after each hit, move both pointers past equal values. O(n^2) time, O(1) extra space besides the output."
    ),
    code=(
        "def three_sum(nums):\n"
        "    nums.sort()\n"
        "    result = []\n"
        "    n = len(nums)\n"
        "    for i in range(n - 2):\n"
        "        if i > 0 and nums[i] == nums[i - 1]:\n"
        "            continue\n"
        "        left, right = i + 1, n - 1\n"
        "        while left < right:\n"
        "            total = nums[i] + nums[left] + nums[right]\n"
        "            if total < 0:\n"
        "                left += 1\n"
        "            elif total > 0:\n"
        "                right -= 1\n"
        "            else:\n"
        "                result.append([nums[i], nums[left], nums[right]])\n"
        "                while left < right and nums[left] == nums[left + 1]:\n"
        "                    left += 1\n"
        "                while left < right and nums[right] == nums[right - 1]:\n"
        "                    right -= 1\n"
        "                left += 1\n"
        "                right -= 1\n"
        "    return result"
    ),
    hint="Sorting first helps a lot. Once you fix the first value, you only need pairs with a given sum — and duplicate values become neighbours you can skip.",
    rubric=[
        "Finds every triplet of distinct indices whose values sum to zero.",
        "The output contains no duplicate triplets.",
        "O(n^2) (sort + two pointers, or a hash set per fixed value) for full credit; O(n^3) earns partial credit.",
        "Handles the no-solution and all-zeros cases.",
    ],
    checkpoints=[
        "Sorts the array (or otherwise structures the search)",
        "Fixes one value and two-pointer scans for the complementary pair",
        "Skips duplicates for the fixed value and for both pointers",
        "Returns all triplets with no duplicates",
        "O(n^2) time",
    ],
))

# ---- B8 Remove the Nth Node From the End
Q.append(dict(
    num=406, src="B8", title="Remove the Nth Node From the End",
    topic="Linked Lists · Two Pointers", difficulty="medium",
    body=(
        "Given the head of a **singly linked list** (each node has a value `val` and a pointer `next`), remove the `n`-th node "
        "**from the end** of the list and return the head of the modified list.\n\n"
        "In the examples, a linked list is written as an array of its node values from head to tail — for example `[1, 2, 3]` "
        "means 1 → 2 → 3, and an empty list is written `[]`. Your solution should work on the linked nodes themselves."
    ),
    constraints=["1 ≤ number of nodes ≤ 30", "0 ≤ node value ≤ 100", "1 ≤ n ≤ number of nodes",
                 "Follow-up: can you do it in one pass?"],
    fn="removeNthFromEnd", argn=["head", "n"], py="remove_nth_from_end", kind="linked_list",
    examples=[
        ([[1, 2, 3, 4, 5], 2], "[1, 2, 3, 5]",
         "Counting from the end, 5 is first and 4 is second. Node 4 is removed, so 3 now points to 5."),
        ([[1], 1], "[]",
         "The only node is removed, so the list becomes empty (the returned head is `null`)."),
    ],
    hidden=[
        ([[1, 2], 2], "[2]", "removes the head itself; a dummy node avoids a special case"),
        ([[1, 2], 1], "[1]", "removes the tail"),
    ],
    approach=(
        "Put a dummy node before head. Move a fast pointer n steps ahead, then advance fast and slow together until fast is on the "
        "last node; slow is then just before the target, so unlink slow.next. One pass, O(L) time, O(1) space. Two passes "
        "(count the length L, then remove node L − n from the front) is also full credit."
    ),
    code=(
        "# ListNode has fields val and next\n"
        "def remove_nth_from_end(head, n):\n"
        "    dummy = ListNode(0, head)\n"
        "    fast = slow = dummy\n"
        "    for _ in range(n):\n"
        "        fast = fast.next\n"
        "    while fast.next:\n"
        "        fast = fast.next\n"
        "        slow = slow.next\n"
        "    slow.next = slow.next.next\n"
        "    return dummy.next"
    ),
    hint="If one pointer starts n nodes ahead of another and both move at the same speed, where is the trailing pointer when the leading one reaches the end? A dummy node before the head helps.",
    rubric=[
        "Removes exactly the n-th node from the end and relinks its neighbours.",
        "Handles removing the head (n equals the length) and the single-node list.",
        "Uses a one-pass gap of n nodes, or a correct two-pass length count.",
        "O(L) time, O(1) extra space.",
    ],
    checkpoints=[
        "Locates the node just before the target correctly",
        "Relinks the previous node's next to skip the target",
        "Handles removal of the head (dummy node or special case)",
        "Returns an empty list (null head) when the only node is removed",
        "O(L) time, O(1) space",
    ],
))

# ---- B9 Kth Largest Element
Q.append(dict(
    num=407, src="B9", title="Kth Largest Element",
    topic="Arrays · Heap · Quickselect", difficulty="medium",
    body=(
        "Given an integer array `nums` and an integer `k`, return the `k`-th largest element. This is the `k`-th value in "
        "**descending sorted order**, so duplicates count separately — it is **not** the `k`-th distinct value.\n\n"
        "Try to solve it without sorting the whole array."
    ),
    constraints=["1 ≤ k ≤ length(nums) ≤ 10^5", "-10^4 ≤ nums[i] ≤ 10^4"],
    fn="kthLargest", argn=["nums", "k"], py="kth_largest",
    examples=[
        ([[3, 2, 1, 5, 6, 4], 2], "5", "In descending order the array is 6, 5, 4, 3, 2, 1. The second value is 5."),
        ([[3, 2, 3, 1, 2, 4, 5, 5, 6], 4], "4",
         "In descending order the array is 6, 5, 5, 4, 3, 3, 2, 2, 1. Both 5s count, so the fourth value is 4."),
    ],
    hidden=[
        ([[1], 1], "1", "single element"),
        ([[-1, -1, -2], 2], "-1", "duplicates count separately; negative values"),
    ],
    approach=(
        "Keep a min-heap of the k largest values seen: push each value and pop when the size exceeds k; the heap's top is the answer. "
        "O(n log k) time, O(k) space. Quickselect (average O(n)) is also full credit; a full sort is O(n log n) and earns partial credit."
    ),
    code=(
        "import heapq\n"
        "def kth_largest(nums, k):\n"
        "    heap = []\n"
        "    for x in nums:\n"
        "        heapq.heappush(heap, x)\n"
        "        if len(heap) > k:\n"
        "            heapq.heappop(heap)\n"
        "    return heap[0]"
    ),
    hint="You only need to remember the k largest values seen so far. Which structure lets you cheaply throw away the smallest of them?",
    rubric=[
        "Returns the k-th largest counting duplicates separately (not the k-th distinct value).",
        "Uses a size-k min-heap or quickselect for full credit.",
        "A full sort is accepted for partial credit.",
        "Handles negative values, k = 1 and k = length(nums).",
    ],
    checkpoints=[
        "Treats duplicates as separate elements",
        "Maintains a size-k min-heap (or uses quickselect partitioning)",
        "Returns the heap's minimum / the correct partition element",
        "Handles k = 1 and k = length(nums)",
        "States O(n log k) or average O(n)",
    ],
))

# ---- B10 Spiral Matrix
Q.append(dict(
    num=408, src="B10", title="Spiral Matrix",
    topic="Matrix · Simulation", difficulty="medium",
    body=(
        "Given an `m × n` matrix, return all of its elements in **spiral order**: start at the top-left corner, move right along "
        "the top row, then down the right column, then left along the bottom row, then up the left column, and keep spiralling "
        "inward until every element has been visited exactly once."
    ),
    constraints=["1 ≤ m, n ≤ 10", "-100 ≤ matrix[i][j] ≤ 100"],
    fn="spiralOrder", argn=["matrix"], py="spiral_order",
    examples=[
        ([[[1, 2, 3], [4, 5, 6], [7, 8, 9]]], "[1, 2, 3, 6, 9, 8, 7, 4, 5]",
         "Right along the top (1, 2, 3), down the right side (6, 9), left along the bottom (8, 7), up the left side (4), then the centre (5)."),
        ([[[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]], "[1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7]",
         "The outer ring gives 1, 2, 3, 4, 8, 12, 11, 10, 9, 5. The remaining inner row, 6 and 7, is read left to right."),
    ],
    hidden=[
        ([[[1], [2], [3]]], "[1, 2, 3]", "single column: without a left ≤ right check the upward pass re-reads 2"),
        ([[[1, 2], [3, 4], [5, 6]]], "[1, 2, 4, 6, 5, 3]", "non-square, more rows than columns"),
    ],
    approach=(
        "Keep four boundaries (top, bottom, left, right). Read the top row, right column, bottom row and left column in turn, "
        "shrinking the matching boundary after each pass. Guard the bottom-row and left-column passes with top ≤ bottom and "
        "left ≤ right so a lone remaining row or column is not read twice. O(m·n) time."
    ),
    code=(
        "def spiral_order(matrix):\n"
        "    result = []\n"
        "    top, bottom = 0, len(matrix) - 1\n"
        "    left, right = 0, len(matrix[0]) - 1\n"
        "    while top <= bottom and left <= right:\n"
        "        for c in range(left, right + 1):\n"
        "            result.append(matrix[top][c])\n"
        "        top += 1\n"
        "        for r in range(top, bottom + 1):\n"
        "            result.append(matrix[r][right])\n"
        "        right -= 1\n"
        "        if top <= bottom:\n"
        "            for c in range(right, left - 1, -1):\n"
        "                result.append(matrix[bottom][c])\n"
        "            bottom -= 1\n"
        "        if left <= right:\n"
        "            for r in range(bottom, top - 1, -1):\n"
        "                result.append(matrix[r][left])\n"
        "            left += 1\n"
        "    return result"
    ),
    hint="Track four boundaries and shrink one after each side you read. What must still be true before you read the bottom row and the left column?",
    rubric=[
        "Visits every element exactly once, in the correct spiral order.",
        "Shrinks the boundaries correctly after each side.",
        "Guards against re-reading a single remaining row or column.",
        "Works for non-square matrices, single rows and single columns.",
    ],
    checkpoints=[
        "Maintains top/bottom/left/right boundaries",
        "Traverses right, down, left, up in order",
        "Checks top ≤ bottom and left ≤ right before the reverse passes",
        "Handles non-square and single row/column matrices",
        "O(m·n) time",
    ],
    buggy=[(
        # no guards before the reverse passes
        "def spiral_order(matrix):\n"
        "    result = []\n"
        "    top, bottom = 0, len(matrix) - 1\n"
        "    left, right = 0, len(matrix[0]) - 1\n"
        "    while top <= bottom and left <= right:\n"
        "        for c in range(left, right + 1): result.append(matrix[top][c])\n"
        "        top += 1\n"
        "        for r in range(top, bottom + 1): result.append(matrix[r][right])\n"
        "        right -= 1\n"
        "        for c in range(right, left - 1, -1): result.append(matrix[bottom][c])\n"
        "        bottom -= 1\n"
        "        for r in range(bottom, top - 1, -1): result.append(matrix[r][left])\n"
        "        left += 1\n"
        "    return result",
        "spiral_order", [[[1], [2], [3]]])],
))

# ---- B11 Binary Tree Level Order Traversal
TREE_NOTE = (
    "In the examples, a tree is written in **level order** as an array, with `null` marking a missing child — for example "
    "`[1, 2, 3, null, 4]` is root 1 with children 2 and 3, where 4 is the right child of 2. An empty tree is `[]`. "
    "Your solution should work on the tree nodes themselves (each node has `val`, `left` and `right`)."
)
Q.append(dict(
    num=409, src="B11", title="Binary Tree Level Order Traversal",
    topic="Trees · BFS · Queue", difficulty="medium",
    body=(
        "Given the root of a binary tree, return its node values **level by level**, from top to bottom and left to right within "
        "each level. Each level is returned as its own array.\n\n" + TREE_NOTE
    ),
    constraints=["0 ≤ number of nodes ≤ 2000", "-1000 ≤ node value ≤ 1000"],
    fn="levelOrder", argn=["root"], py="level_order", kind="tree",
    examples=[
        ([[3, 9, 20, None, None, 15, 7]], "[[3], [9, 20], [15, 7]]",
         "3 is the root. Its children are 9 and 20. 9 has no children, and 20 has children 15 and 7, which form the third level."),
        ([[1, 2, 3, 4, None, None, 5]], "[[1], [2, 3], [4, 5]]",
         "4 is the left child of 2, and 5 is the right child of 3. They have different parents but sit on the same level, so they are grouped together."),
    ],
    hidden=[
        ([[]], "[]", "empty tree"),
        ([[1, None, 2, None, 3]], "[[1], [2], [3]]", "right-skewed tree; one node per level"),
    ],
    approach=(
        "Breadth-first search with a queue. At the start of each level record the queue's length, pop exactly that many nodes, "
        "collect their values and push their non-null children. O(n) time, O(w) space (w = widest level)."
    ),
    code=(
        "from collections import deque\n"
        "# TreeNode has fields val, left and right\n"
        "def level_order(root):\n"
        "    if not root:\n"
        "        return []\n"
        "    result = []\n"
        "    queue = deque([root])\n"
        "    while queue:\n"
        "        level = []\n"
        "        for _ in range(len(queue)):\n"
        "            node = queue.popleft()\n"
        "            level.append(node.val)\n"
        "            if node.left:\n"
        "                queue.append(node.left)\n"
        "            if node.right:\n"
        "                queue.append(node.right)\n"
        "        result.append(level)\n"
        "    return result"
    ),
    hint="Level by level suggests breadth-first search with a queue. How can you tell where one level ends and the next begins?",
    rubric=[
        "Uses BFS (or DFS carrying a depth index) to group values by level.",
        "Each inner array holds exactly one level, left to right.",
        "Returns [] for an empty tree.",
        "O(n) time.",
    ],
    checkpoints=[
        "Uses a queue for breadth-first traversal",
        "Separates levels (e.g. records the queue size per level)",
        "Adds the left child before the right, skipping null children",
        "Returns [] for an empty tree",
        "O(n) time",
    ],
))

# ---- B12 Validate a Binary Search Tree
Q.append(dict(
    num=410, src="B12", title="Validate a Binary Search Tree",
    topic="Trees · Binary Search Tree · Recursion", difficulty="medium",
    body=(
        "Given the root of a binary tree, return `true` if it is a valid **binary search tree (BST)**, otherwise `false`. "
        "In a valid BST:\n\n"
        "- every value in a node's left subtree is **strictly less** than the node's value;\n"
        "- every value in its right subtree is **strictly greater**;\n"
        "- both subtrees are also valid BSTs.\n\n" + TREE_NOTE
    ),
    constraints=["1 ≤ number of nodes ≤ 10^4", "-2^31 ≤ node value ≤ 2^31 − 1"],
    fn="isValidBST", argn=["root"], py="is_valid_bst", kind="tree",
    examples=[
        ([[2, 1, 3]], "true", "1 is less than 2 and sits on the left; 3 is greater than 2 and sits on the right."),
        ([[5, 1, 4, None, None, 3, 6]], "false",
         "4 is the root's right child but is less than 5. Every node in the right subtree must be greater than 5, so the tree is invalid."),
    ],
    hidden=[
        ([[5, 4, 6, None, None, 3, 7]], "false", "3 is a valid left child of 6 but is less than the root 5; checking only parent/child misses it"),
        ([[2, 2, 2]], "false", "equal values are not allowed; comparisons must be strict"),
    ],
    approach=(
        "Recurse with an allowed open range (low, high): going left narrows high to the node's value, going right narrows low. "
        "Use ±infinity (or null) as the initial bounds so values at the 32-bit limits work. O(n) time, O(h) stack. "
        "An in-order traversal that checks values are strictly increasing is equally valid."
    ),
    code=(
        "# TreeNode has fields val, left and right\n"
        "def is_valid_bst(root):\n"
        "    def check(node, low, high):\n"
        "        if not node:\n"
        "            return True\n"
        "        if not (low < node.val < high):\n"
        "            return False\n"
        "        return check(node.left, low, node.val) and check(node.right, node.val, high)\n"
        "    return check(root, float('-inf'), float('inf'))"
    ),
    hint="Comparing each node only with its direct children isn't enough. Given all of a node's ancestors, what range of values is it allowed to have?",
    rubric=[
        "Enforces the BST property against all ancestors (range bounds or in-order check), not just direct children.",
        "Uses strict comparisons, so equal values make the tree invalid.",
        "Handles values at the 32-bit limits (does not use ±2^31 as sentinel bounds that a real value can equal).",
        "O(n) time.",
    ],
    checkpoints=[
        "Recognises a node must satisfy bounds from all its ancestors",
        "Passes (low, high) bounds down, or checks the in-order sequence is strictly increasing",
        "Uses strict < and > (rejects equal values)",
        "Returns the correct true/false for the examples",
        "O(n) time",
    ],
    buggy=[(
        # only checks each node against its direct children
        "def is_valid_bst(root):\n"
        "    if not root: return True\n"
        "    if root.left and root.left.val >= root.val: return False\n"
        "    if root.right and root.right.val <= root.val: return False\n"
        "    return is_valid_bst(root.left) and is_valid_bst(root.right)",
        "is_valid_bst", [[5, 4, 6, None, None, 3, 7]])],
    extra=[([[2147483647]], "true"), ([[-2147483648, None, 2147483647]], "true")],
))

# ---- B13 House Robber
Q.append(dict(
    num=411, src="B13", title="House Robber",
    topic="Arrays · Dynamic Programming", difficulty="medium",
    body=(
        "You are given an array `nums` where `nums[i]` is the amount of money in the `i`-th house on a street. You may take money "
        "from any set of houses, but you **cannot take from two adjacent houses**.\n\n"
        "Return the maximum amount of money you can collect."
    ),
    constraints=["1 ≤ length(nums) ≤ 100", "0 ≤ nums[i] ≤ 400"],
    fn="rob", argn=["nums"], py="rob",
    examples=[
        ([[2, 7, 9, 3, 1]], "12",
         "Take houses 0, 2 and 4 for 2 + 9 + 1 = 12. Taking house 1 (7) instead rules out houses 0 and 2 (including the 9), and the best that leaves is 7 + 3 = 10."),
        ([[2, 1, 1, 2]], "4",
         "Take houses 0 and 3 for 2 + 2 = 4. Simply taking every other house (indices 0 and 2, or 1 and 3) gives only 3."),
    ],
    hidden=[
        ([[5]], "5", "single house"),
        ([[1, 3, 1, 3, 100]], "103", "the best plan (3 + 100) skips two houses in a row"),
    ],
    approach=(
        "Dynamic programming: best(i) = max(best(i − 1), nums[i] + best(i − 2)) — skip house i or take it. Only the last two values "
        "are needed, so O(n) time and O(1) space."
    ),
    code=(
        "def rob(nums):\n"
        "    prev2, prev1 = 0, 0\n"
        "    for x in nums:\n"
        "        prev2, prev1 = prev1, max(prev1, prev2 + x)\n"
        "    return prev1"
    ),
    hint="At each house you have two choices: skip it or take it. What does each choice leave you with from the houses before it?",
    rubric=[
        "Uses the recurrence best(i) = max(best(i − 1), nums[i] + best(i − 2)) or an equivalent DP.",
        "Does not assume that taking alternate houses (all even or all odd indices) is optimal.",
        "Handles a single house.",
        "O(n) time; O(1) space is a bonus.",
    ],
    checkpoints=[
        "Identifies the take/skip choice at each house",
        "Correct DP recurrence with proper base cases",
        "Rejects the simple even/odd alternation idea",
        "Handles a single house",
        "O(n) time",
    ],
    buggy=[(
        "def rob(nums):\n"
        "    return max(sum(nums[0::2]), sum(nums[1::2]))",
        "rob", [[2, 1, 1, 2]])],
))

# ---- B14 All Subsets
Q.append(dict(
    num=412, src="B14", title="All Subsets",
    topic="Arrays · Backtracking · Bit Manipulation", difficulty="medium",
    body=(
        "Given an integer array `nums` of **distinct** elements, return all possible subsets (the power set), including the empty set.\n\n"
        "The result must not contain duplicate subsets. Subsets, and the values inside each subset, may be returned in any order."
    ),
    constraints=["1 ≤ length(nums) ≤ 10", "-10 ≤ nums[i] ≤ 10", "All values in `nums` are distinct."],
    fn="subsets", argn=["nums"], py="subsets", canon=canon_subsets,
    order_note="any order of subsets and of values inside a subset",
    examples=[
        ([[1, 2, 3]], "[[], [1], [2], [1, 2], [3], [1, 3], [2, 3], [1, 2, 3]]",
         "Each of the 3 elements is either in or out of a subset, giving 2^3 = 8 subsets, from the empty set up to the full array."),
        ([[0]], "[[], [0]]", "With one element there are 2^1 = 2 subsets: the empty set and [0]."),
    ],
    hidden=[
        ([[5, -1]], "[[], [5], [-1], [5, -1]]", "negative value; includes both the empty set and the full array"),
        ([[1, 2, 3, 4]],
         "[[], [1], [2], [1, 2], [3], [1, 3], [2, 3], [1, 2, 3], [4], [1, 4], [2, 4], [1, 2, 4], [3, 4], [1, 3, 4], [2, 3, 4], [1, 2, 3, 4]]",
         "exactly 2^4 = 16 distinct subsets"),
    ],
    approach=(
        "Iterative build-up: start with [[]]; for each number, copy every existing subset and append the number to the copy. "
        "Backtracking (include/exclude each index) or bitmasks 0 … 2^n − 1 are equally valid. O(n·2^n) time, which is the size of the output."
    ),
    code=(
        "def subsets(nums):\n"
        "    result = [[]]\n"
        "    for x in nums:\n"
        "        result += [s + [x] for s in result]\n"
        "    return result"
    ),
    hint="Each element is either in a subset or not. Could you build the answer by taking every subset you already have and making a copy that also includes the next element?",
    rubric=[
        "Produces all 2^n subsets, including [] and the full array.",
        "Contains no duplicate subsets.",
        "Uses iterative build-up, backtracking or bitmasks correctly, copying subsets rather than sharing one mutable array.",
        "O(n·2^n) time.",
    ],
    checkpoints=[
        "Includes the empty subset",
        "Generates exactly 2^n subsets",
        "No duplicate subsets",
        "Copies subsets correctly (no shared mutable state bug)",
        "O(n·2^n) time",
    ],
))

# ---- B15 Sort Colors
Q.append(dict(
    num=413, src="B15", title="Sort Colors",
    topic="Arrays · Two Pointers · In-Place", difficulty="medium",
    body=(
        "Given an array `nums` of `n` objects coloured red, white or blue, written as `0`, `1` and `2`, sort them **in place** so "
        "that objects of the same colour are adjacent, in the order red, white, blue (all 0s, then all 1s, then all 2s).\n\n"
        "You must not use a built-in sort function. Aim for a **single pass** with O(1) extra space. The output shown in the "
        "examples is the array after your function has modified it."
    ),
    constraints=["1 ≤ n ≤ 300", "`nums[i]` is `0`, `1` or `2`."],
    fn="sortColors", argn=["nums"], py="sort_colors", kind="in_place",
    examples=[
        ([[2, 0, 2, 1, 1, 0]], "[0, 0, 1, 1, 2, 2]",
         "The two 0s move to the front, the two 1s to the middle and the two 2s to the end."),
        ([[2, 0, 1]], "[0, 1, 2]", "Each colour appears once, so the result is simply 0, 1, 2."),
    ],
    hidden=[
        ([[1, 2, 0]], "[0, 1, 2]", "the 0 swapped in from the end must be re-checked; mid must not advance after swapping a 2"),
        ([[1]], "[1]", "single element"),
    ],
    approach=(
        "Dutch National Flag: pointers low, mid and high; everything before low is 0 and everything after high is 2. "
        "If nums[mid] is 0, swap with nums[low] and advance both; if 1, advance mid; if 2, swap with nums[high] and decrement "
        "high only (the swapped-in value is still unchecked). One pass, O(n) time, O(1) space. A two-pass counting rewrite earns most credit."
    ),
    code=(
        "def sort_colors(nums):\n"
        "    low, mid, high = 0, 0, len(nums) - 1\n"
        "    while mid <= high:\n"
        "        if nums[mid] == 0:\n"
        "            nums[low], nums[mid] = nums[mid], nums[low]\n"
        "            low += 1\n"
        "            mid += 1\n"
        "        elif nums[mid] == 1:\n"
        "            mid += 1\n"
        "        else:\n"
        "            nums[mid], nums[high] = nums[high], nums[mid]\n"
        "            high -= 1"
    ),
    hint="Try keeping three regions: 0s at the front, 2s at the back, and an unchecked middle. What should each pointer do when you meet each colour?",
    rubric=[
        "Produces all 0s, then 1s, then 2s, modifying the array in place.",
        "Does not use a built-in sort.",
        "Single-pass Dutch National Flag for full credit; a two-pass counting rewrite earns most of the credit.",
        "Does not advance mid after swapping with high.",
    ],
    checkpoints=[
        "Maintains low, mid and high pointers (three regions)",
        "Swaps 0s to the front and 2s to the back",
        "Does not advance mid after a swap with high",
        "Works in place with O(1) extra space",
        "Single pass, O(n)",
    ],
    buggy=[(
        # advances mid after swapping with high
        "def sort_colors(nums):\n"
        "    low, mid, high = 0, 0, len(nums) - 1\n"
        "    while mid <= high:\n"
        "        if nums[mid] == 0:\n"
        "            nums[low], nums[mid] = nums[mid], nums[low]; low += 1; mid += 1\n"
        "        elif nums[mid] == 1:\n"
        "            mid += 1\n"
        "        else:\n"
        "            nums[mid], nums[high] = nums[high], nums[mid]; high -= 1; mid += 1",
        "sort_colors", [[1, 2, 0]])],
))

SKIPPED = [
    ("B1 Group Anagrams", "qb-dsa-r12 Group Anagrams"),
    ("B6 Maximum Subarray Sum", "qb-dsa-r10 Maximum Subarray Sum"),
]


# ---------------------------------------------------------------- runners
def make_runner(q, fn):
    kind = q.get("kind")

    def run(args):
        args = json.loads(json.dumps(args))  # deep copy so tests never share state
        if kind == "linked_list":
            head, n = args
            return list_to_array(fn(build_list(head), n))
        if kind == "tree":
            return fn(build_tree(args[0]))
        if kind == "in_place":
            arr = args[0]
            ret = fn(arr)
            assert ret is None or ret is arr
            return arr
        return fn(*args)
    return run


def call_str(q, args):
    return f"{q['fn']}(" + ", ".join(fmt(a) for a in args) + ")"


def input_str(q, args):
    return ", ".join(f"{n} = {fmt(a)}" for n, a in zip(q["argn"], args))


# ---------------------------------------------------------------- brute-force cross-checks
def brute(name):
    import itertools
    if name == "max_area":
        return lambda h: max((j - i) * min(h[i], h[j]) for i in range(len(h)) for j in range(i + 1, len(h)))
    if name == "search_rotated":
        return lambda a, t: a.index(t) if t in a else -1
    if name == "longest_consecutive":
        def f(a):
            s = sorted(set(a)); best = cur = 0; prev = None
            for x in s:
                cur = cur + 1 if prev is not None and x == prev + 1 else 1
                best = max(best, cur); prev = x
            return best
        return f
    if name == "three_sum":
        return lambda a: [list(t) for t in sorted({tuple(sorted(c)) for c in itertools.combinations(a, 3) if sum(c) == 0})]
    if name == "kth_largest":
        return lambda a, k: sorted(a, reverse=True)[k - 1]
    if name == "rob":
        def f(a):
            best = 0
            for mask in range(1 << len(a)):
                if mask & (mask >> 1): continue
                best = max(best, sum(a[i] for i in range(len(a)) if mask >> i & 1))
            return best
        return f
    if name == "subsets":
        return lambda a: [[a[i] for i in range(len(a)) if m >> i & 1] for m in range(1 << len(a))]
    if name == "sort_colors":
        return lambda a: sorted(a)
    return None


def random_cases(name, rng):
    for _ in range(300):
        if name == "max_area":
            yield [[rng.randint(0, 20) for _ in range(rng.randint(2, 12))]]
        elif name == "search_rotated":
            a = sorted(rng.sample(range(-30, 30), rng.randint(1, 10)))
            r = rng.randint(0, len(a) - 1); a = a[r:] + a[:r]
            yield [a, rng.randint(-32, 32)]
        elif name == "longest_consecutive":
            yield [[rng.randint(-8, 8) for _ in range(rng.randint(0, 12))]]
        elif name == "three_sum":
            yield [[rng.randint(-5, 5) for _ in range(rng.randint(3, 9))]]
        elif name == "kth_largest":
            a = [rng.randint(-5, 5) for _ in range(rng.randint(1, 10))]
            yield [a, rng.randint(1, len(a))]
        elif name == "rob":
            yield [[rng.randint(0, 20) for _ in range(rng.randint(1, 12))]]
        elif name == "subsets":
            yield [rng.sample(range(-10, 11), rng.randint(1, 6))]
        elif name == "sort_colors":
            yield [[rng.randint(0, 2) for _ in range(rng.randint(1, 12))]]
        elif name == "remove_nth_from_end":
            a = [rng.randint(0, 100) for _ in range(rng.randint(1, 8))]
            yield [a, rng.randint(1, len(a))]


# ---------------------------------------------------------------- verify + build
def main():
    rng = random.Random(401)
    out = []
    n_checks = 0
    # the tree-format example given in TREE_NOTE must mean what it says
    t = build_tree([1, 2, 3, None, 4])
    assert (t.val, t.left.val, t.right.val, t.left.left, t.left.right.val) == (1, 2, 3, None, 4)
    assert list_to_array(build_list([1, 2, 3])) == [1, 2, 3]
    n_checks += 2
    ids = set()
    for q in Q:
        qid = f"qb-dsa-d{q['num']}"
        assert 401 <= q["num"] <= 499 and qid not in ids
        ids.add(qid)
        fn = load(q["code"], q["py"])
        run = make_runner(q, fn)
        canon = q.get("canon", ident)

        def check(args, disp, label):
            nonlocal n_checks
            exp = json.loads(disp)
            assert fmt(exp) == disp, f"{qid} {label}: display not canonical: {disp!r} vs {fmt(exp)!r}"
            got = run(args)
            assert canon(got) == canon(exp), f"{qid} {label}: got {fmt(got)} expected {disp}"
            n_checks += 1

        for i, (args, disp, _) in enumerate(q["examples"], 1):
            check(args, disp, f"example {i}")
        for i, (args, disp, _) in enumerate(q["hidden"], 1):
            check(args, disp, f"hidden {i}")
        for i, (args, disp) in enumerate(q.get("extra", []), 1):
            check(args, disp, f"extra {i}")
        # the "why it matters" claims: a typical buggy version must fail the named case
        for bcode, bname, bargs in q.get("buggy", []):
            bfn = make_runner(q, load(bcode, bname))
            exp = next(json.loads(d) for a, d, *_ in q["examples"] + q["hidden"] if a == bargs)
            try:
                bgot = bfn(bargs)
            except Exception:
                bgot = "<error>"
            assert bgot == "<error>" or canon(bgot) != canon(exp), f"{qid}: buggy variant unexpectedly passes {bargs}"
            n_checks += 1
        # random cross-check against brute force
        bf = brute(q["py"])
        if bf or q["py"] == "remove_nth_from_end":
            for args in random_cases(q["py"], rng):
                got = run(args)
                if q["py"] == "remove_nth_from_end":
                    h, n = args; want = h[:len(h) - n] + h[len(h) - n + 1:]
                else:
                    want = bf(*json.loads(json.dumps(args)))
                assert canon(got) == canon(want), f"{qid} random {args}: {got} != {want}"
                n_checks += 1

        # ---- assemble the question object
        diff_word = q["difficulty"].capitalize()
        assert q["difficulty"] in ("easy", "medium", "hard")
        prompt = (f"## {q['title']}\n> {q['topic']} · {diff_word}\n\n{q['body']}\n\n### Constraints\n"
                  + "\n".join(f"- {c}" for c in q["constraints"]))
        sample = "\n\n".join(
            f"**Example {i}**\nInput: {input_str(q, a)}\nOutput: {d}\nExplanation: {e}"
            for i, (a, d, e) in enumerate(q["examples"], 1))
        note = f"  ({q['order_note']})" if q.get("order_note") else ""
        eo = [f"Example {i} → {d}{note}" for i, (a, d, _) in enumerate(q["examples"], 1)]
        eo += [f"Hidden test {i} → {call_str(q, a)} = {d}  ({w})" for i, (a, d, w) in enumerate(q["hidden"], 1)]
        obj = {
            "id": qid,
            "category": "dsa",
            "difficulty": q["difficulty"],
            "marks": 5,
            "title": q["title"],
            "topic": q["topic"],
            "prompt": prompt,
            "sample_data": sample,
            "expected_output": "\n".join(eo),
            "reference_answer": q["approach"] + "\n\n" + q["code"],
            "hint": q["hint"],
            "rubric": "\n".join(f"- {r}" for r in q["rubric"]),
            "checkpoints": "\n".join(q["checkpoints"]),
            "source": f"docx: 30 Problems Part B · {q['src']}",
        }
        # ---- structural / wording checks from SPEC
        assert 2 <= len(q["examples"]) <= 3 and len(q["hidden"]) == 2
        assert 3 <= len(q["rubric"]) <= 5 and 4 <= len(q["checkpoints"]) <= 6
        assert 1 <= len(q["topic"].split(" · ")) <= 3
        assert q["title"] == q["title"].strip() and not q["title"].lower().startswith("q")
        for field in ("prompt", "sample_data", "hint"):
            text = obj[field]
            low = text.lower()
            for bad in ("python", "def ", "print(", " dict", "none"):
                assert bad not in low, f"{qid} {field}: forbidden '{bad}'"
            for bad in ("True", "False", " list ", " lists ", "list.", "list,"):
                if bad in (" list ", " lists ", "list.", "list,") and q.get("kind") == "linked_list":
                    continue  # "linked list" is the data structure's name, not a language type
                assert bad not in text, f"{qid} {field}: forbidden '{bad}'"
        assert "Example" not in prompt, f"{qid}: examples must not be in prompt"
        out.append(obj)

    assert len({o["title"] for o in out}) == len(out)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"OK: {len(out)} questions written to {os.path.relpath(OUT)} "
          f"({n_checks} assertions passed; skipped {len(SKIPPED)} duplicates: "
          + ", ".join(f"{a} = {b}" for a, b in SKIPPED) + ")")


if __name__ == "__main__":
    main()
