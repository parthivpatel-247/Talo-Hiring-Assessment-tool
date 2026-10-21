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
- **Grading**: **Analyze all submissions** has AI read each answer as a whole and give marks plus 2-3 lines of reasoning. There is no rubric; the AI judges task fulfilment, clarity, language, structure, audience and concision. For Part 2 the AI also estimates how AI-generated the text looks. That estimate is shown to the panel and never changes the marks.
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

**Already applied the migrations before migration 0017 was added?** Run the same
command again before deploying. It applies only the new `0017_writers_indexes.sql`
(indexes, integrity rules and the `attempt_events` table):
```bash
npx wrangler d1 migrations apply talo-docs-db --remote --env docs
```

## First use

1. Open https://talo-docs.hevo-talo.workers.dev/admin/ and sign in with `parthiv.patel@hevodata.com` and the `ADMIN_PASSWORD` you set.
2. Go to **Access** and add the writers' manager and panel members, each with their own email and password.
3. Go to **Question bank** and add questions, choosing Part 1 or Part 2 for each, with marks and an optional word limit.
4. Go to **Resumes → Assessment length** and check that both parts show green under "In the bank". Each part needs at least as many active questions as its question count. A candidate can't start a part whose bank is too small; they are asked to tell the invigilator.
5. Do a test run before the real drive:
   1. Upload a resume that has your own email on it, then select **Parse**.
   2. Take the test at https://talo-docs.hevo-talo.workers.dev.
   3. Run **Analyze all submissions**, then **Export**.
   4. Delete the test candidate.

## On the day

This works the same as the support site. Some points specific to the two parts:

- **Resume (same questions and answers)** reopens the part the candidate was cut off in. If they were between the parts, nothing needs reopening: they sign in again and select Start Part 2.
- **Retake** clears both parts and draws new questions.
- Refreshing the page while a part is running ends the assessment (the same rule as support). Refreshing between the parts is safe.

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
```

Database design, Free-plan budget and the v1 parity check: `docs/WRITERS-DATA-DESIGN.md`.
