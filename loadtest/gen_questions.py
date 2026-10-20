#!/usr/bin/env python3
# Talo question-bank seed generator.
# Every question is self-contained and carries: an elaborated prompt (scenario + task
# + Input/Output format + constraints), a worked Example shown to the candidate
# (sample_data), the exact expected_output, a one-line HINT (shown on demand), a
# logic-first grading rubric, marks and difficulty.
# Sections: SQL, Python, DSA (algorithms + debugging), Scenario (real-world coding).

def esc(s):
    return (s or '').replace("'", "''")

F = "```"
Q = []  # (id, category, prompt, ref, sample, expected, hint, rubric, marks, diff)

def add(qid, cat, prompt, ref, sample, expected, hint, rubric, marks, diff="medium"):
    Q.append((qid, cat, prompt, ref, sample, expected, hint, rubric, marks, diff))

# ============================================================ SQL (6, marks 3)
add("qb-sql-01","sql",
"""Scenario: An e-commerce team wants the total amount each customer has spent so they can rank their best customers.
Table: orders(customer_id INT, amount INT).
Task: Return each customer_id with the SUM of their amount, highest total first.""",
"SELECT customer_id, SUM(amount) AS total\nFROM orders\nGROUP BY customer_id\nORDER BY total DESC;",
"Table: orders\n| customer_id | amount |\n| 1 | 100 |\n| 2 | 50 |\n| 1 | 70 |",
"| customer_id | total |\n| 1 | 170 |\n| 2 | 50 |",
"Group the rows per customer and SUM, then ORDER BY the total descending.",
"GROUP BY customer_id + SUM(amount) + descending order. Partial if grouping is right but ordering missing.",3,"easy")

add("qb-sql-02","sql",
"""Scenario: HR needs the second-highest distinct salary for a bonus rule.
Table: employees(name TEXT, salary INT).
Task: Return the single second-highest DISTINCT salary. If it doesn't exist, return NULL.""",
"SELECT MAX(salary) AS second_highest\nFROM employees\nWHERE salary < (SELECT MAX(salary) FROM employees);",
"Table: employees\n| name | salary |\n| A | 100 |\n| B | 100 |\n| C | 80 |",
"| second_highest |\n| 80 |",
"The top salary can repeat — find the max salary strictly below the overall max.",
"Handles duplicates of the top salary (< MAX subquery, DISTINCT, or OFFSET). Partial if it returns the top or a duplicate.",3,"medium")

add("qb-sql-03","sql",
"""Scenario: Marketing wants customers who have never placed an order so they can re-engage them.
Tables: customers(id INT, name TEXT), orders(id INT, customer_id INT).
Task: Return the name of every customer with NO matching row in orders.""",
"SELECT c.name\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id\nWHERE o.id IS NULL;",
"customers:\n| id | name |\n| 1 | A |\n| 2 | B |\n| 3 | C |\norders:\n| id | customer_id |\n| 10 | 1 |\n| 11 | 1 |",
"| name |\n| B |\n| C |",
"This is an anti-join — a LEFT JOIN where the right side is NULL, or NOT EXISTS / NOT IN.",
"Correct anti-join (LEFT JOIN ... IS NULL / NOT EXISTS / NOT IN) = full marks. Partial for an INNER JOIN returning the wrong set.",3,"medium")

add("qb-sql-04","sql",
"""Scenario: A store wants its top 3 products by total revenue for a featured shelf.
Tables: products(id INT, name TEXT), order_items(product_id INT, qty INT, price INT).
Task: Return product name and total revenue (SUM(qty*price)), highest first, top 3 only.""",
"SELECT p.name, SUM(oi.qty * oi.price) AS revenue\nFROM products p\nJOIN order_items oi ON oi.product_id = p.id\nGROUP BY p.id, p.name\nORDER BY revenue DESC\nLIMIT 3;",
"products:\n| id | name |\n| 1 | Pen |\n| 2 | Book |\norder_items:\n| product_id | qty | price |\n| 1 | 2 | 10 |\n| 2 | 1 | 50 |\n| 1 | 1 | 10 |",
"| name | revenue |\n| Book | 50 |\n| Pen | 30 |",
"JOIN the tables, SUM(qty*price) per product, then ORDER BY revenue DESC and LIMIT 3.",
"JOIN + GROUP BY + SUM(qty*price) + ORDER BY revenue DESC + LIMIT 3. Partial if aggregate right but ordering/limit missing.",3,"medium")

add("qb-sql-05","sql",
"""Scenario: A signup table was imported twice, so some emails repeat and need flagging.
Table: users(id INT, email TEXT).
Task: Return every email that appears more than once, alphabetically. Each duplicate listed once.""",
"SELECT email\nFROM users\nGROUP BY email\nHAVING COUNT(*) > 1\nORDER BY email;",
"users:\n| id | email |\n| 1 | a@x.com |\n| 2 | b@x.com |\n| 3 | a@x.com |",
"| email |\n| a@x.com |",
"Group by email and keep only the groups whose COUNT is greater than 1 (HAVING, not WHERE).",
"GROUP BY email + HAVING COUNT(*) > 1. Partial if it lists all rows or forgets HAVING.",3,"medium")

add("qb-sql-06","sql",
"""Scenario: Analytics wants signups per month for a trend chart.
Table: signups(id INT, created_at TEXT -- 'YYYY-MM-DD').
Task: Return the month ('YYYY-MM') and the count of signups in that month, earliest month first.""",
"SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS signups\nFROM signups\nGROUP BY month\nORDER BY month;",
"signups:\n| id | created_at |\n| 1 | 2026-01-03 |\n| 2 | 2026-01-20 |\n| 3 | 2026-02-02 |",
"| month | signups |\n| 2026-01 | 2 |\n| 2026-02 | 1 |",
"Truncate the date to year-month (strftime / substr) and GROUP BY that.",
"Group by the year-month derived from the date (any correct date truncation). Partial if grouping by full date.",3,"medium")

# ============================================================ Python (4, marks 4)
add("qb-py-01","python",
"""Scenario: A reviews tool needs the single most frequent word in a review.
Task: Given a lowercase sentence (words separated by single spaces), return the most frequent word and its count in the format 'word count'. On a tie, return the word that appears FIRST in the sentence.
Input: a string s. Output: a string 'word count'.""",
"def most_frequent(s):\n    freq, first = {}, {}\n    for i, w in enumerate(s.split()):\n        freq[w] = freq.get(w, 0) + 1\n        if w not in first: first[w] = i\n    best = max(freq, key=lambda w: (freq[w], -first[w]))\n    return f\"{best} {freq[best]}\"",
f"Example\n{F}\nInput:  s = \"the food was good and the service was good\"\nOutput: \"the 2\"\n{F}\n'the', 'was' and 'good' each appear twice; 'the' appears first, so it wins the tie.",
"the 2",
"Count with a dict; break ties by first-seen index.",
"Correct counting with the right first-seen tie-break = full marks; partial if counting right but tie-break wrong.",4,"medium")

add("qb-py-02","python",
"""Scenario: A data job must merge two already-sorted lists of IDs into one sorted list.
Task: Given two ascending lists a and b, return a single ascending list with all elements (keep duplicates). Aim for O(n+m), not a full re-sort.
Input: two lists a and b. Output: one merged ascending list.""",
"def merge(a, b):\n    i = j = 0\n    out = []\n    while i < len(a) and j < len(b):\n        if a[i] <= b[j]: out.append(a[i]); i += 1\n        else: out.append(b[j]); j += 1\n    out.extend(a[i:]); out.extend(b[j:])\n    return out",
f"Example\n{F}\nInput:  a = [1, 3, 5], b = [2, 3, 6]\nOutput: [1, 2, 3, 3, 5, 6]\n{F}\nBoth 3s are kept; the result stays in ascending order.",
"[1, 2, 3, 3, 5, 6]",
"Walk both lists with two pointers; don't forget the leftover tail of whichever list isn't exhausted.",
"Two-pointer merge (re-sorting is weaker but acceptable). Partial for a correct re-sort or a small bug.",4,"medium")

add("qb-py-03","python",
"""Scenario: A log pipeline counts how many times each log level appears.
Task: Given a string of space-separated levels (e.g. 'INFO ERROR INFO'), return a dict mapping each level to its count.
Input: a string logs. Output: a dict {level: count}.""",
"def count_levels(logs):\n    freq = {}\n    for lvl in logs.split():\n        freq[lvl] = freq.get(lvl, 0) + 1\n    return freq",
f"Example\n{F}\nInput:  logs = \"INFO ERROR INFO WARN ERROR ERROR\"\nOutput: {{'INFO': 2, 'ERROR': 3, 'WARN': 1}}\n{F}\nEach distinct level maps to how many times it appears.",
"{'INFO': 2, 'ERROR': 3, 'WARN': 1}",
"A frequency dict (or collections.Counter) over the split tokens.",
"Correct counts = full marks. Partial for an off-by-one or a missing level.",4,"easy")

add("qb-py-04","python",
"""Scenario: A chat app removes CONSECUTIVE duplicate messages (non-consecutive repeats are kept).
Task: Given a list of message strings, return a new list with runs of the same message collapsed to one.
Input: a list msgs. Output: a list with consecutive duplicates removed.""",
"def dedupe_consecutive(msgs):\n    out = []\n    for m in msgs:\n        if not out or out[-1] != m:\n            out.append(m)\n    return out",
f"Example\n{F}\nInput:  msgs = ['A', 'A', 'B', 'B', 'B', 'A', 'A']\nOutput: ['A', 'B', 'A']\n{F}\nOnly adjacent repeats are collapsed, so the later 'A' run is kept as its own entry.",
"['A', 'B', 'A']",
"Compare each message only with the LAST one you kept, not with everything seen.",
"Collapse only ADJACENT duplicates. Partial if it removes all duplicates instead of consecutive ones.",4,"medium")

# ============================================================ DSA (algorithms, marks 5)
def dsa(qid, title, task, io, constraints, ref, examples, expected, hint, rubric, diff="medium"):
    prompt = f"{title}\nTask: {task}\n{io}\nConstraints: {constraints}"
    add(qid, "dsa", prompt, ref, examples, expected, hint, rubric, 5, diff)

dsa("qb-dsa-01","Second Largest Element.",
"Given an array of integers, return the SECOND LARGEST distinct value. If it does not exist (fewer than 2 distinct values), return -1.",
"Input: an array of n integers. Output: a single integer.",
"1 <= n <= 1e5.",
"def second_largest(arr):\n    first = second = float('-inf')\n    for x in arr:\n        if x > first: second, first = first, x\n        elif x != first and x > second: second = x\n    return second if second != float('-inf') else -1",
f"Example 1\n{F}\nInput:  [12, 35, 1, 10, 34, 1]\nOutput: 34\n{F}\n35 is the largest; 34 is the next distinct value.\nExample 2\n{F}\nInput:  [10, 10, 10]\nOutput: -1\n{F}\nOnly one distinct value exists, so there is no second largest.",
"34",
"Track the largest and second-largest in one pass, and skip values equal to the largest.",
"Finds the second largest DISTINCT value (one pass or sort) and handles duplicates of the maximum. Partial: returns a duplicate of the max, or misses the 'no second value' case.")

dsa("qb-dsa-02","Valid Palindrome.",
"Given a string, return True if it reads the same forwards and backwards after lowercasing and removing all non-alphanumeric characters, else False.",
"Input: a string s. Output: True or False.",
"1 <= length <= 1e5.",
"def is_palindrome(s):\n    t = [c.lower() for c in s if c.isalnum()]\n    return t == t[::-1]",
f"Example 1\n{F}\nInput:  \"A man, a plan, a canal: Panama\"\nOutput: True\n{F}\nAfter cleaning it becomes 'amanaplanacanalpanama', a palindrome.\nExample 2\n{F}\nInput:  \"hello\"\nOutput: False\n{F}",
"True",
"Clean the string first (keep only alphanumerics, lowercase), then compare it to its reverse — or use two pointers.",
"Correct approach ignoring case and punctuation. Partial if case/punctuation handling is missed.")

dsa("qb-dsa-03","First Non-Repeating Character.",
"Given a lowercase string, return the INDEX of the first character that appears exactly once. If none exists, return -1.",
"Input: a string s. Output: an integer index, or -1.",
"1 <= length <= 1e5.",
"def first_unique(s):\n    from collections import Counter\n    c = Counter(s)\n    for i, ch in enumerate(s):\n        if c[ch] == 1: return i\n    return -1",
f"Example 1\n{F}\nInput:  \"loveleetcode\"\nOutput: 2\n{F}\n'l' and 'o' repeat; 'v' at index 2 is the first that appears once.\nExample 2\n{F}\nInput:  \"aabb\"\nOutput: -1\n{F}\nEvery character repeats.",
"2",
"Count every character first, then scan left to right for the first with count 1.",
"Count then find the first with count 1 (O(n)). Partial: a correct O(n^2) scan, or an off-by-one; must return -1 when all repeat.")

dsa("qb-dsa-04","Move Zeros to the End.",
"Given an array, move all zeros to the END while keeping the order of the non-zero elements. Do it in place.",
"Input: an array nums. Output: the same array with zeros moved to the end.",
"1 <= n <= 1e5.",
"def move_zeros(nums):\n    pos = 0\n    for x in nums:\n        if x != 0:\n            nums[pos] = x; pos += 1\n    for i in range(pos, len(nums)):\n        nums[i] = 0\n    return nums",
f"Example 1\n{F}\nInput:  [0, 1, 0, 3, 12]\nOutput: [1, 3, 12, 0, 0]\n{F}\nNon-zeros keep their order; the two zeros move to the end.\nExample 2\n{F}\nInput:  [0, 0, 1]\nOutput: [1, 0, 0]\n{F}",
"[1, 3, 12, 0, 0]",
"Use a write pointer: copy each non-zero forward, then fill the rest with zeros.",
"Write-pointer in place, order of non-zeros preserved (extra list is fine). Partial: order lost, or zeros not all moved.")

dsa("qb-dsa-05","Two Sum.",
"Given an array nums and a target, return the INDICES of the two numbers that add up to the target. Exactly one solution exists; the same element can't be used twice.",
"Input: an array nums and an integer target. Output: a list of two indices.",
"2 <= n <= 1e5.",
"def two_sum(nums, target):\n    seen = {}\n    for i, x in enumerate(nums):\n        if target - x in seen: return [seen[target - x], i]\n        seen[x] = i\n    return []",
f"Example 1\n{F}\nInput:  nums = [2, 7, 11, 15], target = 9\nOutput: [0, 1]\n{F}\nnums[0] + nums[1] = 2 + 7 = 9.\nExample 2\n{F}\nInput:  nums = [3, 3], target = 6\nOutput: [0, 1]\n{F}",
"[0, 1]",
"Store each number's index in a hash map; for each number check whether target - number was already seen.",
"Hash map in one pass (O(n)); a correct O(n^2) brute force earns most marks. Must not reuse the same index.")

dsa("qb-dsa-06","Valid Parentheses.",
"Given a string containing only the characters ()[]{} , return True if every bracket is closed by the same type in the correct order, else False.",
"Input: a string s. Output: True or False.",
"1 <= length <= 1e5.",
"def is_valid(s):\n    pairs = {')':'(', ']':'[', '}':'{'}\n    st = []\n    for ch in s:\n        if ch in '([{': st.append(ch)\n        elif not st or st.pop() != pairs[ch]: return False\n    return not st",
f"Example 1\n{F}\nInput:  \"{{[()]}}\"\nOutput: True\n{F}\nEvery bracket is matched and correctly nested.\nExample 2\n{F}\nInput:  \"([)]\"\nOutput: False\n{F}\nThe brackets overlap instead of nesting.",
"True",
"Use a stack: push openers, and on a closer check it matches the top. The stack must be empty at the end.",
"Stack matching that handles an empty-stack pop and a non-empty stack at the end. Partial if either edge case missed.")

dsa("qb-dsa-07","Longest Substring Without Repeating Characters.",
"Given a string, return the LENGTH of the longest substring that contains no repeating characters.",
"Input: a string s. Output: an integer length.",
"0 <= length <= 1e5.",
"def longest_unique(s):\n    last = {}\n    start = best = 0\n    for i, ch in enumerate(s):\n        if ch in last and last[ch] >= start:\n            start = last[ch] + 1\n        last[ch] = i\n        best = max(best, i - start + 1)\n    return best",
f"Example 1\n{F}\nInput:  \"abcabcbb\"\nOutput: 3\n{F}\n'abc' is the longest stretch with no repeats.\nExample 2\n{F}\nInput:  \"bbbbb\"\nOutput: 1\n{F}\nOnly a single 'b' has no repeat.",
"3",
"Slide a window and remember the last index of each character; when you see a repeat, jump the window start past it.",
"Sliding window with last-seen index (O(n)). A correct O(n^2) answer earns most marks.")

dsa("qb-dsa-08","Merge Overlapping Intervals.",
"Given a list of intervals [start, end], merge all overlapping intervals and return the result sorted by start. Touching intervals like [1,4] and [4,5] merge into one.",
"Input: a list of [start, end] pairs. Output: the merged list of intervals.",
"1 <= n <= 1e5.",
"def merge_intervals(intervals):\n    intervals.sort(key=lambda x: x[0])\n    out = []\n    for s, e in intervals:\n        if out and s <= out[-1][1]:\n            out[-1][1] = max(out[-1][1], e)\n        else:\n            out.append([s, e])\n    return out",
f"Example 1\n{F}\nInput:  [[1, 3], [2, 6], [8, 10], [15, 18]]\nOutput: [[1, 6], [8, 10], [15, 18]]\n{F}\n[1,3] and [2,6] overlap, so they become [1,6].\nExample 2\n{F}\nInput:  [[1, 4], [4, 5]]\nOutput: [[1, 5]]\n{F}\nTouching intervals merge.",
"[[1, 6], [8, 10], [15, 18]]",
"Sort by start first; then extend the last kept interval whenever the next one starts at or before its end.",
"Sort by start, then extend the last merged interval. Partial: touching intervals not merged, or sorting skipped.")

dsa("qb-dsa-09","Rotate an Array.",
"Given an array of n integers and an integer k, rotate it to the RIGHT by k steps and return the result. Note: k may be larger than n.",
"Input: an array nums and an integer k. Output: the rotated array.",
"1 <= n <= 1e5, 0 <= k <= 1e9.",
"def rotate(nums, k):\n    n = len(nums)\n    k %= n\n    return nums[-k:] + nums[:-k] if k else nums[:]",
f"Example 1\n{F}\nInput:  nums = [1, 2, 3, 4, 5, 6, 7], k = 3\nOutput: [5, 6, 7, 1, 2, 3, 4]\n{F}\nEach element moves 3 places right; the last three (5,6,7) wrap to the front.\nExample 2\n{F}\nInput:  nums = [1, 2], k = 5\nOutput: [2, 1]\n{F}\nk = 5 with n = 2 is the same as k = 1 (5 mod 2), so a single right shift.",
"[5, 6, 7, 1, 2, 3, 4]",
"First reduce k with k % n, or large k will break you. Then slicing, reversal, or an extra array all work.",
"Reduce k with k % n (the common bug), then rotate. Partial: correct for k <= n but fails when k > n. O(n*k) shift earns most marks.")

dsa("qb-dsa-10","Maximum Sum of k Consecutive Elements.",
"Given an array and an integer k, return the maximum sum of any k consecutive elements (a sliding window of size k).",
"Input: an array arr and an integer k. Output: an integer (the maximum window sum).",
"1 <= k <= n <= 1e5.",
"def max_window(arr, k):\n    s = sum(arr[:k])\n    best = s\n    for i in range(k, len(arr)):\n        s += arr[i] - arr[i-k]\n        best = max(best, s)\n    return best",
f"Example 1\n{F}\nInput:  arr = [2, 1, 5, 1, 3, 2], k = 3\nOutput: 9\n{F}\nThe window [5, 1, 3] sums to 9, the largest of any 3 in a row.\nExample 2\n{F}\nInput:  arr = [1, 2, 3, 4], k = 2\nOutput: 7\n{F}\n[3, 4] sums to 7.",
"9",
"Keep a running window sum: add the new element and subtract the one that falls out — don't recompute each window.",
"Sliding window in O(n). A correct O(n*k) recompute earns most marks.")

# ---- new DSA coding (from the Arrays & Strings set) ----
dsa("qb-dsa-11","Product Without One Item (no division).",
"A combo builder shows, for each item, the product of the multipliers of all the OTHER items. Given an array, return an array where position i holds the product of every element except arr[i]. You may NOT use division. Aim for O(n) time.",
"Input: an array arr. Output: an array of the same length.",
"Array may contain zeros; 1 <= n <= 1e5.",
"def product_except_self(arr):\n    n = len(arr)\n    res = [1] * n\n    left = 1\n    for i in range(n):\n        res[i] = left; left *= arr[i]\n    right = 1\n    for i in range(n - 1, -1, -1):\n        res[i] *= right; right *= arr[i]\n    return res",
f"Example 1\n{F}\nInput:  [1, 2, 3, 4]\nOutput: [24, 12, 8, 6]\n{F}\nEach position is the product of the other three.\nExample 2\n{F}\nInput:  [2, 0, 5]\nOutput: [0, 10, 0]\n{F}\nDivision would break on the zero — prefix/suffix products handle it.",
"[24, 12, 8, 6]",
"Multiply a running product of everything to the LEFT, then a second pass for everything to the RIGHT. No division needed.",
"Prefix * suffix products, O(n), no division; handles zeros. Partial: uses division (fails on 0) or an O(n^2) answer (still mostly correct).")

dsa("qb-dsa-12","Remove Duplicate Characters (keep first).",
"A sign-up form cleans a suggested username by removing repeated characters, keeping only the FIRST occurrence of each. Return the cleaned string, preserving the original order.",
"Input: a string s. Output: the de-duplicated string.",
"1 <= length <= 1e5.",
"def remove_duplicates(s):\n    seen = set()\n    out = []\n    for ch in s:\n        if ch not in seen:\n            seen.add(ch); out.append(ch)\n    return ''.join(out)",
f"Example 1\n{F}\nInput:  \"programming\"\nOutput: \"progamin\"\n{F}\nEach letter is kept only the first time it appears.\nExample 2\n{F}\nInput:  \"hevodata\"\nOutput: \"hevodat\"\n{F}",
"progamin",
"Track seen characters in a set for O(1) lookups, and build the result in order — set(s) alone loses order.",
"Set for lookups + list to keep order, O(n). Partial if order is lost (e.g. set(s)).")

dsa("qb-dsa-13","Longest Common Prefix.",
"A file manager groups file names by their longest common starting text. Return the longest common prefix of a list of words. If there is none, return the string 'No common prefix'.",
"Input: a list of strings words. Output: the common prefix string, or 'No common prefix'.",
"1 <= number of words <= 1e4.",
"def common_prefix(words):\n    prefix = words[0]\n    for w in words[1:]:\n        while not w.startswith(prefix):\n            prefix = prefix[:-1]\n            if not prefix: return 'No common prefix'\n    return prefix if prefix else 'No common prefix'",
f"Example 1\n{F}\nInput:  [\"flower\", \"flow\", \"flight\"]\nOutput: fl\n{F}\nEvery word starts with 'fl'.\nExample 2\n{F}\nInput:  [\"dog\", \"racecar\", \"car\"]\nOutput: No common prefix\n{F}",
"fl",
"Start with the first word as the prefix and trim its last character until every other word starts with it.",
"Shrink a candidate prefix until all words share it; handle the empty-prefix case. Partial: forgets the 'no prefix' case.")

dsa("qb-dsa-14","Is It a Rotation?",
"A scrolling banner rotates its text. Given the original text s1 and what's on screen now s2, return 'Yes' if s2 is a rotation of s1, otherwise 'No'. Try to do it with a single containment check.",
"Input: two strings s1 and s2. Output: 'Yes' or 'No'.",
"1 <= length <= 1e5.",
"def is_rotation(s1, s2):\n    return 'Yes' if len(s1) == len(s2) and s2 in s1 + s1 else 'No'",
f"Example 1\n{F}\nInput:  s1 = \"waterbottle\", s2 = \"erbottlewat\"\nOutput: Yes\n{F}\n'erbottlewat' appears inside 'waterbottlewaterbottle'.\nExample 2\n{F}\nInput:  s1 = \"abcd\", s2 = \"acbd\"\nOutput: No\n{F}",
"Yes",
"Every rotation of s1 is a substring of s1 + s1 — but check the lengths are equal first.",
"s2 in s1+s1 with an equal-length guard. Partial: forgets the length check (e.g. 'ca' wrongly matches 'abc').")

dsa("qb-dsa-15","Validate an IPv4 Address.",
"A settings page must reject badly typed IP addresses. Return 'Valid' if the string is a valid IPv4 address, else 'Invalid'. A valid address has exactly four parts separated by dots; each part is digits only, 0 to 255, with no leading zeros (except '0' itself).",
"Input: a string s. Output: 'Valid' or 'Invalid'.",
"1 <= length <= 50.",
"def validate_ip(s):\n    parts = s.split('.')\n    if len(parts) != 4: return 'Invalid'\n    for p in parts:\n        if not p.isdigit() or (len(p) > 1 and p[0] == '0') or int(p) > 255:\n            return 'Invalid'\n    return 'Valid'",
f"Example 1\n{F}\nInput:  \"192.168.1.1\"\nOutput: Valid\n{F}\nFour parts, each all-digits and in 0-255 with no leading zeros.\nExample 2\n{F}\nInput:  \"256.10.0.1\"\nOutput: Invalid\n{F}\n256 is greater than 255, so this part is out of range.\nMore cases: \"10.01.2.3\" -> Invalid (leading zero), \"1.2.3\" -> Invalid (only 3 parts), \"1.2.3.a\" -> Invalid (not digits).",
"Valid",
"Split on '.', require exactly four parts, and for each check: all digits, no leading zero, and value 0-255.",
"Exactly 4 parts; each digits-only, 0-255, no leading zeros. Partial: misses leading zeros, the 4-part count, or crashes on non-digits.")

dsa("qb-dsa-16","Roman Numeral to Integer.",
"A museum app converts the year carved on a monument from Roman numerals to a number. Convert a valid Roman numeral (I, V, X, L, C, D, M) to an integer. A smaller value before a larger one is subtracted (IV = 4, CM = 900).",
"Input: a Roman numeral string s. Output: an integer.",
"1 <= length <= 15.",
"def roman_to_int(s):\n    val = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}\n    total = 0\n    for i, ch in enumerate(s):\n        if i + 1 < len(s) and val[ch] < val[s[i+1]]:\n            total -= val[ch]\n        else:\n            total += val[ch]\n    return total",
f"Example 1\n{F}\nInput:  \"MCMXCIV\"\nOutput: 1994\n{F}\nM=1000, CM=900, XC=90, IV=4.\nExample 2\n{F}\nInput:  \"LVIII\"\nOutput: 58\n{F}\nL=50, V=5, III=3.",
"1994",
"Add each symbol's value, but SUBTRACT it when the next symbol is larger than it.",
"Add values, subtract when the next symbol is larger. Partial: handles only addition (misses IV/CM subtraction).")

# ---- Scenario debugging (find + fix the bug in real app code) ----
# These are SCENARIO questions (each opens with a real-world scenario), NOT DSA
# algorithm questions — so they live in the scenario section. Each student gets
# exactly 1 DSA + 1 Scenario, so keeping the DSA pool pure-algorithm matters.
def debug(qid, title, scenario, code, expected, actual, bug, fix_code, hint, extra, diff="easy"):
    prompt = (f"Debugging: {title}\nScenario: {scenario}\n"
              "The program below runs but is wrong. (1) Identify the bug, (2) explain WHY it happens, "
              "and (3) write the corrected code. The code is shown in the example box.")
    # Two cases: the failing run (expected vs actual), plus a second input the FIXED
    # code must also satisfy — so the candidate can sanity-check their correction.
    sample = (f"Example 1 (the failing run)\n{F}\nCode\n{code}\n{F}\n"
              f"Expected output: {expected}\nActual (buggy) output:   {actual}\n\n"
              f"Example 2 (your fix must also pass)\n{F}\n{extra}\n{F}")
    ref = f"Bug: {bug}\nCorrected code:\n{fix_code}"
    rubric = "Full marks: correct bug identified + a clear why + a working fix that passes both cases. Partial: spots the bug but the fix is wrong/incomplete, or the fix works but the reasoning is thin."
    add(qid, "scenario", prompt, ref, sample, expected, hint, rubric, 5, diff)

debug("qb-scn-10","Class Average",
"A report card app shows the average of a student's marks.",
"def average(marks):\n    return sum(marks) // len(marks)\n\nprint(average([90, 85, 80, 78]))",
"83.25","83",
"Integer (floor) division // drops the decimal part.",
"return sum(marks) / len(marks)",
"Look closely at the division operator.",
"average([10, 20])  ->  15.0")

debug("qb-scn-11","Remove Duplicate Order IDs",
"An order system removes repeated order IDs but must keep the first-seen order.",
"def unique(arr):\n    seen = set()\n    result = []\n    for x in arr:\n        if x not in seen:\n            result.append(x)\n    return result\n\nprint(unique([3, 1, 3, 2, 1]))",
"[3, 1, 2]","[3, 1, 3, 2, 1]",
"The value is never added to `seen`, so the set stays empty and nothing is ever treated as a duplicate.",
"add seen.add(x) right after result.append(x)",
"Something is being read from `seen` but never written to it.",
"unique([5, 5, 5, 1])  ->  [5, 1]")

debug("qb-scn-12","Shopping Cart Leaks Between Users",
"Each call should start a new, empty cart, but the second customer sees the first customer's items.",
"def add_item(item, cart=[]):\n    cart.append(item)\n    return cart\n\nprint(add_item('pen'))\nprint(add_item('book'))",
"['pen'] then ['book']","['pen'] then ['pen', 'book']",
"A mutable default argument (cart=[]) is created ONCE and shared across all calls.",
"def add_item(item, cart=None):\n    if cart is None: cart = []\n    cart.append(item); return cart",
"Default argument values are evaluated once, when the function is defined.",
"add_item('milk')  ->  ['milk']   (a fresh call must start empty)","moderate")

debug("qb-scn-13","Binary Search Misses the Last Item",
"A sorted list of employee IDs is searched with binary search, but some IDs that exist are reported as missing.",
"def binary_search(arr, key):\n    low, high = 0, len(arr) - 1\n    while low < high:\n        mid = (low + high) // 2\n        if arr[mid] == key: return mid\n        elif arr[mid] < key: low = mid + 1\n        else: high = mid - 1\n    return -1\n\nprint(binary_search([1, 3, 5, 7, 9], 9))",
"4","-1",
"The loop condition `low < high` exits when low == high, so the final single candidate is never checked.",
"use while low <= high:",
"Think about what happens when low and high meet.",
"binary_search([5], 5)  ->  0   (a single-element list)","moderate")

debug("qb-scn-14","Seating Chart Transpose",
"A seating chart stored row by row must be flipped so rows become columns.",
"def transpose(m):\n    rows, cols = len(m), len(m[0])\n    t = [[0] * rows] * cols\n    for i in range(rows):\n        for j in range(cols):\n            t[j][i] = m[i][j]\n    return t\n\nprint(transpose([[1, 2, 3], [4, 5, 6]]))",
"[[1, 4], [2, 5], [3, 6]]","[[3, 6], [3, 6], [3, 6]]",
"[[0]*rows]*cols repeats ONE inner list, so all rows are the same object — writing one writes all.",
"t = [[0] * rows for _ in range(cols)]",
"The grid rows all change together — how was the 2-D list created?",
"transpose([[1, 2], [3, 4]])  ->  [[1, 3], [2, 4]]","moderate")

debug("qb-scn-15","Letter Frequency Crashes",
"A word puzzle counts how often each letter appears.",
"def char_count(s):\n    count = {}\n    for ch in s:\n        count[ch] += 1\n    return count\n\nprint(char_count('banana'))",
"{'b': 1, 'a': 3, 'n': 2}","KeyError: 'b'",
"count[ch] += 1 reads count[ch] before it exists the first time a letter is seen.",
"count[ch] = count.get(ch, 0) + 1   # or use collections.defaultdict(int)",
"What is count[ch] on the very first time you see a letter?",
"char_count('aba')  ->  {'a': 2, 'b': 1}")

debug("qb-scn-16","Count Capitalised Words Crashes",
"An editor counts words that start with a capital letter, but it crashes when the user types two spaces.",
"def count_capitalised(text):\n    count = 0\n    for word in text.split(' '):\n        if word[0].isupper():\n            count += 1\n    return count\n\nprint(count_capitalised('Welcome  to Hevo Data'))",
"3","IndexError: string index out of range",
"split(' ') on a double space produces an empty string, and word[0] fails on it.",
"use text.split() with no argument (collapses whitespace), or skip empty words",
"A double space produces an unexpected token in the split result.",
"count_capitalised('Hi  There')  ->  2   (note the double space)","moderate")

debug("qb-scn-17","Secret Message Cipher",
"A chat game shifts each lowercase letter forward by k places, wrapping from z back to a.",
"def encrypt(text, k):\n    return ''.join(chr(ord(ch) + k) for ch in text)\n\nprint(encrypt('xyz', 3))",
"abc","{|}",
"Adding k to the code point runs past 'z' into symbols — there is no wrap-around.",
"chr((ord(ch) - ord('a') + k) % 26 + ord('a'))",
"After 'z' you must wrap back to 'a' — think modulo 26.",
"encrypt('az', 1)  ->  'ba'   ('z' wraps around to 'a')","moderate")

# ============================================================ Scenario (real-world coding, marks 5)
def scn(qid, title, scenario, task, io, constraints, ref, examples, expected, hint, rubric, diff="medium"):
    prompt = f"{title}\nScenario: {scenario}\nTask: {task}\n{io}\nConstraints: {constraints}"
    add(qid, "scenario", prompt, ref, examples, expected, hint, rubric, 5, diff)

scn("qb-scn-01","Most Common Words in a Review.",
"a store wants the k most frequent words in a customer review. Ignore case and punctuation; on a tie, order the tied words alphabetically.",
"Given the review text and an integer k, return the k most frequent words as a list (lowercase).",
"Input: a string review and an integer k. Output: a list of k words.",
"review length <= 1e5.",
"import re\nfrom collections import Counter\ndef top_k(review, k):\n    words = re.findall(r'[a-z]+', review.lower())\n    c = Counter(words)\n    return [w for w, _ in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]",
f"Example 1\n{F}\nInput:\n  review = \"Great phone. Battery is great, camera is good. Battery life is great!\"\n  k = 2\nOutput:\n  ['great', 'is']\n{F}\nCounts: great=3, is=3, battery=2, good=1, ... 'great' and 'is' tie at 3 and are the two most frequent.\nExample 2\n{F}\nInput:\n  review = \"ok ok fine fine good\"\n  k = 2\nOutput:\n  ['fine', 'ok']\n{F}\n'ok' and 'fine' both appear twice; the tie is broken alphabetically, so 'fine' comes before 'ok'.",
"['great', 'is']",
"Lowercase and strip punctuation, count the words, then sort by (-count, word) so ties go alphabetically.",
"Normalise case + strip punctuation, count, sort by (-count, word). Partial: punctuation/case not handled or tie-break wrong.")

scn("qb-scn-02","Best Day to Buy and Sell.",
"prices[i] is a share's price on day i. You may buy on one day and sell on a LATER day, at most once.",
"Return the maximum profit. If no profit is possible, return 0.",
"Input: a list prices. Output: an integer (max profit, or 0).",
"1 <= n <= 1e5.",
"def max_profit(prices):\n    low = float('inf'); best = 0\n    for p in prices:\n        low = min(low, p)\n        best = max(best, p - low)\n    return best",
f"Example 1\n{F}\nInput:  prices = [7, 1, 5, 3, 6, 4]\nOutput: 5\n{F}\nBuy at 1 (day 2), sell at 6 (day 5): profit 5.\nExample 2\n{F}\nInput:  prices = [7, 6, 4, 3, 1]\nOutput: 0\n{F}\nPrices only fall, so the best choice is not to trade.",
"5",
"Track the lowest price seen so far and the best profit if you sold today — you must sell AFTER you buy.",
"One pass tracking the min price so far (not max-minus-min of the whole array). A correct O(n^2) answer earns most marks.")

scn("qb-scn-03","Minimum Railway Platforms.",
"arrivals[] and departures[] are train times in 24-hour HHMM. A platform holds one train at a time; a train arriving exactly when another departs still needs its own platform.",
"Return the minimum number of platforms so that no train has to wait.",
"Input: two lists arrivals and departures (same length). Output: an integer.",
"1 <= n <= 1e5.",
"def min_platforms(arr, dep):\n    arr.sort(); dep.sort()\n    i = j = plat = best = 0\n    while i < len(arr):\n        if arr[i] <= dep[j]:\n            plat += 1; best = max(best, plat); i += 1\n        else:\n            plat -= 1; j += 1\n    return best",
f"Example 1\n{F}\nInput:\n  arrivals   = [900, 940, 950, 1100, 1500, 1800]\n  departures = [910, 1200, 1120, 1130, 1900, 2000]\nOutput: 3\n{F}\nBetween 11:00 and 11:20 three trains are at the station at once, so 3 platforms are needed.\nExample 2\n{F}\nInput:\n  arrivals   = [900, 1000]\n  departures = [930, 1030]\nOutput: 1\n{F}\nThe first train leaves at 9:30, before the second arrives at 10:00, so one platform serves both.",
"3",
"Sort arrivals and departures, then sweep with two pointers — an arrival needs a platform, a departure frees one; track the peak.",
"Sort both + two-pointer sweep; an arrival equal to a departure needs a platform (use <=). A correct O(n^2) answer earns most marks.")

scn("qb-scn-04","Compress an SMS Message.",
"a messaging app shrinks runs of repeated characters: each run becomes the character followed by its count ('aaabb' -> 'a3b2').",
"Return the compressed string, or the ORIGINAL string if the compressed version is not shorter.",
"Input: a string s. Output: the compressed or original string.",
"1 <= length <= 1e5.",
"def compress(s):\n    if not s: return s\n    out = []; count = 1\n    for i in range(1, len(s) + 1):\n        if i < len(s) and s[i] == s[i-1]:\n            count += 1\n        else:\n            out.append(s[i-1] + str(count)); count = 1\n    c = ''.join(out)\n    return c if len(c) < len(s) else s",
f"Example 1\n{F}\nInput:  \"aaabccdddd\"\nOutput: \"a3b1c2d4\"\n{F}\nCompressed length 8 < original 10, so the compressed form is used.\nExample 2\n{F}\nInput:  \"abc\"\nOutput: \"abc\"\n{F}\n'a1b1c1' (length 6) is longer than 'abc', so the original is kept.",
"a3b1c2d4",
"Walk the string counting runs; remember to flush the LAST run, then keep whichever of compressed/original is shorter.",
"Run-length encode, handle the last run, keep the shorter of compressed vs original. Partial: last group dropped or not-shorter rule missed.")

scn("qb-scn-05","Suspicious Transactions.",
"transactions[] are amounts in order. A transaction is suspicious if it is MORE than 5x the average of the previous 3 transactions.",
"Return a list of the indices of all suspicious transactions. The first three can never be suspicious.",
"Input: a list transactions. Output: a list of indices.",
"1 <= n <= 1e5.",
"def suspicious(tx):\n    out = []\n    if len(tx) < 4: return out\n    s = sum(tx[:3])\n    for i in range(3, len(tx)):\n        if tx[i] > 5 * (s / 3):\n            out.append(i)\n        s += tx[i] - tx[i-3]\n    return out",
f"Example 1\n{F}\nInput:  [100, 200, 150, 5000, 120, 130, 7000]\nOutput: [3, 6]\n{F}\nIndex 3 (5000) > 5 x avg(100,200,150)=250. Index 6 (7000) > 5 x avg(5000,120,130).\nExample 2\n{F}\nInput:  [100, 100, 100, 200]\nOutput: []\n{F}\nIndex 3 (200) is not more than 5 x avg(100,100,100)=500, so nothing is flagged. The first three can never be suspicious.",
"[3, 6]",
"Keep a sliding window of the previous 3 amounts and compare each new amount to 5x their (float) average.",
"Sliding window over the previous 3, float average, strict > 5x. Partial: off-by-one window or integer-division slip.")

scn("qb-scn-06","Sunset View Buildings.",
"a row of buildings faces the sea to the right. A building can see the sunset only if it is taller than EVERY building to its right.",
"Return the heights of all buildings that can see the sunset, in their original left-to-right order.",
"Input: a list heights. Output: a list of heights.",
"1 <= n <= 1e5.",
"def sunset_view(heights):\n    res = []\n    tallest = float('-inf')\n    for h in reversed(heights):\n        if h > tallest:\n            res.append(h); tallest = h\n    return res[::-1]",
f"Example 1\n{F}\nInput:  [16, 17, 4, 3, 5, 2]\nOutput: [17, 5, 2]\n{F}\nThe last building always sees the sunset. 5 is taller than 2, and 17 is taller than everything to its right.\nExample 2\n{F}\nInput:  [1, 2, 3, 4]\nOutput: [4]\n{F}\nHeights only increase, so every building is blocked by a taller one to its right — only the last (4) sees the sunset.",
"[17, 5, 2]",
"Scan from the RIGHT, tracking the tallest seen so far; a building is visible if it beats that running max.",
"Right-to-left scan tracking the running max, then restore left-to-right order. A correct O(n^2) answer earns most marks.")

scn("qb-scn-07","Merge Two Delivery Schedules.",
"two delivery partners each send a SORTED list of delivery times (in minutes). Dispatch needs a single sorted schedule.",
"Merge the two sorted lists into one sorted list WITHOUT calling sort() or sorted().",
"Input: two sorted lists a and b. Output: one merged sorted list.",
"1 <= total length <= 1e5.",
"def merge_sorted(a, b):\n    i = j = 0\n    merged = []\n    while i < len(a) and j < len(b):\n        if a[i] <= b[j]: merged.append(a[i]); i += 1\n        else: merged.append(b[j]); j += 1\n    merged.extend(a[i:]); merged.extend(b[j:])\n    return merged",
f"Example 1\n{F}\nInput:  a = [1, 4, 7, 10], b = [2, 3, 9]\nOutput: [1, 2, 3, 4, 7, 9, 10]\n{F}\nCompare the fronts of both lists and take the smaller each time.\nExample 2\n{F}\nInput:  a = [5], b = [1, 2, 3]\nOutput: [1, 2, 3, 5]\n{F}\nAll of b is taken first; once b runs out, the leftover 5 from a is appended.",
"[1, 2, 3, 4, 7, 9, 10]",
"Two pointers compare the fronts of both lists; after one runs out, append the rest of the other.",
"Two-pointer merge without sort(); appends the leftover tail. Partial: forgets the leftover elements or uses sort().")

scn("qb-scn-08","Count Subarrays That Hit the Target.",
"an audit team wants how many continuous stretches of transactions add up to exactly k rupees. Amounts can be negative (refunds).",
"Count the contiguous subarrays whose sum equals k.",
"Input: a list nums and an integer k. Output: an integer count.",
"1 <= n <= 1e5; values may be negative.",
"def count_subarrays(nums, k):\n    seen = {0: 1}\n    running = count = 0\n    for x in nums:\n        running += x\n        count += seen.get(running - k, 0)\n        seen[running] = seen.get(running, 0) + 1\n    return count",
f"Example 1\n{F}\nInput:  nums = [1, 1, 1], k = 2\nOutput: 2\n{F}\n[1,1] appears twice.\nExample 2\n{F}\nInput:  nums = [3, 4, 7, 2, -3, 1, 4, 2], k = 7\nOutput: 4\n{F}",
"2",
"Use prefix sums in a dict: for each running sum, add how many times (running - k) has appeared. A sliding window fails with negatives.",
"Prefix-sum counts in a hash map (O(n)); note a sliding window won't work with negatives. Partial: O(n^2) brute force (still mostly correct).")

scn("qb-scn-09","Election Winner by Majority.",
"votes are stored as candidate IDs. A candidate wins outright only with MORE than half of all votes.",
"Return the majority candidate, or None if nobody has more than n/2 votes. Aim for O(n) time and O(1) extra space.",
"Input: a list votes. Output: a candidate ID, or None.",
"1 <= n <= 1e5.",
"def majority(votes):\n    candidate, count = None, 0\n    for v in votes:\n        if count == 0: candidate = v\n        count += 1 if v == candidate else -1\n    return candidate if votes.count(candidate) > len(votes) // 2 else None",
f"Example 1\n{F}\nInput:  [2, 2, 1, 1, 1, 2, 2]\nOutput: 2\n{F}\n2 appears 4 times out of 7 (> 3.5).\nExample 2\n{F}\nInput:  [1, 2, 3, 1]\nOutput: None\n{F}\nNo candidate has more than 2 votes.",
"2",
"Boyer-Moore voting: keep a candidate and a counter; then VERIFY the candidate actually has > n/2 votes.",
"Boyer-Moore (or a counts dict) PLUS a final check that it exceeds n/2. Partial: finds a candidate but skips the majority verification.")

# Questions that existed under an OLD id in a previous seed and have since been
# renamed/recategorised. Deleting them on re-seed stops stale copies lingering in
# the bank. The debugging questions moved from DSA (qb-dsa-17..24) into the scenario
# section (qb-scn-10..17), so the old DSA-categorised rows must be removed.
RETIRED_IDS = [f"qb-dsa-{n}" for n in range(17, 25)]

# ============================================================ emit SQL
lines = [
"-- Talo question bank seed. SQL 6, Python 4, DSA 16 (algorithms + coding), Scenario 17 (real-world + debugging).",
"-- Self-contained: prompt + worked Example + expected output + HINT + rubric. Re-runnable.",
"",
"-- 1) Rebuild question_bank to allow all 4 categories AND the hint column.",
"PRAGMA foreign_keys=OFF;",
"CREATE TABLE IF NOT EXISTS question_bank_rebuild (",
"  id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK (category IN ('sql','python','dsa','scenario')),",
"  prompt TEXT NOT NULL, reference_answer TEXT, sample_data TEXT, rubric TEXT, hint TEXT,",
"  marks INTEGER NOT NULL DEFAULT 3, difficulty TEXT DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'active',",
"  active INTEGER NOT NULL DEFAULT 1, expected_output TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')) );",
"INSERT OR IGNORE INTO question_bank_rebuild (id,category,prompt,reference_answer,sample_data,rubric,marks,difficulty,status,active,expected_output,created_at)",
"  SELECT id,category,prompt,reference_answer,sample_data,rubric,marks,difficulty,status,active,expected_output,created_at FROM question_bank;",
"DROP TABLE question_bank;",
"ALTER TABLE question_bank_rebuild RENAME TO question_bank;",
"CREATE INDEX IF NOT EXISTS idx_qbank_cat_active ON question_bank(category, active);",
"PRAGMA foreign_keys=ON;",
"",
"-- 2) Remove retired/recategorised questions so no stale copy survives a re-seed.",
"DELETE FROM question_bank WHERE id IN (%s);" % ", ".join("'%s'" % esc(i) for i in RETIRED_IDS),
"",
"-- 3) The questions.",
]
for (qid,cat,prompt,ref,sample,exp,hint,rubric,marks,diff) in Q:
    lines.append(
      "INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ("
      f"'{esc(qid)}','{esc(cat)}','{esc(prompt)}','{esc(ref)}','{esc(sample)}','{esc(exp)}','{esc(hint)}','{esc(rubric)}',{marks},'{esc(diff)}','active',1);")

open('loadtest/questions-seed.sql','w').write("\n".join(lines) + "\n")
from collections import Counter
c = Counter(x[1] for x in Q)
print("questions:", len(Q), dict(c))
print("wrote loadtest/questions-seed.sql")
