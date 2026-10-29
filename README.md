# Talo · Campus Hiring Assessment (Hevo Data)

Talo runs Hevo's campus hiring drives end to end: upload the shortlisted
students' resumes, let them take a proctored, timed test, grade the answers with
AI, review and adjust the marks, shortlist, and prepare interview questions.

One codebase serves **two hiring teams**, each as its own site with its own
database, resume storage, admin accounts and URL:

| Site | Team | Test | Deploy |
|---|---|---|---|
| `talo` (support) | Customer support / engineering | One closed-book section: SQL, Python, DSA and real-world scenario questions, drawn per candidate from the bank | `npx wrangler deploy` |
| `talo-docs` (writers) | Documentation / technical writers | Part 1 closed book (grammar and editing), Part 2 open book (a writing task with a reference PRD) | `npx wrangler deploy --env docs` |

The two sites never share data. What differs between them is set by
`TEAM` in `wrangler.toml` (`[env.docs]` sets `TEAM = "docs"`).

## Features

**Candidates**
- Sign in with the email on their resume. One browser per sitting: once a test
  starts, only that browser can continue.
- Full-screen, closed-book test: copy, paste and right-click blocked; leaving the
  page (tab or window switch, full-screen exit) gives a 10-second return window,
  then the test is submitted. Every exit is counted.
- Server-side clock with a hard end time; answers save automatically; the clock
  pauses during a dropped connection and resumes by itself.
- Questions are sent only once the clock is running. Model answers, rubrics and
  scores never reach the candidate's browser.

**Hiring team (`/admin/`)**
- Accounts with two roles: manager (everything) and panel member (view, grade,
  shortlist). Every sign-in is a named account; sign-in limits and pauses protect
  against guessing.
- Resumes: upload PDFs, parse emails and names with AI (in parallel), fix an email
  by hand, assign colleges.
- Question bank: add, bulk-import (JSON), edit marks, enable/disable, soft delete
  and restore, and mark questions **Every candidate** (always in the set; the rest
  are drawn by least-used rotation, so the bank is used evenly).
- Assessment length: questions and minutes per part (writers) or per question type
  (support), applied to candidates who start after the change. Open and close the
  test.
- Candidates dashboard: status, scores, **tab-switch counts**, filters and sorting;
  Resume (same questions and answers, fresh clock), Retake (new questions), Force
  submit, **Revoke access** (optionally also marking the candidate Rejected),
  Restore access, Shortlist, Reject, Delete.
- Grading: AI marks each answer as a whole with reasons and deductions (writers:
  against the author's model answer and marking guidance; copied question text
  earns nothing). On Part 2 of the writers test, an AI-likelihood estimate is shown
  to the panel only and never changes marks.
- **Manual marks**: managers can change one answer's marks or a candidate's final
  total, with a reason. The AI's marks stay visible, the manual mark counts
  everywhere, and grading again never overwrites it.
- Integrity flags, an activity log of every admin action, CSV exports (summary and
  full detail), and interview guides built from each candidate's resume and answers
  (support).

## Technology stack

- **Runtime:** Cloudflare Workers (TypeScript), one Worker per site.
- **Data:** Cloudflare D1 (SQLite) and R2 (resume PDFs).
- **Frontend:** plain HTML, CSS and JavaScript served as Worker static assets; no
  framework or bundler.
- **AI:** OpenAI Chat Completions (default model `gpt-4o-mini`, set in `wrangler.toml`),
  called only from the Worker. PDF text extraction with `unpdf`.
- **Tooling:** Wrangler 4, TypeScript 5, Vitest 3 with `@cloudflare/vitest-pool-workers`
  (tests run in the real Workers runtime), Playwright for browser checks.

## How it is built

One Cloudflare Worker per site:

- **Workers**: all API logic and every OpenAI call (the key never reaches a browser).
- **D1** (SQLite): candidates, questions, answers, sessions, settings, audit log.
- **R2**: resume PDFs.
- **Static assets** served by the same Worker (plain HTML, CSS and JS, no framework).
  The writers site's files are built into `dist-docs/` by
  `scripts/build-writers-assets.mjs`.

```
src/index.ts                 entry: security headers, Origin guard, rate limits, routing, cron
src/routes/admin.ts          /api/admin/* (shared by both sites)
src/routes/admin-docs.ts     writers-only admin routes (two-part test, grading, export)
src/routes/candidate.ts      /api/candidate/* for the support test
src/routes/candidate-docs.ts /api/candidate/* for the writers test
src/lib/                     auth, sessions, roles, timer, randomization, scoring,
                             OpenAI calls, resume parsing, rate limits, site config
public/                      candidate page and admin dashboard (support)
writers/index.html           the writers' candidate page
migrations/, migrations-docs/  D1 migrations for each site's database
test/, test-limits/          Worker tests (vitest + @cloudflare/vitest-pool-workers)
scripts/                     browser smoke tests, schema checks, question-bank tools
docs/                        site guide, version control, data design, security audit
```

## Prerequisites

- **Node.js 22** or later (required by Wrangler 4) and npm.
- A **Cloudflare account** with Workers, D1 and R2, for deploying. Local
  development needs no account: Wrangler simulates D1 and R2 on your machine.
- An **OpenAI API key** to use resume parsing and grading. Everything else runs
  without one.

## Setup

```bash
npm ci --legacy-peer-deps                 # see "Known limitations" for the flag
cp .env.example .dev.vars                 # support site: local secrets
cp .env.example .dev.vars.docs            # writers site: local secrets
npm run db:migrate:local                  # support database (local)
npm run db:migrate:local:docs             # writers database (local)
```

## Environment variables

Secrets are never stored in the repository. Locally they go in the git-ignored
`.dev.vars` (support) and `.dev.vars.docs` (writers); in production they are set
with `npx wrangler secret put <NAME>` (add `--env docs` for the writers site).
`.env.example` lists them with placeholder values:

| Name | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | yes | OpenAI key, used on the server only (resume parsing, grading, interview questions). |
| `SESSION_SECRET` | yes | Signs session cookies. A long random string (`openssl rand -hex 32`), different per environment. |
| `ADMIN_PASSWORD` | yes | With `ADMIN_EMAIL`, creates the first manager account and stays its recovery password. |
| `PANEL_PASSWORD` | no | With `PANEL_EMAIL`, a shared panel-member sign-in (support). Empty = named accounts only. |
| `OPENAI_BASE_URL` | no | Local testing only: send OpenAI calls to a local stand-in. Unset in production and when running tests. |

Non-secret settings live in `wrangler.toml` (`[vars]` for support, `[env.docs.vars]`
for writers): `ADMIN_EMAIL`, `PANEL_EMAIL`, `OPENAI_MODEL`, default question counts,
marks and durations, data retention days, grading and parsing concurrency. Most of
the assessment settings can also be changed by a manager in the admin.

## Run it locally

```bash
npm run dev                                               # support site: http://127.0.0.1:8787
npm run dev:docs -- --port 8788 --inspector-port 9331     # writers site, alongside it
```

Open `/` for the candidate page and `/admin/` for the admin. Sign in with
`ADMIN_EMAIL` from `wrangler.toml` and the `ADMIN_PASSWORD` from your `.dev.vars`.
Candidates can sign in only after their resume is uploaded (or a candidate row is
added to the local database). For local grading without an OpenAI key, point
`OPENAI_BASE_URL` at a small local stand-in (see `docs/WRITERS-SITE.md`, "Local
testing").

## Tests and checks

```bash
npm run typecheck      # TypeScript, no emit
npm test               # security-header check + all Worker tests (vitest, real Workers runtime)
npm run test:limits    # D1 statements per request stay inside the Workers Free plan limits
npm run e2e            # Playwright, support site (starts its own local server; needs
                       # `npx playwright install chromium` or PW_CHROMIUM_PATH)
```

Browser checks against a running local site: `scripts/support-smoke.mjs` (support)
and `scripts/writers-parity-check.mjs` (writers). Each file's header says how to run it.
There is no separate linter or formatter configured; the code follows the existing
style (2-space indent, single quotes, semicolons).

## Build

There is no separate build for the support site: `wrangler deploy` bundles the Worker
and uploads `public/`. The writers site runs `scripts/build-writers-assets.mjs` first
(configured in `wrangler.toml`), which copies `public/` into `dist-docs/` with the
writers' candidate page. To check both builds without deploying:

```bash
npx wrangler deploy --dry-run --outdir /tmp/talo-build
npx wrangler deploy --env docs --dry-run --outdir /tmp/talo-build-docs
```

## Deploy

Deploys run from `main` in your own terminal, logged in with `npx wrangler login`.
First time only: create each site's D1 database and R2 bucket (`npx wrangler d1 create`,
`npx wrangler r2 bucket create`), put the database ids in `wrangler.toml`, and set the
secrets with `npx wrangler secret put <NAME>` (plus `--env docs` for the writers site).
Then, for each release:

```bash
npx wrangler d1 migrations apply campus-hiring-assessment-db --remote   # support
npx wrangler d1 migrations apply talo-docs-db --remote --env docs        # writers
npx wrangler deploy                 # support site
npx wrangler deploy --env docs      # writers site
```

Some columns are added at runtime by the Worker (never in a migration); see
`docs/VERSION-CONTROL.md` for the list and for branches, tags and rollback.

## Known limitations

- **Install needs `--legacy-peer-deps`:** `@cloudflare/vitest-pool-workers` 0.8 declares
  Vitest up to 3.1 while the project uses 3.2. Tests run correctly; `npm ls` reports the
  peer ranges as invalid.
- **Candidates sign in with their email only** (no one-time code). Once a test starts,
  only that browser can continue it, but someone who knows a candidate's email could
  start first.
- **AI grading can be wrong.** Panels should review the marks; managers can correct
  them with manual marks.
- **Resumes must be PDFs** with selectable text (no scanned images, no .docx).
- **Part 3 (debugging questions)** exists in the database and grading code of the
  support site but has no candidate screens; it is not part of the current test.
- **One e2e spec is out of date:** `e2e/part1-gate.spec.ts` expects questions to load
  before the test starts, which the server stopped allowing in the October security
  audit. The other e2e specs pass.
- **Keep this repository private.** It contains the support test's question bank
  with answer keys (`scripts/`, `src/lib/part3bank.ts`, and on the `v2` branch).

## Documentation

- `docs/WRITERS-SITE.md`: the writers site, question bank format, local testing.
- `docs/VERSION-CONTROL.md`: branches, releases, migrations, deploying.
- `docs/WRITERS-DATA-DESIGN.md`: data model of the writers site.
- `docs/security-audit/`: security audit reports and fixes (run 1, and run 2 covering release 1.5).

## Branches

- `main`: production, both sites (release `v1.5.1`).
- `v2`: an earlier full rebuild of the support site. It is **not deployed** and does
  not include the writers site or the work since 20 Oct 2026; kept for reference.
