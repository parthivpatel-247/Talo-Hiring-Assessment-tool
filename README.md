# Talo — Campus Hiring Assessment Platform

A two-part technical assessment platform for campus hiring drives: admin uploads
shortlisted resumes, the platform builds an email allowlist and personalized
Part 2 questions from each resume, candidates take a locked-down Part 1
(multiple-choice, auto-graded) and an open-book Part 2 (free-text, AI-scored),
and the admin dashboard shows results and generates interview questions for
whoever gets shortlisted.

Everything runs as a single Cloudflare Worker: Workers (all logic + every
OpenAI call — the key never reaches the browser), D1 (all structured data),
R2 (resume PDFs), and static assets served directly by the Worker (no
separate Pages project needed — this is the modern equivalent of the
original "Pages + Workers" split and means one `wrangler deploy` does
everything).

**Status: built and smoke-tested locally end-to-end** (see "What's been
tested" below). Not yet deployed anywhere — that needs your Cloudflare
account and OpenAI key, per the plan.

## What you need to provide before deploying

1. **An OpenAI API key.** Used for resume parsing, Part 2 question
   generation, Part 2 scoring, and interview-question generation.
2. **A Cloudflare account**, logged into from your own terminal
   (`npx wrangler login`) so your credentials never have to pass through
   this chat.
3. Nothing else — the free `workers.dev` subdomain is fine to start, and the
   code doesn't touch any other Hevo systems.

## First-time setup (run these yourself, in your own terminal)

```bash
npm install
npx wrangler login                      # opens a browser to authorize this machine

# Create the real D1 database and R2 bucket (one-time):
npx wrangler d1 create campus-hiring-assessment-db
# ^ copy the database_id it prints into wrangler.toml's [[d1_databases]] block,
#   replacing REPLACE_WITH_YOUR_D1_DATABASE_ID
npx wrangler r2 bucket create campus-hiring-resumes

# Apply the schema:
npm run db:migrate:remote

# Set secrets (values are never written to any file in this repo):
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET   # any long random string, e.g. `openssl rand -hex 32`

# Deploy:
npm run deploy
```

Wrangler will print the live `*.workers.dev` URL — that's the single link
you share with students, and `<that-url>/admin/` is the admin dashboard.

## Running it locally first (recommended before your first real deploy)

```bash
npm install
npm run db:migrate:local
cp .dev.vars.example .dev.vars   # then fill in a real OPENAI_API_KEY if you want to test AI features locally
npx wrangler dev
```

This runs entirely on your machine against a local D1/R2, so you can safely
test the whole flow — including a real resume upload — before touching your
live account. Note: `.dev.vars` is in `.gitignore` and never committed.

## Adding the real question bank

Two ways, both go through the admin dashboard (`/admin/`):

- **One at a time:** the "Add question" flow (category, prompt, optional
  code snippet, 4 options, correct index).
- **All at once:** paste a JSON blob shaped like `question-bank/*.sample.json`
  into the bulk-import box. Those two files currently hold placeholder
  sample questions only — replace them with the real bank before go-live.

## What's been tested

I ran a full local smoke test end-to-end (login → Part 1 assignment →
grading → timer countdown with real elapsed-time tracking → tab-switch
logging → submit → Part 2 → autosave → submit → admin dashboard → retake →
revoke/unrevoke → resume-format validation → the daily cron purge job) and
everything behaved correctly. The only calls that couldn't be verified here
are the actual OpenAI calls (resume parsing, question generation, scoring,
interview questions) — this sandbox's own network policy blocks outbound
calls to api.openai.com, so I confirmed instead that a failed OpenAI call is
caught and logged per-candidate/per-question without crashing anything else
(you'll see this for real if a call fails after you deploy, e.g. a bad key
or a transient outage — check the admin dashboard for a null score/reasoning
as the signal something needs a second look). Once you have a real key,
that's the one part worth deliberately testing yourself against 2-3 sample
resumes before the real drive.

## Key design decisions worth knowing before you rely on this

- **Part 1 is multiple-choice, not free-response code.** Cloudflare Workers
  has no code-execution sandbox, so there's no way to deterministically run
  and grade arbitrary submitted SQL/Python without wiring in an external
  judge service. Multiple-choice (a scenario or snippet + 4 options) gives
  truly deterministic grading with zero extra infrastructure. If you
  actually want candidates to write and have code executed, say so — that's
  a real (and different) build, not a tweak.
- **No OTP/verification on login**, per your call — anyone who has a
  candidate's email can sit their test as them. Fine for a first internal
  drive; worth revisiting if this becomes higher-stakes.
- **Part 2 questions are generated right after resume upload**, not at
  login — so all 100 students hitting the link at once never triggers 100
  live OpenAI calls at once.
- **Part 2 scoring happens after submit, in the background** (not before the
  candidate sees "submitted") — same reasoning, plus it means Part 2
  submission is never slowed down waiting on OpenAI.
- **Resumes must be PDF.** Same code-execution-sandbox-style constraint —
  reliable `.docx` parsing needs Node/filesystem APIs Workers doesn't have.
  `unpdf` (a real, small, edge-runtime-native library) handles PDF text
  extraction.
- **Admin login is one shared password**, not per-admin accounts. Fine for
  you + your manager; swap for something stronger before opening this to a
  bigger team.
- **Resume processing runs in batches of 20** (the "Parse & generate" button)
  rather than all 100 at once, so one click stays a predictable, bounded
  request instead of a multi-minute one. Click it again to process the next
  batch — the button re-runs until nothing is left in `uploaded` status.

## What's deliberately not built yet

- Per-admin accounts / audit log of who shortlisted whom.
- A UI to edit/delete individual candidates beyond retake/revoke/reject.
- Retry-with-backoff on OpenAI calls (currently: one attempt, log and move
  on if it fails — fine for this scale, worth adding if volume grows).
- Anything to do with GitHub/CI — this is handed to you as files for now,
  per what you said; happy to wire up a repo + deploy pipeline whenever you
  want that.

## Project layout

```
migrations/0001_init.sql   D1 schema
src/index.ts               Worker entry point + router + cron handler
src/routes/admin.ts        Everything behind /api/admin/*
src/routes/candidate.ts    Everything behind /api/candidate/*
src/lib/                   auth, timer, scoring, randomization, OpenAI calls, resume text extraction
public/                    Candidate-facing pages (plain HTML/CSS/JS, no build step)
public/admin/              Admin dashboard
question-bank/*.sample.json  Placeholder Part 1 questions — replace with the real bank
```
