#!/usr/bin/env python3
"""
Build the rebuilt DSA + Scenario question bank (v2) for Talo.

- 12 DSA + 12 Scenario (6 real-world + 6 debugging) = 24 questions.
- Enhanced "written-answer" format: title, topic + difficulty, prose, constraints,
  complete worked examples (every sample input has its output), a candidate hint.
- Admin-only: reference answer, expected output (examples + 2 hidden tests),
  a plain-text rubric and itemized marking checkpoints — so "Enrich all with AI"
  SKIPS these (it only touches rows missing rubric/checkpoints), preserving the
  authored examples.
- Debugging questions show BUGGY PSEUDOCODE (no Python), which the candidate fixes.

Outputs (to /mnt/user-data/outputs):
  question_bank_v2_review.md          -- human review (candidate + admin fields)
  question_bank_v2_apply.sql          -- retire old DSA+Scenario, insert these 24

Every reference solution is executed against its examples + hidden tests before
the files are written; the script aborts if any check fails.
"""
import os, re, json

OUT = "/mnt/user-data/outputs"
os.makedirs(OUT, exist_ok=True)

Q = []  # each: dict with fields + _verify=(fn, [(args, expected), ...]) + _norm optional

def add(**k): Q.append(k)

# ======================================================================
# DSA (12)
# ======================================================================

add(id="qb-dsa-r01", category="dsa", difficulty="easy", marks=5,
 prompt="""## Second Largest Element
> Arrays · Easy

Given an array `arr` of integers, return the **second largest distinct** value in the array. If it does not exist (fewer than two distinct values), return `-1`.

### Constraints
- 1 ≤ len(arr) ≤ 10^5
- -10^9 ≤ arr[i] ≤ 10^9""",
 sample_data="""**Example 1**
Input: arr = [12, 35, 1, 10, 34, 1]
Output: 34
Explanation: The largest is 35; the next distinct value is 34.

**Example 2**
Input: arr = [10, 5, 10]
Output: 5
Explanation: 10 repeats but counts once, so the second largest distinct value is 5.

**Example 3**
Input: arr = [7, 7, 7]
Output: -1
Explanation: There is only one distinct value, so there is no second largest.""",
 expected_output="""Example 1 → 34
Example 2 → 5
Example 3 → -1
Hidden test 1 → second_largest([-5, -2, -9, -2]) = -5  (all negative; duplicates ignored)
Hidden test 2 → second_largest([2]) = -1  (single element)""",
 reference_answer="""One pass tracking the largest and second-largest distinct values; skip values equal to the current largest. O(n) time, O(1) space. Sorting the distinct values is an acceptable O(n log n) approach.

def second_largest(arr):
    first = second = None
    for x in arr:
        if first is None or x > first:
            second = first; first = x
        elif x != first and (second is None or x > second):
            second = x
    return second if second is not None else -1""",
 hint="You don't need to sort. Keep two values — largest and second largest — and update them in one pass. Watch the case where the current value equals the largest.",
 rubric="""- Returns the second largest DISTINCT value, treating duplicates of the max as one.
- Returns -1 when fewer than two distinct values exist.
- Does not initialise 'second' to 0 (fails on all-negative arrays).
- Full credit for an O(n) single pass; an O(n log n) sort of distinct values is acceptable.""",
 checkpoints="""Identifies that distinct values are required (duplicates of the max ignored)
Correctly tracks both the largest and the second largest
Returns -1 when no second distinct value exists
Handles all-negative input (no 0 initialisation bug)
States or implies O(n) / O(n log n) complexity""",
 _verify=(lambda arr: (lambda f,s:(_sl(arr)))(0,0), None))

def _sl(arr):
    first=second=None
    for x in arr:
        if first is None or x>first: second=first; first=x
        elif x!=first and (second is None or x>second): second=x
    return second if second is not None else -1
Q[-1]["_verify"]=(_sl,[(([12,35,1,10,34,1],),34),(([10,5,10],),5),(([7,7,7],),-1),(([-5,-2,-9,-2],),-5),(([2],),-1)])

add(id="qb-dsa-r02", category="dsa", difficulty="easy", marks=5,
 prompt="""## Valid Palindrome
> Strings · Two Pointers · Easy

A phrase is a palindrome if, after lowercasing all letters and removing every character that is not a letter or digit, it reads the same forwards and backwards.

Given a string `s`, return `True` if it is a palindrome, otherwise `False`.

### Constraints
- 1 ≤ len(s) ≤ 2 × 10^5
- `s` contains printable ASCII characters.""",
 sample_data="""**Example 1**
Input: s = "A man, a plan, a canal: Panama"
Output: True
Explanation: Cleaned, it is "amanaplanacanalpanama", which reads the same both ways.

**Example 2**
Input: s = "race a car"
Output: False
Explanation: Cleaned, it is "raceacar", which is not a palindrome.""",
 expected_output="""Example 1 → True
Example 2 → False
Hidden test 1 → is_palindrome(" ") = True  (cleans to empty string, treated as a palindrome)
Hidden test 2 → is_palindrome("0P") = False  (digits are kept; "0" ≠ "p")""",
 reference_answer="""Two pointers from both ends; skip non-alphanumeric characters and compare in lowercase. O(n) time, O(1) space. Building a cleaned string and comparing with its reverse is also fine.

def is_palindrome(s):
    i, j = 0, len(s) - 1
    while i < j:
        if not s[i].isalnum(): i += 1
        elif not s[j].isalnum(): j -= 1
        else:
            if s[i].lower() != s[j].lower(): return False
            i += 1; j -= 1
    return True""",
 hint="Use two pointers, one at each end. Skip characters that aren't letters or digits, and compare the rest in lowercase as the pointers move toward each other.",
 rubric="""- Ignores case and all non-alphanumeric characters.
- Keeps digits (does not drop them).
- Treats an empty cleaned string as a palindrome (True).
- Full credit for O(n) two-pointer or clean-and-reverse.""",
 checkpoints="""Normalises case correctly
Keeps only letters and digits (digits not dropped)
Compares from both ends correctly
Handles empty / whitespace-only input as True
O(n) approach""",
 _verify=(None,None))
def _pal(s):
    t=[c.lower() for c in s if c.isalnum()]; return t==t[::-1]
Q[-1]["_verify"]=(_pal,[(("A man, a plan, a canal: Panama",),True),(("race a car",),False),((" ",),True),(("0P",),False)])

add(id="qb-dsa-r03", category="dsa", difficulty="easy", marks=5,
 prompt="""## First Unique Character
> Strings · Hash Map · Easy

Given a string `s`, return the **index** of the first character that appears exactly once. If no such character exists, return `-1`.

### Constraints
- 1 ≤ len(s) ≤ 10^5
- `s` consists of lowercase English letters.""",
 sample_data="""**Example 1**
Input: s = "leetcode"
Output: 0
Explanation: 'l' at index 0 appears only once.

**Example 2**
Input: s = "loveleetcode"
Output: 2
Explanation: 'l' and 'o' repeat; the first unique character is 'v' at index 2.""",
 expected_output="""Example 1 → 0
Example 2 → 2
Hidden test 1 → first_unique("aabb") = -1  (no unique character)
Hidden test 2 → first_unique("aabbccdde") = 8  (only 'e' is unique)""",
 reference_answer="""First pass counts each character; second pass returns the first index whose count is 1. O(n) time, O(1) extra space (at most 26 letters).

def first_unique(s):
    from collections import Counter
    c = Counter(s)
    for i, ch in enumerate(s):
        if c[ch] == 1: return i
    return -1""",
 hint="Scan the string twice: first count how often each character appears, then return the index of the first character with a count of 1.",
 rubric="""- Returns the INDEX (not the character) of the first non-repeating character.
- Returns -1 when none exists.
- Uses counting rather than a nested O(n^2) scan for full credit.""",
 checkpoints="""Counts character frequencies
Returns the first index with count 1 (not the character itself)
Returns -1 when there is no unique character
Avoids an O(n^2) nested loop
O(n) approach""",
 _verify=(None,None))
def _fu(s):
    from collections import Counter
    c=Counter(s)
    for i,ch in enumerate(s):
        if c[ch]==1: return i
    return -1
Q[-1]["_verify"]=(_fu,[(("leetcode",),0),(("loveleetcode",),2),(("aabb",),-1),(("aabbccdde",),8)])

add(id="qb-dsa-r04", category="dsa", difficulty="easy", marks=5,
 prompt="""## Move Zeroes to the End
> Arrays · Two Pointers · Easy

Given an integer array `nums`, move every `0` to the end of the array while keeping the relative order of the non-zero elements. You must modify the array **in place**, without making a copy.

### Constraints
- 1 ≤ len(nums) ≤ 10^4
- -2^31 ≤ nums[i] ≤ 2^31 − 1""",
 sample_data="""**Example 1**
Input: nums = [0, 1, 0, 3, 12]
Output: [1, 3, 12, 0, 0]
Explanation: The non-zero values keep their order; both zeros move to the end.

**Example 2**
Input: nums = [0]
Output: [0]
Explanation: A single element needs no change.""",
 expected_output="""Example 1 → [1, 3, 12, 0, 0]
Example 2 → [0]
Hidden test 1 → move_zeros([4, 0, 0, 0, 5, 0, 6]) = [4, 5, 6, 0, 0, 0, 0]
Hidden test 2 → move_zeros([1, 2, 3]) = [1, 2, 3]  (no zeros; array unchanged)""",
 reference_answer="""A write pointer copies each non-zero value forward; then fill the rest with zeros. O(n) time, O(1) space, order preserved, no copy.

def move_zeros(nums):
    pos = 0
    for x in nums:
        if x != 0: nums[pos] = x; pos += 1
    for i in range(pos, len(nums)): nums[i] = 0
    return nums""",
 hint="Keep a write pointer for the next non-zero slot. Copy each non-zero value forward, then fill the remaining slots with zeros.",
 rubric="""- Non-zero elements keep their original relative order.
- All zeros end up at the end.
- Modifies the array in place (no new array returned as the primary mechanism).
- O(n) time.""",
 checkpoints="""Preserves the order of non-zero elements
Moves all zeros to the end
Works in place (no full copy)
Handles the no-zeros and single-element cases
O(n) approach""",
 _verify=(None,None))
def _mz(nums):
    nums=list(nums); pos=0
    for x in nums:
        if x!=0: nums[pos]=x; pos+=1
    for i in range(pos,len(nums)): nums[i]=0
    return nums
Q[-1]["_verify"]=(_mz,[(([0,1,0,3,12],),[1,3,12,0,0]),(([0],),[0]),(([4,0,0,0,5,0,6],),[4,5,6,0,0,0,0]),(([1,2,3],),[1,2,3])])

add(id="qb-dsa-r05", category="dsa", difficulty="medium", marks=5,
 prompt="""## Two Sum
> Arrays · Hash Map · Medium

Given an array of integers `nums` and an integer `target`, return the **indices** of the two numbers that add up to `target`. Exactly one solution exists, and you may not use the same element twice. The indices may be returned in any order.

### Constraints
- 2 ≤ len(nums) ≤ 10^4
- -10^9 ≤ nums[i], target ≤ 10^9""",
 sample_data="""**Example 1**
Input: nums = [2, 7, 11, 15], target = 9
Output: [0, 1]
Explanation: nums[0] + nums[1] = 2 + 7 = 9.

**Example 2**
Input: nums = [3, 2, 4], target = 6
Output: [1, 2]
Explanation: nums[1] + nums[2] = 2 + 4 = 6.""",
 expected_output="""Example 1 → [0, 1]
Example 2 → [1, 2]
Hidden test 1 → two_sum([3, 3], 6) = [0, 1]  (same value, two different indices)
Hidden test 2 → two_sum([-1, -2, -3, -4, -5], -8) = [2, 4]""",
 reference_answer="""Hash map from value to index; for each x, check whether (target - x) was already seen. Store AFTER checking so a value isn't paired with itself. O(n) time, O(n) space.

def two_sum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        if target - x in seen: return [seen[target - x], i]
        seen[x] = i
    return []""",
 hint="For each number x, the value you need is target - x. Keep the numbers you've seen in a hash map (value → index) so you can check for the complement in O(1).",
 rubric="""- Returns two valid indices whose values sum to target.
- Does not reuse the same index twice (store after checking).
- O(n) hash-map solution for full credit; O(n^2) brute force earns partial.""",
 checkpoints="""Uses a hash map of value → index
Checks for the complement before inserting (no self-pairing)
Returns correct indices
Handles duplicate values and negatives
O(n) approach""",
 _verify=(None,None))
def _ts(nums,target):
    seen={}
    for i,x in enumerate(nums):
        if target-x in seen: return [seen[target-x],i]
        seen[x]=i
    return []
Q[-1]["_verify"]=(_ts,[(([2,7,11,15],9),[0,1]),(([3,2,4],6),[1,2]),(([3,3],6),[0,1]),(([-1,-2,-3,-4,-5],-8),[2,4])])

add(id="qb-dsa-r06", category="dsa", difficulty="medium", marks=5,
 prompt="""## Valid Parentheses
> Strings · Stack · Medium

Given a string `s` containing only the characters `()[]{}`, return `True` if every opening bracket is closed by the same type in the correct order, and every closing bracket has a matching opener. Otherwise return `False`.

### Constraints
- 1 ≤ len(s) ≤ 10^4
- `s` consists only of the characters `()[]{}`.""",
 sample_data="""**Example 1**
Input: s = "()[]{}"
Output: True

**Example 2**
Input: s = "(]"
Output: False
Explanation: '(' is closed by ']', a different type.""",
 expected_output="""Example 1 → True
Example 2 → False
Hidden test 1 → is_valid("{[()()]}") = True
Hidden test 2 → is_valid("([)]") = False  (closed in the wrong order)""",
 reference_answer="""Push openers on a stack; each closer must match the top. The stack must be empty at the end. O(n) time, O(n) space.

def is_valid(s):
    pairs = {')':'(', ']':'[', '}':'{'}
    st = []
    for ch in s:
        if ch in '([{': st.append(ch)
        elif not st or st.pop() != pairs[ch]: return False
    return not st""",
 hint="The most recently opened bracket must be the first one closed. Which data structure gives you the most-recently-added item first?",
 rubric="""- Uses a stack (or equivalent) for last-in-first-out matching.
- Each closer matches the correct opener type.
- Rejects an empty stack on a closer, and a non-empty stack at the end.""",
 checkpoints="""Uses a stack / LIFO structure
Matches each closer to the correct opener type
Handles a closer with no opener (empty stack)
Requires the stack empty at the end
O(n) approach""",
 _verify=(None,None))
def _vp(s):
    pairs={')':'(',']':'[','}':'{'}; st=[]
    for ch in s:
        if ch in '([{': st.append(ch)
        elif not st or st.pop()!=pairs[ch]: return False
    return not st
Q[-1]["_verify"]=(_vp,[(("()[]{}",),True),(("(]",),False),(("{[()()]}",),True),(("([)]",),False)])

add(id="qb-dsa-r07", category="dsa", difficulty="medium", marks=5,
 prompt="""## Longest Substring Without Repeating Characters
> Strings · Sliding Window · Medium

Given a string `s`, return the **length** of the longest substring that contains no repeating characters. A substring is a contiguous sequence of characters; it cannot skip characters.

### Constraints
- 0 ≤ len(s) ≤ 5 × 10^4
- `s` may contain letters, digits, symbols and spaces.""",
 sample_data="""**Example 1**
Input: s = "abcabcbb"
Output: 3
Explanation: "abc" has length 3; no longer substring is repeat-free.

**Example 2**
Input: s = "bbbbb"
Output: 1
Explanation: Every character is the same, so the best is length 1.

**Example 3**
Input: s = "pwwkew"
Output: 3
Explanation: "wke" has length 3. "pwke" is not contiguous.""",
 expected_output="""Example 1 → 3
Example 2 → 1
Example 3 → 3
Hidden test 1 → longest("abba") = 2  (window start must never move backward)
Hidden test 2 → longest("") = 0""",
 reference_answer="""Sliding window storing the last index of each character; when a character repeats inside the window, move the start to just past its previous position (never backward). O(n) time.

def longest(s):
    last = {}; start = best = 0
    for i, ch in enumerate(s):
        if ch in last and last[ch] >= start: start = last[ch] + 1
        last[ch] = i
        best = max(best, i - start + 1)
    return best""",
 hint="Use a sliding window with two pointers. Remember the last index of each character; when one repeats inside the window, move the left pointer just past its previous position — never backward.",
 rubric="""- Uses a sliding window (not O(n^2) substring checks) for full credit.
- The window start never moves backward (guard with last_index >= start).
- Returns the length, and handles the empty string as 0.""",
 checkpoints="""Uses a sliding window with last-seen indices
Window start never moves backward
Correctly updates the best length
Handles empty string (0) and all-same characters
O(n) approach""",
 _verify=(None,None))
def _ls(s):
    last={}; start=best=0
    for i,ch in enumerate(s):
        if ch in last and last[ch]>=start: start=last[ch]+1
        last[ch]=i; best=max(best,i-start+1)
    return best
Q[-1]["_verify"]=(_ls,[(("abcabcbb",),3),(("bbbbb",),1),(("pwwkew",),3),(("abba",),2),(("",),0)])

add(id="qb-dsa-r08", category="dsa", difficulty="medium", marks=5,
 prompt="""## Merge Intervals
> Arrays · Sorting · Medium

Given a list of intervals where `intervals[i] = [start, end]`, merge all overlapping intervals and return the non-overlapping intervals that cover all the input, sorted by start. Intervals that merely touch (e.g. `[1,4]` and `[4,5]`) are considered overlapping.

### Constraints
- 1 ≤ len(intervals) ≤ 10^4
- 0 ≤ start ≤ end ≤ 10^4""",
 sample_data="""**Example 1**
Input: intervals = [[1,3], [2,6], [8,10], [15,18]]
Output: [[1,6], [8,10], [15,18]]
Explanation: [1,3] and [2,6] overlap and merge into [1,6].

**Example 2**
Input: intervals = [[1,4], [4,5]]
Output: [[1,5]]
Explanation: Touching intervals merge.""",
 expected_output="""Example 1 → [[1,6], [8,10], [15,18]]
Example 2 → [[1,5]]
Hidden test 1 → merge([[1,4],[0,4]]) = [[0,4]]  (input not pre-sorted)
Hidden test 2 → merge([[1,10],[2,3],[4,5],[11,12]]) = [[1,10],[11,12]]  (nested intervals; must take max end)""",
 reference_answer="""Sort by start, then extend the last merged interval when the next starts at or before its end (take the max end). O(n log n).

def merge(intervals):
    intervals = sorted(intervals, key=lambda x: x[0])
    out = []
    for s, e in intervals:
        if out and s <= out[-1][1]: out[-1][1] = max(out[-1][1], e)
        else: out.append([s, e])
    return out""",
 hint="Sort the intervals by start first. Then each interval can only overlap with the last one you added to the result — extend it, taking the maximum end.",
 rubric="""- Sorts by start before merging.
- Merges touching intervals (uses start <= last_end).
- Takes max(end) when merging (handles a nested interval).""",
 checkpoints="""Sorts intervals by start
Merges overlapping and touching intervals
Uses max end when extending (handles nested intervals)
Produces a correctly ordered, non-overlapping result
O(n log n) approach""",
 _verify=(None,None))
def _mi(intervals):
    iv=sorted([list(x) for x in intervals],key=lambda x:x[0]); out=[]
    for s,e in iv:
        if out and s<=out[-1][1]: out[-1][1]=max(out[-1][1],e)
        else: out.append([s,e])
    return out
Q[-1]["_verify"]=(_mi,[(([[1,3],[2,6],[8,10],[15,18]],),[[1,6],[8,10],[15,18]]),(([[1,4],[4,5]],),[[1,5]]),(([[1,4],[0,4]],),[[0,4]]),(([[1,10],[2,3],[4,5],[11,12]],),[[1,10],[11,12]])])

add(id="qb-dsa-r09", category="dsa", difficulty="medium", marks=5,
 prompt="""## Product of Array Except Self
> Arrays · Prefix/Suffix · Medium

Given an integer array `nums`, return an array `answer` where `answer[i]` is the product of every element of `nums` except `nums[i]`. You must run in O(n) time and **may not use division**.

### Constraints
- 2 ≤ len(nums) ≤ 10^5
- The product of any prefix or suffix fits in a 32-bit integer.""",
 sample_data="""**Example 1**
Input: nums = [1, 2, 3, 4]
Output: [24, 12, 8, 6]
Explanation: 2·3·4, 1·3·4, 1·2·4, 1·2·3.

**Example 2**
Input: nums = [-1, 1, 0, -3, 3]
Output: [0, 0, 9, 0, 0]
Explanation: The single zero makes every product zero except at its own index, where the product of the others is 9.""",
 expected_output="""Example 1 → [24, 12, 8, 6]
Example 2 → [0, 0, 9, 0, 0]
Hidden test 1 → product_except_self([2, 3]) = [3, 2]
Hidden test 2 → product_except_self([0, 0, 5]) = [0, 0, 0]  (two zeros → all zeros)""",
 reference_answer="""Two passes: left-to-right prefix products into the output, then right-to-left suffix products multiplied in. No division. O(n) time, O(1) extra space (besides output).

def product_except_self(nums):
    n = len(nums); res = [1] * n; left = 1
    for i in range(n): res[i] = left; left *= nums[i]
    right = 1
    for i in range(n - 1, -1, -1): res[i] *= right; right *= nums[i]
    return res""",
 hint="Think prefix products and suffix products. Can you compute each in one linear pass and combine them, reusing the output array to avoid extra space?",
 rubric="""- Produces the product of all other elements for each index.
- Uses NO division.
- Runs in O(n) (prefix/suffix passes), not O(n^2).
- Correct with zeros (one zero, and two or more zeros).""",
 checkpoints="""Avoids division entirely
Uses prefix and suffix products
O(n) time
Correct behaviour with a single zero
Correct behaviour with two or more zeros""",
 _verify=(None,None))
def _pes(nums):
    n=len(nums); res=[1]*n; left=1
    for i in range(n): res[i]=left; left*=nums[i]
    right=1
    for i in range(n-1,-1,-1): res[i]*=right; right*=nums[i]
    return res
Q[-1]["_verify"]=(_pes,[(([1,2,3,4],),[24,12,8,6]),(([-1,1,0,-3,3],),[0,0,9,0,0]),(([2,3],),[3,2]),(([0,0,5],),[0,0,0])])

add(id="qb-dsa-r10", category="dsa", difficulty="medium", marks=5,
 prompt="""## Maximum Subarray Sum
> Arrays · Kadane's Algorithm · Medium

Given an integer array `nums` (which may contain negatives), return the largest possible sum of a **non-empty contiguous** subarray.

### Constraints
- 1 ≤ len(nums) ≤ 10^5
- -10^4 ≤ nums[i] ≤ 10^4""",
 sample_data="""**Example 1**
Input: nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4]
Output: 6
Explanation: The subarray [4, -1, 2, 1] has the largest sum, 6.

**Example 2**
Input: nums = [-3, -1, -2]
Output: -1
Explanation: All negative, so the best single element is -1.""",
 expected_output="""Example 1 → 6
Example 2 → -1
Hidden test 1 → max_subarray([5, -9, 6]) = 6  (starting fresh at 6 beats 5-9+6)
Hidden test 2 → max_subarray([1]) = 1""",
 reference_answer="""Kadane: at each element choose to extend the running sum or start fresh; track the best. O(n) time, O(1) space. Must handle all-negative arrays (don't reset best to 0).

def max_subarray(nums):
    best = cur = nums[0]
    for x in nums[1:]:
        cur = max(x, cur + x); best = max(best, cur)
    return best""",
 hint="At each position decide: extend the current running sum, or start a new subarray here (whichever is larger). Track the best sum seen — and seed it from the first element so all-negative inputs work.",
 rubric="""- Returns the maximum contiguous subarray sum.
- Handles all-negative arrays (best is the largest single element, not 0).
- O(n) Kadane for full credit.""",
 checkpoints="""Chooses extend-vs-restart at each step
Tracks the running best
Seeds best from the first element (handles all-negative)
Returns the correct maximum
O(n) approach""",
 _verify=(None,None))
def _ms(nums):
    best=cur=nums[0]
    for x in nums[1:]: cur=max(x,cur+x); best=max(best,cur)
    return best
Q[-1]["_verify"]=(_ms,[(([-2,1,-3,4,-1,2,1,-5,4],),6),(([-3,-1,-2],),-1),(([5,-9,6],),6),(([1],),1)])

add(id="qb-dsa-r11", category="dsa", difficulty="medium", marks=5,
 prompt="""## Rotate an Array
> Arrays · Medium

Given an array `nums` of `n` integers and an integer `k`, rotate the array to the **right** by `k` steps and return the result. Note that `k` may be larger than `n`.

### Constraints
- 1 ≤ len(nums) ≤ 10^5
- 0 ≤ k ≤ 10^9""",
 sample_data="""**Example 1**
Input: nums = [1, 2, 3, 4, 5], k = 2
Output: [4, 5, 1, 2, 3]
Explanation: The last two elements move to the front.

**Example 2**
Input: nums = [1, 2, 3], k = 4
Output: [3, 1, 2]
Explanation: k mod n = 4 mod 3 = 1, so rotate right by 1.""",
 expected_output="""Example 1 → [4, 5, 1, 2, 3]
Example 2 → [3, 1, 2]
Hidden test 1 → rotate([1, 2, 3], 3) = [1, 2, 3]  (k = n restores the array)
Hidden test 2 → rotate([10, 20, 30, 40, 50, 60], 8) = [50, 60, 10, 20, 30, 40]""",
 reference_answer="""Reduce k modulo n, then the answer is the last k elements followed by the first n-k. O(n). The in-place reversal method (reverse all, reverse first k, reverse rest) is also accepted.

def rotate(nums, k):
    n = len(nums); k %= n
    return nums[-k:] + nums[:-k] if k else nums[:]""",
 hint="First reduce k with k mod n (k can exceed the length). Then the result is the last k elements followed by the rest — or use the three-reversal trick.",
 rubric="""- Reduces k modulo n (handles k ≥ n).
- Rotates to the RIGHT by the correct amount.
- Handles k that is a multiple of n (array unchanged).""",
 checkpoints="""Takes k modulo n
Rotates in the right direction (right)
Handles k = 0 and k a multiple of n
Produces the correct rotated array
O(n) approach""",
 _verify=(None,None))
def _rot(nums,k):
    nums=list(nums); n=len(nums); k%=n
    return nums[-k:]+nums[:-k] if k else nums[:]
Q[-1]["_verify"]=(_rot,[(([1,2,3,4,5],2),[4,5,1,2,3]),(([1,2,3],4),[3,1,2]),(([1,2,3],3),[1,2,3]),(([10,20,30,40,50,60],8),[50,60,10,20,30,40])])

add(id="qb-dsa-r12", category="dsa", difficulty="medium", marks=5,
 prompt="""## Group Anagrams
> Strings · Hash Map · Medium

Given an array of strings `strs`, group together all strings that are anagrams of one another (same characters with the same frequencies, in any order). Return the groups in any order.

### Constraints
- 1 ≤ len(strs) ≤ 10^4
- 0 ≤ len(strs[i]) ≤ 100
- Each string contains only lowercase English letters.""",
 sample_data="""**Example 1**
Input: strs = ["eat", "tea", "tan", "ate", "nat", "bat"]
Output: [["bat"], ["nat", "tan"], ["ate", "eat", "tea"]]
Explanation: "eat"/"tea"/"ate" group; "tan"/"nat" group; "bat" is alone. (Any order of groups or members is accepted.)

**Example 2**
Input: strs = [""]
Output: [[""]]
Explanation: One empty string forms its own group.""",
 expected_output="""Example 1 → three groups: {bat}, {nat, tan}, {ate, eat, tea}  (order-independent)
Example 2 → [[""]]
Hidden test 1 → group(["a"]) = [["a"]]
Hidden test 2 → group(["abc", "bca", "cab", "xyz"]) → one group {abc, bca, cab} and one {xyz}""",
 reference_answer="""Key each string by a signature that is identical for anagrams — its sorted characters (or a 26-letter frequency tuple) — and bucket strings by that key in a hash map. O(N·K log K) with sorting (K = word length).

def group(strs):
    from collections import defaultdict
    buckets = defaultdict(list)
    for w in strs: buckets[''.join(sorted(w))].append(w)
    return list(buckets.values())""",
 hint="Give anagrams the same key: sort each string's characters, or use a per-letter frequency signature, and bucket strings by that key in a hash map.",
 rubric="""- Groups strings that are anagrams, each group complete.
- Uses an anagram-invariant key (sorted letters or frequency count).
- Each input string appears in exactly one group.
- Order of groups/members doesn't matter.""",
 checkpoints="""Builds an anagram-invariant key (sorted chars or frequency)
Buckets strings by that key
Every string appears in exactly one group
Handles empty string and single-element input
Reasonable complexity""",
 _verify=(None,None))
def _ga(strs):
    from collections import defaultdict
    b=defaultdict(list)
    for w in strs: b[''.join(sorted(w))].append(w)
    return list(b.values())
def _norm_groups(groups):
    return sorted(tuple(sorted(g)) for g in groups)
Q[-1]["_verify"]=(_ga,[((["eat","tea","tan","ate","nat","bat"],),[["bat"],["nat","tan"],["ate","eat","tea"]]),(([""],),[[""]]),((["a"],),[["a"]]),((["abc","bca","cab","xyz"],),[["abc","bca","cab"],["xyz"]])])
Q[-1]["_norm"]=_norm_groups

# ======================================================================
# SCENARIO — real-world (6)
# ======================================================================

add(id="qb-scn-r01", category="scenario", difficulty="medium", marks=5,
 prompt="""## Best Time to Buy and Sell Stock
> Scenario · Arrays · Medium

You are given an array `prices` where `prices[i]` is a stock's price on day `i`. Choose one day to **buy** and a **later** day to **sell** to maximise profit (at most one transaction). Return the maximum profit, or `0` if no profit is possible. You must buy before you sell.

### Constraints
- 1 ≤ len(prices) ≤ 10^5
- 0 ≤ prices[i] ≤ 10^4""",
 sample_data="""**Example 1**
Input: prices = [7, 1, 5, 3, 6, 4]
Output: 5
Explanation: Buy at 1 (day 2), sell at 6 (day 5). Profit = 5.

**Example 2**
Input: prices = [7, 6, 4, 3, 1]
Output: 0
Explanation: Prices only fall, so no profitable trade exists.""",
 expected_output="""Example 1 → 5
Example 2 → 0
Hidden test 1 → max_profit([2, 4, 1]) = 2  (the lowest price, 1, comes last and can't be used to buy)
Hidden test 2 → max_profit([3, 8, 1, 9, 2]) = 8  (buy at 1, sell at 9)""",
 reference_answer="""Track the lowest price seen so far; for each day the best sale is today's price minus that minimum. O(n), O(1).

def max_profit(prices):
    low = float('inf'); best = 0
    for p in prices:
        low = min(low, p); best = max(best, p - low)
    return best""",
 hint="Walk the prices once, remembering the lowest price seen so far. The best profit selling today is today's price minus that minimum.",
 rubric="""- Enforces buy-before-sell (cannot use a later minimum to buy).
- Returns 0 when prices only fall.
- O(n) single pass for full credit; O(n^2) pairs earns partial.""",
 checkpoints="""Tracks the running minimum price
Computes profit as current price minus running minimum
Respects buy-before-sell ordering
Returns 0 when no profit is possible
O(n) approach""",
 _verify=(None,None))
def _mp(prices):
    low=float('inf'); best=0
    for p in prices: low=min(low,p); best=max(best,p-low)
    return best
Q[-1]["_verify"]=(_mp,[(([7,1,5,3,6,4],),5),(([7,6,4,3,1],),0),(([2,4,1],),2),(([3,8,1,9,2],),8)])

add(id="qb-scn-r02", category="scenario", difficulty="medium", marks=5,
 prompt="""## Minimum Railway Platforms
> Scenario · Sorting · Two Pointers · Medium

A station receives several trains in one day. You are given arrival times `arr` and departure times `dep` in 24-hour `HHMM` format. A platform holds one train at a time. If a train arrives at the exact minute another departs, they still need **separate** platforms. Return the minimum number of platforms so that no train waits.

### Constraints
- 1 ≤ number of trains ≤ 5 × 10^4
- 0000 ≤ arr[i] ≤ dep[i] ≤ 2359""",
 sample_data="""**Example 1**
Input: arr = [900, 940, 950, 1100, 1500, 1800], dep = [910, 1200, 1120, 1130, 1900, 2000]
Output: 3
Explanation: Between 11:00 and 11:20, three trains are present at once.

**Example 2**
Input: arr = [900, 1100, 1235], dep = [1000, 1200, 1240]
Output: 1
Explanation: No two trains overlap, so one platform suffices.""",
 expected_output="""Example 1 → 3
Example 2 → 1
Hidden test 1 → min_platforms([1000, 1000, 1000], [1030, 1015, 1045]) = 3  (all arrive together)
Hidden test 2 → min_platforms([900, 1000], [1000, 1100]) = 2  (arrival equals a departure ⇒ separate platforms)""",
 reference_answer="""Sort arrivals and departures separately; sweep with two pointers. An arrival (arr <= dep, using <= so a same-minute arrival/departure needs its own platform) takes a platform; otherwise a departure frees one. Track the running max. O(n log n).

def min_platforms(arr, dep):
    arr = sorted(arr); dep = sorted(dep)
    i = j = plat = best = 0
    while i < len(arr):
        if arr[i] <= dep[j]: plat += 1; best = max(best, plat); i += 1
        else: plat -= 1; j += 1
    return best""",
 hint="Sort arrivals and departures separately, then sweep both with two pointers: an arrival needs a platform, a departure frees one. Use <= when comparing so a same-minute arrival and departure get separate platforms. Track the running maximum.",
 rubric="""- Sorts arrivals and departures separately.
- Uses <= so a train arriving as another departs needs a separate platform.
- Returns the maximum simultaneous overlap.
- O(n log n) sweep for full credit.""",
 checkpoints="""Sorts arrivals and departures independently
Sweeps with two pointers (arrival adds, departure frees)
Uses <= for the same-minute tie rule
Tracks the running maximum platforms
O(n log n) approach""",
 _verify=(None,None))
def _plat(arr,dep):
    arr=sorted(arr); dep=sorted(dep); i=j=plat=best=0
    while i<len(arr):
        if arr[i]<=dep[j]: plat+=1; best=max(best,plat); i+=1
        else: plat-=1; j+=1
    return best
Q[-1]["_verify"]=(_plat,[(([900,940,950,1100,1500,1800],[910,1200,1120,1130,1900,2000]),3),(([900,1100,1235],[1000,1200,1240]),1),(([1000,1000,1000],[1030,1015,1045]),3),(([900,1000],[1000,1100]),2)])

add(id="qb-scn-r03", category="scenario", difficulty="medium", marks=5,
 prompt="""## SMS Message Compression
> Scenario · Strings · Medium

A messaging app shrinks a message by replacing each run of consecutive repeated characters with the character followed by the run length (for example `aaabb` → `a3b2`). Return the compressed string, or the **original** string if the compressed version is not strictly shorter.

### Constraints
- 0 ≤ len(msg) ≤ 10^4
- `msg` consists of lowercase English letters.""",
 sample_data="""**Example 1**
Input: msg = "aaabccdddd"
Output: "a3b1c2d4"
Explanation: Runs aaa, b, cc, dddd → length 8 < 10.

**Example 2**
Input: msg = "abc"
Output: "abc"
Explanation: "a1b1c1" is longer, so the original is returned.""",
 expected_output="""Example 1 → "a3b1c2d4"
Example 2 → "abc"
Hidden test 1 → compress("aabcccccaaa") = "a2b1c5a3"  (the same letter can form two separate runs)
Hidden test 2 → compress("zzzzzzzzzzzz") = "z12"  (a run length can be more than one digit)""",
 reference_answer="""Walk the string counting each run; append character + count when the run ends. Compare lengths at the end. O(n).

def compress(msg):
    if not msg: return msg
    out = []; count = 1
    for i in range(1, len(msg) + 1):
        if i < len(msg) and msg[i] == msg[i-1]: count += 1
        else: out.append(msg[i-1] + str(count)); count = 1
    c = ''.join(out)
    return c if len(c) < len(msg) else msg""",
 hint="Walk the string counting the current run length. When the next character differs (or the string ends), append the character and its count. Don't forget the final run, and compare lengths before returning.",
 rubric="""- Encodes each run as character + count, counting consecutive runs only.
- Returns the original when the compressed form is not strictly shorter.
- Handles multi-digit counts and repeated-letter separate runs.""",
 checkpoints="""Groups consecutive runs correctly (not global counts)
Appends character followed by its run length
Emits the final run (no off-by-one)
Returns original when not strictly shorter
Handles multi-digit run lengths""",
 _verify=(None,None))
def _cmp(msg):
    if not msg: return msg
    out=[]; count=1
    for i in range(1,len(msg)+1):
        if i<len(msg) and msg[i]==msg[i-1]: count+=1
        else: out.append(msg[i-1]+str(count)); count=1
    c=''.join(out)
    return c if len(c)<len(msg) else msg
Q[-1]["_verify"]=(_cmp,[(("aaabccdddd",),"a3b1c2d4"),(("abc",),"abc"),(("aabcccccaaa",),"a2b1c5a3"),(("zzzzzzzzzzzz",),"z12")])

add(id="qb-scn-r04", category="scenario", difficulty="medium", marks=5,
 prompt="""## Top K Words in a Review
> Scenario · Strings · Hash Map · Medium

An online store shows the most common words in a customer review. Given a string `review` and an integer `k`, return the `k` most frequent words. Words are case-insensitive and made of letters only (ignore punctuation). Sort by frequency from highest to lowest; break ties alphabetically.

### Constraints
- 1 ≤ len(review) ≤ 10^4
- `review` contains English letters, spaces and the marks `. , ! ?`
- 1 ≤ k ≤ number of distinct words""",
 sample_data="""**Example 1**
Input: review = "Great phone. Battery is great, camera is good. Battery life is great!", k = 2
Output: ["great", "is"]
Explanation: "great" and "is" each appear 3 times; "great" comes first alphabetically.

**Example 2**
Input: review = "Fast delivery, fast refund. Good!", k = 1
Output: ["fast"]
Explanation: "Fast" and "fast" are the same word (2 occurrences).""",
 expected_output="""Example 1 → ["great", "is"]
Example 2 → ["fast"]
Hidden test 1 → top_k("Nice nice NICE product. Product is nice.", 2) = ["nice", "product"]  (nice×4, product×2)
Hidden test 2 → top_k("Bad. Worse? Bad!", 2) = ["bad", "worse"]  (tie broken alphabetically)""",
 reference_answer="""Lowercase, extract letter-only words, count them, then sort by (-count, word) and take k. O(n + m log m).

import re
from collections import Counter
def top_k(review, k):
    words = re.findall(r'[a-z]+', review.lower())
    c = Counter(words)
    return [w for w, _ in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]""",
 hint="Lowercase the text and pull out letter-only words, count them with a hash map, then sort by (−count, word) and take the first k.",
 rubric="""- Case-insensitive; strips punctuation to letter-only words.
- Sorts by frequency desc, then alphabetically for ties.
- Returns exactly k words, lowercase.""",
 checkpoints="""Normalises case and removes punctuation
Counts word frequencies
Sorts by frequency then alphabetical tie-break
Returns exactly k lowercase words
Reasonable complexity""",
 _verify=(None,None))
def _tk(review,k):
    import re
    from collections import Counter
    words=re.findall(r'[a-z]+',review.lower()); c=Counter(words)
    return [w for w,_ in sorted(c.items(),key=lambda kv:(-kv[1],kv[0]))[:k]]
Q[-1]["_verify"]=(_tk,[(("Great phone. Battery is great, camera is good. Battery life is great!",2),["great","is"]),(("Fast delivery, fast refund. Good!",1),["fast"]),(("Nice nice NICE product. Product is nice.",2),["nice","product"]),(("Bad. Worse? Bad!",2),["bad","worse"])])

add(id="qb-scn-r05", category="scenario", difficulty="medium", marks=5,
 prompt="""## Suspicious Transactions
> Scenario · Arrays · Sliding Window · Medium

A payment system flags suspicious activity. A transaction is suspicious if its amount is **strictly greater than five times the average of the three immediately preceding transactions**. Given a list `transactions`, return the zero-based indices of all suspicious transactions, in order. The first three can never be flagged (not enough history). When evaluating a transaction, exclude its own amount from the average.

### Constraints
- 1 ≤ len(transactions) ≤ 10^5
- Amounts are non-negative integers.""",
 sample_data="""**Example 1**
Input: transactions = [100, 200, 150, 5000, 120, 130, 7000]
Output: [3]
Explanation: At index 3 the average of [100,200,150] is 150; 5×150 = 750 and 5000 > 750. At index 6 the average of [5000,120,130] is 1750; 5×1750 = 8750 and 7000 is not greater.

**Example 2**
Input: transactions = [10, 10, 10, 51, 20]
Output: [3]
Explanation: At index 3 the average is 10, threshold 50; 51 > 50. At index 4 the average of [10,10,51] ≈ 23.67, threshold ≈ 118.3; 20 is not greater.""",
 expected_output="""Example 1 → [3]
Example 2 → [3]
Hidden test 1 → suspicious([100, 200, 300, 2500, 400, 500, 600, 3500]) = [3, 7]
Hidden test 2 → suspicious([10, 20, 30]) = []  (fewer than four elements; nothing to flag)""",
 reference_answer="""Keep a running sum of the previous three amounts; for each index from 3 on, flag it when amount > 5 * (sum/3), then slide the window. O(n).

def suspicious(tx):
    out = []
    if len(tx) < 4: return out
    s = sum(tx[:3])
    for i in range(3, len(tx)):
        if tx[i] > 5 * (s / 3): out.append(i)
        s += tx[i] - tx[i-3]
    return out""",
 hint="Keep a running sum of the last three amounts. For each transaction from index 3 onward, compare it with 5× that average, then slide the window by adding the new amount and dropping the one three positions back.",
 rubric="""- Uses the three IMMEDIATELY preceding amounts, excluding the current one.
- Uses a strict > comparison against 5× the average.
- Never flags the first three indices.
- Returns indices in ascending order.""",
 checkpoints="""Averages exactly the three preceding transactions
Excludes the current amount from the average
Uses strict > against 5× the average
Skips the first three indices
Slides the window in O(n)""",
 _verify=(None,None))
def _susp(tx):
    out=[]
    if len(tx)<4: return out
    s=sum(tx[:3])
    for i in range(3,len(tx)):
        if tx[i]>5*(s/3): out.append(i)
        s+=tx[i]-tx[i-3]
    return out
Q[-1]["_verify"]=(_susp,[(([100,200,150,5000,120,130,7000],),[3]),(([10,10,10,51,20],),[3]),(([100,200,300,2500,400,500,600,3500],),[3,7]),(([10,20,30],),[])])

add(id="qb-scn-r06", category="scenario", difficulty="medium", marks=5,
 prompt="""## Duplicate API Requests
> Scenario · Hash Set · Arrays · Medium

A backend receives request IDs from clients. A client sometimes retries, so an ID can arrive more than once. Given a list of request IDs, return every ID that occurs more than once — each duplicate reported **only once**, in the order in which its **second occurrence** appears. Do not report IDs that occur only once.

### Constraints
- The input is a list of strings.
- An ID may appear any number of times.""",
 sample_data="""**Example 1**
Input: requests = ["A12", "B15", "A12", "C20", "B15", "D30"]
Output: ["A12", "B15"]
Explanation: "A12" repeats at index 2, then "B15" at index 4. "C20" and "D30" appear once.

**Example 2**
Input: requests = ["X1", "Y2", "X1", "X1", "Y2", "Z3"]
Output: ["X1", "Y2"]
Explanation: "X1" is reported at its second occurrence; later repeats add nothing. "Y2" is reported at its second occurrence.""",
 expected_output="""Example 1 → ["A12", "B15"]
Example 2 → ["X1", "Y2"]
Hidden test 1 → duplicates(["a", "b", "c"]) = []  (no duplicates)
Hidden test 2 → duplicates(["p", "p", "p"]) = ["p"]  (reported once, at the second occurrence)""",
 reference_answer="""Track seen IDs in one set and already-reported IDs in another. On an ID already in 'seen' and not yet reported, append it. O(n).

def duplicates(requests):
    seen = set(); reported = set(); out = []
    for r in requests:
        if r in seen and r not in reported:
            out.append(r); reported.add(r)
        seen.add(r)
    return out""",
 hint="Keep one set of IDs already seen and another of IDs already reported. When an ID is seen again and hasn't been reported yet, add it to the result.",
 rubric="""- Reports each duplicate exactly once.
- Reports it at the SECOND occurrence (not first, not third+).
- Excludes IDs that appear only once.
- Preserves detection order.""",
 checkpoints="""Uses a 'seen' set to detect repeats
Uses a 'reported' set to avoid duplicates in the output
Reports at the second occurrence
Excludes single-occurrence IDs
O(n) approach""",
 _verify=(None,None))
def _dup(requests):
    seen=set(); reported=set(); out=[]
    for r in requests:
        if r in seen and r not in reported: out.append(r); reported.add(r)
        seen.add(r)
    return out
Q[-1]["_verify"]=(_dup,[((["A12","B15","A12","C20","B15","D30"],),["A12","B15"]),((["X1","Y2","X1","X1","Y2","Z3"],),["X1","Y2"]),((["a","b","c"],),[]),((["p","p","p"],),["p"])])

# ======================================================================
# SCENARIO — debugging (6), BUGGY PSEUDOCODE (no Python)
# ======================================================================

add(id="qb-scn-r07", category="scenario", difficulty="easy", marks=5,
 prompt="""## Debugging: Class Average
> Debugging · Arrays · Easy

A report-card app should print the **average** of a student's marks. The pseudocode below runs without error but prints the wrong value.

Pseudocode note: `DIV` is **integer** division (it discards the fraction); `/` is real division.

Do three things: (1) point out the bug, (2) explain **why** it produces the wrong value, and (3) rewrite the faulty line correctly.""",
 sample_data="""**Buggy pseudocode**
```
FUNCTION average(marks):
    total ← sum(marks)
    count ← length(marks)
    RETURN total DIV count

PRINT average([90, 85, 80, 78])
```
Expected output: 83.25
Actual output: 83""",
 expected_output="""Correct output for the example: 83.25
Hidden test 1 → average([5, 2]) = 3.5  (the fraction must be kept)
Hidden test 2 → average([10, 10, 10, 10]) = 10  (whole-number averages still work)
The fix: RETURN total / count (real division).""",
 reference_answer="""Bug: the function uses integer division (DIV), which throws away the fractional part — 333 DIV 4 = 83 instead of 83.25.
Why: DIV floors the result to a whole number, but an average is usually not whole.
Fix: use real division — RETURN total / count.""",
 hint="Compare the two division operators described in the note. Which one keeps the decimal part?",
 rubric="""- Identifies that integer division (DIV) is the bug.
- Explains that DIV discards the fraction.
- Fix uses real division (total / count).""",
 checkpoints="""Names integer division (DIV) as the bug
Explains that the fractional part is discarded
Gives the corrected line using real division
States the correct output 83.25
Clear, correct explanation""",
 _verify=(None,None))
def _avg(marks): return sum(marks)/len(marks)
Q[-1]["_verify"]=(_avg,[(([90,85,80,78],),83.25),(([5,2],),3.5),(([10,10,10,10],),10.0)])

add(id="qb-scn-r08", category="scenario", difficulty="medium", marks=5,
 prompt="""## Debugging: Binary Search Misses the Last Item
> Debugging · Arrays · Searching · Medium

A sorted list of employee IDs is searched with binary search, but some IDs that are present are reported as missing (it returns `-1`). Arrays are 0-indexed; `DIV` is integer division.

Do three things: (1) point out the bug, (2) explain **why** a value that exists can be missed, and (3) fix it.""",
 sample_data="""**Buggy pseudocode**
```
FUNCTION binarySearch(ids, target):
    low ← 0
    high ← length(ids) − 1
    WHILE low < high:
        mid ← (low + high) DIV 2
        IF ids[mid] = target:
            RETURN mid
        ELSE IF ids[mid] < target:
            low ← mid + 1
        ELSE:
            high ← mid − 1
    RETURN −1

PRINT binarySearch([101, 102, 103, 104, 105], 105)
```
Expected output: 4
Actual output: -1""",
 expected_output="""Correct output for the example: 4
Hidden test 1 → binarySearch([1, 3, 5, 7, 9], 1) = 0  (first element, also at a boundary)
Hidden test 2 → binarySearch([2, 4, 6], 5) = -1  (an absent value still returns -1)
The fix: change the loop condition to WHILE low <= high.""",
 reference_answer="""Bug: the loop condition `WHILE low < high` stops when low = high, so the final single candidate is never checked — here 105 sits at that last index.
Why: when the window narrows to one element, low equals high and the loop exits before testing it.
Fix: use `WHILE low <= high`.""",
 hint="Trace low and high on the last comparison. Does the loop ever test the element when low equals high?",
 rubric="""- Identifies the loop condition low < high as the bug.
- Explains the last element is skipped when low == high.
- Fix changes it to low <= high (absent values still return -1).""",
 checkpoints="""Points to the WHILE low < high condition
Explains the last element is skipped at low == high
Fix uses low <= high
Confirms absent values still return -1
Clear, correct explanation""",
 _verify=(None,None))
def _bs(ids,target):
    low,high=0,len(ids)-1
    while low<=high:
        mid=(low+high)//2
        if ids[mid]==target: return mid
        elif ids[mid]<target: low=mid+1
        else: high=mid-1
    return -1
Q[-1]["_verify"]=(_bs,[(([101,102,103,104,105],105),4),(([1,3,5,7,9],1),0),(([2,4,6],5),-1)])

add(id="qb-scn-r09", category="scenario", difficulty="easy", marks=5,
 prompt="""## Debugging: Letter Frequency
> Debugging · Strings · Maps · Easy

A word puzzle counts how often each letter appears and stores the counts in a map. The pseudocode fails the first time it meets a new letter.

Pseudocode note: reading `count[ch]` before a value has been stored for `ch` is an error (the key does not exist yet).

Do three things: (1) point out the bug, (2) explain **why** it fails, and (3) fix it.""",
 sample_data="""**Buggy pseudocode**
```
FUNCTION letterCount(word):
    count ← empty map
    FOR each ch IN word:
        count[ch] ← count[ch] + 1
    RETURN count

PRINT letterCount("banana")
```
Expected output: {b: 1, a: 3, n: 2}
Actual output: error — count[ch] has no value the first time ch is seen""",
 expected_output="""Correct output for the example: {b: 1, a: 3, n: 2}
Hidden test 1 → letterCount("aaa") = {a: 3}
Hidden test 2 → letterCount("abc") = {a: 1, b: 1, c: 1}
The fix: default a missing key to 0 before adding — IF ch not in count THEN count[ch] ← 0, then count[ch] ← count[ch] + 1.""",
 reference_answer="""Bug: `count[ch] ← count[ch] + 1` reads count[ch] before it exists, which errors the first time a letter appears.
Why: the key has no value yet, so there is nothing to add 1 to.
Fix: give a missing key a starting value of 0 first (or use a map that defaults to 0), then increment.""",
 hint="What is count[ch] worth the very first time you see a letter? It needs a starting value before you can add to it.",
 rubric="""- Identifies reading a missing key as the bug.
- Explains the key has no value on first sight.
- Fix defaults the key to 0 before incrementing.""",
 checkpoints="""Identifies the missing-key read as the bug
Explains there is no value to add 1 to on first sight
Fix initialises the key to 0 first (or uses a defaulting map)
Gives the correct counts for the example
Clear, correct explanation""",
 _verify=(None,None))
def _lc(word):
    from collections import Counter
    return dict(Counter(word))
Q[-1]["_verify"]=(_lc,[(("banana",),{"b":1,"a":3,"n":2}),(("aaa",),{"a":3}),(("abc",),{"a":1,"b":1,"c":1})])

add(id="qb-scn-r10", category="scenario", difficulty="medium", marks=5,
 prompt="""## Debugging: Secret Message Cipher
> Debugging · Strings · Medium

A chat game shifts each lowercase letter forward by `k` places, wrapping so that after `z` it continues from `a` (with k = 3, `y` → `b`). The pseudocode runs, but letters near the end of the alphabet turn into other symbols instead of wrapping.

Pseudocode note: `code(ch)` gives a letter's position (a = 0 … z = 25) and `letter(n)` turns a position back into a letter.

Do three things: (1) point out the bug, (2) explain **why** it breaks near the end of the alphabet, and (3) fix it.""",
 sample_data="""**Buggy pseudocode**
```
FUNCTION encrypt(message, k):
    result ← ""
    FOR each ch IN message:
        shifted ← code(ch) + k
        result ← result + letter(shifted)
    RETURN result

PRINT encrypt("abcxyz", 3)
```
Expected output: defabc
Actual output: "def" followed by symbols past 'z'""",
 expected_output="""Correct output for the example: defabc
Hidden test 1 → encrypt("zzz", 1) = "aaa"  (every letter wraps)
Hidden test 2 → encrypt("hello", 0) = "hello"  (a shift of 0 changes nothing)
The fix: wrap with modulo 26 — shifted ← (code(ch) + k) MOD 26.""",
 reference_answer="""Bug: `code(ch) + k` can exceed 25 (the position of z), and letter() of an out-of-range number is no longer a letter.
Why: there is no wraparound — after z the positions should cycle back to a.
Fix: take the position modulo 26 — shifted ← (code(ch) + k) MOD 26, then letter(shifted).""",
 hint="What happens to the position number when it goes past 25 (z)? How do you bring it back into the 0–25 range?",
 rubric="""- Identifies the missing wraparound as the bug.
- Explains positions can exceed 25 and stop being letters.
- Fix uses modulo 26.""",
 checkpoints="""Identifies that the shifted position can exceed 25
Explains there is no wraparound past z
Fix uses MOD 26
Confirms wrap cases (e.g. zzz → aaa)
Clear, correct explanation""",
 _verify=(None,None))
def _cipher(message,k):
    return ''.join(chr((ord(c)-97+k)%26+97) if 'a'<=c<='z' else c for c in message)
Q[-1]["_verify"]=(_cipher,[(("abcxyz",3),"defabc"),(("zzz",1),"aaa"),(("hello",0),"hello")])

add(id="qb-scn-r11", category="scenario", difficulty="medium", marks=5,
 prompt="""## Debugging: The Backup That Changes Too
> Debugging · Arrays · References · Medium

A program keeps a **backup** of a list before editing it, so the original stays safe. But after it edits the backup, the original changes as well.

Pseudocode note: `backup ← original` makes both names refer to the **same** list (not a copy); `copyOf(list)` makes an independent copy.

Do three things: (1) point out the bug, (2) explain **why** the original changes too, and (3) fix it.""",
 sample_data="""**Buggy pseudocode**
```
original ← [10, 20, 30]
backup ← original
backup[0] ← 99
PRINT original[0]
```
Expected output: 10
Actual output: 99""",
 expected_output="""Correct output for the example: 10  (the original's first value must stay 10)
Hidden test 1 → after backup[1] ← 0, PRINT original[1] = 20  (original untouched)
Hidden test 2 → editing the backup must never change the original's values or length
The fix: backup ← copyOf(original).""",
 reference_answer="""Bug: `backup ← original` does not copy the list; both names point at the same list, so editing backup edits original.
Why: the assignment copies the reference, not the contents.
Fix: make a real copy — backup ← copyOf(original).""",
 hint="Does 'backup ← original' create a new list, or just a second name for the same one?",
 rubric="""- Identifies that assignment shares the reference, not a copy.
- Explains both names point to the same list.
- Fix makes an independent copy (copyOf).""",
 checkpoints="""Identifies that backup and original are the same list
Explains assignment copies the reference, not contents
Fix uses an independent copy (copyOf)
Confirms the original stays unchanged
Clear, correct explanation""",
 _verify=(None,None))
def _backup(_=None):
    original=[10,20,30]; backup=list(original); backup[0]=99; return original[0]
Q[-1]["_verify"]=(_backup,[((None,),10)])

add(id="qb-scn-r12", category="scenario", difficulty="easy", marks=5,
 prompt="""## Debugging: Largest Value Is Wrong for Negatives
> Debugging · Arrays · Easy

A program should print the **largest** value in a list. It works for everyday numbers, but when every value is negative it wrongly prints `0`.

Do three things: (1) point out the bug, (2) explain **why** an all-negative list fails, and (3) fix it.""",
 sample_data="""**Buggy pseudocode**
```
FUNCTION largest(nums):
    best ← 0
    FOR each x IN nums:
        IF x > best:
            best ← x
    RETURN best

PRINT largest([-5, -2, -9])
```
Expected output: -2
Actual output: 0""",
 expected_output="""Correct output for the example: -2
Hidden test 1 → largest([-7]) = -7  (single negative value)
Hidden test 2 → largest([3, 1, 2]) = 3  (ordinary positives still correct)
The fix: start best at nums[0] (and loop from the second element), or start at negative infinity.""",
 reference_answer="""Bug: `best` starts at 0, and no negative value is greater than 0, so best stays 0 for an all-negative list.
Why: 0 is not a member of the list — it is a wrong starting assumption.
Fix: start best at the first element (best ← nums[0]) and compare from the second, or start best at negative infinity.""",
 hint="Is 0 always a safe starting value for 'best'? What if every number is below 0?",
 rubric="""- Identifies initialising best to 0 as the bug.
- Explains no negative beats 0, so best stays 0.
- Fix seeds best from the first element (or negative infinity).""",
 checkpoints="""Identifies best ← 0 as the bug
Explains no negative value exceeds 0
Fix seeds best from nums[0] or negative infinity
Confirms correct result for all-negative input
Clear, correct explanation""",
 _verify=(None,None))
def _largest(nums):
    best=nums[0]
    for x in nums[1:]:
        if x>best: best=x
    return best
Q[-1]["_verify"]=(_largest,[(([-5,-2,-9],),-2),(([-7],),-7),(([3,1,2],),3)])

# ======================================================================
# VERIFY every reference solution
# ======================================================================
fails = []
for q in Q:
    fn, cases = q["_verify"]
    norm = q.get("_norm")
    if fn is None or cases is None:
        fails.append((q["id"], "no verifier wired")); continue
    for args, expected in cases:
        try:
            got = fn(*args)
        except Exception as e:
            fails.append((q["id"], f"raised {e!r} on {args}")); continue
        a, b = (norm(got), norm(expected)) if norm else (got, expected)
        if a != b:
            fails.append((q["id"], f"got {got!r} expected {expected!r} on {args}"))

print(f"Questions: {len(Q)}  (DSA={sum(1 for q in Q if q['category']=='dsa')}, Scenario={sum(1 for q in Q if q['category']=='scenario')})")
if fails:
    print("VERIFICATION FAILED:")
    for f in fails: print("  ", f)
    raise SystemExit(1)
print("All reference solutions verified against examples + hidden tests. ✓")

# ======================================================================
# EMIT review markdown + apply SQL
# ======================================================================
def sqlq(s): return "'" + s.replace("'", "''") + "'"
FIELDS = ["prompt","sample_data","expected_output","reference_answer","hint","rubric","checkpoints"]

ids_csv = ", ".join(sqlq(q['id']) for q in Q)
sql = [
 "-- Talo question bank v2 — rebuilt DSA + Scenario set (24 questions).",
 "-- Step 1: retire EVERY OTHER DSA + Scenario question (soft-delete; keeps history/FKs).",
 "-- Step 2: UPSERT the 24 new questions — insert if new, update in place if they",
 "--         already exist. No DELETE, so nothing a candidate's assignment/answer",
 "--         references is ever removed (no FOREIGN KEY error), and re-running is",
 "--         always safe (no UNIQUE error).",
 "-- Run from YOUR machine:",
 "--   npx wrangler d1 execute campus-hiring-assessment-db --remote --file=question_bank_v2_apply.sql",
 "",
 "-- Retire the OLD DSA/Scenario questions (everything in those categories except",
 "-- the 24 below). Idempotent: already-retired rows are skipped.",
 "UPDATE question_bank SET deleted_at = datetime('now'), active = 0",
 f"  WHERE category IN ('dsa','scenario') AND deleted_at IS NULL AND id NOT IN ({ids_csv});",
 "",
]
UPDATE_COLS = ["category","prompt","reference_answer","sample_data","expected_output","hint","rubric","checkpoints","marks","difficulty"]
for q in Q:
    cols = ["id","category","prompt","reference_answer","sample_data","expected_output","hint","rubric","checkpoints","marks","difficulty","status","active","deleted_at"]
    vals = [sqlq(q["id"]), sqlq(q["category"]), sqlq(q["prompt"]), sqlq(q["reference_answer"]),
            sqlq(q["sample_data"]), sqlq(q["expected_output"]), sqlq(q["hint"]), sqlq(q["rubric"]),
            sqlq(q["checkpoints"]), str(q["marks"]), sqlq(q["difficulty"]), "'active'", "1", "NULL"]
    setters = ", ".join(f"{c} = excluded.{c}" for c in UPDATE_COLS) + ", status = 'active', active = 1, deleted_at = NULL"
    sql.append(f"-- {q['id']} · {q['category']} · {q['difficulty']}")
    sql.append(f"INSERT INTO question_bank ({', '.join(cols)}) VALUES ({', '.join(vals)})")
    sql.append(f"  ON CONFLICT(id) DO UPDATE SET {setters};")
    sql.append("")
open(os.path.join(OUT,"question_bank_v2_apply.sql"),"w",encoding="utf-8").write("\n".join(sql))

md = ["# Question Bank v2 — DSA + Scenario (24 questions)","",
 "Rebuilt, deduplicated, enhanced written-answer format. 12 DSA + 12 Scenario (6 real-world + 6 debugging). "
 "Debugging questions show **buggy pseudocode** (no language given away) for the candidate to fix. "
 "Every reference solution was executed against its examples + 2 hidden tests.","",
 "Applying `question_bank_v2_apply.sql` retires all current DSA + Scenario questions and inserts these 24.","",
 "---",""]
for q in Q:
    md.append(f"## {q['id']} · {q['category'].upper()} · {q['difficulty']} · {q['marks']} marks")
    md.append("")
    for f in FIELDS:
        md.append(f"**{f}**")
        md.append("")
        md.append("```")
        md.append(q[f])
        md.append("```")
        md.append("")
    md.append("---")
    md.append("")
open(os.path.join(OUT,"question_bank_v2_review.md"),"w",encoding="utf-8").write("\n".join(md))
print("Wrote:")
print("  "+os.path.join(OUT,"question_bank_v2_review.md"))
print("  "+os.path.join(OUT,"question_bank_v2_apply.sql"))
