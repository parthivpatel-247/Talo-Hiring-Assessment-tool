#!/usr/bin/env python3
"""Build and verify 25 new coding questions (qb-cod-n01 .. qb-cod-n25).

Every reference solution is executed against every example and hidden test; the
displayed outputs are hard-coded literals and must match the computed results
exactly. part_coding.json is written only if every assertion passes.
"""
import copy
import datetime
import json
import os
import re
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "part_coding.json")
SOURCE = "bank v3 (Oct 2026)"
KEYS = ["id", "category", "difficulty", "marks", "title", "topic", "prompt", "sample_data",
        "expected_output", "reference_answer", "hint", "rubric", "checkpoints", "source"]


def fmt(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(json.dumps(k, ensure_ascii=False) + ": " + fmt(x) for k, x in v.items()) + "}"
    raise TypeError(type(v))


QUESTIONS = []


def Q(**kw):
    QUESTIONS.append(kw)


def src(s):
    return textwrap.dedent(s).strip("\n")


# ---------------------------------------------------------------------------
# EASY (8)
# ---------------------------------------------------------------------------
Q(n=1, difficulty="easy", title="Mask an Email Address", topic="Strings · Data Privacy",
  fn="maskEmail", py="mask_email", params=["email"],
  body="""Before customer data is copied into an analytics warehouse, email addresses must be partly hidden. Implement `maskEmail(email)` that returns the masked address.

An email has a **local part** (before `@`) and a **domain** (after `@`). Mask it like this:
- If the local part has 3 or more characters, keep its first and last character and replace every character in between with `*` (one `*` per hidden character).
- If the local part has exactly 2 characters, keep the first and replace the second with `*`.
- If the local part has 1 character, keep it unchanged.
- Convert the domain to lowercase. The local part keeps its original case.

### Constraints
- `email` contains exactly one `@`, with at least one character on each side.
- 3 ≤ length(email) ≤ 254""",
  examples=[
      (("rahul.sharma@Gmail.com",), "r**********a@gmail.com",
       "The local part \"rahul.sharma\" has 12 characters: \"r\" and \"a\" are kept and the 10 in between become `*`. The domain is lowercased."),
      (("ab@hevodata.com",), "a*@hevodata.com",
       "A 2-character local part keeps only its first character."),
  ],
  hidden=[
      (("x@y.in",), "x@y.in", "a 1-character local part is left unchanged"),
      (("Priya.K@Example.CO.IN",), "P*****K@example.co.in", "local-part case is kept; only the domain is lowercased"),
  ],
  approach="Split at `@`, build the masked local part from its length (first char + `*` × (len − 2) + last char, with the 1- and 2-character special cases), and lowercase the domain. O(n) time.",
  ref=src('''
      def mask_email(email):
          local, domain = email.split("@")
          if len(local) >= 3:
              masked = local[0] + "*" * (len(local) - 2) + local[-1]
          elif len(local) == 2:
              masked = local[0] + "*"
          else:
              masked = local
          return masked + "@" + domain.lower()
  '''),
  alt="A regex replacement or a character loop is equally fine.",
  hint="Treat the part before `@` and the part after it separately. How many `*` characters does a local part of length L need?",
  rubric="""- Splits the address into local part and domain at `@`.
- Keeps the first and last character and replaces exactly (length − 2) middle characters with `*`.
- Handles 1- and 2-character local parts as specified.
- Lowercases the domain only; partial credit if masking is right but the domain or short-local cases are wrong.""",
  checkpoints="""Splits on the single @ into local part and domain
Masks the middle with one * per hidden character
Handles a 2-character local part (first char + *)
Leaves a 1-character local part unchanged
Lowercases the domain but not the local part""")

Q(n=2, difficulty="easy", title="Slugify a Report Title", topic="Strings · Normalisation",
  fn="slugify", py="slugify", params=["title"],
  body="""Dashboards are saved under URL-friendly names called **slugs**. Implement `slugify(title)` that turns a report title into a slug:
- Convert all letters to lowercase.
- Keep letters `a`–`z` and digits `0`–`9`.
- Every run of one or more other characters (spaces, punctuation, underscores, ...) becomes a single `-`.
- The slug must not start or end with `-`.
- If nothing is left, return `"untitled"`.

### Constraints
- 0 ≤ length(title) ≤ 200
- `title` contains only printable ASCII characters.""",
  examples=[
      (("Hello, World! 2026 Edition",), "hello-world-2026-edition",
       "\", \", \"! \" and the single spaces each collapse into one `-`."),
      (("  --Q3 Sales: North & South--  ",), "q3-sales-north-south",
       "Leading and trailing spaces and dashes are removed; \" & \" becomes a single `-`."),
  ],
  hidden=[
      (("!!!",), "untitled", "no letters or digits remain"),
      (("Data   Pipelines_101",), "data-pipelines-101", "an underscore is not a letter or digit, and repeated spaces collapse to one dash"),
  ],
  approach="Scan the lowercased title once, appending letters/digits and emitting a single `-` only when a separator run ends and both sides have content; or replace runs with a regex and strip dashes. O(n) time.",
  ref=src('''
      def slugify(title):
          parts, current = [], ""
          for ch in title.lower():
              if ch.isascii() and ch.isalnum():
                  current += ch
              elif current:
                  parts.append(current)
                  current = ""
          if current:
              parts.append(current)
          return "-".join(parts) if parts else "untitled"
  '''),
  alt="A regex such as `re.sub(r\"[^a-z0-9]+\", \"-\", title.lower()).strip(\"-\")` is an accepted alternative.",
  hint="Think of the title as words of letters and digits separated by junk. If you collect the words, how should you join them?",
  rubric="""- Lowercases and keeps only a–z and 0–9.
- Collapses each run of other characters into exactly one `-`.
- Produces no leading or trailing `-`.
- Returns `"untitled"` when nothing is left; partial credit if only the empty case or the dash trimming is missed.""",
  checkpoints="""Lowercases the input
Keeps only letters and digits as content
Collapses consecutive separators into a single dash
Trims leading and trailing dashes
Returns "untitled" for an empty result""")

Q(n=3, difficulty="easy", title="Parse a URL Query String", topic="Strings · Parsing · Hash Map",
  fn="parseQuery", py="parse_query", params=["url"],
  body="""An event collector receives page URLs and needs their query parameters as a map/dictionary. Implement `parseQuery(url)`:
- The query string is the text after the **first** `?` and before the first `#` (or the end of the URL). If there is no `?`, return an empty map.
- Parameters are separated by `&`. Skip empty pieces (for example from `&&`).
- Each piece is split at its **first** `=` into key and value. A piece with no `=` has the value `""`.
- If a key repeats, the **last** value wins.

No percent-decoding is needed. Keys may be returned in any order.

### Constraints
- 1 ≤ length(url) ≤ 2000
- Keys are non-empty.""",
  examples=[
      (("https://shop.example.com/search?q=shoes&size=9&sort=price",), {"q": "shoes", "size": "9", "sort": "price"},
       "Three `key=value` pairs separated by `&`. All values are returned as strings."),
      (("/api/orders?status=paid&debug&page=2&status=shipped#top",), {"status": "shipped", "debug": "", "page": "2"},
       "`debug` has no `=`, so its value is `\"\"`. `status` appears twice and the last value wins. `#top` is not part of the query."),
  ],
  hidden=[
      (("https://hevo.io/docs",), {}, "no `?` means no parameters"),
      (("/r?redirect=/a?b=c&&x=",), {"redirect": "/a?b=c", "x": ""}, "only the first `?` and first `=` split; `&&` gives an empty piece to skip; `x=` has an empty value"),
  ],
  note="  (any key order)",
  approach="Cut the URL at the first `?` and then at `#`, split the rest on `&`, skip empty pieces, and split each piece at its first `=` into the map (later keys overwrite earlier ones). O(n) time.",
  ref=src('''
      def parse_query(url):
          result = {}
          if "?" not in url:
              return result
          query = url.split("?", 1)[1].split("#", 1)[0]
          for piece in query.split("&"):
              if not piece:
                  continue
              if "=" in piece:
                  key, value = piece.split("=", 1)
              else:
                  key, value = piece, ""
              result[key] = value
          return result
  '''),
  alt="Manual index scanning instead of split is fine.",
  hint="Do the work in stages: isolate the query part first, then the pieces, then each key and value. Which split should only happen once?",
  rubric="""- Takes the text after the first `?` and stops at `#`.
- Splits on `&`, skipping empty pieces.
- Splits each piece at its first `=` only; a bare key gets `""`.
- Repeated keys keep the last value; returns an empty map when there is no `?`. Partial credit if one of the edge rules is missed.""",
  checkpoints="""Returns an empty map when the URL has no ?
Strips the #fragment before parsing
Skips empty pieces between & separators
Splits key and value at the first = only
Bare key without = gets an empty string value
Later duplicate keys overwrite earlier ones""")

Q(n=4, difficulty="easy", title="Invert Table Ownership", topic="Hash Map · Grouping",
  fn="tablesByOwner", py="tables_by_owner", params=["owners"],
  body="""A data catalog stores, for each warehouse table, the email of the engineer who owns it. Some tables have no owner yet (`null`).

Implement `tablesByOwner(owners)`, where `owners` maps a table name to an owner email or `null`. Return a map from each owner to an array of the tables they own, **sorted alphabetically**. Tables with a `null` owner go under the key `"unassigned"`. Owners with no tables do not appear. Keys of the result may be in any order.

### Constraints
- 0 ≤ number of tables ≤ 10^4
- Table names are unique, non-empty and lowercase.""",
  examples=[
      (({"orders": "asha@x.com", "payments": "ravi@x.com", "customers": "asha@x.com", "refunds": "ravi@x.com"},),
       {"asha@x.com": ["customers", "orders"], "ravi@x.com": ["payments", "refunds"]},
       "Each owner's tables are collected and sorted alphabetically."),
      (({"events": None, "sessions": "meera@x.com", "clicks": None},),
       {"meera@x.com": ["sessions"], "unassigned": ["clicks", "events"]},
       "`events` and `clicks` have no owner, so they are grouped under `\"unassigned\"`."),
  ],
  hidden=[
      (({},), {}, "an empty catalog gives an empty map"),
      (({"zeta": "neha@x.com", "alpha": "neha@x.com", "mid": "neha@x.com"},), {"neha@x.com": ["alpha", "mid", "zeta"]}, "the input order is not sorted; the arrays must be"),
  ],
  note="  (any key order)",
  approach="One pass over the entries appends each table to an array keyed by its owner (or `\"unassigned\"`), then each array is sorted. O(n log n) time for the sorts, O(n) space.",
  ref=src('''
      def tables_by_owner(owners):
          groups = {}
          for table, owner in owners.items():
              key = owner if owner is not None else "unassigned"
              groups.setdefault(key, []).append(table)
          return {owner: sorted(tables) for owner, tables in sorted(groups.items())}
  '''),
  alt="Sorting the table names first and then grouping (so arrays come out sorted) is also fine.",
  hint="Walk the map once and build a new map whose values are growing arrays. What do you do the first time you see an owner, and what about a missing owner?",
  rubric="""- Groups every table under its owner in a new map.
- Places `null`-owner tables under `"unassigned"`.
- Sorts each owner's array alphabetically.
- Handles an empty input; partial credit if grouping is right but sorting or the null case is missing.""",
  checkpoints="""Iterates over every table/owner pair once
Creates a new array the first time an owner is seen
Maps a null owner to "unassigned"
Sorts each owner's tables alphabetically
Returns an empty map for an empty catalog""")

Q(n=5, difficulty="easy", title="Pack Records Into Upload Batches", topic="Arrays · Batching · Greedy",
  fn="makeBatches", py="make_batches", params=["sizes", "maxRecords", "maxKb"],
  body="""A loader uploads records to a warehouse API in batches. `sizes[i]` is the size of record `i` in KB. Records must stay **in their original order**. Fill batches greedily:
- Add the next record to the current batch if the batch would then have at most `maxRecords` records **and** a total size of at most `maxKb`.
- Otherwise close the current batch and start a new one with that record.
- A record larger than `maxKb` on its own is still sent, in a batch by itself.

Implement `makeBatches(sizes, maxRecords, maxKb)` and return the batches as an array of arrays of sizes.

### Constraints
- 0 ≤ length(sizes) ≤ 10^5
- 1 ≤ sizes[i] ≤ 10^6
- 1 ≤ maxRecords ≤ 1000, 1 ≤ maxKb ≤ 10^6""",
  examples=[
      (([100, 200, 300, 50, 50, 40, 400], 3, 500), [[100, 200], [300, 50, 50], [40, 400]],
       "Adding 300 to [100, 200] would make 600 KB, so a new batch starts. [300, 50, 50] is only 400 KB but already has 3 records, so 40 starts a new batch."),
      (([700, 100, 100], 5, 500), [[700], [100, 100]],
       "700 KB is larger than the 500 KB limit, so it goes alone in its own batch."),
  ],
  hidden=[
      (([], 3, 500), [], "no records means no batches"),
      (([200, 900, 200], 10, 500), [[200], [900], [200]], "an oversized record in the middle must be isolated on both sides"),
  ],
  approach="Keep a current batch and its running total; before adding a record, close the batch if it is full by count or would exceed the size limit. An oversized record ends up alone because nothing fits after it. O(n) time.",
  ref=src('''
      def make_batches(sizes, max_records, max_kb):
          batches, current, total = [], [], 0
          for size in sizes:
              if current and (len(current) == max_records or total + size > max_kb):
                  batches.append(current)
                  current, total = [], 0
              current.append(size)
              total += size
          if current:
              batches.append(current)
          return batches
  '''),
  alt="",
  hint="Keep the current batch and its running total. Before adding a record, ask whether it would break either limit, and do not forget the last batch.",
  rubric="""- Keeps the original record order.
- Closes a batch when the record count limit or the KB limit would be exceeded.
- Sends an oversized record in a batch by itself without crashing or looping.
- Emits the final partial batch and returns `[]` for no records; partial credit if only one of the two limits is enforced.""",
  checkpoints="""Tracks the current batch and its running size
Checks the record-count limit before adding
Checks the KB limit before adding
Isolates a record larger than maxKb
Flushes the final batch after the loop""")

Q(n=6, difficulty="easy", title="Compare Version Strings", topic="Strings · Parsing · Comparison",
  fn="compareVersions", py="compare_versions", params=["a", "b"],
  body="""A connector registry must decide which of two plugin versions is newer. A version is a sequence of non-negative integers separated by dots, such as `"1.2.10"`.

Implement `compareVersions(a, b)` that returns `1` if `a` is newer, `-1` if `b` is newer and `0` if they are equal. Compare part by part from the left **as numbers** (so `10 > 9`, and `"01"` equals `"1"`). If one version has fewer parts, the missing parts count as `0`.

### Constraints
- 1 ≤ length(a), length(b) ≤ 100
- Each part has 1 to 9 digits.""",
  examples=[
      (("1.2.10", "1.2.9"), 1, "The first two parts are equal; 10 > 9 as numbers (a text comparison would get this wrong)."),
      (("2.0", "2.0.0"), 0, "The missing third part of `\"2.0\"` counts as 0."),
  ],
  hidden=[
      (("0.9.9", "1.0"), -1, "the first part decides even though the other parts are larger"),
      (("1.01", "1.001"), 0, "leading zeros do not change the numeric value"),
  ],
  approach="Split both strings on `.`, convert parts to integers, and compare index by index up to the longer length, treating a missing part as 0. O(n) time.",
  ref=src('''
      def compare_versions(a, b):
          pa = [int(x) for x in a.split(".")]
          pb = [int(x) for x in b.split(".")]
          for i in range(max(len(pa), len(pb))):
              x = pa[i] if i < len(pa) else 0
              y = pb[i] if i < len(pb) else 0
              if x != y:
                  return 1 if x > y else -1
          return 0
  '''),
  alt="Padding the shorter array with zeros first is equivalent.",
  hint="Comparing the whole strings as text fails for \"10\" vs \"9\". What should each dot-separated part become before you compare it?",
  rubric="""- Splits on `.` and compares parts numerically, not as text.
- Treats missing parts as 0.
- Returns as soon as a part differs, with the correct sign.
- Handles leading zeros; partial credit for a text comparison that only fails the multi-digit cases.""",
  checkpoints="""Splits each version on dots
Converts parts to integers before comparing
Pads the shorter version with zeros
Returns 1 / -1 at the first differing part
Returns 0 when all parts are equal""")

Q(n=7, difficulty="easy", title="Retry Backoff Schedule", topic="Arrays · Math · Retries",
  fn="backoffSchedule", py="backoff_schedule", params=["baseMs", "factor", "maxMs", "retries"],
  body="""When an API call fails, a pipeline retries it after waiting longer and longer. The wait before retry number `i` (counting from 0) is `baseMs × factor^i` milliseconds, but never more than `maxMs`.

Implement `backoffSchedule(baseMs, factor, maxMs, retries)` that returns an array of the `retries` waits, in order.

### Constraints
- 1 ≤ baseMs, maxMs ≤ 10^9
- 2 ≤ factor ≤ 10
- 0 ≤ retries ≤ 100
- The cap can be very small compared with `factor^retries`; your solution must not overflow fixed-size integers.""",
  examples=[
      ((500, 2, 5000, 6), [500, 1000, 2000, 4000, 5000, 5000],
       "500 doubles to 1000, 2000, 4000; the next would be 8000, which is capped at 5000, and it stays capped."),
      ((1000, 3, 60000, 4), [1000, 3000, 9000, 27000],
       "Multiplying by 3 each time never reaches the 60000 cap within 4 retries."),
  ],
  hidden=[
      ((500, 2, 5000, 0), [], "zero retries means an empty schedule"),
      ((200, 2, 150, 3), [150, 150, 150], "the cap applies even to the very first wait"),
  ],
  approach="Keep a running delay starting at baseMs; append min(delay, maxMs) and multiply only while the delay is still below the cap, which also prevents overflow for 100 retries. O(retries) time.",
  ref=src('''
      def backoff_schedule(base_ms, factor, max_ms, retries):
          waits, delay = [], base_ms
          for _ in range(retries):
              waits.append(min(delay, max_ms))
              if delay < max_ms:
                  delay *= factor
          return waits
  '''),
  alt="Computing base × factor^i directly is accepted only if the answer addresses overflow (e.g. stops growing once capped).",
  hint="Each wait is the previous one multiplied by the factor. Once you hit the cap, do you still need to keep multiplying?",
  rubric="""- Produces exactly `retries` values, starting at baseMs (or the cap if smaller).
- Multiplies by `factor` each step and caps every value at maxMs.
- Avoids overflow by not growing the delay once it reaches the cap.
- Returns an empty array for 0 retries; partial credit if the values are right but overflow is ignored.""",
  checkpoints="""Starts from baseMs for retry 0
Multiplies by factor between retries
Caps every wait at maxMs (including the first)
Stops growing the delay once capped (no overflow)
Returns exactly retries values""")

Q(n=8, difficulty="easy", title="Parse a Structured Log Line", topic="Strings · Parsing · Validation",
  fn="parseLogLine", py="parse_log_line", params=["line"],
  body="""Application logs reach the pipeline as text lines in the format:

`<timestamp> <LEVEL> [<service>] <message>`

Implement `parseLogLine(line)` that returns a map with the keys `"timestamp"`, `"level"`, `"service"` and `"message"`, or `null` if the line is malformed. A line is valid when:
- the timestamp and the level are separated by single spaces from what follows,
- the level is exactly one of `DEBUG`, `INFO`, `WARN`, `ERROR`,
- the service is a non-empty name inside `[` and `]`, followed by one space,
- the message (everything after that space, kept exactly) is non-empty.

The timestamp does not need to be validated beyond being non-empty. The message itself may contain spaces and brackets.

### Constraints
- 0 ≤ length(line) ≤ 10^4
- Timestamps and service names contain no spaces.""",
  examples=[
      (("2026-10-01T10:15:30Z ERROR [payment-service] Card declined: code=51",),
       {"timestamp": "2026-10-01T10:15:30Z", "level": "ERROR", "service": "payment-service", "message": "Card declined: code=51"},
       "All four parts are present and the level is allowed."),
      (("2026-10-01T10:15:31Z NOTICE [auth] User logged in",), None,
       "`NOTICE` is not one of the four allowed levels."),
  ],
  hidden=[
      (("2026-10-01T10:16:00Z WARN [loader] Retrying [attempt 2] in 5s",),
       {"timestamp": "2026-10-01T10:16:00Z", "level": "WARN", "service": "loader", "message": "Retrying [attempt 2] in 5s"},
       "brackets inside the message must not confuse the service parsing"),
      (("2026-10-01T10:16:00Z INFO loader Started",), None, "the service is not wrapped in brackets"),
  ],
  approach="Split off the first two space-separated tokens (timestamp and level), check the level against the allowed set, then require the remainder to start with `[` and find the first `] ` to cut out the service and message. O(n) time.",
  ref=src('''
      LEVELS = {"DEBUG", "INFO", "WARN", "ERROR"}

      def parse_log_line(line):
          parts = line.split(" ", 2)
          if len(parts) < 3:
              return None
          timestamp, level, rest = parts
          if not timestamp or level not in LEVELS or not rest.startswith("["):
              return None
          end = rest.find("] ")
          if end <= 1:
              return None
          service, message = rest[1:end], rest[end + 2:]
          if not message:
              return None
          return {"timestamp": timestamp, "level": level, "service": service, "message": message}
  '''),
  alt="A regex such as `^(\\S+) (DEBUG|INFO|WARN|ERROR) \\[([^\\]]+)\\] (.+)$` is an accepted alternative.",
  hint="Peel the line apart from the left: first two tokens, then the bracketed service. Which bracket marks the end of the service when the message can contain brackets too?",
  rubric="""- Extracts timestamp, level, service and message correctly for a valid line.
- Rejects lines whose level is not one of the four allowed values.
- Requires the service to be inside brackets and uses the FIRST `] ` so brackets in the message are kept.
- Returns `null` (not a crash) for malformed or short lines; partial credit if valid lines parse but some malformed ones slip through.""",
  checkpoints="""Splits off timestamp and level as the first two tokens
Validates the level against DEBUG/INFO/WARN/ERROR
Requires [service] and ends it at the first "] "
Keeps the rest of the line as the message, brackets included
Returns null for malformed input instead of failing""")

# ---------------------------------------------------------------------------
# MEDIUM (12)
# ---------------------------------------------------------------------------
Q(n=9, difficulty="medium", title="Split a CSV Line With Quoted Fields", topic="Strings · Parsing · State Machine",
  fn="splitCsvLine", py="split_csv_line", params=["line"], raw_input=True,
  body="""A file loader reads CSV exports from customers. Splitting on every comma breaks when a field itself contains a comma, so implement `splitCsvLine(line)` that returns the array of field values for one line:
- Fields are separated by commas.
- A field may be wrapped in double quotes. Inside a quoted field, commas are ordinary characters and two double quotes in a row (`""`) stand for one literal `"`.
- The wrapping quotes are not part of the value.
- Unquoted fields are returned exactly as written (no trimming).
- A trailing comma means the last field is empty; an empty line has one empty field.

You may assume the line is well formed (quotes are balanced and a quoted field is followed by a comma or the end of the line). In the examples, `\\"` inside an output string stands for one literal double-quote character.

### Constraints
- 0 ≤ length(line) ≤ 10^5
- Target O(n) time; do not use a CSV library.""",
  examples=[
      (('101,"Sharma, Rahul",Mumbai,4500',), ["101", "Sharma, Rahul", "Mumbai", "4500"],
       "The comma inside the quoted name does not split it. The quotes are removed."),
      (('7,"He said ""hi""",,"",end',), ["7", "He said \"hi\"", "", "", "end"],
       "`\"\"` inside a quoted field becomes one quote. `,,` gives an empty field and `\"\"` on its own is an empty quoted field."),
  ],
  hidden=[
      (('a,b,',), ["a", "b", ""], "a trailing comma creates a final empty field"),
      (('""""',), ["\""], "a quoted field whose whole value is one escaped quote"),
  ],
  approach="Scan character by character with an `inQuotes` flag: outside quotes a comma ends the field and a quote enters quoted mode; inside quotes a doubled quote appends one quote and a single quote leaves quoted mode. Append the last field after the loop. O(n) time.",
  ref=src('''
      def split_csv_line(line):
          fields, current, in_quotes, i = [], [], False, 0
          while i < len(line):
              ch = line[i]
              if in_quotes:
                  if ch == '"':
                      if i + 1 < len(line) and line[i + 1] == '"':
                          current.append('"')
                          i += 1
                      else:
                          in_quotes = False
                  else:
                      current.append(ch)
              elif ch == '"':
                  in_quotes = True
              elif ch == ",":
                  fields.append("".join(current))
                  current = []
              else:
                  current.append(ch)
              i += 1
          fields.append("".join(current))
          return fields
  '''),
  alt="Any equivalent state machine is fine; a solution that splits on commas and then re-joins quoted pieces earns partial credit if it mishandles `\"\"`.",
  hint="A single left-to-right scan works if you remember one thing: are you currently inside quotes? Look one character ahead when you see a quote inside a quoted field.",
  rubric="""- Splits on commas only when outside quotes.
- Removes wrapping quotes and turns `""` inside a quoted field into one `"`.
- Produces empty fields for `,,`, `""` and a trailing comma.
- Single pass O(n) without a CSV library; partial credit if quoted commas work but escaped quotes or empty fields do not.""",
  checkpoints="""Tracks whether the scan is inside a quoted field
Treats commas inside quotes as literal characters
Converts a doubled quote "" into one literal quote
Ends a field at an unquoted comma and keeps empty fields
Adds the last field after the loop (trailing comma case)
O(n) single pass""")

Q(n=10, difficulty="medium", title="Flatten a Nested Record", topic="Recursion · Hash Map · JSON",
  fn="flattenRecord", py="flatten_record", params=["record"],
  body="""Warehouse tables are flat, but API responses are nested. Implement `flattenRecord(record)` that turns a nested JSON-like value into a single-level map:
- Keys of nested maps are joined with `.`, e.g. `customer.address.city`.
- Array elements use their index as the key segment, e.g. `items.0.sku`.
- Scalar values (numbers, strings, booleans, `null`) are kept as they are.
- An **empty** map `{}` or empty array `[]` is kept as the value at its own path (so the column is not lost).

`record` itself is always a map. Keys of the result may be in any order.

### Constraints
- Nesting depth ≤ 50; total number of scalar values ≤ 10^5.
- Original keys never contain `.`.""",
  examples=[
      (({"id": 7, "customer": {"name": "Asha", "address": {"city": "Pune", "pin": "411001"}}, "paid": True},),
       {"id": 7, "customer.name": "Asha", "customer.address.city": "Pune", "customer.address.pin": "411001", "paid": True},
       "Nested map keys are joined with dots at every level."),
      (({"order": 12, "items": [{"sku": "A1", "qty": 2}, {"sku": "B7", "qty": 1}], "tags": []},),
       {"order": 12, "items.0.sku": "A1", "items.0.qty": 2, "items.1.sku": "B7", "items.1.qty": 1, "tags": []},
       "Array positions become `0` and `1` in the key. The empty array `tags` is kept as `[]`."),
  ],
  hidden=[
      (({"a": {"b": None, "c": {}}},), {"a.b": None, "a.c": {}}, "null is a scalar to keep; an empty map is kept at its path"),
      (({"matrix": [[1, 2], [3]]},), {"matrix.0.0": 1, "matrix.0.1": 2, "matrix.1.0": 3}, "arrays nested inside arrays"),
  ],
  note="  (any key order)",
  approach="Depth-first recursion carrying the path prefix: for a non-empty map or array recurse into each child with `prefix.key` / `prefix.index`; otherwise write the value at the prefix. O(total size) time. An explicit stack instead of recursion is equally good.",
  ref=src('''
      def flatten_record(record):
          out = {}

          def walk(value, path):
              if isinstance(value, dict) and value:
                  for key, child in value.items():
                      walk(child, path + "." + key if path else key)
              elif isinstance(value, list) and value:
                  for i, child in enumerate(value):
                      walk(child, path + "." + str(i))
              else:
                  out[path] = value

          for key, value in record.items():
              walk(value, key)
          return out
  '''),
  alt="",
  hint="Write a helper that receives a value and the path that leads to it. When is a value a leaf, and when do you go one level deeper?",
  rubric="""- Recursively (or with a stack) visits every nested map and array.
- Builds dotted paths correctly, using indexes for arrays.
- Keeps scalars, including `null`, unchanged.
- Keeps empty maps/arrays as values at their path; partial credit if arrays or empty containers are mishandled.""",
  checkpoints="""Uses recursion or an explicit stack with the current path
Joins map keys with dots
Uses the array index as the path segment
Stores scalars (including null) at their full path
Keeps empty {} and [] as values instead of dropping them""")

Q(n=11, difficulty="medium", title="Deep Merge Pipeline Configs", topic="Recursion · Hash Map · Configuration",
  fn="deepMerge", py="deep_merge", params=["base", "override"],
  body="""Each pipeline has a default config and an optional per-customer override. Implement `deepMerge(base, override)` that returns the effective config as a **new** map (do not modify the inputs):
- Every key from `base` is kept unless the override changes it.
- If a key exists in both and **both** values are maps, merge them recursively with the same rules.
- Otherwise the override's value replaces the base value (arrays are replaced wholesale, not concatenated).
- If the override's value is `null`, the key is **removed** from the result.

Keys of the result may be in any order.

### Constraints
- Nesting depth ≤ 20; each map has at most 1000 keys.
- `base` and `override` are both maps.""",
  examples=[
      (({"source": {"host": "db.internal", "port": 5432, "ssl": False}, "batchSize": 500}, {"source": {"port": 6432, "ssl": True}, "retries": 3}),
       {"source": {"host": "db.internal", "port": 6432, "ssl": True}, "batchSize": 500, "retries": 3},
       "`source` is a map on both sides, so it is merged: `host` is kept and `port`/`ssl` are replaced. `retries` is new."),
      (({"tables": ["orders", "users"], "schedule": {"every": "1h"}}, {"tables": ["payments"], "schedule": None}),
       {"tables": ["payments"]},
       "The array is replaced, not combined. `schedule: null` deletes the key."),
  ],
  hidden=[
      (({"a": {"b": 1}}, {"a": 5}), {"a": 5}, "a map replaced by a scalar is not merged"),
      (({"sink": {"auth": {"user": "etl", "password": "x"}, "region": "ap-south-1"}}, {"sink": {"auth": {"password": None}}}),
       {"sink": {"auth": {"user": "etl"}, "region": "ap-south-1"}}, "null deletes a key two levels deep while siblings survive"),
  ],
  note="  (any key order)",
  approach="Copy base, then for each override key: delete on null, recurse when both sides are maps, otherwise deep-copy the override value in. O(total keys) time; copying keeps the inputs unchanged.",
  ref=src('''
      import copy

      def deep_merge(base, override):
          result = copy.deepcopy(base)
          for key, value in override.items():
              if value is None:
                  result.pop(key, None)
              elif isinstance(value, dict) and isinstance(result.get(key), dict):
                  result[key] = deep_merge(result[key], value)
              else:
                  result[key] = copy.deepcopy(value)
          return result
  '''),
  alt="",
  hint="Start from a copy of the base and walk the override's keys. There are only three cases per key: null, map-on-both-sides, and everything else.",
  rubric="""- Recursively merges keys where both values are maps.
- Replaces scalars and arrays with the override value.
- Removes keys whose override value is `null`, at any depth.
- Does not mutate `base` or `override`; partial credit for a correct one-level merge or for mutating the inputs.""",
  checkpoints="""Keeps base keys that the override does not mention
Recurses only when both values are maps
Replaces arrays and scalars wholesale
Deletes a key when the override value is null
Returns a new structure without mutating the inputs""")

Q(n=12, difficulty="medium", title="Keep the Latest Version of Each Event", topic="Hash Map · Deduplication",
  fn="latestEvents", py="latest_events", params=["events"],
  body="""A change feed can deliver the same order several times, and older versions can arrive **after** newer ones. Each event is a map with `id`, `status` and `updated_at`, where `updated_at` is an ISO-8601 UTC timestamp in the fixed format `YYYY-MM-DDTHH:MM:SSZ`.

Implement `latestEvents(events)` that keeps exactly one event per `id`: the one with the latest `updated_at`. If two events for the same `id` have the same `updated_at`, keep the one that appears **later** in the input. Return the kept events in the order in which each `id` **first appeared** in the input.

### Constraints
- 0 ≤ length(events) ≤ 10^5
- All timestamps use exactly the format above.""",
  examples=[
      (([{"id": "o1", "status": "created", "updated_at": "2026-10-01T10:00:00Z"},
         {"id": "o2", "status": "created", "updated_at": "2026-10-01T10:05:00Z"},
         {"id": "o1", "status": "paid", "updated_at": "2026-10-01T10:20:00Z"},
         {"id": "o1", "status": "created", "updated_at": "2026-10-01T10:01:00Z"}],),
       [{"id": "o1", "status": "paid", "updated_at": "2026-10-01T10:20:00Z"},
        {"id": "o2", "status": "created", "updated_at": "2026-10-01T10:05:00Z"}],
       "The last `o1` event arrived late with an older timestamp, so the 10:20 `paid` version is kept. `o1` appeared before `o2`, so it comes first."),
      (([{"id": "u9", "status": "active", "updated_at": "2026-10-02T08:00:00Z"},
         {"id": "u9", "status": "blocked", "updated_at": "2026-10-02T08:00:00Z"}],),
       [{"id": "u9", "status": "blocked", "updated_at": "2026-10-02T08:00:00Z"}],
       "Same timestamp, so the event that appears later wins."),
  ],
  hidden=[
      (([],), [], "no events"),
      (([{"id": "b", "status": "x", "updated_at": "2026-01-01T00:00:00Z"},
         {"id": "a", "status": "y", "updated_at": "2026-01-01T00:00:00Z"},
         {"id": "b", "status": "z", "updated_at": "2026-01-02T00:00:00Z"}],),
       [{"id": "b", "status": "z", "updated_at": "2026-01-02T00:00:00Z"},
        {"id": "a", "status": "y", "updated_at": "2026-01-01T00:00:00Z"}],
       "output follows first appearance (b before a), not id order or the order of the winning events"),
  ],
  approach="One pass with a map id → best event and a separate array of ids in first-seen order; replace the stored event when the new `updated_at` is greater than or equal to it (fixed-width ISO strings compare correctly as text). O(n) time and space.",
  ref=src('''
      def latest_events(events):
          best, order = {}, []
          for event in events:
              key = event["id"]
              if key not in best:
                  order.append(key)
                  best[key] = event
              elif event["updated_at"] >= best[key]["updated_at"]:
                  best[key] = event
          return [best[key] for key in order]
  '''),
  alt="Parsing timestamps into numbers instead of comparing the fixed-format strings is fine.",
  hint="A map from id to the best event so far handles the deduplication. What extra structure remembers the order in which ids were first seen, and should a tie replace the stored event?",
  rubric="""- Keeps exactly one event per id, chosen by the latest `updated_at`.
- Breaks timestamp ties in favour of the later event (uses >= rather than >).
- Returns events in first-appearance order of their ids.
- O(n) with a hash map; partial credit for an O(n^2) or sort-based solution, or if tie-breaking or ordering is wrong.""",
  checkpoints="""Uses a map keyed by id to hold the best event so far
Compares updated_at correctly (string compare valid for fixed format, or parsed)
Replaces on equal timestamp so the later event wins
Remembers the first-appearance order of ids
Returns one event per id in that order
O(n) time""")

Q(n=13, difficulty="medium", title="Diff Two Table Snapshots", topic="Hash Map · Set Operations · Comparison",
  fn="diffSnapshots", py="diff_snapshots", params=["old", "new"],
  body="""To sync a table incrementally, a pipeline compares yesterday's snapshot with today's. Each snapshot is an array of records (maps); every record has a unique integer `id` within its snapshot, plus any other fields.

Implement `diffSnapshots(old, new)` that returns a map with three arrays of ids, each sorted ascending:
- `"added"`: ids present only in `new`,
- `"removed"`: ids present only in `old`,
- `"changed"`: ids present in both whose records differ in any way (a field added, removed, or with a different value).

The order of records inside a snapshot carries no meaning.

### Constraints
- 0 ≤ length(old), length(new) ≤ 10^5
- Field values are strings, numbers, booleans or `null`.""",
  examples=[
      (([{"id": 1, "name": "Asha", "city": "Pune"}, {"id": 2, "name": "Ravi", "city": "Delhi"}, {"id": 3, "name": "Meera", "city": "Goa"}],
        [{"id": 3, "name": "Meera", "city": "Panaji"}, {"id": 1, "name": "Asha", "city": "Pune"}, {"id": 4, "name": "Kabir", "city": "Agra"}]),
       {"added": [4], "removed": [2], "changed": [3]},
       "4 is new, 2 is gone, and 3 changed city. Record 1 is identical even though it moved position."),
      (([{"id": 5, "email": "a@x.com"}], [{"id": 5, "email": "a@x.com", "phone": None}]),
       {"added": [], "removed": [], "changed": [5]},
       "A new field counts as a change, even when its value is `null`."),
  ],
  hidden=[
      (([], []), {"added": [], "removed": [], "changed": []}, "two empty snapshots"),
      (([], [{"id": 2, "v": 1}, {"id": 1, "v": 1}]), {"added": [1, 2], "removed": [], "changed": []}, "everything is new and the ids must be sorted"),
  ],
  approach="Index both snapshots by id in hash maps, then classify ids by membership and compare the records of shared ids field-by-field (including key sets). O((n + m) log(n + m)) for the final sorts, O(n + m) space.",
  ref=src('''
      def diff_snapshots(old, new):
          old_by_id = {r["id"]: r for r in old}
          new_by_id = {r["id"]: r for r in new}
          added = sorted(k for k in new_by_id if k not in old_by_id)
          removed = sorted(k for k in old_by_id if k not in new_by_id)
          changed = sorted(k for k in old_by_id if k in new_by_id and old_by_id[k] != new_by_id[k])
          return {"added": added, "removed": removed, "changed": changed}
  '''),
  alt="Sorting both snapshots by id and merging with two pointers is an accepted alternative.",
  hint="Looking up a record by id should be fast in both snapshots. Once you can do that, every id falls into exactly one of four buckets.",
  rubric="""- Indexes records by id (hash map or sort + merge) instead of comparing every pair.
- Classifies ids into added / removed / changed correctly.
- Treats a field added or removed (even with `null`) as a change, and ignores record position.
- Returns each array sorted ascending; partial credit for an O(n × m) nested-loop solution.""",
  checkpoints="""Builds an id → record lookup for both snapshots
Finds ids only in new (added) and only in old (removed)
Compares shared records field by field, including the set of fields
Ignores the order of records in the snapshots
Sorts each result array ascending""")

Q(n=14, difficulty="medium", title="Infer a Column Type From Samples", topic="Strings · Validation · Type Inference",
  fn="inferColumnType", py="infer_column_type", params=["values"],
  body="""When a new CSV source is connected, the pipeline guesses each column's type from sample values. Implement `inferColumnType(values)`, where `values` is an array of strings (or `null`). Ignore `null` and empty strings `""`. Every remaining value is checked against these patterns:
- `"boolean"`: `true` or `false` in any letter case.
- `"integer"`: an optional leading `-` followed by one or more digits.
- `"float"`: an optional leading `-`, one or more digits, a `.`, and one or more digits.
- `"date"`: the shape `YYYY-MM-DD` with digits only, a month from `01` to `12` and a day from `01` to `31` (no need to check days per month).

Return the type if **all** remaining values match the same type; return `"float"` if they are a mix of only integers and floats; return `"string"` in every other case; return `"unknown"` if no values remain.

### Constraints
- 0 ≤ length(values) ≤ 10^4
- Each value has at most 100 characters and no surrounding spaces.""",
  examples=[
      ((["12", "-7", "", "305", None],), "integer", "The empty string and `null` are ignored; the rest are integers."),
      ((["3", "4.50", "10"],), "float", "A mix of integers and floats widens to float."),
      ((["2026-10-01", "2026-13-01"],), "string", "`2026-13-01` has month 13, so it is not a date, and the column falls back to string."),
  ],
  hidden=[
      (([None, "", None],), "unknown", "no usable sample values"),
      ((["TRUE", "false", "1"],), "string", "\"1\" is an integer, not a boolean, and boolean + integer is not a valid widening"),
  ],
  approach="Classify each non-empty value with small pattern checks (or regexes), collect the set of types seen, then decide: empty → unknown, one type → it, {integer, float} → float, otherwise string. O(total characters) time.",
  ref=src('''
      import re

      def classify(v):
          if v.lower() in ("true", "false"):
              return "boolean"
          if re.fullmatch(r"-?[0-9]+", v):
              return "integer"
          if re.fullmatch(r"-?[0-9]+\\.[0-9]+", v):
              return "float"
          m = re.fullmatch(r"[0-9]{4}-([0-9]{2})-([0-9]{2})", v)
          if m and 1 <= int(m.group(1)) <= 12 and 1 <= int(m.group(2)) <= 31:
              return "date"
          return "string"

      def infer_column_type(values):
          seen = {classify(v) for v in values if v is not None and v != ""}
          if not seen:
              return "unknown"
          if len(seen) == 1:
              return seen.pop()
          if seen == {"integer", "float"}:
              return "float"
          return "string"
  '''),
  alt="Hand-written character checks instead of regexes are equally fine.",
  hint="First decide the type of each single value, then decide what a set of value types means for the whole column.",
  rubric="""- Ignores `null` and empty strings and returns `"unknown"` when nothing remains.
- Classifies boolean, integer, float and date values exactly as specified (case-insensitive booleans, month/day ranges).
- Widens integer + float to float and falls back to string for any other mix.
- Partial credit if the per-value checks are right but the combination logic is wrong (or vice versa).""",
  checkpoints="""Skips null and empty-string samples
Recognises booleans case-insensitively
Distinguishes integer from float patterns (sign, digits on both sides of the dot)
Validates the date shape and month/day ranges
Combines types: single type, integer+float → float, otherwise string
Returns "unknown" when no samples remain""")

Q(n=15, difficulty="medium", title="Sliding Window Rate Limiter", topic="Queue · Sliding Window · Rate Limiting",
  fn="rateLimit", py="rate_limit", params=["timestamps", "limit", "window"],
  body="""An ingestion API allows each client at most `limit` **accepted** requests in any period of `window` seconds. You receive one client's request times `timestamps` (in seconds, sorted in non-decreasing order).

A request at time `t` is accepted if fewer than `limit` previously **accepted** requests have a time in the interval `(t − window, t]`. Rejected requests do not count against the limit.

Implement `rateLimit(timestamps, limit, window)` that returns an array of booleans: `true` if the request was accepted, `false` if it was rejected.

### Constraints
- 0 ≤ length(timestamps) ≤ 10^5
- 0 ≤ timestamps[i] ≤ 10^9
- 1 ≤ limit ≤ 10^4, 1 ≤ window ≤ 10^6
- Target O(n) time.""",
  examples=[
      (([1, 2, 3, 4, 11, 12], 3, 10), [True, True, True, False, True, True],
       "At t = 4 the window (−6, 4] already holds 3 accepted requests. At t = 11 the window (1, 11] holds only 2 and 3. At t = 12 the window (2, 12] holds 3 and 11."),
      (([5, 5, 5, 5], 2, 1), [True, True, False, False],
       "Requests at the same second all fall in the same window; only the first two are accepted."),
  ],
  hidden=[
      (([], 3, 10), [], "no requests"),
      (([0, 1, 2, 3, 10], 1, 10), [True, False, False, False, True], "rejected requests do not count, and time 0 has left the window (0, 10] by t = 10"),
  ],
  approach="Keep a queue of accepted timestamps; for each request pop timestamps ≤ t − window from the front, accept (and push) if the queue size is below the limit. Each timestamp is pushed and popped at most once, so O(n) time and O(limit) space.",
  ref=src('''
      from collections import deque

      def rate_limit(timestamps, limit, window):
          accepted, result = deque(), []
          for t in timestamps:
              while accepted and accepted[0] <= t - window:
                  accepted.popleft()
              if len(accepted) < limit:
                  accepted.append(t)
                  result.append(True)
              else:
                  result.append(False)
          return result
  '''),
  alt="",
  hint="Only accepted requests matter, and old ones expire in arrival order. Which structure lets you add at one end and expire from the other?",
  rubric="""- Counts only accepted requests within the window `(t − window, t]` (correct open/closed boundary).
- Does not count rejected requests.
- Expires old timestamps with a queue/deque (or two pointers over accepted times).
- O(n) for full credit; rescanning all earlier requests for each one (O(n^2)) earns partial credit.""",
  checkpoints="""Keeps the timestamps of accepted requests only
Evicts timestamps with time <= t - window before deciding
Accepts when fewer than limit remain, then records the time
Rejected requests are not added to the window
Returns one boolean per request
O(n) amortised time""")

Q(n=16, difficulty="medium", title="Add Minutes to a UTC Timestamp", topic="Date & Time · Arithmetic · Strings",
  fn="addMinutes", py="add_minutes", params=["timestamp", "minutes"],
  body="""A scheduler computes the next run time of a job. Implement `addMinutes(timestamp, minutes)` that returns `timestamp` plus `minutes` minutes, in the same format `YYYY-MM-DDTHH:MM:SSZ`.

All times are UTC, so there are no time zones or daylight-saving changes. **Do not use a built-in date/time library**; do the calendar arithmetic yourself. Use the Gregorian calendar: February has 29 days in leap years. A year is a leap year if it is divisible by 4, except years divisible by 100 that are not divisible by 400.

### Constraints
- The input year is between 1970 and 9000 and the input is always a valid timestamp.
- 0 ≤ minutes ≤ 10^6
- The seconds part never changes.""",
  examples=[
      (("2026-10-17T22:45:00Z", 90), "2026-10-18T00:15:00Z", "22:45 + 1 h 30 min crosses midnight into the next day."),
      (("2024-02-28T23:30:00Z", 60), "2024-02-29T00:30:00Z", "2024 is a leap year, so the day after 28 February is 29 February."),
  ],
  hidden=[
      (("2026-12-31T23:59:59Z", 1), "2027-01-01T00:00:59Z", "rolls over the minute, hour, day, month and year at once"),
      (("2100-02-28T12:00:00Z", 1440), "2100-03-01T12:00:00Z", "2100 is divisible by 100 but not 400, so it is not a leap year"),
  ],
  approach="Parse the fields, add the minutes to the minute-of-day, carry whole days, then advance the date one day at a time using a days-in-month function with the leap-year rule (at most ~700 days for the constraints). Converting to a day count since an epoch and back is an accepted O(1)-style alternative.",
  ref=src('''
      def is_leap(y):
          return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)

      def days_in_month(y, m):
          if m == 2:
              return 29 if is_leap(y) else 28
          return 30 if m in (4, 6, 9, 11) else 31

      def add_minutes(timestamp, minutes):
          y, mo, d = int(timestamp[0:4]), int(timestamp[5:7]), int(timestamp[8:10])
          hh, mm, ss = int(timestamp[11:13]), int(timestamp[14:16]), timestamp[17:19]
          total = hh * 60 + mm + minutes
          extra_days, total = divmod(total, 1440)
          for _ in range(extra_days):
              d += 1
              if d > days_in_month(y, mo):
                  d, mo = 1, mo + 1
                  if mo > 12:
                      mo, y = 1, y + 1
          return "%04d-%02d-%02dT%02d:%02d:%sZ" % (y, mo, d, total // 60, total % 60, ss)
  '''),
  alt="",
  hint="Convert the time of day into minutes, add, and work out how many whole days that carries. Then you only need a rule for \"what is the day after this date?\"",
  rubric="""- Parses the timestamp fields and adds minutes with correct carry into hours and days.
- Advances dates across month and year ends using the right days per month.
- Applies the full leap-year rule (divisible by 4, except centuries not divisible by 400).
- Formats the result with zero-padding in the original format; partial credit if only the leap-century case or formatting is wrong.""",
  checkpoints="""Parses year, month, day, hour, minute from the string
Carries minutes into hours and whole days correctly
Rolls over month and year boundaries
Implements the leap-year rule including the century exception
Formats the output with two-digit zero padding and keeps seconds""")

Q(n=17, difficulty="medium", title="Order Status State Machine", topic="State Machine · Hash Map · Validation",
  fn="processOrder", py="process_order", params=["actions"],
  body="""An order system only allows certain status changes. Every order starts in the state `"created"`, and these are the only allowed transitions:

| state | action | next state |
|---|---|---|
| `created` | `pay` | `paid` |
| `created` | `cancel` | `cancelled` |
| `paid` | `ship` | `shipped` |
| `paid` | `cancel` | `cancelled` |
| `shipped` | `deliver` | `delivered` |
| `delivered` | `return` | `returned` |

`cancelled` and `returned` are final: no action is allowed from them. Any action not listed for the current state (including unknown actions) is invalid.

Implement `processOrder(actions)` that applies `actions` in order and returns the final state. If an action is invalid, stop and return the string `"error at step i"`, where `i` is the 0-based index of the first invalid action.

### Constraints
- 0 ≤ length(actions) ≤ 1000
- Actions are lowercase strings.""",
  examples=[
      ((["pay", "ship", "deliver"],), "delivered", "created → paid → shipped → delivered, all allowed."),
      ((["pay", "cancel", "ship"],), "error at step 2", "After `cancel` the order is final, so `ship` at index 2 is invalid."),
  ],
  hidden=[
      (([],), "created", "no actions leaves the initial state"),
      ((["pay", "ship", "deliver", "return", "return"],), "error at step 4", "`returned` is final, so a second return is invalid"),
  ],
  approach="Store the transition table as a map from (state, action) to next state; walk the actions, look each one up and return the error string at the first miss. O(n) time, O(1) space for a fixed table.",
  ref=src('''
      TRANSITIONS = {
          ("created", "pay"): "paid",
          ("created", "cancel"): "cancelled",
          ("paid", "ship"): "shipped",
          ("paid", "cancel"): "cancelled",
          ("shipped", "deliver"): "delivered",
          ("delivered", "return"): "returned",
      }

      def process_order(actions):
          state = "created"
          for i, action in enumerate(actions):
              nxt = TRANSITIONS.get((state, action))
              if nxt is None:
                  return "error at step %d" % i
              state = nxt
          return state
  '''),
  alt="A nested map (state → action → next state) or a switch statement is equally fine; the table-driven version is preferred.",
  hint="Write the table down as data rather than a long chain of if-statements. Then each step is a single lookup.",
  rubric="""- Starts in `created` and applies every allowed transition correctly.
- Rejects actions not allowed from the current state, including from final states and unknown actions.
- Returns `"error at step i"` with the 0-based index of the first invalid action and stops there.
- Returns `created` for no actions; partial credit for hard-coded if-chains that miss some transitions.""",
  checkpoints="""Initial state is "created"
Encodes the transition table (preferably as data)
Moves to the next state for each valid action
Returns "error at step i" at the first invalid action, 0-based
Treats cancelled and returned as final states""")

PAGE_RECORDS = [
    {"id": 4, "created_at": "2026-10-01T09:00:00Z"},
    {"id": 2, "created_at": "2026-10-01T09:05:00Z"},
    {"id": 7, "created_at": "2026-10-01T09:05:00Z"},
    {"id": 1, "created_at": "2026-10-01T09:10:00Z"},
    {"id": 9, "created_at": "2026-10-01T09:12:00Z"},
]
Q(n=18, difficulty="medium", title="Cursor-Based Pagination", topic="Arrays · Pagination · Comparison",
  fn="getPage", py="get_page", params=["records", "pageSize", "cursor"],
  body="""An export API returns records page by page. Using an offset (\"skip 20 rows\") breaks when rows are inserted or deleted between calls, so the API uses a **cursor**: the sort key of the last record already returned.

`records` is sorted by `created_at` ascending and then by `id` ascending (several records can share a `created_at`). `created_at` uses the fixed format `YYYY-MM-DDTHH:MM:SSZ`. A cursor is the string `"<created_at>|<id>"` of the last record on the previous page, or `null` for the first page.

Implement `getPage(records, pageSize, cursor)` that returns a map with:
- `"items"`: the ids of the next `pageSize` records whose `(created_at, id)` comes strictly **after** the cursor,
- `"nextCursor"`: the cursor of the last returned record, or `null` if no records remain after it.

The record named by the cursor may no longer exist (it could have been deleted).

### Constraints
- 0 ≤ length(records) ≤ 10^5; 1 ≤ pageSize ≤ 1000
- ids are positive integers, unique.""",
  examples=[
      ((PAGE_RECORDS, 2, None), {"items": [4, 2], "nextCursor": "2026-10-01T09:05:00Z|2"},
       "First page: the first two records. Records remain after id 2, so a cursor is returned."),
      ((PAGE_RECORDS, 2, "2026-10-01T09:05:00Z|2"), {"items": [7, 1], "nextCursor": "2026-10-01T09:10:00Z|1"},
       "id 7 has the same `created_at` as the cursor but a larger id, so it comes after the cursor."),
      ((PAGE_RECORDS, 2, "2026-10-01T09:10:00Z|1"), {"items": [9], "nextCursor": None},
       "Only one record is left, and nothing remains after it, so `nextCursor` is `null`."),
  ],
  hidden=[
      (([r for r in PAGE_RECORDS if r["id"] != 2], 2, "2026-10-01T09:05:00Z|2"), {"items": [7, 1], "nextCursor": "2026-10-01T09:10:00Z|1"},
       "the cursor's record (id 2) was deleted; resuming by key comparison still works",
       "getPage(example records without id 2, 2, \"2026-10-01T09:05:00Z|2\")"),
      ((PAGE_RECORDS, 5, None), {"items": [4, 2, 7, 1, 9], "nextCursor": None},
       "the page ends exactly at the last record, so no cursor to an empty page is returned",
       "getPage(example records, 5, null)"),
  ],
  approach="Parse the cursor into (created_at, id), skip records whose key is ≤ it (a binary search on the sorted key works too), take up to pageSize, and set nextCursor only if a record exists after the last one taken. O(n) scan or O(log n + pageSize) with binary search.",
  ref=src('''
      def get_page(records, page_size, cursor):
          start = 0
          if cursor is not None:
              c_time, c_id = cursor.split("|")
              key = (c_time, int(c_id))
              while start < len(records) and (records[start]["created_at"], records[start]["id"]) <= key:
                  start += 1
          page = records[start:start + page_size]
          items = [r["id"] for r in page]
          has_more = start + page_size < len(records)
          next_cursor = None
          if page and has_more:
              last = page[-1]
              next_cursor = "%s|%d" % (last["created_at"], last["id"])
          return {"items": items, "nextCursor": next_cursor}
  '''),
  alt="",
  hint="Turn the cursor back into the two values it encodes and compare records by both of them. When should the next cursor be null even though you returned a full page?",
  rubric="""- Parses the cursor into created_at and id and compares on BOTH (ties on created_at resolved by id).
- Returns records strictly after the cursor, and still works when the cursor's record was deleted.
- Returns at most pageSize ids.
- Sets nextCursor to the last returned record's key, or null when nothing remains; partial credit for an offset-based or created_at-only solution.""",
  checkpoints="""Handles a null cursor as the first page
Splits the cursor into created_at and numeric id
Compares (created_at, id) tuples, strictly greater than the cursor
Takes at most pageSize records
nextCursor is null when no records remain after the page
Does not depend on the cursor's record still existing""")

Q(n=19, difficulty="medium", title="Count User Sessions From Click Events", topic="Hash Map · Sorting · Sessionization",
  fn="countSessions", py="count_sessions", params=["events", "gap"],
  body="""Product analytics groups each user's click events into **sessions**. A user's events, ordered by time, belong to the same session as long as each event comes at most `gap` seconds after the previous one. A difference **greater** than `gap` starts a new session.

`events` is an array of maps `{"user": ..., "ts": ...}` with `ts` in seconds. Events are **not** sorted and can contain repeats. Implement `countSessions(events, gap)` that returns a map from each user to their number of sessions. Keys may be in any order.

### Constraints
- 0 ≤ length(events) ≤ 10^5
- 0 ≤ ts ≤ 10^9, 1 ≤ gap ≤ 10^6""",
  examples=[
      (([{"user": "u1", "ts": 0}, {"user": "u2", "ts": 50}, {"user": "u1", "ts": 1000}, {"user": "u1", "ts": 4000}, {"user": "u2", "ts": 1900}], 1800),
       {"u1": 2, "u2": 2},
       "u1: 0 → 1000 is within 1800 s, 1000 → 4000 is not, so 2 sessions. u2: 50 → 1900 is 1850 s, more than 1800, so 2 sessions."),
      (([{"user": "a", "ts": 3600}, {"user": "a", "ts": 0}, {"user": "a", "ts": 1800}], 1800),
       {"a": 1},
       "Sorted, the times are 0, 1800, 3600. Each gap is exactly 1800, which does not start a new session."),
  ],
  hidden=[
      (([], 1800), {}, "no events, no users"),
      (([{"user": "z", "ts": 10}, {"user": "z", "ts": 10}, {"user": "z", "ts": 2000}], 1800), {"z": 2}, "repeated timestamps are part of the same session; 10 → 2000 is a new one"),
  ],
  note="  (any key order)",
  approach="Group timestamps by user in a map, sort each user's times, and count 1 plus the number of consecutive differences greater than gap. O(n log n) time, O(n) space.",
  ref=src('''
      def count_sessions(events, gap):
          by_user = {}
          for e in events:
              by_user.setdefault(e["user"], []).append(e["ts"])
          result = {}
          for user in sorted(by_user):
              times = sorted(by_user[user])
              sessions = 1
              for prev, cur in zip(times, times[1:]):
                  if cur - prev > gap:
                      sessions += 1
              result[user] = sessions
          return result
  '''),
  alt="Sorting all events by (user, ts) once and scanning is an equivalent approach.",
  hint="Sessions are per user and depend on time order. What two steps put each user's events in the shape you need?",
  rubric="""- Groups events by user before sessionizing.
- Sorts each user's timestamps (input is unsorted).
- Starts a new session only when the difference is strictly greater than gap.
- Counts at least one session for every user with events; partial credit if sorting is skipped or the boundary uses >=.""",
  checkpoints="""Groups timestamps per user in a map
Sorts each user's timestamps
Starts with one session per user
Increments only when the gap is strictly greater than the limit
Returns a count for every user seen""")

Q(n=20, difficulty="medium", title="Fill a Message Template", topic="Strings · Parsing · Hash Map",
  fn="renderTemplate", py="render_template", params=["template", "values"],
  body="""Notification emails are built from templates with placeholders such as `{{name}}`. Implement `renderTemplate(template, values)` that returns the filled-in text:
- A placeholder is `{{`, optional spaces, a name made of letters, digits or `_`, optional spaces, then `}}`. So `{{name}}` and `{{ name }}` are the same placeholder.
- If the name is a key in `values`, replace the whole placeholder with that value converted to text (numbers are written normally, e.g. `0`).
- If the name is not in `values`, leave the placeholder exactly as written.
- Inserted values are **not** scanned again for placeholders.
- Text that does not form a complete placeholder (e.g. a `{{` that is never closed) is copied unchanged.

### Constraints
- 0 ≤ length(template) ≤ 10^5
- `values` maps names to strings or numbers.""",
  examples=[
      (("Hi {{name}}, your order {{ order_id }} ships on {{date}}.", {"name": "Asha", "order_id": 1042, "date": "2026-10-20"}),
       "Hi Asha, your order 1042 ships on 2026-10-20.",
       "`{{ order_id }}` with spaces matches the key `order_id`, and the number is written as text."),
      (("{{greeting}} {{ name }}! Balance: {{balance}}", {"name": "Ravi", "balance": 0}),
       "{{greeting}} Ravi! Balance: 0",
       "`greeting` has no value, so its placeholder stays. A value of `0` is still a value."),
  ],
  hidden=[
      (("Total {{amount}} {{", {"amount": 99}), "Total 99 {{", "an unclosed {{ is copied as plain text"),
      (("{{a}}-{{b}}", {"a": "{{b}}", "b": "x"}), "{{b}}-x", "the inserted value {{b}} is not expanded again"),
  ],
  approach="Scan left to right: at each `{{`, look for the matching `}}`, check that the trimmed inner text is a valid name, and either append the value or the original text; otherwise copy characters as they are. Output is built once, so inserted values are never rescanned. O(n + output) time. A single regex substitution with a callback is an accepted alternative.",
  ref=src('''
      import re

      PLACEHOLDER = re.compile(r"\\{\\{\\s*([A-Za-z0-9_]+)\\s*\\}\\}")

      def render_template(template, values):
          def replace(match):
              name = match.group(1)
              return str(values[name]) if name in values else match.group(0)
          return PLACEHOLDER.sub(replace, template)
  '''),
  alt="Repeated find-and-replace per key is NOT correct (it can rescan inserted values) and earns partial credit only.",
  hint="Build the output in one left-to-right pass instead of replacing text in place. What should happen to a placeholder whose name you do not know?",
  rubric="""- Recognises placeholders with and without inner spaces and valid names only.
- Replaces known names with their value as text (including `0`) and keeps unknown placeholders unchanged.
- Does not re-expand placeholders that appear inside inserted values.
- Copies unclosed `{{` and other text unchanged; partial credit for naive per-key find-and-replace.""",
  checkpoints="""Detects {{ ... }} and trims optional spaces around the name
Replaces known names with the value converted to text
Leaves unknown placeholders exactly as written
Treats falsy values like 0 as present
Does not rescan inserted values
Copies an unclosed {{ unchanged""")

# ---------------------------------------------------------------------------
# HARD (5)
# ---------------------------------------------------------------------------
Q(n=21, difficulty="hard", title="Apply an Out-of-Order Change Log", topic="Hash Map · Sorting · Change Data Capture",
  fn="applyChanges", py="apply_changes", params=["changes"],
  body="""A replication pipeline reads row changes from a source database and must rebuild the table. Every change has a unique log sequence number `lsn`; the true order of changes is ascending `lsn`, but changes can **arrive out of order** and the same change can arrive **more than once** (an exact repeat with the same `lsn`).

Each change is a map with `op`, `key`, `lsn` and, except for deletes, `row` (a map of column → value):
- `insert`: the row with this key becomes exactly `row` (replacing any existing row).
- `update`: the columns in `row` are set on the existing row; other columns keep their values. An update for a key that does not currently exist is ignored.
- `delete`: the row with this key is removed (ignored if it does not exist).

Implement `applyChanges(changes)` that returns the final table as a map from key to row. Rows only contain the columns given to them; columns may be in any order, and keys of the result may be in any order.

### Constraints
- 0 ≤ length(changes) ≤ 10^5
- `lsn` values are positive integers; changes with equal `lsn` are identical.""",
  examples=[
      (([{"op": "insert", "key": "o1", "lsn": 1, "row": {"status": "created", "amount": 500}},
         {"op": "update", "key": "o1", "lsn": 3, "row": {"status": "shipped"}},
         {"op": "update", "key": "o1", "lsn": 2, "row": {"status": "paid", "amount": 450}},
         {"op": "insert", "key": "o2", "lsn": 4, "row": {"status": "created", "amount": 90}}],),
       {"o1": {"status": "shipped", "amount": 450}, "o2": {"status": "created", "amount": 90}},
       "In lsn order, o1 is inserted, updated to paid/450 (lsn 2), then to shipped (lsn 3). Applying in arrival order would wrongly end with paid."),
      (([{"op": "insert", "key": "u1", "lsn": 10, "row": {"plan": "free"}},
         {"op": "delete", "key": "u1", "lsn": 12},
         {"op": "update", "key": "u1", "lsn": 11, "row": {"plan": "pro"}},
         {"op": "update", "key": "u1", "lsn": 11, "row": {"plan": "pro"}},
         {"op": "insert", "key": "u2", "lsn": 13, "row": {"plan": "pro"}}],),
       {"u2": {"plan": "pro"}},
       "The duplicate lsn 11 is applied once; u1 is deleted at lsn 12, after its update, so it is absent."),
  ],
  hidden=[
      (([{"op": "update", "key": "k", "lsn": 1, "row": {"x": 1}}],), {}, "an update with no existing row is ignored rather than creating a partial row"),
      (([{"op": "update", "key": "k", "lsn": 4, "row": {"b": 3}},
         {"op": "insert", "key": "k", "lsn": 1, "row": {"a": 1}},
         {"op": "insert", "key": "k", "lsn": 3, "row": {"b": 2}},
         {"op": "delete", "key": "k", "lsn": 2}],),
       {"k": {"b": 3}},
       "delete then re-insert: the old column a must not come back, and the late-arriving update applies on top",
       "applyChanges([update k lsn 4 {b: 3}, insert k lsn 1 {a: 1}, insert k lsn 3 {b: 2}, delete k lsn 2])"),
  ],
  note="  (any key and column order)",
  approach="Drop exact duplicates by lsn, sort the remaining changes by lsn, then replay them into a map of key → row with the insert/update/delete rules. O(n log n) time, O(n) space. Grouping by key and sorting each group is an equivalent alternative.",
  ref=src('''
      def apply_changes(changes):
          unique = {}
          for change in changes:
              unique[change["lsn"]] = change
          table = {}
          for lsn in sorted(unique):
              c = unique[lsn]
              key = c["key"]
              if c["op"] == "insert":
                  table[key] = dict(c["row"])
              elif c["op"] == "update":
                  if key in table:
                      table[key].update(c["row"])
              elif c["op"] == "delete":
                  table.pop(key, None)
          return {k: table[k] for k in sorted(table)}
  '''),
  alt="",
  hint="The arrival order is a distraction: what order would the source database have applied these changes in? Duplicates are easy to remove once you notice what makes a change unique.",
  rubric="""- Removes duplicate changes (same lsn) so each change applies once.
- Applies changes in ascending lsn order, not arrival order.
- Implements insert (replace whole row), update (merge columns, ignore if missing) and delete correctly.
- Re-insert after delete starts from a fresh row; partial credit if ordering is right but update/delete semantics are wrong, or vice versa.
- O(n log n) or better.""",
  checkpoints="""Deduplicates changes by lsn
Sorts changes by lsn before applying
Insert replaces the row completely
Update merges columns and is ignored for a missing row
Delete removes the row; a later insert starts fresh
Returns the final key → row map""")

Q(n=22, difficulty="hard", title="Count Business Days Between Dates", topic="Date & Time · Arithmetic · Hash Set",
  fn="businessDays", py="business_days", params=["start", "end", "holidays"],
  body="""A payments team must count how many **business days** a settlement took. Implement `businessDays(start, end, holidays)` that returns the number of dates `d` with `start ≤ d ≤ end` (both inclusive) that are Monday to Friday and are **not** in `holidays`.

Dates are strings `YYYY-MM-DD`. `holidays` may contain duplicates, weekend dates, and dates outside the range. If `start` is after `end`, return `0`.

**Do not use a built-in date/time library.** You may rely on this fact: `1970-01-01` was a **Thursday**. Use the Gregorian leap-year rule (divisible by 4, except years divisible by 100 that are not divisible by 400).

### Constraints
- All dates are valid and between 1970-01-01 and 2100-12-31.
- 0 ≤ length(holidays) ≤ 1000
- The range spans at most 10 years.""",
  examples=[
      (("2026-10-16", "2026-10-23", ["2026-10-20"]), 5,
       "From Friday 16 Oct to Friday 23 Oct there are 6 weekdays (16, 19, 20, 21, 22, 23). The 20th is a holiday, leaving 5."),
      (("2024-02-26", "2024-03-04", ["2024-03-02"]), 6,
       "Mon 26 Feb to Mon 4 Mar 2024 includes the leap day 29 Feb: weekdays are 26, 27, 28, 29 Feb and 1, 4 Mar. The holiday on Saturday 2 Mar changes nothing."),
  ],
  hidden=[
      (("2026-10-24", "2026-10-25", []), 0, "a range covering only Saturday and Sunday"),
      (("2026-12-24", "2027-01-01", ["2026-12-25", "2026-12-25", "2027-01-01", "2026-12-31"]), 4,
       "crosses a year end; a duplicated holiday must be subtracted only once (7 weekdays − 3 distinct holidays)"),
  ],
  approach="Convert a date to a day number since 1970-01-01 (sum of year lengths, month lengths and the day), so the weekday is (Thursday + dayNumber) mod 7. Iterate the day numbers from start to end (≤ ~3660 days), or count full weeks × 5 plus the remainder, and subtract the distinct holidays that fall on in-range weekdays (use a set). O(range + holidays).",
  ref=src('''
      def is_leap(y):
          return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)

      MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

      def day_number(date):
          y, m, d = int(date[0:4]), int(date[5:7]), int(date[8:10])
          days = sum(366 if is_leap(yr) else 365 for yr in range(1970, y))
          days += sum(MONTH_DAYS[:m - 1]) + (1 if m > 2 and is_leap(y) else 0)
          return days + d - 1

      def business_days(start, end, holidays):
          s, e = day_number(start), day_number(end)
          if s > e:
              return 0
          holiday_numbers = {day_number(h) for h in holidays}
          count = 0
          for n in range(s, e + 1):
              weekday = (n + 3) % 7          # 0 = Monday ... 6 = Sunday; day 0 was a Thursday
              if weekday < 5 and n not in holiday_numbers:
                  count += 1
          return count
  '''),
  alt="Zeller's congruence or Sakamoto's method for the weekday, and a full-weeks × 5 shortcut for counting, are accepted alternatives.",
  hint="If you can turn any date into \"number of days since 1970-01-01\", both the weekday and walking through the range become simple integer arithmetic.",
  rubric="""- Computes the day of the week without a date library, correctly across months, years and leap years.
- Counts weekdays inclusively from start to end and returns 0 when start > end.
- Subtracts each in-range weekday holiday exactly once (ignores duplicates, weekend and out-of-range holidays).
- Applies the full leap-year rule; partial credit for a correct approach with an off-by-one in the weekday anchor or range ends.""",
  checkpoints="""Converts a date to a day count (or uses a weekday formula) without a library
Uses the 1970-01-01 Thursday anchor correctly
Applies the leap-year rule including centuries
Counts Monday–Friday dates inclusive of both ends
Uses a set so duplicate holidays count once; ignores weekend/out-of-range holidays
Returns 0 when start is after end""")

Q(n=23, difficulty="hard", title="Check a Version Against a Range", topic="Strings · Parsing · Comparison",
  fn="satisfies", py="satisfies", params=["version", "range"],
  body="""A connector marketplace lets each plugin declare which platform versions it supports. Implement `satisfies(version, range)` that returns `true` if `version` is inside `range`.

A version is `MAJOR.MINOR.PATCH` (three non-negative integers, compared numerically, MAJOR first). A range is one or more **groups** separated by ` || `; the version satisfies the range if it satisfies **any** group. A group is one or more **comparators** separated by single spaces; the version must satisfy **all** of them. A comparator is one of:
- `1.2.3` or `=1.2.3`: exactly that version.
- `>1.2.3`, `>=1.2.3`, `<1.2.3`, `<=1.2.3`: the usual comparisons.
- `~1.2.3`: at least `1.2.3` and less than `1.3.0` (patch changes only).
- `^1.2.3`: at least `1.2.3` and less than `2.0.0`. If MAJOR is `0`, `^0.2.3` means at least `0.2.3` and less than `0.3.0`.

### Constraints
- The range is always well formed; 1 ≤ length(range) ≤ 500.
- Each version part has at most 6 digits.""",
  examples=[
      (("1.4.2", "^1.2.0"), True, "`^1.2.0` allows everything from 1.2.0 up to (not including) 2.0.0."),
      (("2.0.0", ">=1.5.0 <2.0.0"), False, "Both comparators must hold, and 2.0.0 is not less than 2.0.0."),
      (("0.3.1", "^0.2.5 || ~0.3.0"), True, "`^0.2.5` means [0.2.5, 0.3.0), which fails, but `~0.3.0` means [0.3.0, 0.4.0), which holds."),
  ],
  hidden=[
      (("1.10.0", ">1.9.9"), True, "parts are compared as numbers, not text (\"1.10.0\" < \"1.9.9\" as strings)"),
      (("0.3.0", "^0.2.5"), False, "the caret on a 0.x version only allows patch changes; 0.3.0 is the exclusive upper bound"),
  ],
  approach="Parse versions into integer triples so tuple comparison works. Split the range on ` || `, each group on spaces, translate each comparator (including ~ and ^) into lower/upper bounds, and return true if any group passes all checks. O(length of range).",
  ref=src('''
      def parse(v):
          return tuple(int(x) for x in v.split("."))

      def check(v, comp):
          for op in (">=", "<=", ">", "<", "=", "~", "^"):
              if comp.startswith(op):
                  target = parse(comp[len(op):])
                  break
          else:
              op, target = "=", parse(comp)
          major, minor, _ = target
          if op == "=":
              return v == target
          if op == ">":
              return v > target
          if op == ">=":
              return v >= target
          if op == "<":
              return v < target
          if op == "<=":
              return v <= target
          if op == "~":
              return target <= v < (major, minor + 1, 0)
          upper = (major + 1, 0, 0) if major > 0 else (0, minor + 1, 0)
          return target <= v < upper

      def satisfies(version, range_):
          v = parse(version)
          for group in range_.split(" || "):
              if all(check(v, comp) for comp in group.split()):
                  return True
          return False
  '''),
  alt="",
  hint="Make version comparison trivial first (three numbers compared left to right). Then rewrite ~ and ^ as a pair of ordinary comparisons, and handle AND inside a group and OR between groups.",
  rubric="""- Compares versions numerically part by part (not as strings).
- Supports exact, >, >=, <, <= comparators with an AND across a group.
- Expands ~ and ^ correctly, including the special case of ^ with MAJOR 0.
- Combines groups with OR via ` || `; partial credit if the operators work but ^0.x or OR groups are wrong.""",
  checkpoints="""Parses versions into numeric triples
Recognises the operator prefix (>=, <= checked before > and <)
Implements ~ as [x.y.z, x.(y+1).0)
Implements ^ as [x.y.z, (x+1).0.0), and [0.y.z, 0.(y+1).0) when MAJOR is 0
Requires all comparators in a group (AND)
Accepts if any || group passes (OR)""")

Q(n=24, difficulty="hard", title="Reorder Late Events With a Watermark", topic="Heap · Streaming · Simulation",
  fn="reorderEvents", py="reorder_events", params=["events", "lateness"],
  body="""A streaming job receives events that are **mostly** in time order, but some arrive late. It reorders them using a **watermark**:
- Keep `maxSeen`, the largest event time seen so far among accepted events. The watermark is `maxSeen − lateness` (before any event is accepted it is minus infinity).
- When an event `[time, id]` arrives: if `time` is **less than** the current watermark, it is too late and is **dropped**. Otherwise it is buffered, `maxSeen` and the watermark are updated, and then every buffered event with `time ≤ watermark` is emitted in increasing `time` order (ties in arrival order).
- When the stream ends, all remaining buffered events are emitted in the same order.

Implement `reorderEvents(events, lateness)`, where `events` is in arrival order. Return a map with `"emitted"` (ids in emit order) and `"dropped"` (ids in arrival order).

### Constraints
- 0 ≤ length(events) ≤ 10^5
- 0 ≤ time ≤ 10^9, 0 ≤ lateness ≤ 10^9; ids are unique strings.
- Target O(n log n).""",
  examples=[
      (([[5, "a"], [3, "b"], [9, "c"], [4, "d"], [12, "e"], [8, "f"]], 3), {"emitted": ["b", "a", "c", "e"], "dropped": ["d", "f"]},
       "After c (time 9) the watermark is 6, so b (3) and a (5) are emitted. d (4) is below 6 and dropped. After e (12) the watermark is 9 and c is emitted. f (8) is below 9 and dropped. e is flushed at the end."),
      (([[1, "x"], [1, "y"], [2, "z"], [1, "w"]], 0), {"emitted": ["x", "y", "z"], "dropped": ["w"]},
       "With lateness 0 each event is emitted on arrival. y (1) equals the watermark 1, which is not late. w (1) is below the watermark 2."),
  ],
  hidden=[
      (([], 5), {"emitted": [], "dropped": []}, "an empty stream"),
      (([[7, "p"], [2, "q"], [5, "r"]], 100), {"emitted": ["q", "r", "p"], "dropped": []}, "a huge lateness never drops anything; everything is sorted and emitted at the end"),
  ],
  approach="Buffer accepted events in a min-heap keyed by (time, arrival index). On each arrival compare with the current watermark, push, update maxSeen, then pop while the heap's minimum time ≤ watermark; flush the heap at the end. Each event is pushed and popped once: O(n log n) time, O(n) space.",
  ref=src('''
      import heapq

      def reorder_events(events, lateness):
          heap, emitted, dropped = [], [], []
          max_seen = None
          for seq, (time, event_id) in enumerate(events):
              watermark = None if max_seen is None else max_seen - lateness
              if watermark is not None and time < watermark:
                  dropped.append(event_id)
                  continue
              heapq.heappush(heap, (time, seq, event_id))
              max_seen = time if max_seen is None else max(max_seen, time)
              watermark = max_seen - lateness
              while heap and heap[0][0] <= watermark:
                  emitted.append(heapq.heappop(heap)[2])
          while heap:
              emitted.append(heapq.heappop(heap)[2])
          return {"emitted": emitted, "dropped": dropped}
  '''),
  alt="A sorted buffer with insertion is acceptable for partial-to-full credit depending on the stated complexity (O(n^2) worst case).",
  hint="You repeatedly need the earliest buffered event, and new events can land anywhere in time order. Which structure gives you the minimum quickly as items are added?",
  rubric="""- Drops an event only when its time is strictly less than the watermark at arrival.
- Updates maxSeen/watermark only from accepted events and emits buffered events with time ≤ watermark after each arrival.
- Emits in increasing time order with ties in arrival order, and flushes the buffer at the end.
- Uses a min-heap (O(n log n)) for full credit; a re-sorted array each time earns partial credit.""",
  checkpoints="""Maintains maxSeen and computes watermark = maxSeen - lateness
Drops events whose time is below the current watermark
Buffers accepted events in a min-heap by (time, arrival order)
Emits all buffered events with time <= watermark after each arrival
Flushes remaining events at the end in order
O(n log n) time""")

Q(n=25, difficulty="hard", title="Match a Cron Schedule", topic="Strings · Parsing · Scheduling",
  fn="cronMatches", py="cron_matches", params=["expr", "time"],
  body="""Pipelines are scheduled with cron expressions. Implement `cronMatches(expr, time)` that returns `true` if the job should run at the given minute.

`expr` has five fields separated by single spaces: **minute** (0–59), **hour** (0–23), **day of month** (1–31), **month** (1–12) and **day of week** (0–6, where 0 is Sunday). `time` is a map with the integer keys `minute`, `hour`, `day`, `month`, `weekday`. In this simplified version **all five** fields must match.

Each field is one or more items separated by commas; the field matches if **any** item matches. An item is:
- `*`: any value.
- A number `n`: exactly `n`.
- A range `a-b`: any value from `a` to `b` inclusive.
- A step `*/s` or `a-b/s`: the values start, start + s, start + 2s, ... up to the end, where for `*/s` the start and end are the field's minimum and maximum (so minute `*/15` is 0, 15, 30, 45 and day `*/10` is 1, 11, 21, 31).

### Constraints
- `expr` is always well formed and all numbers are within their field's range.
- 1 ≤ s ≤ 59""",
  examples=[
      (("*/15 9-17 * * 1-5", {"minute": 45, "hour": 17, "day": 16, "month": 10, "weekday": 5}), True,
       "45 is a multiple of 15, hour 17 is inside 9-17 (inclusive), and Friday (5) is inside 1-5."),
      (("0 0 1,15 * *", {"minute": 0, "hour": 0, "day": 14, "month": 10, "weekday": 3}), False,
       "Midnight matches, but day 14 is neither 1 nor 15."),
      (("10-30/10 * * 1,4,7,10 0", {"minute": 30, "hour": 6, "day": 4, "month": 10, "weekday": 0}), True,
       "10-30/10 is 10, 20, 30; October is in the month values; 0 is Sunday."),
  ],
  hidden=[
      (("5 * * * *", {"minute": 55, "hour": 1, "day": 1, "month": 1, "weekday": 4}), False, "a single number must match exactly, not as a suffix or multiple"),
      (("1-10/4 * * * *", {"minute": 9, "hour": 0, "day": 1, "month": 1, "weekday": 4}), True, "a stepped range starts at its own start: 1, 5, 9 (not multiples of 4)"),
  ],
  approach="Map each field to its (min, max), split the field on commas, and test each item: `*`, number, range, or step (start/end from the range or the field bounds, then check value in range and (value − start) mod s = 0). All five fields must match. O(length of expr).",
  ref=src('''
      FIELDS = [("minute", 0, 59), ("hour", 0, 23), ("day", 1, 31), ("month", 1, 12), ("weekday", 0, 6)]

      def item_matches(item, value, lo, hi):
          step = 1
          if "/" in item:
              item, s = item.split("/")
              step = int(s)
          if item == "*":
              start, end = lo, hi
          elif "-" in item:
              a, b = item.split("-")
              start, end = int(a), int(b)
          else:
              start = end = int(item)
          return start <= value <= end and (value - start) % step == 0

      def cron_matches(expr, time):
          parts = expr.split(" ")
          for field, (name, lo, hi) in zip(parts, FIELDS):
              value = time[name]
              if not any(item_matches(item, value, lo, hi) for item in field.split(",")):
                  return False
          return True
  '''),
  alt="Expanding every field into the set of allowed values and checking membership is an equally good alternative.",
  hint="Treat every item form as \"a start, an end and a step\": `*` and a plain number are just special cases of that. Then a field is an OR over its items and the expression is an AND over its fields.",
  rubric="""- Parses all five fields and requires every field to match.
- Supports `*`, single numbers, inclusive ranges and comma-separated items (any item matches).
- Implements steps correctly: `*/s` from the field minimum (1 for day/month), `a-b/s` from `a`.
- Partial credit if basic items work but steps are computed as plain multiples of s or field minimums are wrong.""",
  checkpoints="""Splits the expression into the five fields in the right order
Splits each field on commas and matches if any item matches
Handles * and exact numbers
Handles inclusive ranges a-b
Handles steps from the field minimum (*/s) and from a range start (a-b/s)
Returns true only when all five fields match""")


# ---------------------------------------------------------------------------
# Build + verify
# ---------------------------------------------------------------------------
BANNED = re.compile(r"\b(list|lists|dict|dicts|python|def|print)\b|print\(", re.IGNORECASE)


def independent_checks():
    """Cross-check the hand-written date questions against datetime."""
    ns = {}
    exec(next(q for q in QUESTIONS if q["n"] == 16)["ref"], ns)
    for ts, mins in [("2026-10-17T22:45:00Z", 90), ("2024-02-28T23:30:00Z", 60), ("2026-12-31T23:59:59Z", 1),
                     ("2100-02-28T12:00:00Z", 1440), ("1999-12-31T00:00:07Z", 10 ** 6), ("2000-02-28T23:59:00Z", 2)]:
        d = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ") + datetime.timedelta(minutes=mins)
        assert ns["add_minutes"](ts, mins) == d.strftime("%Y-%m-%dT%H:%M:%SZ"), ts
    ns = {}
    exec(next(q for q in QUESTIONS if q["n"] == 22)["ref"], ns)
    import random
    rnd = random.Random(7)
    base = datetime.date(1970, 1, 1)
    for _ in range(300):
        s = base + datetime.timedelta(days=rnd.randint(0, 47000))
        e = s + datetime.timedelta(days=rnd.randint(-5, 900))
        hol = [(s + datetime.timedelta(days=rnd.randint(-10, 400))).isoformat() for _ in range(rnd.randint(0, 8))]
        hs = set(hol)
        exp = 0
        d = s
        while d <= e:
            if d.weekday() < 5 and d.isoformat() not in hs:
                exp += 1
            d += datetime.timedelta(days=1)
        assert ns["business_days"](s.isoformat(), e.isoformat(), hol) == exp


def build():
    out = []
    n_tests = 0
    for q in QUESTIONS:
        ns = {}
        exec(q["ref"], ns)
        fn = ns[q["py"]]
        diff_label = q["difficulty"].capitalize()
        note = q.get("note", "")
        sample, expected = [], []
        for i, (args, want, expl) in enumerate(q["examples"], 1):
            got = fn(*copy.deepcopy(args))
            assert fmt(got) == fmt(want), (q["n"], "example", i, fmt(got), fmt(want))
            if q.get("raw_input"):
                inp = ", ".join("%s = `%s`" % (p, a) for p, a in zip(q["params"], args))
            else:
                inp = ", ".join("%s = %s" % (p, fmt(a)) for p, a in zip(q["params"], args))
            sample.append("**Example %d**\nInput: %s\nOutput: %s\nExplanation: %s" % (i, inp, fmt(want), expl))
            expected.append("Example %d → %s%s" % (i, fmt(want), note))
            n_tests += 1
        for i, h in enumerate(q["hidden"], 1):
            args, want, why = h[0], h[1], h[2]
            got = fn(*copy.deepcopy(args))
            assert fmt(got) == fmt(want), (q["n"], "hidden", i, fmt(got), fmt(want))
            shown = ["`%s`" % a for a in args] if q.get("raw_input") else [fmt(a) for a in args]
            call = h[3] if len(h) > 3 else "%s(%s)" % (q["fn"], ", ".join(shown))
            expected.append("Hidden test %d → %s = %s  (%s)" % (i, call, fmt(want), why))
            n_tests += 1
        prompt = "## %s\n> %s · %s\n\n%s" % (q["title"], q["topic"], diff_label, q["body"].strip())
        ref_answer = q["approach"]
        if q.get("alt"):
            ref_answer += " " + q["alt"]
        ref_answer += "\n\n" + q["ref"]
        obj = {
            "id": "qb-cod-n%02d" % q["n"],
            "category": "coding",
            "difficulty": q["difficulty"],
            "marks": 4,
            "title": q["title"],
            "topic": q["topic"],
            "prompt": prompt,
            "sample_data": "\n\n".join(sample),
            "expected_output": "\n".join(expected),
            "reference_answer": ref_answer,
            "hint": q["hint"],
            "rubric": q["rubric"],
            "checkpoints": q["checkpoints"],
            "source": SOURCE,
        }
        out.append(obj)
    return out, n_tests


def validate(out):
    assert len(out) == 25
    ids = [o["id"] for o in out]
    assert ids == ["qb-cod-n%02d" % i for i in range(1, 26)], ids
    assert len(set(ids)) == 25
    titles = [o["title"].lower() for o in out]
    assert len(set(titles)) == 25
    from collections import Counter
    mix = Counter(o["difficulty"] for o in out)
    assert mix == {"easy": 8, "medium": 12, "hard": 5}, mix
    existing = set()
    tsv = os.path.join(HERE, "existing-titles.tsv")
    if os.path.exists(tsv):
        for line in open(tsv, encoding="utf-8").read().splitlines()[1:]:
            cols = line.split("\t")
            if len(cols) > 2:
                existing.add(cols[2].strip().lower())
    for o in out:
        assert list(o.keys()) == KEYS, o["id"]
        assert o["category"] == "coding" and o["marks"] == 4 and o["source"] == SOURCE
        assert o["title"].lower() not in existing, o["title"]
        assert 1 <= len(o["topic"].split(" · ")) <= 3, o["id"]
        assert o["prompt"].startswith("## %s\n> %s · %s\n\n" % (o["title"], o["topic"], o["difficulty"].capitalize()))
        assert "### Constraints" in o["prompt"] and "Example" not in o["prompt"].split("### Constraints")[0].replace("examples", ""), o["id"]
        for field in ("prompt", "sample_data", "hint"):
            m = BANNED.search(o[field])
            assert not m, (o["id"], field, m.group(0))
        assert "True" not in o["sample_data"] and "False" not in o["sample_data"] and "None" not in o["sample_data"], o["id"]
        n_ex = o["sample_data"].count("**Example ")
        assert 2 <= n_ex <= 3, o["id"]
        for block in o["sample_data"].split("\n\n"):
            assert "\nInput: " in block and "\nOutput: " in block and "\nExplanation: " in block, o["id"]
        exp_lines = o["expected_output"].split("\n")
        assert sum(l.startswith("Example ") for l in exp_lines) == n_ex
        assert sum(l.startswith("Hidden test ") for l in exp_lines) == 2
        rub = o["rubric"].split("\n")
        assert 3 <= len(rub) <= 5 and all(r.startswith("- ") for r in rub), o["id"]
        cps = o["checkpoints"].split("\n")
        assert 4 <= len(cps) <= 6 and not any(c.startswith("- ") for c in cps), o["id"]
        assert o["hint"].count(".") + o["hint"].count("?") <= 3, o["id"]


def main():
    independent_checks()
    out, n_tests = build()
    validate(out)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("PASS: %d coding questions, %d example/hidden tests verified, 0 failures -> %s"
          % (len(out), n_tests, os.path.relpath(OUT, os.getcwd())))


if __name__ == "__main__":
    main()
