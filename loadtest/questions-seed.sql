-- Talo question bank seed. SQL 6, Python 4, DSA 16 (algorithms + coding), Scenario 17 (real-world + debugging).
-- Self-contained: prompt + worked Example + expected output + HINT + rubric. Re-runnable.

-- 1) Rebuild question_bank to allow all 4 categories AND the hint column.
PRAGMA foreign_keys=OFF;
CREATE TABLE IF NOT EXISTS question_bank_rebuild (
  id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK (category IN ('sql','python','dsa','scenario')),
  prompt TEXT NOT NULL, reference_answer TEXT, sample_data TEXT, rubric TEXT, hint TEXT,
  marks INTEGER NOT NULL DEFAULT 3, difficulty TEXT DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'active',
  active INTEGER NOT NULL DEFAULT 1, expected_output TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')) );
INSERT OR IGNORE INTO question_bank_rebuild (id,category,prompt,reference_answer,sample_data,rubric,marks,difficulty,status,active,expected_output,created_at)
  SELECT id,category,prompt,reference_answer,sample_data,rubric,marks,difficulty,status,active,expected_output,created_at FROM question_bank;
DROP TABLE question_bank;
ALTER TABLE question_bank_rebuild RENAME TO question_bank;
CREATE INDEX IF NOT EXISTS idx_qbank_cat_active ON question_bank(category, active);
PRAGMA foreign_keys=ON;

-- 2) Remove retired/recategorised questions so no stale copy survives a re-seed.
DELETE FROM question_bank WHERE id IN ('qb-dsa-17', 'qb-dsa-18', 'qb-dsa-19', 'qb-dsa-20', 'qb-dsa-21', 'qb-dsa-22', 'qb-dsa-23', 'qb-dsa-24');

-- 3) The questions.
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-sql-01','sql','Scenario: An e-commerce team wants the total amount each customer has spent so they can rank their best customers.
Table: orders(customer_id INT, amount INT).
Task: Return each customer_id with the SUM of their amount, highest total first.','SELECT customer_id, SUM(amount) AS total
FROM orders
GROUP BY customer_id
ORDER BY total DESC;','Table: orders
| customer_id | amount |
| 1 | 100 |
| 2 | 50 |
| 1 | 70 |','| customer_id | total |
| 1 | 170 |
| 2 | 50 |','Group the rows per customer and SUM, then ORDER BY the total descending.','GROUP BY customer_id + SUM(amount) + descending order. Partial if grouping is right but ordering missing.',3,'easy','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-sql-02','sql','Scenario: HR needs the second-highest distinct salary for a bonus rule.
Table: employees(name TEXT, salary INT).
Task: Return the single second-highest DISTINCT salary. If it doesn''t exist, return NULL.','SELECT MAX(salary) AS second_highest
FROM employees
WHERE salary < (SELECT MAX(salary) FROM employees);','Table: employees
| name | salary |
| A | 100 |
| B | 100 |
| C | 80 |','| second_highest |
| 80 |','The top salary can repeat — find the max salary strictly below the overall max.','Handles duplicates of the top salary (< MAX subquery, DISTINCT, or OFFSET). Partial if it returns the top or a duplicate.',3,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-sql-03','sql','Scenario: Marketing wants customers who have never placed an order so they can re-engage them.
Tables: customers(id INT, name TEXT), orders(id INT, customer_id INT).
Task: Return the name of every customer with NO matching row in orders.','SELECT c.name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;','customers:
| id | name |
| 1 | A |
| 2 | B |
| 3 | C |
orders:
| id | customer_id |
| 10 | 1 |
| 11 | 1 |','| name |
| B |
| C |','This is an anti-join — a LEFT JOIN where the right side is NULL, or NOT EXISTS / NOT IN.','Correct anti-join (LEFT JOIN ... IS NULL / NOT EXISTS / NOT IN) = full marks. Partial for an INNER JOIN returning the wrong set.',3,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-sql-04','sql','Scenario: A store wants its top 3 products by total revenue for a featured shelf.
Tables: products(id INT, name TEXT), order_items(product_id INT, qty INT, price INT).
Task: Return product name and total revenue (SUM(qty*price)), highest first, top 3 only.','SELECT p.name, SUM(oi.qty * oi.price) AS revenue
FROM products p
JOIN order_items oi ON oi.product_id = p.id
GROUP BY p.id, p.name
ORDER BY revenue DESC
LIMIT 3;','products:
| id | name |
| 1 | Pen |
| 2 | Book |
order_items:
| product_id | qty | price |
| 1 | 2 | 10 |
| 2 | 1 | 50 |
| 1 | 1 | 10 |','| name | revenue |
| Book | 50 |
| Pen | 30 |','JOIN the tables, SUM(qty*price) per product, then ORDER BY revenue DESC and LIMIT 3.','JOIN + GROUP BY + SUM(qty*price) + ORDER BY revenue DESC + LIMIT 3. Partial if aggregate right but ordering/limit missing.',3,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-sql-05','sql','Scenario: A signup table was imported twice, so some emails repeat and need flagging.
Table: users(id INT, email TEXT).
Task: Return every email that appears more than once, alphabetically. Each duplicate listed once.','SELECT email
FROM users
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY email;','users:
| id | email |
| 1 | a@x.com |
| 2 | b@x.com |
| 3 | a@x.com |','| email |
| a@x.com |','Group by email and keep only the groups whose COUNT is greater than 1 (HAVING, not WHERE).','GROUP BY email + HAVING COUNT(*) > 1. Partial if it lists all rows or forgets HAVING.',3,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-sql-06','sql','Scenario: Analytics wants signups per month for a trend chart.
Table: signups(id INT, created_at TEXT -- ''YYYY-MM-DD'').
Task: Return the month (''YYYY-MM'') and the count of signups in that month, earliest month first.','SELECT strftime(''%Y-%m'', created_at) AS month, COUNT(*) AS signups
FROM signups
GROUP BY month
ORDER BY month;','signups:
| id | created_at |
| 1 | 2026-01-03 |
| 2 | 2026-01-20 |
| 3 | 2026-02-02 |','| month | signups |
| 2026-01 | 2 |
| 2026-02 | 1 |','Truncate the date to year-month (strftime / substr) and GROUP BY that.','Group by the year-month derived from the date (any correct date truncation). Partial if grouping by full date.',3,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-py-01','python','Scenario: A reviews tool needs the single most frequent word in a review.
Task: Given a lowercase sentence (words separated by single spaces), return the most frequent word and its count in the format ''word count''. On a tie, return the word that appears FIRST in the sentence.
Input: a string s. Output: a string ''word count''.','def most_frequent(s):
    freq, first = {}, {}
    for i, w in enumerate(s.split()):
        freq[w] = freq.get(w, 0) + 1
        if w not in first: first[w] = i
    best = max(freq, key=lambda w: (freq[w], -first[w]))
    return f"{best} {freq[best]}"','Example
```
Input:  s = "the food was good and the service was good"
Output: "the 2"
```
''the'', ''was'' and ''good'' each appear twice; ''the'' appears first, so it wins the tie.','the 2','Count with a dict; break ties by first-seen index.','Correct counting with the right first-seen tie-break = full marks; partial if counting right but tie-break wrong.',4,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-py-02','python','Scenario: A data job must merge two already-sorted lists of IDs into one sorted list.
Task: Given two ascending lists a and b, return a single ascending list with all elements (keep duplicates). Aim for O(n+m), not a full re-sort.
Input: two lists a and b. Output: one merged ascending list.','def merge(a, b):
    i = j = 0
    out = []
    while i < len(a) and j < len(b):
        if a[i] <= b[j]: out.append(a[i]); i += 1
        else: out.append(b[j]); j += 1
    out.extend(a[i:]); out.extend(b[j:])
    return out','Example
```
Input:  a = [1, 3, 5], b = [2, 3, 6]
Output: [1, 2, 3, 3, 5, 6]
```
Both 3s are kept; the result stays in ascending order.','[1, 2, 3, 3, 5, 6]','Walk both lists with two pointers; don''t forget the leftover tail of whichever list isn''t exhausted.','Two-pointer merge (re-sorting is weaker but acceptable). Partial for a correct re-sort or a small bug.',4,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-py-03','python','Scenario: A log pipeline counts how many times each log level appears.
Task: Given a string of space-separated levels (e.g. ''INFO ERROR INFO''), return a dict mapping each level to its count.
Input: a string logs. Output: a dict {level: count}.','def count_levels(logs):
    freq = {}
    for lvl in logs.split():
        freq[lvl] = freq.get(lvl, 0) + 1
    return freq','Example
```
Input:  logs = "INFO ERROR INFO WARN ERROR ERROR"
Output: {''INFO'': 2, ''ERROR'': 3, ''WARN'': 1}
```
Each distinct level maps to how many times it appears.','{''INFO'': 2, ''ERROR'': 3, ''WARN'': 1}','A frequency dict (or collections.Counter) over the split tokens.','Correct counts = full marks. Partial for an off-by-one or a missing level.',4,'easy','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-py-04','python','Scenario: A chat app removes CONSECUTIVE duplicate messages (non-consecutive repeats are kept).
Task: Given a list of message strings, return a new list with runs of the same message collapsed to one.
Input: a list msgs. Output: a list with consecutive duplicates removed.','def dedupe_consecutive(msgs):
    out = []
    for m in msgs:
        if not out or out[-1] != m:
            out.append(m)
    return out','Example
```
Input:  msgs = [''A'', ''A'', ''B'', ''B'', ''B'', ''A'', ''A'']
Output: [''A'', ''B'', ''A'']
```
Only adjacent repeats are collapsed, so the later ''A'' run is kept as its own entry.','[''A'', ''B'', ''A'']','Compare each message only with the LAST one you kept, not with everything seen.','Collapse only ADJACENT duplicates. Partial if it removes all duplicates instead of consecutive ones.',4,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-01','dsa','Second Largest Element.
Task: Given an array of integers, return the SECOND LARGEST distinct value. If it does not exist (fewer than 2 distinct values), return -1.
Input: an array of n integers. Output: a single integer.
Constraints: 1 <= n <= 1e5.','def second_largest(arr):
    first = second = float(''-inf'')
    for x in arr:
        if x > first: second, first = first, x
        elif x != first and x > second: second = x
    return second if second != float(''-inf'') else -1','Example 1
```
Input:  [12, 35, 1, 10, 34, 1]
Output: 34
```
35 is the largest; 34 is the next distinct value.
Example 2
```
Input:  [10, 10, 10]
Output: -1
```
Only one distinct value exists, so there is no second largest.','34','Track the largest and second-largest in one pass, and skip values equal to the largest.','Finds the second largest DISTINCT value (one pass or sort) and handles duplicates of the maximum. Partial: returns a duplicate of the max, or misses the ''no second value'' case.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-02','dsa','Valid Palindrome.
Task: Given a string, return True if it reads the same forwards and backwards after lowercasing and removing all non-alphanumeric characters, else False.
Input: a string s. Output: True or False.
Constraints: 1 <= length <= 1e5.','def is_palindrome(s):
    t = [c.lower() for c in s if c.isalnum()]
    return t == t[::-1]','Example 1
```
Input:  "A man, a plan, a canal: Panama"
Output: True
```
After cleaning it becomes ''amanaplanacanalpanama'', a palindrome.
Example 2
```
Input:  "hello"
Output: False
```','True','Clean the string first (keep only alphanumerics, lowercase), then compare it to its reverse — or use two pointers.','Correct approach ignoring case and punctuation. Partial if case/punctuation handling is missed.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-03','dsa','First Non-Repeating Character.
Task: Given a lowercase string, return the INDEX of the first character that appears exactly once. If none exists, return -1.
Input: a string s. Output: an integer index, or -1.
Constraints: 1 <= length <= 1e5.','def first_unique(s):
    from collections import Counter
    c = Counter(s)
    for i, ch in enumerate(s):
        if c[ch] == 1: return i
    return -1','Example 1
```
Input:  "loveleetcode"
Output: 2
```
''l'' and ''o'' repeat; ''v'' at index 2 is the first that appears once.
Example 2
```
Input:  "aabb"
Output: -1
```
Every character repeats.','2','Count every character first, then scan left to right for the first with count 1.','Count then find the first with count 1 (O(n)). Partial: a correct O(n^2) scan, or an off-by-one; must return -1 when all repeat.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-04','dsa','Move Zeros to the End.
Task: Given an array, move all zeros to the END while keeping the order of the non-zero elements. Do it in place.
Input: an array nums. Output: the same array with zeros moved to the end.
Constraints: 1 <= n <= 1e5.','def move_zeros(nums):
    pos = 0
    for x in nums:
        if x != 0:
            nums[pos] = x; pos += 1
    for i in range(pos, len(nums)):
        nums[i] = 0
    return nums','Example 1
```
Input:  [0, 1, 0, 3, 12]
Output: [1, 3, 12, 0, 0]
```
Non-zeros keep their order; the two zeros move to the end.
Example 2
```
Input:  [0, 0, 1]
Output: [1, 0, 0]
```','[1, 3, 12, 0, 0]','Use a write pointer: copy each non-zero forward, then fill the rest with zeros.','Write-pointer in place, order of non-zeros preserved (extra list is fine). Partial: order lost, or zeros not all moved.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-05','dsa','Two Sum.
Task: Given an array nums and a target, return the INDICES of the two numbers that add up to the target. Exactly one solution exists; the same element can''t be used twice.
Input: an array nums and an integer target. Output: a list of two indices.
Constraints: 2 <= n <= 1e5.','def two_sum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        if target - x in seen: return [seen[target - x], i]
        seen[x] = i
    return []','Example 1
```
Input:  nums = [2, 7, 11, 15], target = 9
Output: [0, 1]
```
nums[0] + nums[1] = 2 + 7 = 9.
Example 2
```
Input:  nums = [3, 3], target = 6
Output: [0, 1]
```','[0, 1]','Store each number''s index in a hash map; for each number check whether target - number was already seen.','Hash map in one pass (O(n)); a correct O(n^2) brute force earns most marks. Must not reuse the same index.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-06','dsa','Valid Parentheses.
Task: Given a string containing only the characters ()[]{} , return True if every bracket is closed by the same type in the correct order, else False.
Input: a string s. Output: True or False.
Constraints: 1 <= length <= 1e5.','def is_valid(s):
    pairs = {'')'':''('', '']'':''['', ''}'':''{''}
    st = []
    for ch in s:
        if ch in ''([{'': st.append(ch)
        elif not st or st.pop() != pairs[ch]: return False
    return not st','Example 1
```
Input:  "{[()]}"
Output: True
```
Every bracket is matched and correctly nested.
Example 2
```
Input:  "([)]"
Output: False
```
The brackets overlap instead of nesting.','True','Use a stack: push openers, and on a closer check it matches the top. The stack must be empty at the end.','Stack matching that handles an empty-stack pop and a non-empty stack at the end. Partial if either edge case missed.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-07','dsa','Longest Substring Without Repeating Characters.
Task: Given a string, return the LENGTH of the longest substring that contains no repeating characters.
Input: a string s. Output: an integer length.
Constraints: 0 <= length <= 1e5.','def longest_unique(s):
    last = {}
    start = best = 0
    for i, ch in enumerate(s):
        if ch in last and last[ch] >= start:
            start = last[ch] + 1
        last[ch] = i
        best = max(best, i - start + 1)
    return best','Example 1
```
Input:  "abcabcbb"
Output: 3
```
''abc'' is the longest stretch with no repeats.
Example 2
```
Input:  "bbbbb"
Output: 1
```
Only a single ''b'' has no repeat.','3','Slide a window and remember the last index of each character; when you see a repeat, jump the window start past it.','Sliding window with last-seen index (O(n)). A correct O(n^2) answer earns most marks.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-08','dsa','Merge Overlapping Intervals.
Task: Given a list of intervals [start, end], merge all overlapping intervals and return the result sorted by start. Touching intervals like [1,4] and [4,5] merge into one.
Input: a list of [start, end] pairs. Output: the merged list of intervals.
Constraints: 1 <= n <= 1e5.','def merge_intervals(intervals):
    intervals.sort(key=lambda x: x[0])
    out = []
    for s, e in intervals:
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out','Example 1
```
Input:  [[1, 3], [2, 6], [8, 10], [15, 18]]
Output: [[1, 6], [8, 10], [15, 18]]
```
[1,3] and [2,6] overlap, so they become [1,6].
Example 2
```
Input:  [[1, 4], [4, 5]]
Output: [[1, 5]]
```
Touching intervals merge.','[[1, 6], [8, 10], [15, 18]]','Sort by start first; then extend the last kept interval whenever the next one starts at or before its end.','Sort by start, then extend the last merged interval. Partial: touching intervals not merged, or sorting skipped.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-09','dsa','Rotate an Array.
Task: Given an array of n integers and an integer k, rotate it to the RIGHT by k steps and return the result. Note: k may be larger than n.
Input: an array nums and an integer k. Output: the rotated array.
Constraints: 1 <= n <= 1e5, 0 <= k <= 1e9.','def rotate(nums, k):
    n = len(nums)
    k %= n
    return nums[-k:] + nums[:-k] if k else nums[:]','Example 1
```
Input:  nums = [1, 2, 3, 4, 5, 6, 7], k = 3
Output: [5, 6, 7, 1, 2, 3, 4]
```
Each element moves 3 places right; the last three (5,6,7) wrap to the front.
Example 2
```
Input:  nums = [1, 2], k = 5
Output: [2, 1]
```
k = 5 with n = 2 is the same as k = 1 (5 mod 2), so a single right shift.','[5, 6, 7, 1, 2, 3, 4]','First reduce k with k % n, or large k will break you. Then slicing, reversal, or an extra array all work.','Reduce k with k % n (the common bug), then rotate. Partial: correct for k <= n but fails when k > n. O(n*k) shift earns most marks.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-10','dsa','Maximum Sum of k Consecutive Elements.
Task: Given an array and an integer k, return the maximum sum of any k consecutive elements (a sliding window of size k).
Input: an array arr and an integer k. Output: an integer (the maximum window sum).
Constraints: 1 <= k <= n <= 1e5.','def max_window(arr, k):
    s = sum(arr[:k])
    best = s
    for i in range(k, len(arr)):
        s += arr[i] - arr[i-k]
        best = max(best, s)
    return best','Example 1
```
Input:  arr = [2, 1, 5, 1, 3, 2], k = 3
Output: 9
```
The window [5, 1, 3] sums to 9, the largest of any 3 in a row.
Example 2
```
Input:  arr = [1, 2, 3, 4], k = 2
Output: 7
```
[3, 4] sums to 7.','9','Keep a running window sum: add the new element and subtract the one that falls out — don''t recompute each window.','Sliding window in O(n). A correct O(n*k) recompute earns most marks.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-11','dsa','Product Without One Item (no division).
Task: A combo builder shows, for each item, the product of the multipliers of all the OTHER items. Given an array, return an array where position i holds the product of every element except arr[i]. You may NOT use division. Aim for O(n) time.
Input: an array arr. Output: an array of the same length.
Constraints: Array may contain zeros; 1 <= n <= 1e5.','def product_except_self(arr):
    n = len(arr)
    res = [1] * n
    left = 1
    for i in range(n):
        res[i] = left; left *= arr[i]
    right = 1
    for i in range(n - 1, -1, -1):
        res[i] *= right; right *= arr[i]
    return res','Example 1
```
Input:  [1, 2, 3, 4]
Output: [24, 12, 8, 6]
```
Each position is the product of the other three.
Example 2
```
Input:  [2, 0, 5]
Output: [0, 10, 0]
```
Division would break on the zero — prefix/suffix products handle it.','[24, 12, 8, 6]','Multiply a running product of everything to the LEFT, then a second pass for everything to the RIGHT. No division needed.','Prefix * suffix products, O(n), no division; handles zeros. Partial: uses division (fails on 0) or an O(n^2) answer (still mostly correct).',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-12','dsa','Remove Duplicate Characters (keep first).
Task: A sign-up form cleans a suggested username by removing repeated characters, keeping only the FIRST occurrence of each. Return the cleaned string, preserving the original order.
Input: a string s. Output: the de-duplicated string.
Constraints: 1 <= length <= 1e5.','def remove_duplicates(s):
    seen = set()
    out = []
    for ch in s:
        if ch not in seen:
            seen.add(ch); out.append(ch)
    return ''''.join(out)','Example 1
```
Input:  "programming"
Output: "progamin"
```
Each letter is kept only the first time it appears.
Example 2
```
Input:  "hevodata"
Output: "hevodat"
```','progamin','Track seen characters in a set for O(1) lookups, and build the result in order — set(s) alone loses order.','Set for lookups + list to keep order, O(n). Partial if order is lost (e.g. set(s)).',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-13','dsa','Longest Common Prefix.
Task: A file manager groups file names by their longest common starting text. Return the longest common prefix of a list of words. If there is none, return the string ''No common prefix''.
Input: a list of strings words. Output: the common prefix string, or ''No common prefix''.
Constraints: 1 <= number of words <= 1e4.','def common_prefix(words):
    prefix = words[0]
    for w in words[1:]:
        while not w.startswith(prefix):
            prefix = prefix[:-1]
            if not prefix: return ''No common prefix''
    return prefix if prefix else ''No common prefix''','Example 1
```
Input:  ["flower", "flow", "flight"]
Output: fl
```
Every word starts with ''fl''.
Example 2
```
Input:  ["dog", "racecar", "car"]
Output: No common prefix
```','fl','Start with the first word as the prefix and trim its last character until every other word starts with it.','Shrink a candidate prefix until all words share it; handle the empty-prefix case. Partial: forgets the ''no prefix'' case.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-14','dsa','Is It a Rotation?
Task: A scrolling banner rotates its text. Given the original text s1 and what''s on screen now s2, return ''Yes'' if s2 is a rotation of s1, otherwise ''No''. Try to do it with a single containment check.
Input: two strings s1 and s2. Output: ''Yes'' or ''No''.
Constraints: 1 <= length <= 1e5.','def is_rotation(s1, s2):
    return ''Yes'' if len(s1) == len(s2) and s2 in s1 + s1 else ''No''','Example 1
```
Input:  s1 = "waterbottle", s2 = "erbottlewat"
Output: Yes
```
''erbottlewat'' appears inside ''waterbottlewaterbottle''.
Example 2
```
Input:  s1 = "abcd", s2 = "acbd"
Output: No
```','Yes','Every rotation of s1 is a substring of s1 + s1 — but check the lengths are equal first.','s2 in s1+s1 with an equal-length guard. Partial: forgets the length check (e.g. ''ca'' wrongly matches ''abc'').',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-15','dsa','Validate an IPv4 Address.
Task: A settings page must reject badly typed IP addresses. Return ''Valid'' if the string is a valid IPv4 address, else ''Invalid''. A valid address has exactly four parts separated by dots; each part is digits only, 0 to 255, with no leading zeros (except ''0'' itself).
Input: a string s. Output: ''Valid'' or ''Invalid''.
Constraints: 1 <= length <= 50.','def validate_ip(s):
    parts = s.split(''.'')
    if len(parts) != 4: return ''Invalid''
    for p in parts:
        if not p.isdigit() or (len(p) > 1 and p[0] == ''0'') or int(p) > 255:
            return ''Invalid''
    return ''Valid''','Example 1
```
Input:  "192.168.1.1"
Output: Valid
```
Four parts, each all-digits and in 0-255 with no leading zeros.
Example 2
```
Input:  "256.10.0.1"
Output: Invalid
```
256 is greater than 255, so this part is out of range.
More cases: "10.01.2.3" -> Invalid (leading zero), "1.2.3" -> Invalid (only 3 parts), "1.2.3.a" -> Invalid (not digits).','Valid','Split on ''.'', require exactly four parts, and for each check: all digits, no leading zero, and value 0-255.','Exactly 4 parts; each digits-only, 0-255, no leading zeros. Partial: misses leading zeros, the 4-part count, or crashes on non-digits.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-dsa-16','dsa','Roman Numeral to Integer.
Task: A museum app converts the year carved on a monument from Roman numerals to a number. Convert a valid Roman numeral (I, V, X, L, C, D, M) to an integer. A smaller value before a larger one is subtracted (IV = 4, CM = 900).
Input: a Roman numeral string s. Output: an integer.
Constraints: 1 <= length <= 15.','def roman_to_int(s):
    val = {''I'':1,''V'':5,''X'':10,''L'':50,''C'':100,''D'':500,''M'':1000}
    total = 0
    for i, ch in enumerate(s):
        if i + 1 < len(s) and val[ch] < val[s[i+1]]:
            total -= val[ch]
        else:
            total += val[ch]
    return total','Example 1
```
Input:  "MCMXCIV"
Output: 1994
```
M=1000, CM=900, XC=90, IV=4.
Example 2
```
Input:  "LVIII"
Output: 58
```
L=50, V=5, III=3.','1994','Add each symbol''s value, but SUBTRACT it when the next symbol is larger than it.','Add values, subtract when the next symbol is larger. Partial: handles only addition (misses IV/CM subtraction).',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-10','scenario','Debugging: Class Average
Scenario: A report card app shows the average of a student''s marks.
The program below runs but is wrong. (1) Identify the bug, (2) explain WHY it happens, and (3) write the corrected code. The code is shown in the example box.','Bug: Integer (floor) division // drops the decimal part.
Corrected code:
return sum(marks) / len(marks)','Example 1 (the failing run)
```
Code
def average(marks):
    return sum(marks) // len(marks)

print(average([90, 85, 80, 78]))
```
Expected output: 83.25
Actual (buggy) output:   83

Example 2 (your fix must also pass)
```
average([10, 20])  ->  15.0
```','83.25','Look closely at the division operator.','Full marks: correct bug identified + a clear why + a working fix that passes both cases. Partial: spots the bug but the fix is wrong/incomplete, or the fix works but the reasoning is thin.',5,'easy','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-11','scenario','Debugging: Remove Duplicate Order IDs
Scenario: An order system removes repeated order IDs but must keep the first-seen order.
The program below runs but is wrong. (1) Identify the bug, (2) explain WHY it happens, and (3) write the corrected code. The code is shown in the example box.','Bug: The value is never added to `seen`, so the set stays empty and nothing is ever treated as a duplicate.
Corrected code:
add seen.add(x) right after result.append(x)','Example 1 (the failing run)
```
Code
def unique(arr):
    seen = set()
    result = []
    for x in arr:
        if x not in seen:
            result.append(x)
    return result

print(unique([3, 1, 3, 2, 1]))
```
Expected output: [3, 1, 2]
Actual (buggy) output:   [3, 1, 3, 2, 1]

Example 2 (your fix must also pass)
```
unique([5, 5, 5, 1])  ->  [5, 1]
```','[3, 1, 2]','Something is being read from `seen` but never written to it.','Full marks: correct bug identified + a clear why + a working fix that passes both cases. Partial: spots the bug but the fix is wrong/incomplete, or the fix works but the reasoning is thin.',5,'easy','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-12','scenario','Debugging: Shopping Cart Leaks Between Users
Scenario: Each call should start a new, empty cart, but the second customer sees the first customer''s items.
The program below runs but is wrong. (1) Identify the bug, (2) explain WHY it happens, and (3) write the corrected code. The code is shown in the example box.','Bug: A mutable default argument (cart=[]) is created ONCE and shared across all calls.
Corrected code:
def add_item(item, cart=None):
    if cart is None: cart = []
    cart.append(item); return cart','Example 1 (the failing run)
```
Code
def add_item(item, cart=[]):
    cart.append(item)
    return cart

print(add_item(''pen''))
print(add_item(''book''))
```
Expected output: [''pen''] then [''book'']
Actual (buggy) output:   [''pen''] then [''pen'', ''book'']

Example 2 (your fix must also pass)
```
add_item(''milk'')  ->  [''milk'']   (a fresh call must start empty)
```','[''pen''] then [''book'']','Default argument values are evaluated once, when the function is defined.','Full marks: correct bug identified + a clear why + a working fix that passes both cases. Partial: spots the bug but the fix is wrong/incomplete, or the fix works but the reasoning is thin.',5,'moderate','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-13','scenario','Debugging: Binary Search Misses the Last Item
Scenario: A sorted list of employee IDs is searched with binary search, but some IDs that exist are reported as missing.
The program below runs but is wrong. (1) Identify the bug, (2) explain WHY it happens, and (3) write the corrected code. The code is shown in the example box.','Bug: The loop condition `low < high` exits when low == high, so the final single candidate is never checked.
Corrected code:
use while low <= high:','Example 1 (the failing run)
```
Code
def binary_search(arr, key):
    low, high = 0, len(arr) - 1
    while low < high:
        mid = (low + high) // 2
        if arr[mid] == key: return mid
        elif arr[mid] < key: low = mid + 1
        else: high = mid - 1
    return -1

print(binary_search([1, 3, 5, 7, 9], 9))
```
Expected output: 4
Actual (buggy) output:   -1

Example 2 (your fix must also pass)
```
binary_search([5], 5)  ->  0   (a single-element list)
```','4','Think about what happens when low and high meet.','Full marks: correct bug identified + a clear why + a working fix that passes both cases. Partial: spots the bug but the fix is wrong/incomplete, or the fix works but the reasoning is thin.',5,'moderate','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-14','scenario','Debugging: Seating Chart Transpose
Scenario: A seating chart stored row by row must be flipped so rows become columns.
The program below runs but is wrong. (1) Identify the bug, (2) explain WHY it happens, and (3) write the corrected code. The code is shown in the example box.','Bug: [[0]*rows]*cols repeats ONE inner list, so all rows are the same object — writing one writes all.
Corrected code:
t = [[0] * rows for _ in range(cols)]','Example 1 (the failing run)
```
Code
def transpose(m):
    rows, cols = len(m), len(m[0])
    t = [[0] * rows] * cols
    for i in range(rows):
        for j in range(cols):
            t[j][i] = m[i][j]
    return t

print(transpose([[1, 2, 3], [4, 5, 6]]))
```
Expected output: [[1, 4], [2, 5], [3, 6]]
Actual (buggy) output:   [[3, 6], [3, 6], [3, 6]]

Example 2 (your fix must also pass)
```
transpose([[1, 2], [3, 4]])  ->  [[1, 3], [2, 4]]
```','[[1, 4], [2, 5], [3, 6]]','The grid rows all change together — how was the 2-D list created?','Full marks: correct bug identified + a clear why + a working fix that passes both cases. Partial: spots the bug but the fix is wrong/incomplete, or the fix works but the reasoning is thin.',5,'moderate','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-15','scenario','Debugging: Letter Frequency Crashes
Scenario: A word puzzle counts how often each letter appears.
The program below runs but is wrong. (1) Identify the bug, (2) explain WHY it happens, and (3) write the corrected code. The code is shown in the example box.','Bug: count[ch] += 1 reads count[ch] before it exists the first time a letter is seen.
Corrected code:
count[ch] = count.get(ch, 0) + 1   # or use collections.defaultdict(int)','Example 1 (the failing run)
```
Code
def char_count(s):
    count = {}
    for ch in s:
        count[ch] += 1
    return count

print(char_count(''banana''))
```
Expected output: {''b'': 1, ''a'': 3, ''n'': 2}
Actual (buggy) output:   KeyError: ''b''

Example 2 (your fix must also pass)
```
char_count(''aba'')  ->  {''a'': 2, ''b'': 1}
```','{''b'': 1, ''a'': 3, ''n'': 2}','What is count[ch] on the very first time you see a letter?','Full marks: correct bug identified + a clear why + a working fix that passes both cases. Partial: spots the bug but the fix is wrong/incomplete, or the fix works but the reasoning is thin.',5,'easy','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-16','scenario','Debugging: Count Capitalised Words Crashes
Scenario: An editor counts words that start with a capital letter, but it crashes when the user types two spaces.
The program below runs but is wrong. (1) Identify the bug, (2) explain WHY it happens, and (3) write the corrected code. The code is shown in the example box.','Bug: split('' '') on a double space produces an empty string, and word[0] fails on it.
Corrected code:
use text.split() with no argument (collapses whitespace), or skip empty words','Example 1 (the failing run)
```
Code
def count_capitalised(text):
    count = 0
    for word in text.split('' ''):
        if word[0].isupper():
            count += 1
    return count

print(count_capitalised(''Welcome  to Hevo Data''))
```
Expected output: 3
Actual (buggy) output:   IndexError: string index out of range

Example 2 (your fix must also pass)
```
count_capitalised(''Hi  There'')  ->  2   (note the double space)
```','3','A double space produces an unexpected token in the split result.','Full marks: correct bug identified + a clear why + a working fix that passes both cases. Partial: spots the bug but the fix is wrong/incomplete, or the fix works but the reasoning is thin.',5,'moderate','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-17','scenario','Debugging: Secret Message Cipher
Scenario: A chat game shifts each lowercase letter forward by k places, wrapping from z back to a.
The program below runs but is wrong. (1) Identify the bug, (2) explain WHY it happens, and (3) write the corrected code. The code is shown in the example box.','Bug: Adding k to the code point runs past ''z'' into symbols — there is no wrap-around.
Corrected code:
chr((ord(ch) - ord(''a'') + k) % 26 + ord(''a''))','Example 1 (the failing run)
```
Code
def encrypt(text, k):
    return ''''.join(chr(ord(ch) + k) for ch in text)

print(encrypt(''xyz'', 3))
```
Expected output: abc
Actual (buggy) output:   {|}

Example 2 (your fix must also pass)
```
encrypt(''az'', 1)  ->  ''ba''   (''z'' wraps around to ''a'')
```','abc','After ''z'' you must wrap back to ''a'' — think modulo 26.','Full marks: correct bug identified + a clear why + a working fix that passes both cases. Partial: spots the bug but the fix is wrong/incomplete, or the fix works but the reasoning is thin.',5,'moderate','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-01','scenario','Most Common Words in a Review.
Scenario: a store wants the k most frequent words in a customer review. Ignore case and punctuation; on a tie, order the tied words alphabetically.
Task: Given the review text and an integer k, return the k most frequent words as a list (lowercase).
Input: a string review and an integer k. Output: a list of k words.
Constraints: review length <= 1e5.','import re
from collections import Counter
def top_k(review, k):
    words = re.findall(r''[a-z]+'', review.lower())
    c = Counter(words)
    return [w for w, _ in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]','Example 1
```
Input:
  review = "Great phone. Battery is great, camera is good. Battery life is great!"
  k = 2
Output:
  [''great'', ''is'']
```
Counts: great=3, is=3, battery=2, good=1, ... ''great'' and ''is'' tie at 3 and are the two most frequent.
Example 2
```
Input:
  review = "ok ok fine fine good"
  k = 2
Output:
  [''fine'', ''ok'']
```
''ok'' and ''fine'' both appear twice; the tie is broken alphabetically, so ''fine'' comes before ''ok''.','[''great'', ''is'']','Lowercase and strip punctuation, count the words, then sort by (-count, word) so ties go alphabetically.','Normalise case + strip punctuation, count, sort by (-count, word). Partial: punctuation/case not handled or tie-break wrong.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-02','scenario','Best Day to Buy and Sell.
Scenario: prices[i] is a share''s price on day i. You may buy on one day and sell on a LATER day, at most once.
Task: Return the maximum profit. If no profit is possible, return 0.
Input: a list prices. Output: an integer (max profit, or 0).
Constraints: 1 <= n <= 1e5.','def max_profit(prices):
    low = float(''inf''); best = 0
    for p in prices:
        low = min(low, p)
        best = max(best, p - low)
    return best','Example 1
```
Input:  prices = [7, 1, 5, 3, 6, 4]
Output: 5
```
Buy at 1 (day 2), sell at 6 (day 5): profit 5.
Example 2
```
Input:  prices = [7, 6, 4, 3, 1]
Output: 0
```
Prices only fall, so the best choice is not to trade.','5','Track the lowest price seen so far and the best profit if you sold today — you must sell AFTER you buy.','One pass tracking the min price so far (not max-minus-min of the whole array). A correct O(n^2) answer earns most marks.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-03','scenario','Minimum Railway Platforms.
Scenario: arrivals[] and departures[] are train times in 24-hour HHMM. A platform holds one train at a time; a train arriving exactly when another departs still needs its own platform.
Task: Return the minimum number of platforms so that no train has to wait.
Input: two lists arrivals and departures (same length). Output: an integer.
Constraints: 1 <= n <= 1e5.','def min_platforms(arr, dep):
    arr.sort(); dep.sort()
    i = j = plat = best = 0
    while i < len(arr):
        if arr[i] <= dep[j]:
            plat += 1; best = max(best, plat); i += 1
        else:
            plat -= 1; j += 1
    return best','Example 1
```
Input:
  arrivals   = [900, 940, 950, 1100, 1500, 1800]
  departures = [910, 1200, 1120, 1130, 1900, 2000]
Output: 3
```
Between 11:00 and 11:20 three trains are at the station at once, so 3 platforms are needed.
Example 2
```
Input:
  arrivals   = [900, 1000]
  departures = [930, 1030]
Output: 1
```
The first train leaves at 9:30, before the second arrives at 10:00, so one platform serves both.','3','Sort arrivals and departures, then sweep with two pointers — an arrival needs a platform, a departure frees one; track the peak.','Sort both + two-pointer sweep; an arrival equal to a departure needs a platform (use <=). A correct O(n^2) answer earns most marks.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-04','scenario','Compress an SMS Message.
Scenario: a messaging app shrinks runs of repeated characters: each run becomes the character followed by its count (''aaabb'' -> ''a3b2'').
Task: Return the compressed string, or the ORIGINAL string if the compressed version is not shorter.
Input: a string s. Output: the compressed or original string.
Constraints: 1 <= length <= 1e5.','def compress(s):
    if not s: return s
    out = []; count = 1
    for i in range(1, len(s) + 1):
        if i < len(s) and s[i] == s[i-1]:
            count += 1
        else:
            out.append(s[i-1] + str(count)); count = 1
    c = ''''.join(out)
    return c if len(c) < len(s) else s','Example 1
```
Input:  "aaabccdddd"
Output: "a3b1c2d4"
```
Compressed length 8 < original 10, so the compressed form is used.
Example 2
```
Input:  "abc"
Output: "abc"
```
''a1b1c1'' (length 6) is longer than ''abc'', so the original is kept.','a3b1c2d4','Walk the string counting runs; remember to flush the LAST run, then keep whichever of compressed/original is shorter.','Run-length encode, handle the last run, keep the shorter of compressed vs original. Partial: last group dropped or not-shorter rule missed.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-05','scenario','Suspicious Transactions.
Scenario: transactions[] are amounts in order. A transaction is suspicious if it is MORE than 5x the average of the previous 3 transactions.
Task: Return a list of the indices of all suspicious transactions. The first three can never be suspicious.
Input: a list transactions. Output: a list of indices.
Constraints: 1 <= n <= 1e5.','def suspicious(tx):
    out = []
    if len(tx) < 4: return out
    s = sum(tx[:3])
    for i in range(3, len(tx)):
        if tx[i] > 5 * (s / 3):
            out.append(i)
        s += tx[i] - tx[i-3]
    return out','Example 1
```
Input:  [100, 200, 150, 5000, 120, 130, 7000]
Output: [3, 6]
```
Index 3 (5000) > 5 x avg(100,200,150)=250. Index 6 (7000) > 5 x avg(5000,120,130).
Example 2
```
Input:  [100, 100, 100, 200]
Output: []
```
Index 3 (200) is not more than 5 x avg(100,100,100)=500, so nothing is flagged. The first three can never be suspicious.','[3, 6]','Keep a sliding window of the previous 3 amounts and compare each new amount to 5x their (float) average.','Sliding window over the previous 3, float average, strict > 5x. Partial: off-by-one window or integer-division slip.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-06','scenario','Sunset View Buildings.
Scenario: a row of buildings faces the sea to the right. A building can see the sunset only if it is taller than EVERY building to its right.
Task: Return the heights of all buildings that can see the sunset, in their original left-to-right order.
Input: a list heights. Output: a list of heights.
Constraints: 1 <= n <= 1e5.','def sunset_view(heights):
    res = []
    tallest = float(''-inf'')
    for h in reversed(heights):
        if h > tallest:
            res.append(h); tallest = h
    return res[::-1]','Example 1
```
Input:  [16, 17, 4, 3, 5, 2]
Output: [17, 5, 2]
```
The last building always sees the sunset. 5 is taller than 2, and 17 is taller than everything to its right.
Example 2
```
Input:  [1, 2, 3, 4]
Output: [4]
```
Heights only increase, so every building is blocked by a taller one to its right — only the last (4) sees the sunset.','[17, 5, 2]','Scan from the RIGHT, tracking the tallest seen so far; a building is visible if it beats that running max.','Right-to-left scan tracking the running max, then restore left-to-right order. A correct O(n^2) answer earns most marks.',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-07','scenario','Merge Two Delivery Schedules.
Scenario: two delivery partners each send a SORTED list of delivery times (in minutes). Dispatch needs a single sorted schedule.
Task: Merge the two sorted lists into one sorted list WITHOUT calling sort() or sorted().
Input: two sorted lists a and b. Output: one merged sorted list.
Constraints: 1 <= total length <= 1e5.','def merge_sorted(a, b):
    i = j = 0
    merged = []
    while i < len(a) and j < len(b):
        if a[i] <= b[j]: merged.append(a[i]); i += 1
        else: merged.append(b[j]); j += 1
    merged.extend(a[i:]); merged.extend(b[j:])
    return merged','Example 1
```
Input:  a = [1, 4, 7, 10], b = [2, 3, 9]
Output: [1, 2, 3, 4, 7, 9, 10]
```
Compare the fronts of both lists and take the smaller each time.
Example 2
```
Input:  a = [5], b = [1, 2, 3]
Output: [1, 2, 3, 5]
```
All of b is taken first; once b runs out, the leftover 5 from a is appended.','[1, 2, 3, 4, 7, 9, 10]','Two pointers compare the fronts of both lists; after one runs out, append the rest of the other.','Two-pointer merge without sort(); appends the leftover tail. Partial: forgets the leftover elements or uses sort().',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-08','scenario','Count Subarrays That Hit the Target.
Scenario: an audit team wants how many continuous stretches of transactions add up to exactly k rupees. Amounts can be negative (refunds).
Task: Count the contiguous subarrays whose sum equals k.
Input: a list nums and an integer k. Output: an integer count.
Constraints: 1 <= n <= 1e5; values may be negative.','def count_subarrays(nums, k):
    seen = {0: 1}
    running = count = 0
    for x in nums:
        running += x
        count += seen.get(running - k, 0)
        seen[running] = seen.get(running, 0) + 1
    return count','Example 1
```
Input:  nums = [1, 1, 1], k = 2
Output: 2
```
[1,1] appears twice.
Example 2
```
Input:  nums = [3, 4, 7, 2, -3, 1, 4, 2], k = 7
Output: 4
```','2','Use prefix sums in a dict: for each running sum, add how many times (running - k) has appeared. A sliding window fails with negatives.','Prefix-sum counts in a hash map (O(n)); note a sliding window won''t work with negatives. Partial: O(n^2) brute force (still mostly correct).',5,'medium','active',1);
INSERT OR REPLACE INTO question_bank (id,category,prompt,reference_answer,sample_data,expected_output,hint,rubric,marks,difficulty,status,active) VALUES ('qb-scn-09','scenario','Election Winner by Majority.
Scenario: votes are stored as candidate IDs. A candidate wins outright only with MORE than half of all votes.
Task: Return the majority candidate, or None if nobody has more than n/2 votes. Aim for O(n) time and O(1) extra space.
Input: a list votes. Output: a candidate ID, or None.
Constraints: 1 <= n <= 1e5.','def majority(votes):
    candidate, count = None, 0
    for v in votes:
        if count == 0: candidate = v
        count += 1 if v == candidate else -1
    return candidate if votes.count(candidate) > len(votes) // 2 else None','Example 1
```
Input:  [2, 2, 1, 1, 1, 2, 2]
Output: 2
```
2 appears 4 times out of 7 (> 3.5).
Example 2
```
Input:  [1, 2, 3, 1]
Output: None
```
No candidate has more than 2 votes.','2','Boyer-Moore voting: keep a candidate and a counter; then VERIFY the candidate actually has > n/2 votes.','Boyer-Moore (or a counts dict) PLUS a final check that it exceeds n/2. Partial: finds a candidate but skips the majority verification.',5,'medium','active',1);
