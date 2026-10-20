# Talo question import spec (docx → bank)

You are converting interview questions from a Word document (already extracted to
`question-bank/docx-import/source.txt`) into Talo's question-bank format.
Talo is a proctored campus-hiring assessment. Students write answers (code in ANY
language or pseudocode, or prose) in a text editor; there is NO code execution.
An AI grader marks answers against the admin-only fields (reference answer,
expected output, rubric, checkpoints). Candidates only ever see `prompt`,
`sample_data` and `hint`.

## Reference
`question-bank/docx-import/existing-bank-reference.json` holds the 24 questions
already in the bank. Match their style and level of detail exactly. Do NOT
re-create any question that is the same problem as one of these (same task, even
if renamed or re-skinned with a different story). Same rule inside your own list.

## Output (one JSON array, UTF-8) — every object has exactly these keys
| key | rules |
|---|---|
| `id` | `qb-dsa-dNNN` for category dsa, `qb-scn-dNNN` for scenario; use only the number range you were given |
| `category` | `"dsa"` (a plain algorithm/data-structure task) or `"scenario"` (a real-world story problem, or a debugging task) |
| `difficulty` | `"easy"`, `"medium"` or `"hard"` (docx "Easy" → easy, "Moderate"/"Easy to Moderate" → medium unless clearly trivial) |
| `marks` | always `5` |
| `title` | short title, Title Case, no "Q3." prefix. Debugging ones start with `Debugging: ` |
| `topic` | e.g. `"Arrays · Two Pointers"` (1–3 topics joined by ` · `) |
| `prompt` | markdown, exactly this shape (see reference): `## <title>` newline `> <topic> · <Easy|Medium|Hard>` blank line, problem description paragraphs (use `backticks` for identifiers/values, **bold** sparingly), optional `### Input`/`### Output` subsections if useful, then `### Constraints` with `- ` bullets. No examples here. |
| `sample_data` | the examples, shape: `**Example 1**` newline `Input: ...` newline `Output: ...` newline `Explanation: ...` (blank line between examples). 2–3 examples. EVERY example has Input AND Output. For debugging questions start with `**Buggy pseudocode**` then a fenced code block (```` ``` ````) of PSEUDOCODE (never Python/Java syntax), then examples using `Input:` / `Expected output:` / `Actual output:` rows. |
| `expected_output` | `Example 1 → <value>` per example, plus 2 lines `Hidden test N → <call or input> = <value>  (<why it matters>)` covering edge cases |
| `reference_answer` | approach in 1–3 sentences with complexity, then a clean reference solution (Python is fine here — admin-only). For debugging: name each bug, why it happens, and the corrected pseudocode. |
| `hint` | 1–2 sentences that nudge without giving the solution |
| `rubric` | 3–5 `- ` bullets of what a full-credit answer must do |
| `checkpoints` | 4–6 lines (newline-separated, no bullets) — itemized marking checkpoints |
| `source` | `"docx: <section name> <original number/code>"` e.g. `"docx: 30 Problems Part A · A3"` |

## Language-neutral wording (important — students may answer in any language)
- Never say "Python", "list", "dict", "def", "print()" in candidate-facing fields
  (`prompt`, `sample_data`, `hint`). Say "array", "map/dictionary", "function", "return".
- Booleans `true` / `false`; missing value `null` (or the sentinel the problem defines);
  arrays `[1, 2, 3]`; strings in double quotes `"abc"`.
- Function names in camelCase or a neutral form, e.g. `secondLargest(arr)`.

## Verification (mandatory)
Write ONE Python 3 script (path given in your task) that defines every question and,
for each, a Python reference implementation plus test cases for EVERY example and
every hidden test, and asserts they pass (normalise Python True/False/None to
true/false/null when comparing with the displayed values). For debugging questions,
implement BOTH the buggy behaviour (assert it produces the stated "Actual output")
and the fixed behaviour (assert "Expected output"). The script writes the JSON file
only if every assertion passes, and prints a summary. Run it until it passes.

If the docx itself contains a wrong output, a wrong explanation, a typo, an
ambiguous statement or Python-specific wording, FIX it and record the fix.

## Final message (your reply)
1. Number of questions written, ids and titles.
2. Every docx item you SKIPPED as a duplicate, and which existing question it duplicates.
3. Every correction you made to the docx content.
4. Confirmation that the verify script passed (paste its summary line).
