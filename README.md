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

## Run it locally

```bash
npm ci --legacy-peer-deps
cp .dev.vars.example .dev.vars            # support site; fill in local values
cp .dev.vars.example .dev.vars.docs       # writers site
npx wrangler d1 migrations apply campus-hiring-assessment-db --local
npx wrangler d1 migrations apply talo-docs-db --local --env docs
npm run dev          # support site on http://127.0.0.1:8787
npm run dev:docs -- --port 8788 --inspector-port 9331   # writers site, alongside
```

`.dev.vars*` files are git-ignored and never committed. For local grading without
an OpenAI key, point `OPENAI_BASE_URL` at a small local stand-in (see
`docs/WRITERS-SITE.md`, "Local testing").

## Tests

```bash
npm test               # security-header check + all Worker tests
npm run test:limits    # D1 statement budgets per request (Workers Free plan limits)
```

Browser checks against a local dev server: `scripts/support-smoke.mjs` (support) and
`scripts/writers-parity-check.mjs` (writers). Each file's header says how to run it.

## Deploy

Deploys run from `main` in your own terminal, logged in with `npx wrangler login`.
Secrets are set with `npx wrangler secret put <NAME>` and never go into a file or the
repository: `OPENAI_API_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD` (plus `--env docs` for
the writers site).

```bash
npx wrangler d1 migrations apply campus-hiring-assessment-db --remote   # support
npx wrangler d1 migrations apply talo-docs-db --remote --env docs        # writers
npx wrangler deploy                 # support site
npx wrangler deploy --env docs      # writers site
```

Some columns are added at runtime by the Worker (never in a migration); see
`docs/VERSION-CONTROL.md` for the list and for branches, tags and rollback.

## Documentation

- `docs/WRITERS-SITE.md`: the writers site, question bank format, local testing.
- `docs/VERSION-CONTROL.md`: branches, releases, migrations, deploying.
- `docs/WRITERS-DATA-DESIGN.md`: data model of the writers site.
- `docs/security-audit/`: the security audit report and fixes.

## Branches

- `main`: production, both sites (release `v1.5`).
- `v2`: an earlier full rebuild of the support site. It is **not deployed** and does
  not include the writers site or the work since 20 Oct 2026; kept for reference.
