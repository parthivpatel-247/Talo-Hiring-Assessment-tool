# Talo · campus hiring assessment (Hevo Data)

Talo runs Hevo Data's campus hiring drives end to end: upload the shortlisted
resumes, run a proctored written test in the exam hall, grade it against a rubric,
shortlist, prepare interview questions and export the results.

- **Candidates** (`/`): sign in with the email on their resume and the hall code (or a
  personal code), read the rules, and take a timed, full-screen test of SQL, coding,
  data structures and real-world scenarios, answering in any language or pseudocode.
- **Hiring team** (`/admin/`): drives and colleges, resume upload and parsing,
  candidates with bulk actions, question bank, grading, integrity signals, versioned
  Excel/CSV exports, activity log, backups and settings.

One Cloudflare Worker serves everything: the API, the static frontend (with security
headers on every response), D1 (SQLite) for data and R2 for resumes, exports and
backups. No framework, no build step for the frontend.

## Layout

```
src/
  index.ts            request entry: security headers, CSRF guard, routing, errors, usage metering
  router.ts           tiny router with per-route access (public / candidate / admin / manager)
  cron.ts             every 10 min: close expired tests; daily: retention purge, backup, housekeeping
  db/                 schema.ts (v2 tables + indexes), migrate.ts (auto v1→v2 upgrade), seed.ts
  data/question-seed.json   the bundled question bank (178 reviewed questions)
  lib/                sessions, passwords, rate limits, exam clock, grading, email, exports, telemetry
  routes/             candidate.ts, public.ts, admin/*.ts
public/
  index.html          candidate app      assets/js/candidate/{app,exam}.js
  admin/index.html    admin app          assets/js/admin/{app,shared,bulk,drawer}.js + views/*
  privacy/ terms/ 404.html               assets/css/*.css (Hevo tokens, components, pages)
question-bank/        sources and verification scripts for every bundled question
scripts/              build-question-seed.py, e2e-tour.mjs (browser tour), tour.sh, smoke.mjs
test/                 Worker tests (vitest + @cloudflare/vitest-pool-workers)
docs/RUNBOOK.md       deploy, migrate, run a drive, back up and recover
```

## Commands

```bash
npm ci --legacy-peer-deps
npm test                 # Worker tests in the real runtime (D1 + R2 in memory)
npm run e2e              # local Worker + headless Chromium tour, screenshots in e2e-results/
npm run dev              # local Worker on http://127.0.0.1:8787 (uses .dev.vars)
npm run build:questions  # rebuild src/data/question-seed.json from question-bank/
npx wrangler deploy      # see docs/RUNBOOK.md first
```

Local secrets go in `.dev.vars` (git-ignored; see `.dev.vars.example`). Production
secrets are set with `npx wrangler secret put <NAME>` in your own terminal.

## Security model in one paragraph

Admins sign in with individual accounts (PBKDF2 passwords, lockout after 5 failures,
optional emailed 6-digit code, 12-hour sessions with a 2-hour idle timeout, roles
manager / panel member checked on every request). Candidates sign in with email plus a
hall code, a personal code (which then becomes the only code that works for them) or an
emailed one-time code; one device at a time; questions are sent only once the clock is
running, and answer keys, rubrics and scores never reach the candidate's browser. The
exam clock is enforced on the server (every save and heartbeat advances it; a hard
deadline closes the test). All SQL is parameterised, all output is escaped, CSP allows no
inline script or style, cross-site writes are rejected, and every admin action is in the
activity log. See `docs/RUNBOOK.md` and Settings → Integrations for what to configure.
