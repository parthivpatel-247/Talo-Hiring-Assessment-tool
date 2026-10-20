#!/usr/bin/env python3
"""Build + verify Talo bank questions imported from the docx (slice A).

Slice: source.txt lines 1-441 (Question 1..9), 1659-2166 (Section A1/A2 Q1-Q10),
2167-2942 (Part A: Arrays Q1-Q10). Duplicates of the existing bank are skipped
(see SKIPPED below).

Every example and hidden test is executed against the Python reference solution
that is embedded in `reference_answer` (the exact code shown to admins), and the
result is compared with the value written in this file. part_a.json is written
only if every assertion passes.
"""
import copy
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "part_a.json")
REF = os.path.join(HERE, "existing-bank-reference.json")

KEYS = ["id", "category", "difficulty", "marks", "title", "topic", "prompt",
        "sample_data", "expected_output", "reference_answer", "hint", "rubric",
        "checkpoints", "source"]

SKIPPED = [
    ("Questions 1-9 · Question 1 Move Zeroes", "qb-dsa-r04 Move Zeroes to the End"),
    ("Questions 1-9 · Question 2 Longest Substring Without Repeating Characters", "qb-dsa-r07"),
    ("Questions 1-9 · Question 3 Product of Array Except Self", "qb-dsa-r09"),
    ("Questions 1-9 · Question 4 Group Anagrams", "qb-dsa-r12"),
    ("Questions 1-9 · Question 5 Duplicate API Requests", "qb-scn-r06"),
    ("Questions 1-9 · Question 6 Log Analysis — Most Frequent Log Level", "qb-scn-r04 Top K Words in a Review"),
    ("Questions 1-9 · Question 8 Suspicious Transactions", "qb-scn-r05"),
    ("Section A1 · Q1 Best Day to Buy and Sell", "qb-scn-r01 Best Time to Buy and Sell Stock"),
    ("Section A1 · Q3 Rotate the Playlist", "qb-dsa-r11 Rotate an Array"),
    ("Section A1 · Q5 Duplicate Phone Numbers", "qb-scn-r06 Duplicate API Requests"),
    ("Section A2 · Q7 Is the Message a Palindrome?", "qb-dsa-r02 Valid Palindrome"),
    ("Section A2 · Q9 Compress the Text Message", "qb-scn-r03 SMS Message Compression"),
    ("Section A2 · Q10 Most Frequent Word in Customer Reviews", "qb-scn-r04 Top K Words in a Review"),
    ("Part A Arrays · Q6 Second largest without sorting", "qb-dsa-r01 Second Largest Element"),
    ("Part A Arrays · Q7 Rotate left by k (reversal)", "qb-dsa-r11 Rotate an Array"),
    ("Part A Arrays · Q8 Move all zeros to the end", "qb-dsa-r04 Move Zeroes to the End"),
    ("Part A Arrays · Q10 Kadane maximum subarray", "qb-dsa-r10 Maximum Subarray Sum"),
]


# ---------------------------------------------------------------- formatting
def neutral(v):
    """Language-neutral display: true/false/null, [a, b], "str"."""
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(neutral(x) for x in v) + "]"
    return repr(v)


def labelled(a, b):
    return lambda v: f"{a} = {neutral(v[0])}, {b} = {neutral(v[1])}"


Q = []


def add(**kw):
    Q.append(kw)


# ================================================================ questions
add(
    num=101, category="scenario", difficulty="easy",
    title="Username Autocomplete",
    topic="Scenario · Strings · Prefix Matching",
    source="docx: Questions 1–9 · Question 7 (User Search / Autocomplete)",
    body=(
        "A web application stores usernames in an array and offers a search box. Given an array "
        "`users` and a search string `prefix`, return every username that **starts with** `prefix` "
        "— the match must begin at the first character of the username. Matching is case-sensitive.\n\n"
        "Return all matching usernames in their original order, or an empty array if none match."
    ),
    constraints=[
        "0 ≤ len(users) ≤ 10^4",
        "0 ≤ len(prefix) ≤ 100",
        "Usernames and `prefix` are strings; an empty `prefix` matches every username.",
    ],
    names=["users", "prefix"], call="autocomplete", fn="autocomplete",
    code='''def autocomplete(users, prefix):
    m = len(prefix)
    return [u for u in users if len(u) >= m and u[:m] == prefix]''',
    approach=("Scan the usernames once and keep each one whose first len(prefix) characters equal "
              "`prefix` (a username shorter than the prefix can never match). O(n·m) time, where m is "
              "the prefix length."),
    examples=[
        ((["ashish", "ashwin", "amit", "ankit", "arjun"], "ash"), ["ashish", "ashwin"],
         "Only \"ashish\" and \"ashwin\" begin with \"ash\"."),
        ((["alice", "bob", "anna", "alex"], "al"), ["alice", "alex"],
         "\"alice\" and \"alex\" start with \"al\" and keep their original relative order."),
        ((["sam", "Sammy", "samir"], "sam"), ["sam", "samir"],
         "A username equal to the prefix matches. \"Sammy\" does not, because matching is case-sensitive."),
    ],
    hidden=[
        ((["bash", "ashok", "cash"], "ash"), ["ashok"],
         "\"bash\" and \"cash\" contain \"ash\" but do not start with it"),
        ((["amy", "bob"], ""), ["amy", "bob"], "an empty prefix matches every username"),
    ],
    extra=[  # extra asserted edge cases (not shown)
        ((["as"], "ash"), []),
        (([], "a"), []),
    ],
    hint=("For each username, compare only its first few characters with the prefix. Watch out for "
          "usernames that are shorter than the prefix."),
    rubric=[
        "Matches only at the START of the username (\"bash\" does not match \"ash\").",
        "Returns ALL matches, not just the first, in their original order.",
        "Returns an empty array when nothing matches and handles usernames shorter than the prefix without error.",
        "Case-sensitive comparison; O(n·m) overall.",
    ],
    checkpoints=[
        "Checks every username against the prefix",
        "Compares from the first character only (prefix, not substring)",
        "Collects every match in original order",
        "Handles a username shorter than the prefix safely",
        "Returns an empty array when nothing matches",
    ],
)

add(
    num=102, category="scenario", difficulty="easy",
    title="Message Deduplication",
    topic="Scenario · Arrays · Strings",
    source="docx: Questions 1–9 · Question 9 (Message Deduplication)",
    body=(
        "A messaging system receives a sequence of messages. Because of retries, the same message can "
        "arrive several times **in a row**. Given an array `messages`, collapse every uninterrupted run "
        "of identical messages into a single occurrence and return the result.\n\n"
        "Keep the original order. If a message appears again after a different message, that later "
        "occurrence is kept."
    ),
    constraints=[
        "0 ≤ len(messages) ≤ 10^5",
        "Messages are strings and are compared exactly (case-sensitive).",
    ],
    names=["messages"], call="dedupe", fn="dedupe",
    code='''def dedupe(messages):
    out = []
    for i, m in enumerate(messages):
        if i == 0 or m != messages[i - 1]:
            out.append(m)
    return out''',
    approach=("Keep a message only when it differs from the message immediately before it in the input "
              "(the first message is always kept). One pass, O(n) time."),
    examples=[
        ((["A", "A", "B", "B", "B", "A", "A"],), ["A", "B", "A"],
         "The first two \"A\"s become one, the three \"B\"s become one, and the last two \"A\"s become one. "
         "That final \"A\" stays because it follows a \"B\"."),
        ((["LOGIN", "LOGIN", "LOGOUT", "LOGIN"],), ["LOGIN", "LOGOUT", "LOGIN"],
         "The two leading \"LOGIN\"s collapse to one. The last \"LOGIN\" is kept because \"LOGOUT\" separates it from the first run."),
    ],
    hidden=[
        (([],), [], "empty input returns an empty array"),
        ((["A", "B", "A", "B"],), ["A", "B", "A", "B"],
         "no consecutive repeats, so nothing is removed — a global 'seen' set would wrongly return [\"A\", \"B\"]"),
    ],
    extra=[((["X", "X", "X"],), ["X"]), ((["Q"],), ["Q"])],
    hint=("You only need to compare each message with the one right before it. There is no need to "
          "remember every message seen so far."),
    rubric=[
        "Collapses only CONSECUTIVE duplicates and keeps a repeat that follows a different message.",
        "Preserves the original order.",
        "Handles an empty input and a single-message input.",
        "O(n) single pass; a global 'seen' set is incorrect (it drops non-consecutive repeats).",
    ],
    checkpoints=[
        "Compares each message with the immediately preceding one",
        "Always keeps the first message",
        "Keeps non-consecutive repeats (no global seen set)",
        "Preserves the original order",
        "Handles an empty input",
        "O(n) approach",
    ],
)

add(
    num=103, category="scenario", difficulty="easy",
    title="Missing Roll Number",
    topic="Scenario · Arrays · Math",
    source="docx: Section A1 Arrays and Basic Problem Solving · Q2",
    body=(
        "A class has `n` students with unique roll numbers from `1` to `n`. The teacher recorded exactly "
        "`n − 1` of them in an array `rolls`. Every recorded number is valid and appears only once, so "
        "exactly one roll number is missing. Return the missing roll number.\n\n"
        "The missing number may be `1`, `n`, or any number in between, and `rolls` is **not** necessarily sorted."
    ),
    constraints=[
        "2 ≤ n ≤ 10^5",
        "len(rolls) = n − 1",
        "1 ≤ rolls[i] ≤ n, and all recorded numbers are distinct.",
    ],
    names=["n", "rolls"], call="missingRoll", fn="missing_roll",
    code='''def missing_roll(n, rolls):
    return n * (n + 1) // 2 - sum(rolls)''',
    approach=("The full set 1..n sums to n(n+1)/2, so the missing number is that total minus the sum of "
              "`rolls`. O(n) time, O(1) space. Use a 64-bit integer (n(n+1)/2 is about 5×10^9 for "
              "n = 10^5) or XOR 1..n with every recorded value to avoid overflow."),
    examples=[
        ((6, [1, 2, 4, 5, 6]), 3, "The complete set is 1 to 6; the number 3 is missing."),
        ((5, [2, 5, 1, 3]), 4, "The input is unsorted. 1 + 2 + 3 + 4 + 5 = 15 and the recorded total is 11, so 4 is missing."),
    ],
    hidden=[
        ((4, [1, 2, 3]), 4, "the missing number is n itself"),
        ((2, [2]), 1, "smallest class; the missing number is 1"),
    ],
    extra=[((100000, list(range(1, 100000))), 100000)],
    hint=("You know exactly which numbers should be present. Is there a single quantity you can compute "
          "for the full set 1..n and compare with what was recorded?"),
    rubric=[
        "Returns the single missing number, including when it is 1 or n.",
        "Does not assume the input is sorted.",
        "Full credit for O(n) time and O(1) space (sum formula or XOR); sorting or a 'present' array also earns credit.",
        "Avoids 32-bit overflow of the sum for large n (64-bit integer or XOR).",
    ],
    checkpoints=[
        "Uses the expected total n(n+1)/2 (or XOR / a presence array)",
        "Subtracts the recorded values correctly",
        "Handles the missing number being 1 or n",
        "Does not rely on sorted input",
        "Addresses overflow for large n",
        "O(n) approach",
    ],
)

add(
    num=104, category="scenario", difficulty="medium",
    title="Best Sales Window",
    topic="Scenario · Arrays · Sliding Window",
    source="docx: Section A1 Arrays and Basic Problem Solving · Q4",
    body=(
        "A shop owner records daily sales for `n` consecutive days in an array `sales`. Given an integer "
        "`k`, return the **maximum total** sales over any `k` consecutive days.\n\n"
        "A window must be exactly `k` adjacent days — you may not skip days or use fewer or more than "
        "`k` days. If several windows share the maximum, return just the sum."
    ),
    constraints=[
        "1 ≤ k ≤ len(sales) ≤ 10^5",
        "0 ≤ sales[i] ≤ 10^4",
    ],
    names=["sales", "k"], call="maxWindow", fn="max_window",
    code='''def max_window(sales, k):
    s = sum(sales[:k]); best = s
    for i in range(k, len(sales)):
        s += sales[i] - sales[i - k]
        best = max(best, s)
    return best''',
    approach=("Sliding window: sum the first k days, then for each later day add it and subtract the day "
              "that leaves the window, tracking the maximum. O(n) time, O(1) space."),
    examples=[
        (([2, 1, 5, 1, 3, 2], 3), 9,
         "The three-day sums are 8 (days 1–3), 7 (days 2–4), 9 (days 3–5) and 6 (days 4–6). The maximum is 9."),
        (([4, 2, 1, 7, 8, 1, 2, 8, 1, 0], 3), 16,
         "Days 3–5 (1 + 7 + 8) and days 4–6 (7 + 8 + 1) both total 16, so the answer is 16."),
    ],
    hidden=[
        (([5, 1, 3], 3), 9, "k = n: the whole array is the only window"),
        (([1, 1, 1, 5, 6], 2), 11, "the best window is the last one — catches an off-by-one that skips it"),
    ],
    extra=[(([3, 9, 2, 9], 1), 9)],
    hint=("When the window moves one day to the right, only two days change. Can you update the total "
          "without re-adding all k values?"),
    rubric=[
        "Considers every window of exactly k consecutive days, including the last one.",
        "Returns the maximum sum (not the window's position).",
        "Handles k = n (single window) and k = 1.",
        "O(n) sliding window for full credit; recomputing each window in O(n·k) earns partial credit.",
    ],
    checkpoints=[
        "Computes the first window's sum",
        "Slides by adding the new day and removing the day that left",
        "Tracks the running maximum",
        "Includes the final window (no off-by-one)",
        "Handles k = n",
        "O(n) approach",
    ],
)

add(
    num=105, category="scenario", difficulty="easy",
    title="Password Strength Checker",
    topic="Scenario · Strings",
    source="docx: Section A2 Strings · Q6",
    body=(
        "A website accepts only strong passwords. Given a string `password` with no spaces, return "
        "`\"Valid\"` if it meets **all five** rules below, otherwise return `\"Invalid\"`:\n\n"
        "1. at least 8 characters;\n"
        "2. at least one uppercase English letter (`A`–`Z`);\n"
        "3. at least one lowercase English letter (`a`–`z`);\n"
        "4. at least one digit (`0`–`9`);\n"
        "5. at least one special character from exactly this set: `@ # $ % & *`.\n\n"
        "Other symbols such as `!`, `_` or `-` do not satisfy the special-character rule."
    ),
    constraints=[
        "1 ≤ len(password) ≤ 100",
        "`password` contains no spaces.",
    ],
    names=["password"], call="checkPassword", fn="check_password",
    code='''def check_password(pw):
    upper = any('A' <= c <= 'Z' for c in pw)
    lower = any('a' <= c <= 'z' for c in pw)
    digit = any('0' <= c <= '9' for c in pw)
    special = any(c in '@#$%&*' for c in pw)
    ok = len(pw) >= 8 and upper and lower and digit and special
    return "Valid" if ok else "Invalid"''',
    approach=("Check the length, then scan the characters once setting four flags (uppercase, lowercase, "
              "digit, special from the allowed set); the password is valid only if all hold. O(n)."),
    examples=[
        (("Hello@123",), "Valid",
         "9 characters, uppercase H, lowercase letters, digits, and the permitted special character @."),
        (("hello123",), "Invalid",
         "There is no uppercase letter and no permitted special character."),
        (("Hello!123",), "Invalid",
         "Every rule is met except the special character: ! is not in the permitted set."),
    ],
    hidden=[
        (("Ab1@efgh",), "Valid", "exactly 8 characters — the length boundary is allowed"),
        (("Ab1@efg",), "Invalid", "7 characters; every other rule is met"),
    ],
    extra=[(("ABCDEFG1@",), "Invalid"), (("abcdefg1@",), "Invalid"), (("Abcdefgh@",), "Invalid"),
           (("Abcdefg1_",), "Invalid"), (("Zz9*Zz9*",), "Valid")],
    hint=("Scan the password once and keep a yes/no flag for each character rule. Check the length "
          "separately and combine everything at the end."),
    rubric=[
        "Checks all five rules, with length ≥ 8 (exactly 8 is allowed).",
        "Accepts only @ # $ % & * as special characters (rejects !, _, -).",
        "Requires every rule together (AND, not OR).",
        "Returns exactly \"Valid\" or \"Invalid\"; O(n) time.",
    ],
    checkpoints=[
        "Length check uses ≥ 8",
        "Detects uppercase, lowercase and digit characters",
        "Restricts special characters to the given set",
        "Combines all rules with AND",
        "Returns the exact strings Valid / Invalid",
    ],
)

add(
    num=106, category="dsa", difficulty="easy",
    title="Anagram Check",
    topic="Strings · Hash Map",
    source="docx: Section A2 Strings · Q8 (Anagram Check for a Word Game)",
    body=(
        "Two words are **anagrams** if they contain exactly the same letters with exactly the same "
        "frequencies, possibly in a different order. Given two words `a` and `b`, return `true` if `b` "
        "can be formed by rearranging all the letters of `a`, otherwise return `false`.\n\n"
        "Ignore uppercase/lowercase differences. Every letter must be used exactly once — no letters may "
        "be added or removed."
    ),
    constraints=[
        "1 ≤ len(a), len(b) ≤ 10^5",
        "Both words contain English letters only.",
    ],
    names=["a", "b"], call="isAnagram", fn="is_anagram",
    code='''def is_anagram(a, b):
    a, b = a.lower(), b.lower()
    if len(a) != len(b):
        return False
    cnt = {}
    for c in a:
        cnt[c] = cnt.get(c, 0) + 1
    for c in b:
        if cnt.get(c, 0) == 0:
            return False
        cnt[c] -= 1
    return True''',
    approach=("Lowercase both words; if the lengths differ they cannot be anagrams. Otherwise count each "
              "letter of `a` and consume the counts with `b` (a 26-slot array or a map). O(n) time. "
              "Sorting both words and comparing is O(n log n) and also acceptable."),
    examples=[
        (("Listen", "Silent"), True,
         "Ignoring case, both words contain e, i, l, n, s and t exactly once."),
        (("Apple", "Papel"), True, "Both contain a, e, l once and p twice."),
        (("Apple", "Appla"), False,
         "\"Appla\" has two a's and no e, so the letter frequencies differ."),
    ],
    hidden=[
        (("abc", "abcd"), False, "different lengths can never be anagrams"),
        (("aab", "abb"), False, "same set of letters but different counts"),
    ],
    extra=[(("Dormitory", "dirtyroom"), True), (("a", "A"), True), (("ab", "cd"), False)],
    hint=("Normalise the case first. Then think about how many times each letter occurs in each word."),
    rubric=[
        "Compares case-insensitively.",
        "Compares letter FREQUENCIES, not just the set of letters (\"aab\" vs \"abb\" is false).",
        "Handles words of different lengths (false).",
        "O(n) counting for full credit; sorting both words in O(n log n) is acceptable.",
    ],
    checkpoints=[
        "Normalises case before comparing",
        "Checks that the lengths are equal",
        "Counts letter frequencies (or sorts both words)",
        "Compares the counts exactly",
        "Returns true / false correctly",
        "States O(n) or O(n log n) complexity",
    ],
)

add(
    num=107, category="dsa", difficulty="easy",
    title="Largest and Smallest Element",
    topic="Arrays",
    source="docx: Part A Arrays · Q1",
    body=(
        "Given an array `arr` of integers, find both the **largest** and the **smallest** element "
        "**without sorting** the array. Return the two values together (for example as a pair "
        "`largest, smallest`)."
    ),
    constraints=[
        "1 ≤ len(arr) ≤ 10^5",
        "-10^9 ≤ arr[i] ≤ 10^9",
    ],
    names=["arr"], call="minMax", fn="min_max", fmt=labelled("largest", "smallest"),
    code='''def min_max(arr):
    largest = smallest = arr[0]
    for x in arr[1:]:
        if x > largest:
            largest = x
        if x < smallest:
            smallest = x
    return largest, smallest''',
    approach=("Initialise both trackers to arr[0], then update them in a single pass. O(n) time, O(1) "
              "space; no sorting."),
    examples=[
        (([4, 9, 1, 7, 3],), (9, 1), "9 is the greatest value and 1 is the least."),
        (([-5, -2, -9],), (-2, -9), "All values are negative: -2 is the largest and -9 is the smallest."),
        (([7],), (7, 7), "With a single element, it is both the largest and the smallest."),
    ],
    hidden=[
        (([7, 7, 7],), (7, 7), "all elements equal"),
        (([0, -1, 100, -100],), (100, -100), "mixed signs; the extremes are not at the first position"),
    ],
    extra=[(([3, 8, 5],), (8, 3)), (([5, 4, 3],), (5, 3))],
    hint=("Start both trackers from an actual element of the array rather than a fixed number such as 0, "
          "then update them as you go."),
    rubric=[
        "Returns both the largest and the smallest value.",
        "Initialises from arr[0] (or ±infinity), not 0 — 0 breaks all-negative or all-positive arrays.",
        "Does not sort; single O(n) pass.",
        "Handles a single-element array (both values equal).",
    ],
    checkpoints=[
        "Initialises largest and smallest from the array (not 0)",
        "Updates both values in one pass",
        "Handles all-negative input",
        "Handles a single element",
        "Avoids sorting; O(n)",
    ],
)

add(
    num=108, category="dsa", difficulty="easy",
    title="Sum and Average of an Array",
    topic="Arrays",
    source="docx: Part A Arrays · Q2",
    body=(
        "Given an array `arr` of integers, return the **sum** of its elements and their **average** (the "
        "sum divided by the number of elements).\n\n"
        "The average must keep its fractional part — for example, the average of `[1, 2]` is `1.5`, not `1`. "
        "A whole-number average may be written either way (`25` or `25.0`)."
    ),
    constraints=[
        "1 ≤ len(arr) ≤ 10^5",
        "-1000 ≤ arr[i] ≤ 1000",
    ],
    names=["arr"], call="sumAndAverage", fn="sum_and_average", fmt=labelled("sum", "average"),
    code='''def sum_and_average(arr):
    total = 0
    for x in arr:
        total += x
    return total, total / len(arr)''',
    approach=("Accumulate the total in one pass, then divide by the element count using real "
              "(floating-point) division. O(n) time, O(1) space."),
    examples=[
        (([10, 20, 30, 40],), (100, 25.0), "10 + 20 + 30 + 40 = 100 and 100 / 4 = 25.0."),
        (([5],), (5, 5.0), "With one element, the sum is 5 and the average is 5.0."),
        (([1, 2],), (3, 1.5), "The sum is 3 and 3 / 2 = 1.5, so the average can be a decimal."),
    ],
    hidden=[
        (([-1, 1],), (0, 0.0), "negatives cancel out"),
        (([-3, -4],), (-7, -3.5), "negative fraction — integer division would give -4 or -3"),
    ],
    extra=[(([0, 0, 0],), (0, 0.0))],
    hint=("Add the elements in one pass. When you divide, make sure your language does not throw away the "
          "decimal part."),
    rubric=[
        "Computes the correct sum, including negative values.",
        "Average uses real division and keeps the fraction ([1, 2] → 1.5).",
        "Divides by the number of elements.",
        "Returns both values; O(n) single pass.",
    ],
    checkpoints=[
        "Accumulates the sum correctly",
        "Divides by the element count",
        "Uses real (not integer) division",
        "Handles negative values",
        "Returns both the sum and the average",
    ],
)

add(
    num=109, category="dsa", difficulty="easy",
    title="Reverse an Array In Place",
    topic="Arrays · Two Pointers",
    source="docx: Part A Arrays · Q3",
    body=(
        "Given an array `arr`, reverse it **in place** and return it. Use only O(1) extra space: do not "
        "create a second array and do not use a built-in reverse or copy operation. Rearrange the "
        "elements by swapping them."
    ),
    constraints=[
        "0 ≤ len(arr) ≤ 10^5",
        "-10^9 ≤ arr[i] ≤ 10^9",
    ],
    names=["arr"], call="reverseInPlace", fn="reverse_in_place", inplace=True,
    code='''def reverse_in_place(arr):
    left, right = 0, len(arr) - 1
    while left < right:
        arr[left], arr[right] = arr[right], arr[left]
        left += 1
        right -= 1
    return arr''',
    approach=("Two pointers start at both ends; swap the elements and move inward while left < right. "
              "O(n) time, O(1) extra space."),
    examples=[
        (([1, 2, 3, 4, 5],), [5, 4, 3, 2, 1],
         "The first and last elements swap, then the second and second-last. The middle element 3 stays."),
        (([1, 2, 3, 4],), [4, 3, 2, 1], "For an even length, 1 and 4 swap, then 2 and 3 swap."),
        (([7],), [7], "A single element stays as it is."),
    ],
    hidden=[
        (([],), [], "empty array — the loop must not run"),
        (([-1, 0, 5],), [5, 0, -1], "odd length with negative values"),
    ],
    extra=[(([1, 2],), [2, 1])],
    hint=("Use two positions, one at each end, and move them toward each other. Think carefully about "
          "exactly when to stop."),
    rubric=[
        "Reverses by swapping in place with O(1) extra space (no second array).",
        "Stops at the middle (left < right) — continuing past it reverses the array back.",
        "Works for odd, even, single-element and empty arrays.",
        "O(n) time.",
    ],
    checkpoints=[
        "Uses two pointers from both ends",
        "Swaps elements correctly",
        "Stops when the pointers meet (left < right)",
        "Uses no extra array or built-in reverse",
        "Handles empty and single-element arrays",
    ],
)

add(
    num=110, category="dsa", difficulty="easy",
    title="Count Even and Odd Numbers",
    topic="Arrays",
    source="docx: Part A Arrays · Q4",
    body=(
        "Given an array `arr` of integers, return how many elements are **even** and how many are "
        "**odd**. Zero is even, and negative numbers follow the same rule (`-4` is even, `-3` is odd)."
    ),
    constraints=[
        "0 ≤ len(arr) ≤ 10^5",
        "-10^9 ≤ arr[i] ≤ 10^9",
    ],
    names=["arr"], call="countEvenOdd", fn="count_even_odd", fmt=labelled("even", "odd"),
    code='''def count_even_odd(arr):
    even = odd = 0
    for x in arr:
        if x % 2 == 0:
            even += 1
        else:
            odd += 1
    return even, odd''',
    approach=("One pass: an element is even when x % 2 == 0, otherwise odd. Testing `== 0` is safe for "
              "negatives, whereas `x % 2 == 1` fails in languages where -3 % 2 is -1 (C, C++, Java, "
              "JavaScript). O(n) time, O(1) space."),
    examples=[
        (([1, 2, 3, 4, 5, 6, 7],), (3, 4), "Even numbers are 2, 4, 6; odd numbers are 1, 3, 5, 7."),
        (([2, 4, 6],), (3, 0), "All elements are even."),
        (([0],), (1, 0), "Zero is an even number."),
    ],
    hidden=[
        (([],), (0, 0), "empty array"),
        (([-2, -3],), (1, 1), "negative odd number — a 'remainder == 1' test misses -3 in many languages"),
    ],
    extra=[(([1, 3],), (0, 2)), (([-7, -9, 10],), (1, 2))],
    hint=("Divisibility by 2 decides parity. Be careful how the remainder behaves for negative numbers in "
          "your language."),
    rubric=[
        "Counts zero as even.",
        "Classifies negative numbers correctly (tests remainder == 0 rather than remainder == 1).",
        "Returns both counts; an empty array gives 0 and 0.",
        "O(n) single pass.",
    ],
    checkpoints=[
        "Uses the remainder by 2 to test parity",
        "Treats 0 as even",
        "Handles negative odd numbers correctly",
        "Returns both counts",
        "Handles an empty array",
    ],
)

add(
    num=111, category="dsa", difficulty="easy",
    title="Linear Search",
    topic="Arrays · Searching",
    source="docx: Part A Arrays · Q5",
    body=(
        "Given an array `arr` of integers and an integer `x`, return the index of the **first occurrence** "
        "of `x` in `arr` (indices start at `0`), or `-1` if `x` is not present. The array is not sorted, so "
        "check the elements one by one."
    ),
    constraints=[
        "0 ≤ len(arr) ≤ 10^6",
        "0 ≤ arr[i], x ≤ 10^6",
    ],
    names=["arr", "x"], call="linearSearch", fn="linear_search",
    code='''def linear_search(arr, x):
    for i in range(len(arr)):
        if arr[i] == x:
            return i
    return -1''',
    approach=("Scan from index 0 and return the first index where arr[i] equals x; return -1 only after "
              "the loop finishes. O(n) time, O(1) space."),
    examples=[
        (([1, 2, 3, 4], 3), 2, "3 is at index 2."),
        (([10, 8, 30, 4, 5], 5), 4, "5 is the last element, at index 4."),
        (([10, 8, 30], 6), -1, "6 is not present, so the result is -1."),
    ],
    hidden=[
        (([1, 2, 2, 3], 2), 1, "duplicates — the FIRST occurrence is returned"),
        (([], 1), -1, "empty array"),
    ],
    extra=[(([3], 3), 0), (([5, 8, 2, 9], 7), -1)],
    hint=("Visit each position in order and stop as soon as you find a match. Decide what to return only "
          "after you have checked every element."),
    rubric=[
        "Returns the FIRST matching index, 0-based.",
        "Returns -1 only after checking every element (not on the first mismatch).",
        "Handles an empty array.",
        "O(n) time, O(1) space.",
    ],
    checkpoints=[
        "Iterates over every index in order",
        "Returns immediately on the first match",
        "Returns -1 after the loop, not on the first mismatch",
        "Uses 0-based indexing",
        "Handles an empty array",
    ],
)

add(
    num=112, category="dsa", difficulty="easy",
    title="Pairs With a Given Sum",
    topic="Arrays · Hash Set",
    source="docx: Part A Arrays · Q9",
    unordered=True,
    body=(
        "Given an array `arr` of **distinct** integers and an integer `target`, return **all** pairs of "
        "elements whose sum equals `target`. Write each pair as `[a, b]`, where `a` appears **before** `b` "
        "in the array. An element cannot pair with itself.\n\n"
        "Return the pairs in any order, or an empty array if there are none."
    ),
    constraints=[
        "0 ≤ len(arr) ≤ 10^5",
        "All elements of `arr` are distinct.",
        "-10^9 ≤ arr[i], target ≤ 10^9",
    ],
    names=["arr", "target"], call="findPairs", fn="find_pairs",
    code='''def find_pairs(arr, target):
    seen = set(); pairs = []
    for x in arr:
        if target - x in seen:
            pairs.append([target - x, x])
        seen.add(x)
    return pairs''',
    approach=("One pass with a hash set of earlier elements: for each x, if target − x has already been "
              "seen, record [target − x, x]; then add x. Checking before adding stops an element pairing "
              "with itself. O(n) time and space; nested loops in O(n^2) earn partial credit."),
    examples=[
        (([2, 7, 4, 5, 3, 6], 9), [[2, 7], [4, 5], [3, 6]], "2 + 7, 4 + 5 and 3 + 6 each add up to 9."),
        (([1, 2, 3], 10), [], "No two elements add up to 10."),
        (([-2, 2, 0], 0), [[-2, 2]],
         "-2 + 2 = 0. The element 0 would need a second 0, which is not present (an element cannot pair with itself)."),
    ],
    hidden=[
        (([1, 3, 7, 9, 5], 10), [[3, 7], [1, 9]], "any order; 5 must not pair with itself"),
        (([], 5), [], "empty array"),
    ],
    extra=[(([5], 10), []), (([4, 5], 9), [[4, 5]])],
    hint=("For each element, think about which other value it would need to reach the target. How can you "
          "check quickly whether you have already seen that value?"),
    rubric=[
        "Finds ALL pairs, not just the first one.",
        "Writes each pair with the earlier element first and never pairs an element with itself.",
        "Reports each pair exactly once and returns an empty array when there is none.",
        "O(n) with a hash set for full credit; O(n^2) nested loops earn partial credit.",
    ],
    checkpoints=[
        "Looks for the complement target − x",
        "Uses a set of earlier elements (or nested loops)",
        "Collects every pair",
        "Keeps each pair as [earlier, later]",
        "Does not pair an element with itself",
        "Returns an empty array when no pair exists",
    ],
)

# brute-force cross-checks on random inputs
def gen_rolls(r):
    n = r.randint(2, 40)
    miss = r.randint(1, n)
    rolls = [v for v in range(1, n + 1) if v != miss]
    r.shuffle(rolls)
    return (n, rolls)


BRUTE = {
    103: (lambda n, rolls: (set(range(1, n + 1)) - set(rolls)).pop(),
          lambda r: gen_rolls(r)),
    104: (lambda s, k: max(sum(s[i:i + k]) for i in range(len(s) - k + 1)),
          lambda r: (lambda s: (s, r.randint(1, len(s))))([r.randint(0, 20) for _ in range(r.randint(1, 15))])),
    106: (lambda a, b: sorted(a.lower()) == sorted(b.lower()),
          lambda r: ("".join(r.choice("abAB") for _ in range(r.randint(1, 5))),
                     "".join(r.choice("abAB") for _ in range(r.randint(1, 5))))),
    107: (lambda a: (max(a), min(a)), lambda r: ([r.randint(-50, 50) for _ in range(r.randint(1, 10))],)),
    110: (lambda a: (sum(1 for x in a if x % 2 == 0), sum(1 for x in a if x % 2)),
          lambda r: ([r.randint(-50, 50) for _ in range(r.randint(0, 10))],)),
    112: (lambda a, t: sorted([a[i], a[j]] for i in range(len(a)) for j in range(i + 1, len(a)) if a[i] + a[j] == t),
          lambda r: (r.sample(range(-15, 16), r.randint(0, 10)), r.randint(-10, 10))),
}


# ================================================================ build
def build(q):
    ns = {}
    exec(q["code"], ns)
    fn = ns[q["fn"]]
    fmt = q.get("fmt", neutral)
    unordered = q.get("unordered", False)

    def run(args):
        a = copy.deepcopy(args)
        res = fn(*a)
        if q.get("inplace"):
            assert res is a[0], f"{q['num']}: result is not the same array (not in place)"
        return res

    def same(res, exp):
        if unordered:
            return sorted(res) == sorted(exp)
        if isinstance(exp, tuple):
            return tuple(res) == exp and all(type(x) == type(y) for x, y in zip(res, exp))
        return res == exp and type(res) == type(exp)

    disp_name = q["call"]
    ex_blocks, exp_lines = [], []
    for i, (args, exp, expl) in enumerate(q["examples"], 1):
        res = run(args)
        assert same(res, exp), f"{q['num']} example {i}: got {res!r}, expected {exp!r}"
        inp = ", ".join(f"{n} = {neutral(a)}" for n, a in zip(q["names"], args))
        out = fmt(exp)
        ex_blocks.append(f"**Example {i}**\nInput: {inp}\nOutput: {out}\nExplanation: {expl}")
        exp_lines.append(f"Example {i} → {out}")
    for i, (args, exp, why) in enumerate(q["hidden"], 1):
        res = run(args)
        assert same(res, exp), f"{q['num']} hidden {i}: got {res!r}, expected {exp!r}"
        call = f"{disp_name}(" + ", ".join(neutral(a) for a in args) + ")"
        out = fmt(exp)
        if isinstance(exp, tuple):
            out = f"({out})"
        exp_lines.append(f"Hidden test {i} → {call} = {out}  ({why})")
    n_checked = len(q["examples"]) + len(q["hidden"])
    for args, exp in q.get("extra", []):
        res = run(args)
        assert same(res, exp), f"{q['num']} extra {args!r}: got {res!r}, expected {exp!r}"
        n_checked += 1
    if q["num"] in BRUTE:
        brute, gen = BRUTE[q["num"]]
        r = random.Random(q["num"])
        for _ in range(300):
            args = gen(r)
            res, ref = run(args), brute(*copy.deepcopy(args))
            if unordered:
                res = sorted(res)
            assert tuple(res) == tuple(ref) if isinstance(ref, tuple) else res == ref, \
                f"{q['num']} brute mismatch on {args!r}: {res!r} vs {ref!r}"
            n_checked += 1

    diff_word = q["difficulty"].capitalize()
    prompt = (f"## {q['title']}\n> {q['topic']} · {diff_word}\n\n{q['body']}\n\n### Constraints\n"
              + "\n".join(f"- {c}" for c in q["constraints"]))
    prefix = "qb-dsa-d" if q["category"] == "dsa" else "qb-scn-d"
    obj = {
        "id": f"{prefix}{q['num']}",
        "category": q["category"],
        "difficulty": q["difficulty"],
        "marks": 5,
        "title": q["title"],
        "topic": q["topic"],
        "prompt": prompt,
        "sample_data": "\n\n".join(ex_blocks),
        "expected_output": "\n".join(exp_lines),
        "reference_answer": q["approach"] + "\n\n" + q["code"],
        "hint": q["hint"],
        "rubric": "\n".join(f"- {r}" for r in q["rubric"]),
        "checkpoints": "\n".join(q["checkpoints"]),
        "source": q["source"],
    }
    return obj, n_checked


BANNED = [r"\bPython\b", r"\blists?\b", r"\bdicts?\b", r"\bdef\b", r"print\(", r"\bNone\b",
          r"\bTrue\b", r"\bFalse\b", r"\bprint\b"]


def validate(obj, ref_titles):
    qid = obj["id"]
    assert list(obj.keys()) == KEYS, f"{qid}: keys {list(obj.keys())}"
    m = re.fullmatch(r"qb-(dsa|scn)-d(\d{3})", qid)
    assert m and 101 <= int(m.group(2)) <= 199, f"{qid}: bad id"
    assert (m.group(1) == "dsa") == (obj["category"] == "dsa"), f"{qid}: id/category mismatch"
    assert obj["category"] in ("dsa", "scenario")
    assert obj["difficulty"] in ("easy", "medium", "hard")
    assert obj["marks"] == 5
    assert not re.match(r"(?i)q\d", obj["title"]) and obj["title"] == obj["title"].strip()
    words = [w for w in re.split(r"\s+", obj["title"]) if w]
    small = {"a", "an", "and", "in", "of", "the", "to", "with", "or", "for", "on"}
    for i, w in enumerate(words):
        assert w[0].isupper() or (i > 0 and w in small), f"{qid}: title not Title Case: {w}"
    parts = obj["topic"].split(" · ")
    assert 1 <= len(parts) <= 3 and all(parts), f"{qid}: topic parts"
    lines = obj["prompt"].split("\n")
    assert lines[0] == f"## {obj['title']}", f"{qid}: prompt title line"
    assert lines[1] == f"> {obj['topic']} · {obj['difficulty'].capitalize()}", f"{qid}: prompt topic line"
    assert lines[2] == "", f"{qid}: blank line after header"
    assert "\n### Constraints\n- " in obj["prompt"], f"{qid}: constraints"
    after = obj["prompt"].split("### Constraints\n", 1)[1].split("\n")
    assert all(l.startswith("- ") for l in after), f"{qid}: constraint bullets"
    assert "Example" not in obj["prompt"], f"{qid}: examples in prompt"
    blocks = obj["sample_data"].split("\n\n")
    assert 2 <= len(blocks) <= 3, f"{qid}: example count"
    for i, b in enumerate(blocks, 1):
        bl = b.split("\n")
        assert bl[0] == f"**Example {i}**" and bl[1].startswith("Input: ") and \
            bl[2].startswith("Output: ") and bl[3].startswith("Explanation: ") and len(bl) == 4, \
            f"{qid}: example {i} shape"
    el = obj["expected_output"].split("\n")
    assert len(el) == len(blocks) + 2, f"{qid}: expected_output line count"
    for i in range(len(blocks)):
        assert el[i].startswith(f"Example {i + 1} → "), f"{qid}: expected example line"
        assert el[i].split(" → ", 1)[1] == blocks[i].split("\n")[2][len("Output: "):], f"{qid}: example/expected mismatch"
    for j in (1, 2):
        assert re.fullmatch(rf"Hidden test {j} → \w+\(.*\) = .+  \(.+\)", el[len(blocks) + j - 1]), \
            f"{qid}: hidden line {j}"
    rub = obj["rubric"].split("\n")
    assert 3 <= len(rub) <= 5 and all(r.startswith("- ") for r in rub), f"{qid}: rubric"
    cps = obj["checkpoints"].split("\n")
    assert 4 <= len(cps) <= 6 and all(c and not c.startswith(("-", "*", "•")) for c in cps), f"{qid}: checkpoints"
    assert 1 <= len(re.findall(r"[.!?](\s|$)", obj["hint"])) <= 2, f"{qid}: hint sentences"
    assert obj["source"].startswith("docx: ")
    assert "def " in obj["reference_answer"]
    for field in ("prompt", "sample_data", "hint"):
        for pat in BANNED:
            hit = re.search(pat, obj[field])
            assert not hit, f"{qid}: banned word {hit.group(0)!r} in {field}"
    norm = lambda t: re.sub(r"[^a-z]", "", t.lower())
    assert norm(obj["title"]) not in ref_titles, f"{qid}: title duplicates existing bank"


def main():
    ref = json.load(open(REF, encoding="utf-8"))
    ref_titles = {re.sub(r"[^a-z]", "", q["prompt"].split("\n")[0][3:].lower()) for q in ref}
    ref_ids = {q["id"] for q in ref}
    out, total = [], 0
    for q in Q:
        obj, n = build(q)
        validate(obj, ref_titles)
        out.append(obj)
        total += n
    ids = [o["id"] for o in out]
    nums = [int(i[-3:]) for i in ids]
    assert len(set(nums)) == len(nums), "duplicate id numbers"
    assert not set(ids) & ref_ids
    titles = [o["title"] for o in out]
    assert len(set(titles)) == len(titles), "duplicate titles in this slice"
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    cats = {c: sum(o["category"] == c for o in out) for c in ("dsa", "scenario")}
    print(f"PASS: {len(out)} questions ({cats['dsa']} dsa, {cats['scenario']} scenario), "
          f"{total} test assertions passed, {len(SKIPPED)} docx items skipped as duplicates "
          f"-> {os.path.relpath(OUT, os.getcwd())}")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        if os.path.exists(OUT):
            pass  # leave any previous good file untouched
        sys.exit(1)
