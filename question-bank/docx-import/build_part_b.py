#!/usr/bin/env python3
"""Build + verify docx import slice: "Arrays and Strings" Part B (Strings) and
Part C (Scenario-Based Debugging) -> part_b.json.

Every example and hidden test is checked against:
  * DSA: the Python code embedded in `reference_answer` (exec'd from the text itself)
  * Debugging: a Python simulation of BOTH the buggy pseudocode (must give the
    stated "Actual output") and the fixed pseudocode (must give "Expected output").
The JSON is written only if every assertion passes.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "part_b.json")
REF = os.path.join(HERE, "existing-bank-reference.json")

KEYS = ["id", "category", "difficulty", "marks", "title", "topic", "prompt",
        "sample_data", "expected_output", "reference_answer", "hint", "rubric",
        "checkpoints", "source"]


# --------------------------------------------------------------------------
# Display helpers (Python value -> language-neutral display)
# --------------------------------------------------------------------------
def fmt(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{fmt(k)}: {fmt(x)}" for k, x in v.items()) + "}"
    raise TypeError(type(v))


class PseudoIndexError(Exception):
    def __init__(self, idx):
        super().__init__(idx)
        self.idx = idx


class PArr:
    """Bounds-checked 0-indexed array/string, as in the pseudocode (no negative indexing)."""
    def __init__(self, data):
        self.d = list(data)

    def _chk(self, i):
        if i < 0 or i >= len(self.d):
            raise PseudoIndexError(i)

    def __getitem__(self, i):
        self._chk(i)
        return self.d[i]

    def __setitem__(self, i, v):
        self._chk(i)
        self.d[i] = v

    def __len__(self):
        return len(self.d)


def run(fn, args, show=fmt):
    try:
        return show(fn(*args))
    except PseudoIndexError as e:
        return f"error — index {e.idx} is out of range"


# --------------------------------------------------------------------------
# Part B — Strings (category dsa)
# --------------------------------------------------------------------------
DSA = []

DSA.append(dict(
    id="qb-dsa-d201", difficulty="easy", title="Reverse a String", topic="Strings",
    fname="reverseString", params=["s"],
    body=(
        "Write a function `reverseString(s)` that returns the characters of the string `s` "
        "in reverse order. Spaces, digits and letter case are kept exactly as they are; only "
        "the order changes.\n\n"
        "Build the reversed string yourself, character by character, instead of calling a "
        "built-in reverse function."
    ),
    constraints=["0 ≤ length(s) ≤ 10^5", "`s` may contain letters, digits and spaces."],
    examples=[
        (["planet"], '"tenalp"', "The characters are read from last to first."),
        (["Hello World"], '"dlroW olleH"', "The space and the capital letters stay; only the order is reversed."),
        ([""], '""', "An empty string stays empty."),
    ],
    hidden=[
        (["a"], '"a"', "single character is unchanged"),
        (["12345"], '"54321"', "digits are characters too"),
    ],
    reference_answer=(
        "Walk the string from the last index down to 0 and append each character to the result "
        "(or swap characters from both ends of a character array). O(n) time, O(n) space. "
        "Note: prepending (rev = ch + rev) is also correct but O(n^2) in languages with immutable "
        "strings — acceptable for this size, mention it if discussing complexity.\n\n"
        "def reverseString(s):\n"
        "    out = []\n"
        "    for i in range(len(s) - 1, -1, -1):\n"
        "        out.append(s[i])\n"
        "    return ''.join(out)"
    ),
    hint="Start from the last character and work towards the first, adding each one to a new result.",
    rubric=(
        "- Returns the characters in exact reverse order, keeping spaces, digits and case.\n"
        "- Builds the result with a loop (or two-pointer swaps) rather than a single built-in reverse call.\n"
        "- Handles the empty string and a single character.\n"
        "- Linear-time approach for full credit (repeated prepending is accepted with a complexity note)."
    ),
    checkpoints=(
        "Iterates over the characters from last to first (or swaps from both ends)\n"
        "Builds the reversed result without a built-in reverse\n"
        "Keeps spaces, digits and letter case unchanged\n"
        "Handles the empty string and a single character\n"
        "States or implies O(n) complexity"
    ),
    source="docx: Arrays and Strings Part B · Q1",
))

DSA.append(dict(
    id="qb-dsa-d202", difficulty="easy", title="Count Vowels and Consonants", topic="Strings · Counting",
    fname="countVowelsConsonants", params=["s"],
    body=(
        "Write a function `countVowelsConsonants(s)` that counts the vowels and the consonants in "
        "the string `s` and returns them as a pair `[vowels, consonants]`.\n\n"
        "- Vowels are `a`, `e`, `i`, `o`, `u` in either upper or lower case.\n"
        "- Consonants are all other English letters (so `y` is a consonant).\n"
        "- Digits, spaces and symbols are not counted at all."
    ),
    constraints=["0 ≤ length(s) ≤ 10^5", "`s` contains printable ASCII characters."],
    examples=[
        (["Hello World"], "[3, 7]", "Vowels are e, o, o. Consonants are H, l, l, W, r, l, d."),
        (["AEIOU bcd 123"], "[5, 3]", "Upper-case vowels count; the spaces and digits are ignored."),
        (["xyz"], "[0, 3]", "There are no vowels; y is a consonant."),
    ],
    hidden=[
        ([""], "[0, 0]", "empty string"),
        (["Sky-high, 42!"], "[1, 6]", "y is a consonant; the hyphen, comma, digits and ! are ignored"),
    ],
    reference_answer=(
        "One pass: lowercase each character; if it is an English letter, increment vowels when it "
        "is in 'aeiou', otherwise consonants. Non-letters are skipped. O(n) time, O(1) space.\n\n"
        "def countVowelsConsonants(s):\n"
        "    vowels = consonants = 0\n"
        "    for ch in s.lower():\n"
        "        if 'a' <= ch <= 'z':\n"
        "            if ch in 'aeiou':\n"
        "                vowels += 1\n"
        "            else:\n"
        "                consonants += 1\n"
        "    return [vowels, consonants]"
    ),
    hint="First decide whether a character is a letter at all. Only then check whether it is a vowel — and remember capitals.",
    rubric=(
        "- Counts vowels case-insensitively (A and a both count).\n"
        "- Counts only letters as consonants — digits, spaces and symbols are ignored.\n"
        "- Treats y as a consonant.\n"
        "- Returns both counts in the order [vowels, consonants]; O(n) single pass."
    ),
    checkpoints=(
        "Checks that a character is a letter before classifying it\n"
        "Counts vowels in both upper and lower case\n"
        "Counts every other letter as a consonant (including y)\n"
        "Ignores digits, spaces and symbols\n"
        "Returns [vowels, consonants] for the empty string as [0, 0]"
    ),
    source="docx: Arrays and Strings Part B · Q3",
))

DSA.append(dict(
    id="qb-dsa-d203", difficulty="easy", title="Count Words in a Sentence", topic="Strings",
    fname="countWords", params=["s"],
    body=(
        "Write a function `countWords(s)` that returns the number of words in the sentence `s`.\n\n"
        "A word is a run of non-whitespace characters. Words may be separated by **one or more** "
        "whitespace characters (spaces, tabs or newlines), and leading or trailing whitespace "
        "must be ignored."
    ),
    constraints=["0 ≤ length(s) ≤ 10^5", "`s` contains printable ASCII characters, tabs and newlines."],
    examples=[
        (["  Coding   is fun  "], "3", "The words are Coding, is and fun. Repeated, leading and trailing spaces are ignored."),
        (["Hello"], "1", "There is a single word."),
        (["   "], "0", "The string contains only spaces, so there are no words."),
    ],
    hidden=[
        ([""], "0", "empty string"),
        (["one two\tthree\nfour"], "4", "a tab and a newline also separate words"),
    ],
    reference_answer=(
        "Scan once, counting the positions where a non-whitespace character starts a new word "
        "(the previous character was whitespace or there was none). Splitting on runs of "
        "whitespace and counting the non-empty parts is also fine. O(n) time, O(1) space.\n\n"
        "def countWords(s):\n"
        "    count = 0\n"
        "    in_word = False\n"
        "    for ch in s:\n"
        "        if ch.isspace():\n"
        "            in_word = False\n"
        "        elif not in_word:\n"
        "            count += 1\n"
        "            in_word = True\n"
        "    return count"
    ),
    hint="Counting spaces and adding 1 breaks when spaces repeat. Instead, count the places where a word begins.",
    rubric=(
        "- Counts runs of non-whitespace characters, not raw spaces (no 'spaces + 1' bug).\n"
        "- Ignores leading, trailing and repeated whitespace.\n"
        "- Returns 0 for an empty or whitespace-only string.\n"
        "- Treats tabs and newlines as separators; O(n)."
    ),
    checkpoints=(
        "Identifies word boundaries (start of a non-whitespace run) or splits on whitespace runs\n"
        "Handles repeated spaces between words\n"
        "Ignores leading and trailing whitespace\n"
        "Returns 0 for empty / whitespace-only input\n"
        "Treats tabs and newlines as whitespace"
    ),
    source="docx: Arrays and Strings Part B · Q4",
))

DSA.append(dict(
    id="qb-dsa-d204", difficulty="easy", title="Character Frequency", topic="Strings · Hash Map",
    fname="charFrequency", params=["s"],
    body=(
        "Write a function `charFrequency(s)` that returns a map/dictionary from each character of "
        "`s` to the number of times it occurs.\n\n"
        "- Counting is **case-sensitive**: `A` and `a` are different characters.\n"
        "- Every character counts, including spaces, digits and symbols.\n"
        "- Keys must appear in the order of their **first appearance** in `s`. If your language's "
        "map does not keep insertion order, also keep the characters in first-seen order (for "
        "example in a separate array) and return or print the counts in that order."
    ),
    constraints=["0 ≤ length(s) ≤ 10^5", "`s` contains printable ASCII characters."],
    examples=[
        (["letter"], '{"l": 1, "e": 2, "t": 2, "r": 1}', "l is seen first, then e, t and r; e and t appear twice each."),
        (["AaA"], '{"A": 2, "a": 1}', "Upper-case A and lower-case a are counted separately."),
        ([""], "{}", "An empty string has no characters, so the map is empty."),
    ],
    hidden=[
        (["a b a"], '{"a": 2, " ": 2, "b": 1}', "spaces are counted as characters"),
        (["112!1"], '{"1": 3, "2": 1, "!": 1}', "digits and symbols count; order of first appearance"),
    ],
    reference_answer=(
        "One pass with a hash map: if the character is new, give it a count of 0 (and remember its "
        "order), then add 1. O(n) time, O(k) space for k distinct characters. Python dicts keep "
        "insertion order, so first-appearance order comes for free.\n\n"
        "def charFrequency(s):\n"
        "    freq = {}\n"
        "    for ch in s:\n"
        "        freq[ch] = freq.get(ch, 0) + 1\n"
        "    return freq"
    ),
    hint="Use a map from character to count. What should the count be the first time you meet a character?",
    rubric=(
        "- Counts every character, case-sensitively, including spaces, digits and symbols.\n"
        "- Initialises a new character's count before incrementing (no missing-key error).\n"
        "- Reports characters in order of first appearance.\n"
        "- O(n) single pass with a map (an O(n^2) count-per-character scan earns partial credit)."
    ),
    checkpoints=(
        "Uses a map/dictionary from character to count\n"
        "Initialises a new key to 0 (or uses a default) before adding 1\n"
        "Treats upper and lower case as different characters\n"
        "Counts spaces, digits and symbols\n"
        "Preserves first-appearance order and returns {} for an empty string"
    ),
    source="docx: Arrays and Strings Part B · Q5",
))

DSA.append(dict(
    id="qb-dsa-d205", difficulty="medium", title="Check Two Strings Are Anagrams", topic="Strings · Hash Map",
    fname="isAnagram", params=["a", "b"],
    body=(
        "Two strings are **anagrams** if one can be rearranged to form the other using every letter "
        "exactly as many times as it appears. Spaces and letter case are ignored.\n\n"
        "Write a function `isAnagram(a, b)` that returns `true` if `a` and `b` are anagrams, "
        "otherwise `false`."
    ),
    constraints=["0 ≤ length(a), length(b) ≤ 10^5", "`a` and `b` contain only English letters and spaces."],
    examples=[
        (["listen", "silent"], "true", "Both contain e, i, l, n, s, t once each."),
        (["hello", "world"], "false", "The letters are different."),
        (["Dormitory", "Dirty room"], "true", "After removing the space and ignoring case, both use the same letters the same number of times."),
    ],
    hidden=[
        (["aab", "abb"], "false", "same length and same set of letters, but different counts"),
        (["School master", "The classroom"], "true", "spaces in different places and mixed case"),
    ],
    reference_answer=(
        "Remove spaces and lowercase both strings; if the cleaned lengths differ return false. "
        "Count letters of the first in a map, then decrement for the second — any count going "
        "below zero means false. O(n) time, O(1) extra space (26 letters). Sorting both cleaned "
        "strings and comparing is an accepted O(n log n) alternative.\n\n"
        "def isAnagram(a, b):\n"
        "    a = a.replace(' ', '').lower()\n"
        "    b = b.replace(' ', '').lower()\n"
        "    if len(a) != len(b):\n"
        "        return False\n"
        "    count = {}\n"
        "    for ch in a:\n"
        "        count[ch] = count.get(ch, 0) + 1\n"
        "    for ch in b:\n"
        "        if count.get(ch, 0) == 0:\n"
        "            return False\n"
        "        count[ch] -= 1\n"
        "    return True"
    ),
    hint="Clean both strings the same way first. Then think about comparing how many times each letter appears, not just which letters appear.",
    rubric=(
        "- Ignores spaces and letter case in both strings.\n"
        "- Compares letter COUNTS, not just the set of letters (\"aab\" vs \"abb\" is false).\n"
        "- Returns false when the cleaned lengths differ.\n"
        "- O(n) counting for full credit; sorting both strings (O(n log n)) is accepted."
    ),
    checkpoints=(
        "Removes spaces and normalises case before comparing\n"
        "Uses frequency counting or sorting of the cleaned strings\n"
        "Compares counts so repeated letters must match exactly\n"
        "Handles different cleaned lengths (returns false)\n"
        "States or implies O(n) or O(n log n) complexity"
    ),
    source="docx: Arrays and Strings Part B · Q6",
))

DSA.append(dict(
    id="qb-dsa-d206", difficulty="easy", title="Reverse Each Word in a Sentence", topic="Strings",
    fname="reverseWords", params=["sentence"],
    body=(
        "Write a function `reverseWords(sentence)` that reverses the characters **inside each word** "
        "while keeping the words in their original order. Return the new sentence.\n\n"
        "Words are separated by spaces. In the result, words are joined by exactly one space: "
        "leading, trailing and repeated spaces are removed. Punctuation attached to a word is "
        "part of that word."
    ),
    constraints=["0 ≤ length(sentence) ≤ 10^5", "`sentence` contains printable ASCII characters."],
    examples=[
        (["hello world"], '"olleh dlrow"', "\"hello\" becomes \"olleh\" and \"world\" becomes \"dlrow\"; the word order is unchanged."),
        (["Coding is fun"], '"gnidoC si nuf"', "Letter case is kept while each word is reversed."),
        ([" hi   there "], '"ih ereht"', "Leading, trailing and repeated spaces are removed."),
    ],
    hidden=[
        ([""], '""', "empty sentence"),
        (["Hi, you!"], '",iH !uoy"', "punctuation belongs to the word it is attached to"),
    ],
    reference_answer=(
        "Split the sentence into words on runs of spaces (dropping empty pieces), reverse each word, "
        "and join them with single spaces. O(n) time, O(n) space.\n\n"
        "def reverseWords(sentence):\n"
        "    return ' '.join(word[::-1] for word in sentence.split())"
    ),
    hint="Break the problem in two: find the words, then reverse each one separately before putting them back together.",
    rubric=(
        "- Reverses the characters within each word.\n"
        "- Keeps the words in their original order (does not reverse the whole sentence).\n"
        "- Collapses leading, trailing and repeated spaces to single separating spaces.\n"
        "- Handles the empty sentence; O(n)."
    ),
    checkpoints=(
        "Separates the sentence into words correctly (ignoring empty pieces)\n"
        "Reverses each word individually\n"
        "Keeps the original word order\n"
        "Joins words with exactly one space (no leading/trailing spaces)\n"
        "Handles the empty sentence"
    ),
    source="docx: Arrays and Strings Part B · Q8",
))


# --------------------------------------------------------------------------
# Part C — Scenario-Based Debugging (category scenario)
#   Each entry: buggy(*args) and fixed(*args) simulate the pseudocode exactly.
# --------------------------------------------------------------------------
NEG_INF = float("-inf")


def b_sum(arr):
    a = PArr(arr); total = 0
    for i in range(0, len(arr) + 1):          # FOR i FROM 0 TO length(arr)  (inclusive)
        total = total + a[i]
    return total


def f_sum(arr):
    total = 0
    for x in arr:
        total = total + x
    return total


def b_add(a_text, b_text):                    # READ returns text; + on text joins
    return a_text + b_text


def f_add(a_text, b_text):
    return int(a_text) + int(b_text)


def b_shout(s):
    s.upper()                                 # result discarded
    return s


def f_shout(s):
    s = s.upper()
    return s


def b_vowels(s):
    count = 0
    for c in s:
        if c in "aeiou":
            count += 1
    return count


def f_vowels(s):
    count = 0
    for c in s:
        if c.lower() in "aeiou":
            count += 1
    return count


def b_reverse(arr):
    a = PArr(arr); n = len(a)
    for i in range(0, n):                     # FOR i FROM 0 TO n − 1
        a[i], a[n - 1 - i] = a[n - 1 - i], a[i]
    return a.d


def f_reverse(arr):
    a = PArr(arr); n = len(a)
    for i in range(0, n // 2):                # FOR i FROM 0 TO (n DIV 2) − 1
        a[i], a[n - 1 - i] = a[n - 1 - i], a[i]
    return a.d


def b_pal(s):
    t = PArr(s); n = len(t)
    for i in range(0, n // 2):
        if t[i] != t[n - i]:
            return False
    return True


def f_pal(s):
    t = PArr(s); n = len(t)
    for i in range(0, n // 2):
        if t[i] != t[n - 1 - i]:
            return False
    return True


def b_search(arr, key):
    a = PArr(arr)
    for i in range(0, len(a)):
        if a[i] == key:
            return i
        else:
            return -1
    return -1


def f_search(arr, key):
    a = PArr(arr)
    for i in range(0, len(a)):
        if a[i] == key:
            return i
    return -1


def b_second(arr):
    first = second = NEG_INF
    for x in arr:
        if x > first:
            second = first; first = x
        elif x > second:
            second = x
    return second


def f_second(arr):
    first = second = NEG_INF
    for x in arr:
        if x > first:
            second = first; first = x
        elif x > second and x != first:
            second = x
    return second


DBG = []

DBG.append(dict(
    id="qb-scn-d201", difficulty="easy", title="Debugging: Sum Loop Runs One Step Too Far",
    topic="Debugging · Arrays · Loops", fname="sumAll", params=["arr"],
    buggy=b_sum, fixed=f_sum,
    body=(
        "A student writes a function that should return the **sum** of all the marks in an array. "
        "Instead of returning the total, the program crashes.\n\n"
        "Pseudocode note: `FOR i FROM a TO b` runs with i = a, a + 1, …, b (**both ends included**). "
        "Arrays are 0-indexed, and reading `arr[i]` outside `0 … length(arr) − 1` is an error.\n\n"
        "Do three things: (1) point out the bug, (2) explain **why** the program crashes, and "
        "(3) rewrite the faulty line correctly."
    ),
    constraints=["0 ≤ length(arr) ≤ 10^5", "Your fix must still return 0 for an empty array."],
    pseudocode=(
        "FUNCTION sumAll(arr):\n"
        "    total ← 0\n"
        "    FOR i FROM 0 TO length(arr):\n"
        "        total ← total + arr[i]\n"
        "    RETURN total"
    ),
    examples=[
        ([[1, 2, 3, 4, 5]], "15", "error — index 5 is out of range",
         "The loop runs for i = 0 … 5, but the last valid index is 4."),
        ([[10]], "10", "error — index 1 is out of range",
         "Even with one element the loop makes one extra step."),
    ],
    hidden=[
        ([[]], "0", "error — index 0 is out of range", "empty array must sum to 0"),
        ([[-3, 3, 7]], "7", "error — index 3 is out of range", "negatives cancel; only the loop bound was wrong"),
    ],
    fix_line="FOR i FROM 0 TO length(arr) − 1 (or FOR each x IN arr: total ← total + x).",
    reference_answer=(
        "Bug: the loop bound `FOR i FROM 0 TO length(arr)` is off by one — because the range is "
        "inclusive it visits index length(arr), which does not exist.\n"
        "Why: valid indices are 0 … length(arr) − 1, so the final iteration reads past the end and "
        "the program crashes (for [1, 2, 3, 4, 5] it reads arr[5]). With an empty array it fails on "
        "the very first step (arr[0]).\n"
        "Fix: stop one earlier, or loop over the values directly so no index can go out of range.\n\n"
        "Corrected pseudocode:\n"
        "FUNCTION sumAll(arr):\n"
        "    total ← 0\n"
        "    FOR i FROM 0 TO length(arr) − 1:\n"
        "        total ← total + arr[i]\n"
        "    RETURN total\n"
        "(Equivalent: FOR each x IN arr: total ← total + x.)"
    ),
    hint="Write down the values i takes for a 5-element array. What is the largest index that actually exists?",
    rubric=(
        "- Identifies the loop upper bound (TO length(arr)) as the bug.\n"
        "- Explains the last iteration reads one index past the end (off-by-one).\n"
        "- Fix uses length(arr) − 1 or iterates over the values directly.\n"
        "- Fixed version returns 0 for an empty array."
    ),
    checkpoints=(
        "Points to the FOR i FROM 0 TO length(arr) line\n"
        "Explains the inclusive bound visits index length(arr), which does not exist\n"
        "States that valid indices are 0 to length(arr) − 1\n"
        "Gives a correct fix (TO length(arr) − 1, or FOR each x IN arr)\n"
        "Confirms the corrected output 15 and 0 for an empty array"
    ),
    source="docx: Arrays and Strings Part C · Q1",
))

DBG.append(dict(
    id="qb-scn-d202", difficulty="easy", title="Debugging: Typed Numbers Are Joined, Not Added",
    topic="Debugging · Input · Data Types", fname=None, params=["first", "second"],
    buggy=b_add, fixed=f_add, show=str,
    input_disp=lambda a, b: f"the user types {a}, then {b}",
    hidden_disp=lambda a, b: f"inputs {a} and {b}",
    body=(
        "A simple calculator asks the user for two whole numbers and should print their **sum**. "
        "The program runs without any error, but the result is wrong.\n\n"
        "Pseudocode note: `READ(message)` shows the message and returns exactly what the user typed "
        "**as text** — typing 2 gives the text `\"2\"`, not the number 2. Using `+` on two text values "
        "joins them (`\"2\" + \"3\"` → `\"23\"`). `toNumber(text)` converts text such as `\"42\"` into "
        "the number 42.\n\n"
        "Do three things: (1) point out the bug, (2) explain **why** the output is wrong, and "
        "(3) fix it."
    ),
    constraints=["The user always types a valid whole number (it may have leading zeros, e.g. 05).",
                 "The sum fits in a 32-bit integer."],
    pseudocode=(
        "a ← READ(\"First number: \")\n"
        "b ← READ(\"Second number: \")\n"
        "PRINT a + b"
    ),
    examples=[
        (["2", "3"], "5", "23", "The text \"2\" and the text \"3\" are joined into \"23\"."),
        (["10", "5"], "15", "105", "Joining \"10\" and \"5\" gives \"105\"."),
    ],
    hidden=[
        (["0", "7"], "7", "07", "a leading 0 from joining shows the values were never added"),
        (["05", "5"], "10", "055", "after conversion the leading zero no longer matters"),
    ],
    fix_line="convert before adding — a ← toNumber(READ(\"First number: \")) and b ← toNumber(READ(\"Second number: \")).",
    reference_answer=(
        "Bug: `a` and `b` hold text, not numbers, because READ returns what was typed as text; "
        "`a + b` therefore joins the two texts instead of adding them.\n"
        "Why: + on text means concatenation, so \"2\" + \"3\" becomes \"23\". The same type mix-up "
        "would also make a comparison like `a = 5` fail, because text \"5\" is not the number 5.\n"
        "Fix: convert each input to a number as soon as it is read, then add.\n\n"
        "Corrected pseudocode:\n"
        "a ← toNumber(READ(\"First number: \"))\n"
        "b ← toNumber(READ(\"Second number: \"))\n"
        "PRINT a + b"
    ),
    hint="What type of value does READ give back? What does + do when both sides are that type?",
    rubric=(
        "- Identifies that the inputs are text, not numbers.\n"
        "- Explains that + on text joins (concatenates) instead of adding.\n"
        "- Fix converts both inputs to numbers before adding.\n"
        "- Corrected program prints 5 for inputs 2 and 3."
    ),
    checkpoints=(
        "States that READ returns text (a string), not a number\n"
        "Explains + concatenates text, giving 23 instead of 5\n"
        "Converts BOTH inputs with toNumber (or equivalent) before using them\n"
        "Gives the correct output 5 for inputs 2 and 3\n"
        "Clear, correct explanation"
    ),
    source="docx: Arrays and Strings Part C · Q2",
))

DBG.append(dict(
    id="qb-scn-d203", difficulty="easy", title="Debugging: Upper-Case Result Is Thrown Away",
    topic="Debugging · Strings · Return Values", fname="shout", params=["s"],
    buggy=b_shout, fixed=f_shout,
    body=(
        "A chat app has a \"shout\" button that should return the message in **capital letters**. "
        "The function runs without error, but it returns the message unchanged.\n\n"
        "Pseudocode note: `toUpper(text)` **returns a new** upper-case copy of `text`; it does not "
        "change `text` itself.\n\n"
        "Do three things: (1) point out the bug, (2) explain **why** the message is unchanged, and "
        "(3) fix it."
    ),
    constraints=["0 ≤ length(s) ≤ 10^4", "Digits, spaces and symbols are left as they are."],
    pseudocode=(
        "FUNCTION shout(s):\n"
        "    toUpper(s)\n"
        "    RETURN s"
    ),
    examples=[
        (["hello"], '"HELLO"', '"hello"', "toUpper builds \"HELLO\", but that new value is never stored."),
        (["Good Day"], '"GOOD DAY"', '"Good Day"', "The original s is returned exactly as it came in."),
    ],
    hidden=[
        (["ABC"], '"ABC"', '"ABC"', "already upper case, so the bug is invisible here"),
        (["hi 5!"], '"HI 5!"', '"hi 5!"', "digits, spaces and symbols are unchanged"),
    ],
    fix_line="s ← toUpper(s) (or RETURN toUpper(s)).",
    reference_answer=(
        "Bug: the line `toUpper(s)` calls the function but throws its result away.\n"
        "Why: toUpper does not modify s — it returns a new upper-case copy. Since that copy is never "
        "assigned or returned, s is still the original text.\n"
        "Fix: store (or return) the result.\n\n"
        "Corrected pseudocode:\n"
        "FUNCTION shout(s):\n"
        "    s ← toUpper(s)\n"
        "    RETURN s"
    ),
    hint="Read the note about toUpper carefully. Where does the new upper-case value go after the call?",
    rubric=(
        "- Identifies that the result of toUpper(s) is discarded.\n"
        "- Explains toUpper returns a new value and does not change s.\n"
        "- Fix assigns the result back (s ← toUpper(s)) or returns it directly."
    ),
    checkpoints=(
        "Points to the toUpper(s) line as the bug\n"
        "Explains toUpper returns a new copy instead of changing s\n"
        "Fix stores or returns the result of toUpper\n"
        "Gives the correct output \"HELLO\" for \"hello\"\n"
        "Clear, correct explanation"
    ),
    source="docx: Arrays and Strings Part C · Q4",
))

DBG.append(dict(
    id="qb-scn-d204", difficulty="easy", title="Debugging: Vowel Counter Misses Capitals",
    topic="Debugging · Strings", fname="countVowels", params=["s"],
    buggy=b_vowels, fixed=f_vowels,
    body=(
        "A spelling game counts the vowels (`a`, `e`, `i`, `o`, `u`) in a word, in **both upper and "
        "lower case**. For `\"Apple\"` it reports 1 vowel instead of 2.\n\n"
        "Pseudocode note: `c IN \"aeiou\"` is true only when `c` is exactly one of those five "
        "lower-case characters — the check is case-sensitive, so `\"A\"` is not in `\"aeiou\"`. "
        "`toLower(c)` returns the lower-case form of `c`.\n\n"
        "Do three things: (1) point out the bug, (2) explain **why** some vowels are missed, and "
        "(3) fix it."
    ),
    constraints=["0 ≤ length(s) ≤ 10^5", "`s` contains English letters and spaces."],
    pseudocode=(
        "FUNCTION countVowels(s):\n"
        "    count ← 0\n"
        "    FOR each c IN s:\n"
        "        IF c IN \"aeiou\":\n"
        "            count ← count + 1\n"
        "    RETURN count"
    ),
    examples=[
        (["Apple"], "2", "1", "The capital A is not in \"aeiou\", so only e is counted."),
        (["AEIOU"], "5", "0", "Every vowel is upper case, so none is counted."),
    ],
    hidden=[
        (["banana"], "3", "3", "all lower case, so the bug is hidden"),
        (["Umbrella Ice"], "5", "3", "capital U and I must be counted too"),
    ],
    fix_line="compare in one case — IF toLower(c) IN \"aeiou\" (or check against \"aeiouAEIOU\").",
    reference_answer=(
        "Bug: the test `IF c IN \"aeiou\"` only matches lower-case vowels.\n"
        "Why: the membership check is case-sensitive, so capital vowels such as A, I or U are "
        "skipped and the count is too low.\n"
        "Fix: normalise the case before checking (or include the capital vowels in the set).\n\n"
        "Corrected pseudocode:\n"
        "FUNCTION countVowels(s):\n"
        "    count ← 0\n"
        "    FOR each c IN s:\n"
        "        IF toLower(c) IN \"aeiou\":\n"
        "            count ← count + 1\n"
        "    RETURN count"
    ),
    hint="Which letter in \"Apple\" is not being counted? How is it different from the others?",
    rubric=(
        "- Identifies the case-sensitive check as the bug.\n"
        "- Explains that upper-case vowels are not in \"aeiou\".\n"
        "- Fix lowercases c (or the whole string) before checking, or adds capital vowels to the set."
    ),
    checkpoints=(
        "Points to the IF c IN \"aeiou\" line\n"
        "Explains the comparison is case-sensitive so capitals are missed\n"
        "Fix normalises case (toLower) or checks \"aeiouAEIOU\"\n"
        "Gives the correct output 2 for \"Apple\"\n"
        "Clear, correct explanation"
    ),
    source="docx: Arrays and Strings Part C · Q5",
))

DBG.append(dict(
    id="qb-scn-d205", difficulty="medium", title="Debugging: Reverse Leaves the Array Unchanged",
    topic="Debugging · Arrays · Two Pointers", fname="reverse", params=["arr"],
    buggy=b_reverse, fixed=f_reverse,
    body=(
        "A function should reverse an array **in place** by swapping elements from the two ends. "
        "It runs without error, but the array comes back exactly as it went in.\n\n"
        "Pseudocode note: `FOR i FROM a TO b` includes both ends and does not run at all when "
        "b < a. `swap(x, y)` exchanges the two values. `DIV` is integer division. Arrays are "
        "0-indexed.\n\n"
        "Do three things: (1) point out the bug, (2) explain **why** the array ends up unchanged, "
        "and (3) fix it."
    ),
    constraints=["0 ≤ length(arr) ≤ 10^5", "The fix must still work in place (no second array)."],
    pseudocode=(
        "FUNCTION reverse(arr):\n"
        "    n ← length(arr)\n"
        "    FOR i FROM 0 TO n − 1:\n"
        "        swap(arr[i], arr[n − 1 − i])\n"
        "    RETURN arr"
    ),
    examples=[
        ([[1, 2, 3, 4, 5]], "[5, 4, 3, 2, 1]", "[1, 2, 3, 4, 5]",
         "Pairs (0,4) and (1,3) are swapped on the way to the middle, then swapped back on the way out."),
        ([[1, 2]], "[2, 1]", "[1, 2]", "i = 0 swaps the pair, then i = 1 swaps the same pair back."),
    ],
    hidden=[
        ([[1, 2, 3, 4]], "[4, 3, 2, 1]", "[1, 2, 3, 4]", "even length; the loop must stop after n DIV 2 swaps"),
        ([[]], "[]", "[]", "empty array; the corrected loop must not run"),
    ],
    fix_line="loop only to the middle — FOR i FROM 0 TO (n DIV 2) − 1.",
    reference_answer=(
        "Bug: the loop runs over the whole array (`FOR i FROM 0 TO n − 1`) instead of only the "
        "first half.\n"
        "Why: every pair (i, n − 1 − i) is visited twice — once from each side — so each swap is "
        "undone by a second swap, and the array returns to its original order.\n"
        "Fix: stop at the middle so each pair is swapped exactly once.\n\n"
        "Corrected pseudocode:\n"
        "FUNCTION reverse(arr):\n"
        "    n ← length(arr)\n"
        "    FOR i FROM 0 TO (n DIV 2) − 1:\n"
        "        swap(arr[i], arr[n − 1 − i])\n"
        "    RETURN arr"
    ),
    hint="Trace the loop for [1, 2]. How many times is the pair (0, 1) swapped?",
    rubric=(
        "- Identifies the loop range (whole array instead of half) as the bug.\n"
        "- Explains each pair is swapped twice, undoing the reversal.\n"
        "- Fix limits the loop to the first n DIV 2 positions.\n"
        "- Fixed version still works for odd, even and empty arrays."
    ),
    checkpoints=(
        "Points to the FOR i FROM 0 TO n − 1 line\n"
        "Explains every pair is swapped twice and so restored\n"
        "Fix loops to (n DIV 2) − 1\n"
        "Correct for both odd and even lengths\n"
        "Clear, correct explanation"
    ),
    source="docx: Arrays and Strings Part C · Q6",
))

DBG.append(dict(
    id="qb-scn-d206", difficulty="easy", title="Debugging: Palindrome Check Reads Past the End",
    topic="Debugging · Strings · Indexing", fname="isPalindrome", params=["s"],
    buggy=b_pal, fixed=f_pal,
    body=(
        "A function should return `true` if a word reads the same forwards and backwards, otherwise "
        "`false`. Instead it crashes for almost every input.\n\n"
        "Pseudocode note: strings are 0-indexed, and reading `s[i]` outside `0 … length(s) − 1` is an "
        "error. `FOR i FROM a TO b` includes both ends and does not run when b < a. `DIV` is integer "
        "division.\n\n"
        "Do three things: (1) point out the bug, (2) explain **why** it crashes, and (3) fix it."
    ),
    constraints=["0 ≤ length(s) ≤ 10^5", "The comparison is case-sensitive (no cleaning is needed)."],
    pseudocode=(
        "FUNCTION isPalindrome(s):\n"
        "    n ← length(s)\n"
        "    FOR i FROM 0 TO (n DIV 2) − 1:\n"
        "        IF s[i] ≠ s[n − i]:\n"
        "            RETURN false\n"
        "    RETURN true"
    ),
    examples=[
        (["madam"], "true", "error — index 5 is out of range", "On the first step (i = 0) it reads s[5], one past the last index 4."),
        (["hello"], "false", "error — index 5 is out of range", "It crashes before it can compare anything."),
    ],
    hidden=[
        (["a"], "true", "true", "single character; the loop never runs, so the bug hides"),
        (["abba"], "true", "error — index 4 is out of range", "even length; pairs (0,3) and (1,2) must be compared"),
    ],
    fix_line="compare with the true mirror index — IF s[i] ≠ s[n − 1 − i].",
    reference_answer=(
        "Bug: the mirror index `n − i` is off by one; the character that mirrors position i is at "
        "n − 1 − i.\n"
        "Why: at i = 0 the code reads s[n], but the last valid index is n − 1, so it crashes on the "
        "first comparison for any string of length 2 or more.\n"
        "Fix: use n − 1 − i.\n\n"
        "Corrected pseudocode:\n"
        "FUNCTION isPalindrome(s):\n"
        "    n ← length(s)\n"
        "    FOR i FROM 0 TO (n DIV 2) − 1:\n"
        "        IF s[i] ≠ s[n − 1 − i]:\n"
        "            RETURN false\n"
        "    RETURN true"
    ),
    hint="For a 5-letter word, which index should the first letter be compared with? What index does the code use?",
    rubric=(
        "- Identifies the mirror index n − i as the bug.\n"
        "- Explains s[n] is one past the last valid index, so the first comparison crashes.\n"
        "- Fix uses n − 1 − i (loop bounds stay the same)."
    ),
    checkpoints=(
        "Points to s[n − i] as the faulty expression\n"
        "Explains index n is out of range (last index is n − 1)\n"
        "Fix compares s[i] with s[n − 1 − i]\n"
        "Gives the correct outputs true for \"madam\" and false for \"hello\"\n"
        "Clear, correct explanation"
    ),
    source="docx: Arrays and Strings Part C · Q7",
))

DBG.append(dict(
    id="qb-scn-d207", difficulty="easy", title="Debugging: Linear Search Gives Up Too Early",
    topic="Debugging · Arrays · Searching", fname="search", params=["arr", "key"],
    buggy=b_search, fixed=f_search,
    body=(
        "A function should return the index of the **first** occurrence of `key` in `arr`, or `-1` "
        "if `key` is not present. It only ever finds a key that sits at index 0; every other key is "
        "reported as missing.\n\n"
        "Pseudocode note: `RETURN` ends the function immediately, even inside a loop. Arrays are "
        "0-indexed.\n\n"
        "Do three things: (1) point out the bug, (2) explain **why** later keys are never found, "
        "and (3) fix it."
    ),
    constraints=["0 ≤ length(arr) ≤ 10^5", "Values may repeat; return the first matching index."],
    pseudocode=(
        "FUNCTION search(arr, key):\n"
        "    FOR i FROM 0 TO length(arr) − 1:\n"
        "        IF arr[i] = key:\n"
        "            RETURN i\n"
        "        ELSE:\n"
        "            RETURN −1\n"
        "    RETURN −1"
    ),
    examples=[
        ([[5, 8, 2, 9], 2], "2", "-1", "arr[0] = 5 is not 2, so the ELSE branch returns -1 straight away."),
        ([[5, 8, 2, 9], 9], "3", "-1", "Only the first element is ever checked."),
    ],
    hidden=[
        ([[5, 8, 2, 9], 5], "0", "0", "key at index 0, so the bug hides"),
        ([[3, 6, 6], 6], "1", "-1", "must return the FIRST matching index"),
    ],
    fix_line="delete the ELSE branch so RETURN −1 happens only after the loop has checked every element.",
    reference_answer=(
        "Bug: the `ELSE: RETURN −1` inside the loop.\n"
        "Why: on the first element that does not match, the function returns −1 and the loop never "
        "reaches the remaining elements — so only arr[0] is ever checked.\n"
        "Fix: remove the ELSE; a missing key can only be decided after the whole array has been "
        "searched.\n\n"
        "Corrected pseudocode:\n"
        "FUNCTION search(arr, key):\n"
        "    FOR i FROM 0 TO length(arr) − 1:\n"
        "        IF arr[i] = key:\n"
        "            RETURN i\n"
        "    RETURN −1"
    ),
    hint="When can you be sure the key is NOT in the array — after one mismatch, or after something else?",
    rubric=(
        "- Identifies the ELSE: RETURN −1 inside the loop as the bug.\n"
        "- Explains it returns on the first mismatch, so only index 0 is checked.\n"
        "- Fix returns −1 only after the loop finishes; still returns the first matching index."
    ),
    checkpoints=(
        "Points to the ELSE: RETURN −1 branch\n"
        "Explains RETURN exits on the first mismatch\n"
        "Fix moves the -1 result after the loop (removes the ELSE)\n"
        "Gives the correct output 2 for key 2 in [5, 8, 2, 9]\n"
        "Clear, correct explanation"
    ),
    source="docx: Arrays and Strings Part C · Q8",
))

DBG.append(dict(
    id="qb-scn-d208", difficulty="medium", title="Debugging: Second Largest Returns a Duplicate",
    topic="Debugging · Arrays", fname="secondLargest", params=["arr"],
    buggy=b_second, fixed=f_second,
    body=(
        "A function should return the **second largest distinct** value in an array. For `[5, 5, 3]` "
        "the answer should be `3`, but the function returns `5`.\n\n"
        "Pseudocode note: `−infinity` is smaller than every number.\n\n"
        "Do three things: (1) point out the bug, (2) explain **why** a duplicate of the largest value "
        "is returned, and (3) fix it."
    ),
    constraints=["2 ≤ length(arr) ≤ 10^5", "`arr` always contains at least two distinct values."],
    pseudocode=(
        "FUNCTION secondLargest(arr):\n"
        "    first ← −infinity\n"
        "    second ← −infinity\n"
        "    FOR each x IN arr:\n"
        "        IF x > first:\n"
        "            second ← first\n"
        "            first ← x\n"
        "        ELSE IF x > second:\n"
        "            second ← x\n"
        "    RETURN second"
    ),
    examples=[
        ([[5, 5, 3]], "3", "5", "The second 5 is not greater than first (5) but is greater than second, so second becomes 5."),
        ([[1, 2, 2]], "1", "2", "The repeated 2 overwrites second, which should have stayed 1."),
        ([[10, 20, 30]], "20", "20", "With no duplicates the bug does not show."),
    ],
    hidden=[
        ([[4, 4, 9]], "4", "4", "duplicates before the maximum; the fix must not break this"),
        ([[-1, -1, -5]], "-5", "-1", "all negative, duplicate maximum"),
    ],
    fix_line="ELSE IF x > second AND x ≠ first.",
    reference_answer=(
        "Bug: the condition `ELSE IF x > second` lets a value equal to `first` become `second`.\n"
        "Why: a repeat of the largest value is not greater than first, so it falls into the ELSE IF; "
        "it is greater than second, so second is overwritten with a duplicate of the largest instead "
        "of the next distinct value.\n"
        "Fix: also require x to be different from first.\n\n"
        "Corrected pseudocode:\n"
        "FUNCTION secondLargest(arr):\n"
        "    first ← −infinity\n"
        "    second ← −infinity\n"
        "    FOR each x IN arr:\n"
        "        IF x > first:\n"
        "            second ← first\n"
        "            first ← x\n"
        "        ELSE IF x > second AND x ≠ first:\n"
        "            second ← x\n"
        "    RETURN second"
    ),
    hint="Trace first and second through [5, 5, 3]. What happens when the second 5 arrives?",
    rubric=(
        "- Identifies the ELSE IF x > second condition as the bug.\n"
        "- Explains a duplicate of the largest value slips into second.\n"
        "- Fix adds x ≠ first (distinct check) to that condition.\n"
        "- Fixed version is still correct when duplicates come before the maximum (e.g. [4, 4, 9])."
    ),
    checkpoints=(
        "Points to the ELSE IF x > second condition\n"
        "Explains a value equal to first can overwrite second\n"
        "Fix requires x ≠ first\n"
        "Gives the correct output 3 for [5, 5, 3]\n"
        "Confirms cases like [4, 4, 9] still return 4"
    ),
    source="docx: Arrays and Strings Part C · Q9",
))


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------
DIFF = {"easy": "Easy", "medium": "Medium", "hard": "Hard"}
FAILS = []
CHECKS = [0]


def check(cond, msg):
    CHECKS[0] += 1
    if not cond:
        FAILS.append(msg)


def build_prompt(q):
    head = f"## {q['title']}\n> {q['topic']} · {DIFF[q['difficulty']]}\n\n"
    cons = "### Constraints\n" + "\n".join(f"- {c}" for c in q["constraints"])
    return head + q["body"] + "\n\n" + cons


def call_disp(q, args):
    return f"{q['fname']}(" + ", ".join(fmt(a) for a in args) + ")"


def input_disp(q, args):
    return ", ".join(f"{p} = {fmt(a)}" for p, a in zip(q["params"], args))


def extract_code(ref):
    # code starts at the first line beginning with 'def ' or 'import'/'from'
    lines = ref.split("\n")
    for i, ln in enumerate(lines):
        if ln.startswith(("def ", "import ", "from ")):
            return "\n".join(lines[i:])
    raise AssertionError("no code in reference_answer")


def build_dsa(q):
    ns = {}
    exec(extract_code(q["reference_answer"]), ns)
    fn = ns[q["fname"]]
    ex_blocks, exp_lines = [], []
    for n, (args, out, why) in enumerate(q["examples"], 1):
        got = fmt(fn(*args))
        check(got == out, f"{q['id']} example {n}: got {got}, stated {out}")
        ex_blocks.append(f"**Example {n}**\nInput: {input_disp(q, args)}\nOutput: {out}\nExplanation: {why}")
        exp_lines.append(f"Example {n} → {out}")
    for n, (args, out, why) in enumerate(q["hidden"], 1):
        got = fmt(fn(*args))
        check(got == out, f"{q['id']} hidden {n}: got {got}, stated {out}")
        exp_lines.append(f"Hidden test {n} → {call_disp(q, args)} = {out}  ({why})")
    return dict(
        id=q["id"], category="dsa", difficulty=q["difficulty"], marks=5, title=q["title"],
        topic=q["topic"], prompt=build_prompt(q), sample_data="\n\n".join(ex_blocks),
        expected_output="\n".join(exp_lines), reference_answer=q["reference_answer"],
        hint=q["hint"], rubric=q["rubric"], checkpoints=q["checkpoints"], source=q["source"],
    )


def build_dbg(q):
    show = q.get("show", fmt)
    idisp = q.get("input_disp") or (lambda *a: input_disp(q, a))
    hdisp = q.get("hidden_disp") or (lambda *a: call_disp(q, a))
    ex_blocks, exp_lines = [], []
    for n, (args, exp, act, why) in enumerate(q["examples"], 1):
        g_fix = run(q["fixed"], args, show)
        g_bug = run(q["buggy"], args, show)
        check(g_fix == exp, f"{q['id']} example {n} fixed: got {g_fix}, stated {exp}")
        check(g_bug == act, f"{q['id']} example {n} buggy: got {g_bug}, stated {act}")
        ex_blocks.append(f"**Example {n}**\nInput: {idisp(*args)}\nExpected output: {exp}\n"
                         f"Actual output: {act}\nExplanation: {why}")
        exp_lines.append(f"Example {n} → {exp}")
    for n, (args, exp, act, why) in enumerate(q["hidden"], 1):
        g_fix = run(q["fixed"], args, show)
        g_bug = run(q["buggy"], args, show)
        check(g_fix == exp, f"{q['id']} hidden {n} fixed: got {g_fix}, stated {exp}")
        check(g_bug == act, f"{q['id']} hidden {n} buggy: got {g_bug}, stated {act}")
        exp_lines.append(f"Hidden test {n} → {hdisp(*args)} = {exp}  ({why}; buggy version gives {act})")
    exp_lines.append(f"The fix: {q['fix_line']}")
    sample = "**Buggy pseudocode**\n```\n" + q["pseudocode"] + "\n```\n\n" + "\n\n".join(ex_blocks)
    return dict(
        id=q["id"], category="scenario", difficulty=q["difficulty"], marks=5, title=q["title"],
        topic=q["topic"], prompt=build_prompt(q), sample_data=sample,
        expected_output="\n".join(exp_lines), reference_answer=q["reference_answer"],
        hint=q["hint"], rubric=q["rubric"], checkpoints=q["checkpoints"], source=q["source"],
    )


def norm_title(t):
    t = re.sub(r"^debugging:\s*", "", t.lower())
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def validate(items, existing):
    ex_titles = {norm_title(re.match(r"## (.+)", e["prompt"]).group(1)) for e in existing}
    ids, titles = set(), set()
    banned = [r"\bPython\b", r"\blist\b", r"\bdict\b", r"\bdef\b", r"\bprint\(", r"\bTrue\b",
              r"\bFalse\b", r"\bNone\b", r"\bIndexError\b", r"\belif\b", r"\brange\(", r"\blen\("]
    for it in items:
        qid = it["id"]
        check(list(it.keys()) == KEYS, f"{qid}: keys {list(it.keys())}")
        m = re.fullmatch(r"qb-(dsa|scn)-d(\d{3})", qid)
        check(bool(m) and 201 <= int(m.group(2)) <= 299, f"{qid}: id out of pattern/range")
        check((m.group(1) == "dsa") == (it["category"] == "dsa"), f"{qid}: id prefix vs category")
        check(it["category"] in ("dsa", "scenario"), f"{qid}: category")
        check(it["difficulty"] in DIFF, f"{qid}: difficulty")
        check(it["marks"] == 5, f"{qid}: marks")
        check(qid not in ids, f"{qid}: duplicate id"); ids.add(qid)
        nt = norm_title(it["title"])
        check(nt not in titles, f"{qid}: duplicate title in slice"); titles.add(nt)
        check(nt not in ex_titles, f"{qid}: title duplicates existing bank")
        check(it["title"] == it["title"].strip() and not re.match(r"Q\d", it["title"]), f"{qid}: title prefix")
        is_dbg = it["title"].startswith("Debugging: ")
        check(is_dbg == (it["category"] == "scenario"), f"{qid}: debugging title/category")
        check(1 <= len(it["topic"].split(" · ")) <= 3, f"{qid}: topic count")
        p = it["prompt"]
        check(p.startswith(f"## {it['title']}\n> {it['topic']} · {DIFF[it['difficulty']]}\n\n"), f"{qid}: prompt header")
        check("### Constraints\n- " in p, f"{qid}: constraints section")
        check("Example" not in p and "Input:" not in p, f"{qid}: examples leaked into prompt")
        sd = it["sample_data"]
        blocks = re.split(r"\n\n(?=\*\*Example \d+\*\*)", sd)
        exs = [b for b in blocks if b.startswith("**Example")]
        check(2 <= len(exs) <= 3, f"{qid}: example count {len(exs)}")
        for b in exs:
            check("\nInput: " in b, f"{qid}: example missing Input")
            if is_dbg:
                check("\nExpected output: " in b and "\nActual output: " in b, f"{qid}: debug example rows")
            else:
                check("\nOutput: " in b, f"{qid}: example missing Output")
        if is_dbg:
            check(sd.startswith("**Buggy pseudocode**\n```\n"), f"{qid}: pseudocode header")
            code = re.search(r"```\n(.*?)\n```", sd, re.S).group(1)
            for bad in [r"\bdef\b", r"\brange\(", r"\blen\(", r"==", r"\+=", r"\[::", r"\belif\b",
                        r"\bTrue\b", r"\bFalse\b", r"\bNone\b", r"\bprint\(", r"float\(", r"\.upper\(",
                        r"\binput\("]:
                check(not re.search(bad, code), f"{qid}: Python syntax {bad} in pseudocode")
        eo = it["expected_output"].split("\n")
        n_ex = sum(1 for ln in eo if re.match(r"Example \d+ → ", ln))
        n_hid = sum(1 for ln in eo if re.match(r"Hidden test \d+ → .+ = .+  \(.+\)$", ln))
        check(n_ex == len(exs), f"{qid}: expected_output example lines {n_ex} vs {len(exs)}")
        check(n_hid == 2, f"{qid}: hidden test lines {n_hid}")
        rb = it["rubric"].split("\n")
        check(3 <= len(rb) <= 5 and all(r.startswith("- ") for r in rb), f"{qid}: rubric shape")
        cp = it["checkpoints"].split("\n")
        check(4 <= len(cp) <= 6 and not any(c.startswith(("-", "*")) for c in cp), f"{qid}: checkpoints shape")
        check(it["source"].startswith("docx: "), f"{qid}: source")
        hint_sents = [s for s in re.split(r"(?<=[.?!])\s+", it["hint"].strip()) if s]
        check(1 <= len(hint_sents) <= 2, f"{qid}: hint sentence count {len(hint_sents)}")
        for field in ("prompt", "sample_data", "hint"):
            for pat in banned:
                check(not re.search(pat, it[field]), f"{qid}: banned {pat} in {field}")
        for k in KEYS:
            check(it[k] not in ("", None), f"{qid}: empty {k}")


def main():
    with open(REF, encoding="utf-8") as fh:
        existing = json.load(fh)
    check(len(existing) == 24, "reference bank should hold 24 questions")
    items = [build_dsa(q) for q in DSA] + [build_dbg(q) for q in DBG]
    validate(items, existing)
    if FAILS:
        print(f"FAILED: {len(FAILS)} of {CHECKS[0]} checks")
        for f in FAILS:
            print("  -", f)
        sys.exit(1)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(items, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    n_dsa = sum(1 for i in items if i["category"] == "dsa")
    print(f"PASS: {len(items)} questions ({n_dsa} dsa, {len(items) - n_dsa} scenario), "
          f"{CHECKS[0]} checks passed -> {os.path.relpath(OUT, os.getcwd())}")


if __name__ == "__main__":
    main()
