# Writers / documentation hiring site (`talo-docs`)

The writers team runs its own copy of Talo. It uses the same code as the support site,
but has its own address, database, resume storage, admin logins and secrets. The two
sites share nothing at run time, so the teams' candidates, questions, results and panels
never mix.

| | Support site | Writers site |
|---|---|---|
| Worker | `talo` | `talo-docs` |
| Address | https://talo.hevo-talo.workers.dev | https://talo-docs.hevo-talo.workers.dev |
| Database (D1) | `campus-hiring-assessment-db` | `talo-docs-db` |
| Resume storage (R2) | `campus-hiring-resumes` | `talo-docs-resumes` |
| Migrations folder | `migrations/` | `migrations-docs/` |
| Deploy command | `npx wrangler deploy` | `npx wrangler deploy --env docs` |

All settings for the writers site are under `[env.docs]` in `wrangler.toml`.
`TEAM = "docs"` switches the code to the writers' test.

## What the writers' test is

- **Part 1**: closed book. Defaults are 4 questions in 30 minutes. It runs in full screen, with no copy or paste, the same as the support test. When Part 1 is submitted or its time runs out, it is **locked**: the server refuses any change to Part 1 answers.
- **Part 2**: open book. Defaults are 2 questions in 45 minutes. It opens only after Part 1 is closed, from a "Start Part 2" screen, and its clock starts on that click. Candidates may switch tabs and may copy and paste. Both are recorded for the panel.
- **Questions**: each candidate gets random questions from that part's bank, so Part 1 questions only ever come from Part 1 and Part 2 questions only from Part 2. A retake gets fresh questions.
- **Length**: the number of questions and minutes for each part are set in admin, under **Resumes → Assessment length**. Changes apply to candidates who start after you save.
- **Grading**: **Analyze all submissions** has AI read each answer as a whole and give marks plus 2-3 lines of reasoning. There is no rubric; the AI judges task fulfilment, clarity, language, structure, audience and concision. For Part 2 the AI also estimates how AI-generated the text looks. That estimate is shown to the panel and never changes the marks. Text copied from the question earns no marks: a Part 2 answer that is mostly the question or PRD pasted back (85% or more of its words copied word for word) gets an automatic 0 without the AI, and when a smaller share is copied the AI is told how much and grades only the candidate's own writing.
- **Export**: the summary CSV has Part 1, Part 2 and total scores, plus integrity counts. The full-detail CSV has every question, answer, word count, AI marks and reasoning.
- **Resumes**: uploading and parsing work as on the support site. The writers site does not generate AI interview questions.

## One-time setup (your terminal, logged in with `npx wrangler login`)

Run these from the repository on the `main` branch.

1. Create the database, then paste the `database_id` it prints into `wrangler.toml` under `[[env.docs.d1_databases]]`, replacing `REPLACE_WITH_TALO_DOCS_DB_ID`:
   ```bash
   npx wrangler d1 create talo-docs-db
   ```
2. Create the resume storage:
   ```bash
   npx wrangler r2 bucket create talo-docs-resumes
   ```
3. Create the tables. This uses `migrations-docs/` and never touches the support database:
   ```bash
   npx wrangler d1 migrations apply talo-docs-db --remote --env docs
   ```
4. Set the writers site's secrets. Wrangler prompts for each value; don't paste them anywhere else.
   - `SESSION_SECRET` must be a **new** value, not the support site's. Generate one with `openssl rand -hex 32`.
   - `ADMIN_PASSWORD` is the first manager's password.
   - `OPENAI_API_KEY` can be the same key as support, or a separate one.
   ```bash
   npx wrangler secret put SESSION_SECRET --env docs
   npx wrangler secret put ADMIN_PASSWORD --env docs
   npx wrangler secret put OPENAI_API_KEY --env docs
   ```
5. Deploy the writers site. This builds `dist-docs/` (public/ with the writers' page) and deploys only `talo-docs`:
   ```bash
   npx wrangler deploy --env docs
   ```
6. Commit the `database_id` change from step 1 (`git commit -am "Set talo-docs database id"`).

**Already applied the migrations earlier?** Run the same command again before
deploying. It applies only the files you don't have yet: `0017_writers_indexes.sql`
(indexes, integrity rules, the `attempt_events` table) and `0018_rate_limits.sql`
(the sign-in limits table):
```bash
npx wrangler d1 migrations apply talo-docs-db --remote --env docs
```
The support site has a matching new file, `migrations/0016_rate_limits.sql`. Apply it
before the support site's next deploy from `main`:
```bash
npx wrangler d1 migrations apply campus-hiring-assessment-db --remote
```
(If a migration is missed, the Worker creates the table itself on the first sign-in.)

## First use

1. Open https://talo-docs.hevo-talo.workers.dev/admin/ and sign in with `parthiv.patel@hevodata.com` and the `ADMIN_PASSWORD` you set.
2. Go to **Access** and add the writers' manager and panel members, each with their own email and password.
3. Go to **Question bank** and add questions, choosing Part 1 or Part 2 for each, with marks and an optional word limit. To add many at once, open **Bulk import (JSON)** and pick a file shaped like
   `{"questions":[{"part":1,"prompt":"…","marks":5,"wordLimit":150},{"part":2,"prompt":"…"}]}`.
   `marks` and `wordLimit` are optional. Questions already in the bank are skipped, and any length of file works: the page sends it 30 at a time.
4. Go to **Resumes → Assessment length** and check that both parts show green under "In the bank". Each part needs at least as many active questions as its question count. A candidate can't start a part whose bank is too small; they are asked to tell the invigilator.
5. Do a test run before the real drive:
   1. Upload a resume that has your own email on it, then select **Parse**.
   2. Take the test at https://talo-docs.hevo-talo.workers.dev.
   3. Run **Analyze all submissions**, then **Export**.
   4. Delete the test candidate.

   For the test run you have to open the test first (next section) and close it again afterwards.

## The writing team's question bank (2026-10-25)

The team's test comes from their Word file "Writing Assignment Campus Drive". `scripts/build-writers-bank.py` turns it into an import file, `scripts/verify-writers-bank.py` checks that every line candidates see is copied word for word, and `scripts/verify-writers-bank-style.py` checks that bold, underline and italic match.

- **Part 1 (closed book):** each candidate gets **12 questions, 20 marks**: both editing exercises (Write a tooltip, Write an alert message, 5 marks each, marked *Every candidate*) plus **10 of the 20 grammar sentences** (1 mark each). The ten are drawn by least-used rotation, so the 20 sentences are spread evenly across candidates (two candidates in a row get complementary sets). The ten sentences come first (Q1–Q10), shuffled per candidate; the *Every candidate* questions always come last (Q11 Exercise I, Q12 Exercise II, in the order they were added to the bank).
- **Part 2 (open book):** 1 question, the Alerts PRD outline (20 marks), the same for everyone. The total is **40 marks**, as in the team's file.
- **How Part 2 looks:** the task sits in a "Your task" card at the top (it can be folded away). The PRD follows as a reference document, with a bar that stays in view and jumps to Task, Objective, Background, Requirements and User Stories. The answer box is on the right, with a 2,000-word limit.
- **Exercise I** was reframed at the team's request: candidates write the one-line tooltip from the context. There is no existing tooltip to rewrite.
- **Model answers, acceptable variations, explanations and marking criteria** are stored with each question for the grader only. Candidates never receive them. The grader treats a model answer as one acceptable version and gives full marks to other correct wordings.
- **Setting up the live site:**
  1. In Admin → Question bank → Bulk import, choose `writers-question-bank.json`.
  2. Under Resumes → Assessment length, set Part 1 to 12 questions and 30 minutes, and Part 2 to 1 question and 45 minutes.
  3. Check that both parts show green.
- **Formatting in question text:**
  - `#### heading` (a section heading, kept in its own letter case);
  - `### heading` (small capitals, for the support site's style);
  - `**bold**`;
  - `[u]underline[/u]` and `[i]italic[/i]`;
  - lists (indent two spaces for a nested item);
  - tables, in which `<br>` makes a line break inside a cell.
- **Welcome screen:** shows the team's introduction, with the duration taken from Assessment length and Marks: 40.
- **Every candidate / drawn at random:** a question marked *Every candidate* (Question bank row button, the Add form tick box, or `"required": true` in an import file) goes to every candidate; the rest of the part's question count is drawn at random. Assessment length refuses a count smaller than the number of *Every candidate* questions.

## On the day

**The test is closed until you open it.** At the top of **Overview** a card shows the test as **Closed**. When the candidates are seated, a manager selects **Open the test**. Until then, a candidate who selects Start Part 1 sees "The assessment has not opened yet. Please wait for the invigilator to open it." with a **Try again** button, and nothing is drawn or timed. Select **Close the test** after the last candidate has started. Candidates already in a part carry on; nobody new can start Part 1.

This works the same as the support site. Some points specific to the two parts:

- **Resume (same questions and answers)** reopens the part the candidate was cut off in. If they were between the parts, nothing needs reopening: they sign in again and select Start Part 2.
- **Retake** clears both parts and draws new questions.
- After a **Resume** or **Retake** of Part 1, that candidate can start Part 1 even if the test is closed, for the next 3 hours. Starting uses it up.
- **Sign-in limits.**
  - **Admins:** 5 wrong passwords for one account from one network pause that account there for 15 minutes. 20 wrong sign-ins from one network pause the network.
  - **Browsers already used:** a browser that has signed in to the account before isn't affected by those pauses, so a student on the college network can't lock the invigilators out. That browser has its own limit of 10 wrong passwords.
  - **Candidates:** 200 sign-ins with emails that aren't on the list, from one network in 10 minutes, pause candidate sign-in on that network for 10 minutes.
  - **Lifting a pause:** whenever any pause is active, a **Sign-in paused** card appears at the top of Overview. A manager's **Lift sign-in pauses** clears every pause at once.
  - **Before the drive:** sign in once on each invigilator laptop, so those browsers are trusted.
- Refreshing the page while a part is running ends the assessment (the same rule as support). Refreshing between the parts is safe.
- **Each part has a hard end time:** its minutes plus up to 10 minutes for connection drops (`DOCS_MAX_PAUSE_MINUTES`). After that the server closes the part and refuses further saves, even if the page is still open.
- A candidate sign-in lasts 12 hours. If you **Revoke** a candidate, their page shows "Your session was ended by the hiring team" at its next sync.
- **One browser per part.** The browser that starts a part is the only one that can continue it. Another browser signed in with the same email (before the start, or between the parts) is shut out with "This test is running in another browser". Between the parts a candidate may sign in again on another device, and Part 2 then belongs to whichever browser starts it.
- After **Resume**, **Retake** or **Restore access**, every earlier sign-in for that candidate ends: **the candidate signs in again** to continue. (Restore access doesn't do this to a candidate who is in the middle of a part.)
- **Shortlist and Reject** are offered only once a candidate has been graded.
- Removing or demoting a panel member in **Access** takes effect on their very next click; they don't keep their old role until they sign out.
- **Every admin login is an account in Access.** The first sign-in with `ADMIN_EMAIL` and the `ADMIN_PASSWORD` secret creates that manager's account (name taken from the email). From then on it is listed with everyone else. The secret keeps working as the recovery password: it re-activates the account and makes it a manager again, and changing the secret signs out sessions made with the old one. A manager can also give that account its own password with **Reset password**.

## Reviewing results (both sites)

- **Tab switches** on the Candidates list: how many times each candidate left the test (switched tab or window, or left full screen). Writers show Part 1 (closed book: each exit counts against the candidate) and Part 2 (open book: switching is allowed, shown for context) separately. Amber means once or twice, red means 3 or more. Sort by **Tab switches (most first)** to see the most frequent first.
- **Change marks** (managers): under each answer in a candidate's view, once that part is submitted. Enter 0 to the question's marks, in steps of 0.25, with an optional reason. The AI's marks stay visible, and the change shows who made it, when and why. The manual mark counts in the part score, the total, the list and the CSV exports. **Grade** again updates only the AI's marks, never a manual one. **Use AI marks** removes the change.
- **Change the total** (managers): next to Total in a candidate's view, to set the final total directly (for example after a panel review). The list marks it *edited*; **Use sum of answers** removes it.
- **Resume** and **Retake** clear manual marks and a changed total, since the answers will be graded again.
- **Revoke access** asks whether to **also mark as Rejected**. **Restore access** puts back the status from before the revoke (Submitted if the revoke closed a running test).
- Every one of these changes is in the **Activity log**.

## Updating the writers site later

- Any change merged into `main` reaches the writers site only when you run `npx wrangler deploy --env docs`.
- `npx wrangler deploy` with no `--env` deploys the **support** site only.

## Local testing

```bash
npx wrangler d1 migrations apply talo-docs-db --local --env docs
npx wrangler dev --env docs        # http://127.0.0.1:8787, local secrets in .dev.vars.docs
npx vitest run test/docs.test.ts   # the writers' tests (the full suite: npm test)
npm run test:limits                # 100-candidate drive against the Workers Free limits
node scripts/writers-parity-check.mjs   # browser check of the candidate protections (needs wrangler dev --env docs)
ADMIN_EMAIL=... ADMIN_PASSWORD=... QA_DIR=./qa node scripts/writers-ui-audit.mjs   # clicks every admin and candidate control (71 checks)
SITE=writers BASE=http://127.0.0.1:8788 CAND_EMAIL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/ratelimit-ui-check.mjs   # 429s and sign-in pauses in the browser (13 checks; SITE=support: 12)
BASE=http://127.0.0.1:8789 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/support-smoke.mjs   # support site in the browser, incl. one browser per sitting (18 checks; needs `npx wrangler dev --port 8789`)
```

**Load tests:** the per-request ceilings (`[[ratelimits]]` in `wrangler.toml`) allow 3,000 requests a minute from one network. A load test run from one machine that simulates more than about 300 students will hit that ceiling. Run load tests against a local `wrangler dev`, or raise `RL_IP` for the test and put it back afterwards.

The UI audit needs a local stand-in for OpenAI so that parsing and grading run without a real key. Point `OPENAI_BASE_URL=http://127.0.0.1:8799` in `.dev.vars.docs` at any small server that answers `/v1/chat/completions` with JSON. Never put a real key or real student resumes in `QA_DIR`.

Database design, Free-plan budget and the v1 parity check: `docs/WRITERS-DATA-DESIGN.md`.
