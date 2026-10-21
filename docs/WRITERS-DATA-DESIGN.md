# Writers site — database, system design and Free-plan budget

This is the validation record for the writers / documentation hiring site (`talo-docs`).
It covers the Cloudflare Workers **Free** plan limits, the database design (keys,
normalization, constraints, indexes, transactions), the system design, and a check
that every protection and admin feature of the v1 support site works on the writers
site too. Every number here comes from a test you can re-run:

| Command | What it proves |
|---|---|
| `npm test` | 110 tests: the 88 support tests are unchanged, and 22 writers tests cover the flow, the database rules, the protections and admin parity |
| `npm run test:limits` | a full 100-candidate writers drive on a metered database: queries, rows read and written, and outbound calls for every request |
| `node scripts/writers-parity-check.mjs` | 17 checks of the candidate protections, run in a real browser against `wrangler dev --env docs` |

## 1. Cloudflare Free plan limits, and where the writers site stands

| Limit (Free plan, per account unless noted) | Writers site, measured |
|---|---|
| **Requests: 100,000 a day.** Static files are free and don't count. | About 180 API requests per candidate. 100 candidates use about 18,000 (18%). |
| **D1 rows written: 100,000 a day** | About 350 per candidate. 100 candidates write about 35,000 rows (35%). |
| **D1 rows read: 5,000,000 a day** | About 1,000 per candidate. 100 candidates read about 100,000 rows (2%). Admin screens add about 1,000 rows a minute per open admin tab. |
| **D1 queries per request: 50** | The busiest request uses 34 (importing 30 questions). Most use 3–10. The test fails if any route goes over 40. |
| **Outbound requests per request: 50** | Grading uses 6 OpenAI calls per request, at most 30 with retries. Resume parsing uses 2. |
| **CPU: 10 ms per request,** with some leeway for occasional overruns | Candidate requests use well under 10 ms. See section 6 for the two heavy steps. |
| **D1: 500 MB per database, 10 databases, 5 GB in total** | Roughly 6 MB of answers per 100-candidate drive, deleted after 15 days. Two databases in use. |
| **Cron triggers: 5** | 2 in use (one per site). |
| **R2 free tier: 10 GB stored, 1M writes and 10M reads a month** | A resume is about 50–300 KB. |

How the writers site keeps its numbers down:

- **The clock sync and the autosave are one request.** The page syncs the clock every 30 s and sends the answer being typed in the same request; the support page uses a 10 s sync plus a 15 s autosave.
- **Saves still happen at the moments that matter:** on every question switch, when leaving the answer box, and on submit. The longest stretch of typing that a crash could lose is 30 s.
- **Requests that could grow with the cohort are capped:**
  - grading: 1 candidate per request
  - resume parsing: 2 PDFs per request
  - upload: 10 files per request (the admin page sends larger sets in chunks)
  - question import: 30 per request
  - closing abandoned attempts: 10 per request
- **The daily retention purge is set-based.** It uses 15 queries however many candidates expire; the support site's purge loops per candidate.
- **Static files are served by Cloudflare without running the Worker,** so they don't use any of the daily requests.

**Both sites share the account's daily limits.** The support test uses about 600 requests and 600 rows written per candidate per hour (estimated from its 10 s sync and 15 s autosave). Two big drives on the same UTC day can therefore add up: 100 support candidates and 100 writers together come to about 95,000 rows written. Before running both on one day, upgrade to Workers Paid ($5 a month), or put the drives on different UTC days. Daily limits reset at 00:00 UTC (05:30 IST).

## 2. Database design

### Tables (writers database `talo-docs-db`)

| Table | One row per | Key | Notes |
|---|---|---|---|
| `candidates` | candidate | `id`; `email` UNIQUE | Pipeline status (checked by a trigger), college, parsed resume data |
| `question_bank` | question | `id` | `category` = `part1` / `part2` (CHECK); marks and word limit (trigger); soft delete through `deleted_at` |
| `part1_assignments` | candidate × Part 1 question | (`candidate_id`, `question_id`); UNIQUE (`candidate_id`, `position`) | The random Part 1 draw |
| `part1_answers` | candidate × Part 1 question | (`candidate_id`, `question_id`) | Answer, AI marks and reasoning |
| `part2_questions` | candidate × Part 2 question | `id`; UNIQUE (`candidate_id`, `position`) | Copy of the bank question as shown to the candidate, plus `source_question_id` |
| `part2_answers` | candidate × Part 2 question | (`candidate_id`, `question_id`) | Answer, AI marks, reasoning and AI-likelihood |
| `attempts` | candidate | `candidate_id` | Each part's clock (start, time left, last sync, submit), leave-the-test counts, login counts |
| `attempt_events` | integrity event | `id` | Leaving the test, pastes, typing metrics. One INSERT per event; cascades when the candidate is deleted |
| `part1_seen`, `question_usage` | candidate × question / question | composite / `question_id` | Rotation: what each candidate has seen, and how often each question has been used |
| `settings` | setting | `key` | Questions and minutes per part, colleges |
| `admin_users`, `admin_sessions`, `admin_audit` | panel account / session / admin action | `id` / `token` / `id` | Accounts and roles; revocable sessions; activity log |

`part3_*` and `interview_questions` exist because the writers site runs the same code and migrations as support, but nothing on the writers site writes to them.

### Normalization

- **Most tables are in third normal form,** and in BCNF for their keys. Every non-key column depends on the whole key and nothing else: answers depend on (candidate, question), clock values on the candidate's attempt, question text on the question.
- **The writers site replaces one design flaw from v1:**
  - **The flaw:** v1 appends integrity events to a JSON array stored in `attempts`. That breaks first normal form, and two events arriving together could overwrite each other.
  - **The fix:** on the writers site each event is a row in `attempt_events`, written by a single INSERT, so none can be lost. A test fires 8 events at once and checks that all 8 are stored.
- **These denormalizations are deliberate and kept:**
  - **`part2_questions` copies the bank question** for each candidate. This is a snapshot of exactly what the candidate saw: editing or deleting the bank question later can't change past tests or their grading.
  - **`attempts` has a column per part** (part 1 / part 2) rather than a row per part. The number of parts is fixed and small, and one row per candidate means each clock sync reads and writes exactly one row. A table with a row per part would be the more normalized shape; v2 can adopt it.
  - **`candidates.skills` and `candidates.projects` are JSON.** They are display-only resume data that is never filtered or joined on.
  - **`question_usage` is a stored counter** that could be computed from `part1_seen`. Keeping it means the rotation reads one row per question instead of the whole history; it is updated atomically with `uses = uses + 1`.

### Constraints the database enforces itself

- **Primary keys** on every table. **UNIQUE** on `candidates.email`, on `admin_users.username`, and on (`candidate_id`, `position`) for both parts' question sets, so two overlapping requests can never give a candidate two sets.
- **Foreign keys** from every child table to `candidates`, and from answers to their questions. D1 enforces them. `attempt_events` uses `ON DELETE CASCADE`.
- **CHECK** constraints:
  - `question_bank.category` is one of the known values.
  - `attempt_events.part` is 1 or 2, and its numeric fields are not negative.
- **Triggers** (SQLite can't add a CHECK to an existing table), which reject:
  - a candidate status outside the pipeline states;
  - marks of zero or less;
  - a word limit outside 50–3,000;
  - a negative clock.

  Tests confirm each one rejects bad data.
- **Questions are never hard-deleted** (`deleted_at`), so every answer keeps a valid foreign key and past results stay complete.

### Indexes

Every query on a candidate-facing route uses an index: candidate by id and by email, attempt by candidate, each part's questions by candidate, answers by (candidate, question), the rotation by (category, active), and settings by key. Writers migration 0017 adds:

| Index | Used by |
|---|---|
| `part2_questions(candidate_id, position)`, UNIQUE | Part 2 start, grading, export, the duplicate-set guard (previously a full table scan) |
| `part1_assignments(candidate_id, position)`, UNIQUE | The duplicate-set guard for Part 1 |
| `part2_answers(question_id)`, `interview_questions(candidate_id)` | Foreign-key checks when a candidate or their Part 2 questions are deleted (retake went from 427 to 41 rows read, delete from 472 to 89) |
| `candidates(created_at)`, `admin_sessions(expires_at)` | The daily retention purge |
| `attempt_events(candidate_id, part, type)` | Paste and typing signals for grading, the detail view, export |

A few queries still scan a table on purpose, because they need every row: the cohort list, the export, and the abandoned-attempt check. Each reads about one row per candidate.

### Transactions, concurrency and idempotency

- **Multi-step changes run in one D1 batch,** which is a single transaction: clock sync plus answer save, finishing a test, retake, resume, the purge, and each integrity event with its counter.
- **Assigning questions is safe when two requests overlap** (the page's prefetch and Start can arrive together). Each row is inserted only if its position is free, and the UNIQUE index backs that up.
- **Grading claims are atomic.** `UPDATE … WHERE id IN (SELECT … LIMIT n)` means parallel grading calls never grade the same candidate twice.
- **Submitting twice is harmless.** Submit and close use `COALESCE`, so the first close time is kept. A clock sync can't move a part that is already closed (`WHERE …_submitted_at IS NULL`).
- **The server decides what can still be written.** Part 1 answers are refused once Part 1 is closed, and Part 2 is refused before Part 1 is closed.

### Time and data lifecycle

- **All times are UTC.** New columns use ISO-8601. Older v1 columns use SQLite's `YYYY-MM-DD HH:MM:SS` and are compared with SQLite date functions.
  - **Fixed:** an admin session's expiry was compared across the two formats. Because the space sorts before "T", a session stayed valid until the date changed instead of for 12 hours. A test now covers it.
- **Retention:** every day, candidates older than `DATA_RETENTION_DAYS` (15) are deleted together with their answers, questions, events and resume files. Expired sessions are deleted too, and so are activity-log rows past the same period, as the privacy notice promises.
- **Backups:** D1 Time Travel can restore the database to any minute in the last 7 days on the Free plan.

## 3. System design

- **Two fully separate deployments from one codebase.** `talo` and `talo-docs` each have their own Worker, D1 database, R2 bucket, secrets, admin accounts and address. Writers-only code runs only when `TEAM = "docs"`. Each site's candidate page is built into its own static assets, so neither site ships the other's page.
- **The Worker is stateless.** Candidate sessions are HMAC-signed cookies and need no database read. Admin sessions are signed tokens that are also stored in D1, so they can be revoked and they expire.
- **The server is authoritative for time.**
  - Each part keeps its time left and its last sync. If syncs stop (a disconnect), the clock stops; a gap is charged at most 45 s.
  - Abandoned attempts are closed automatically after their time plus a 30-minute grace period, so grading is never blocked.
- **Failure handling on the page:**
  - When a sync fails, the page shows "Connection lost — timer paused" and freezes the countdown.
  - It then checks the server every 10 s and resumes on its own. v1 waited for the browser's `online` event, which doesn't fire when the network was up but a request failed.
- **Privacy:**
  - No candidate request returns marks, scores, reasoning or answer keys. A test checks this after grading.
  - API and CSV responses are `no-store`.
  - Errors return only "Internal error" to the browser.

## 4. Same features and protections as the v1 support site

| v1 feature or protection | Writers site | How it's checked |
|---|---|---|
| Consent box before starting | Yes | browser check |
| Full screen; leaving starts a 10 s "return or be submitted" countdown | Yes, in Part 1. Part 2 is open book, as decided. | browser check |
| Warning toasts | Yes | browser check |
| Copy, cut, paste and right-click blocked | Yes, in Part 1. Part 2 allows them and logs pastes. | browser check |
| Not returning in 10 s submits and closes the assessment | Yes; both parts are closed on the server | browser check |
| Connection loss pauses the timer and resumes automatically | Yes, and recovery is more reliable than v1 | browser check |
| Reloading during a part ends the test | Yes. Reloading between the parts is safe. | browser check |
| One sitting per email; a second sign-in is blocked and flagged | Yes | browser check and tests |
| Unknown email, not-ready and revoked candidates are refused | Yes | browser check and tests |
| Autosave | Yes (with the 30 s sync, on switch, on blur and on submit) | tests and browser |
| Integrity flags (blocked sign-in, multiple logins, left the test) | Yes | test |
| Admin actions: Resume, Retake, Force submit, Revoke / Restore, Fix email, Delete with snapshot, colleges | Yes. Resume and Retake follow the two parts. | tests |
| Manager-only actions; panel members view and grade only | Yes, using the same shared rule as support | test (13 actions refused for a panel member) |
| Question soft delete, restore, disable | Yes; the bank counts update | test |
| Analyze all submissions; Grade now; Export | Yes, with per-part scores | tests |
| Access (named panel accounts, roles) | Yes, separate from support | test |
| Daily retention purge | Yes, set-based, and also covers events and the activity log | test |
| Security audit items (constant-time signatures, no internal errors to clients, parameterized SQL, escaped output, retention) | Yes; the shared code is unchanged and the writers routes follow the same rules | review and tests |

**About "3 strikes":** the live v1 code has no 3-strike counter. Its rule is that every time a candidate leaves, they get 10 s to come back or the test is submitted. The writers' Part 1 uses exactly that rule.

**Fixed while checking parity:** leaving full screen again within 1.5 s of coming back was ignored. The candidate could then stay out of full screen with no countdown. The full-screen check now raises the countdown again whenever none is running. This is shared page code, so the support site gets the fix only when it is next deployed from `main`.

The student security-report fixes, such as `__Host-` cookies and login lockout, were built in **v2**. They reach the writers site when it moves to v2.

### Security re-audit and full UI test (2026-10-21)

Every admin button and candidate control was clicked in a real browser against a local writers site (`scripts/writers-ui-audit.mjs`, 63 checks). The run had no console errors, page errors or unexpected API errors. The security review then found and fixed the following:

| # | Finding | Fix |
|---|---|---|
| H1 | A candidate could open Part 1 before the drive started and read the questions. | The test is **closed by default**. A manager opens it from Overview. Questions are drawn and shown only after Start. |
| H2 | A part had no hard end on the server; a page that stopped syncing kept its clock frozen. | Each part has a deadline: its minutes + `DOCS_MAX_PAUSE_MINUTES` (10). Every save also advances the clock. After the deadline the part is closed and saves are refused. |
| M1 | A demoted or deactivated panel member kept their old role until their session expired. | Admin sessions carry the user id; every request checks the current role and active flag. Removing a member, deactivating them or changing their password signs them out. |
| M2 | An answer could change the grader's instructions. | The answer is wrapped in a random per-call boundary and the grader is told to treat it only as text to mark. |
| M3 | Grading could run on a half-finished attempt. | Grade is refused until both parts are submitted. |
| M4 | A page could log unlimited integrity events, or spam the blocked-sign-in log. | At most 300 events per part, and only while the part is running. The blocked-sign-in log row is written at most once a minute per candidate. Per-IP rate limiting isn't available on workers.dev. |
| M5 | Any file named `.pdf` was accepted as a resume. | It must also start with the PDF signature `%PDF-`. It is served with a sandbox policy, `nosniff`, a cleaned filename and `no-store`. |
| L1 | `/me` showed the candidate their outcome (shortlisted / rejected). | The candidate only sees their stage (not started, between parts, done). |
| L2 | Spreadsheet exports could carry formulas (`=`, `+`, `-`, `@`). | Such values are prefixed with `'`. |
| L3 | Bootstrap passwords were compared with `===`. | Constant-time compare. |
| L4 | Text shown in the pages escaped `<` and `>` but not quotes. | Quotes are escaped too. |
| L5 | No cross-site request check. | Any POST, PUT or DELETE to `/api/` whose Origin header names another site is refused (403). |
| L6 | Candidate sign-ins never expired. | 12 hours. A revoked candidate's page shows "Your session was ended by the hiring team". |

UI fixes from the same run: a failing row action (Resume, Retake, Revoke…) now shows the error instead of failing silently, Revoke asks for confirmation, and a failed Start Part 1 returns the candidate to the start screen with a Try again button.

**Tests:** 124 tests in 15 files pass, including the 88 support tests, which are unchanged. There are 11 new writers security tests and 3 new shared ones (`test/security-fixes.test.ts`). The 100-candidate limits run passes 9/9. The browser parity check passes 17/17, and a smoke run of the support site passes 13/13 with no writers controls showing.

## 5. Changes in shared code (support site gets them only when it is next deployed from `main`)

- **Admin session expiry:** compares ISO timestamps correctly (section 2).
- **Full-screen check:** a second quick exit can no longer slip past the countdown (section 4).
- **Manager-only rule:** moved into `src/lib/roles.ts`. The rule is the same, and both sites now use it.
- **Answer box:** typing when no questions loaded no longer throws a page error.
- **Optional batch settings:** `RESUME_PROCESS_BATCH` and `MAX_UPLOAD_FILES`. When they are unset, support keeps 20 resumes and 100 files.
- **From the 2026-10-21 re-audit:**
  - admin sessions bound to the user (M1);
  - PDF signature check and safe viewer headers (M5);
  - CSV formula guard (L2);
  - constant-time password compare (L3);
  - quote escaping (L4);
  - cross-site guard (L5);
  - 12-hour candidate sign-in (L6);
  - row actions report errors.

  The support grader's prompt was **not** changed, so support scores stay comparable.

## 6. Open items

1. **Which Cloudflare plan is the account on?** Two heavy steps use more than the Free plan's 10 ms CPU per request, on both sites:
   - reading a resume PDF: about 35–100 ms;
   - an admin password check: tens of ms.

   Cloudflare allows occasional overruns. The writers site parses 2 resumes per request to keep each one small, and `RESUME_PROCESS_BATCH = "1"` lowers it further. Some support-site requests also go over the Free per-request query limit, which only works on Workers Paid:
   - its summary export (4 queries per candidate);
   - its 20-resume parse batches.

   If those work today, the account is on Paid and none of the Free limits apply. Please check under Workers & Pages → Plans in the Cloudflare dashboard.
2. **Same-day drives:** see section 1.
3. **v2:** port the writers mode, including `attempt_events` and these rules, before v2 replaces `main`.
