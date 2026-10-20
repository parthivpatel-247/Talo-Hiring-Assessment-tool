# Talo v2: deploy, migrate and operate

Everything here runs in **your own terminal**, logged in to Cloudflare with
`npx wrangler login`. Secrets are typed into Wrangler's prompt and never go into
a file, a chat or this repository.

Production today: Worker `talo` at https://talo.hevo-talo.workers.dev, D1 database
`campus-hiring-assessment-db`, R2 bucket `campus-hiring-resumes`.

---

## 1. Before you deploy (10 minutes)

1. **Pick a quiet time.** Deploy when no drive is running. v2 uses new session
   cookies, so anyone signed in to v1 is signed out.
2. **Install and test locally.**
   ```bash
   npm ci --legacy-peer-deps
   npm test            # 59 Worker tests in the real runtime
   npm run e2e         # browser tour: setup → drive → resume → exam → grading → export
   ```
3. **Take two backups of the live database.**
   ```bash
   # a) A SQL dump you keep on your machine
   npx wrangler d1 export campus-hiring-assessment-db --remote --output=talo-pre-v2.sql
   # b) Note the Time Travel bookmark for "right now" (restore point)
   npx wrangler d1 time-travel info campus-hiring-assessment-db
   ```
   Keep the dump private: it contains candidate data.

## 2. Secrets and settings

| Name | Where | Needed? | Notes |
|---|---|---|---|
| `SESSION_SECRET` | secret | yes (already set) | Keep the existing value. |
| `OPENAI_API_KEY` | secret | yes (already set) | Resume reading, grading, rubrics, interview prep. |
| `ADMIN_PASSWORD` | secret | first run only | Used once, with `ADMIN_EMAIL`, to create the first manager. After that it does nothing. |
| `PANEL_PASSWORD` | secret | **no longer used** | Remove it: `npx wrangler secret delete PANEL_PASSWORD` |
| `EMAIL_PROVIDER`, `EMAIL_FROM` | `wrangler.toml` `[vars]` | to enable email | `"resend"` or `"sendgrid"`, and a sender on a verified domain, e.g. `"Hevo Campus Hiring <campus@hevodata.com>"`. |
| `EMAIL_API_KEY` | secret | to enable email | `npx wrangler secret put EMAIL_API_KEY` |
| `TURNSTILE_SITE_KEY` | `wrangler.toml` `[vars]` | optional | Cloudflare Turnstile widget key. |
| `TURNSTILE_SECRET` | secret | optional | `npx wrangler secret put TURNSTILE_SECRET` |

Email is what turns on: admin two-step sign-in codes, emailed invites with a
personal code, password reset links, and the "email code" student sign-in mode.
Without it, everything else works and the Overview checklist says what is off.

## 3. Deploy

```bash
npx wrangler deploy
```

The first request after deploy upgrades the database **automatically and atomically**:

1. A full copy of every v1 table is written to R2 (`backups/pre-migration-v1-….json`,
   with password hashes redacted).
2. In one D1 batch, the v1 tables are renamed, the v2 tables and 33 indexes are
   created, the data is copied across, and the v1 tables are dropped. If anything
   fails, the batch rolls back and v1 data is untouched (the site shows "being
   updated" until it is fixed).
3. The question bank gets the 178 bundled questions (existing questions, and any
   edits you made to them, are never overwritten).

Check it worked:
```bash
curl -s https://talo.hevo-talo.workers.dev/api/health
npx wrangler d1 execute campus-hiring-assessment-db --remote \
  --command "SELECT key, value FROM schema_meta; SELECT category, COUNT(*) FROM questions GROUP BY category;"
```

## 4. First sign-in

1. Open https://talo.hevo-talo.workers.dev/admin/
2. If v1 already had a **manager** account, sign in with it. Otherwise sign in with
   `ADMIN_EMAIL` (parthiv.patel@hevodata.com) and the `ADMIN_PASSWORD` secret: Talo asks
   for your name and a new password and creates the first manager. From then on the
   setup password stops working.
3. Settings → Team: add the panel (managers or panel members). With email set up they
   get an invite link; without it, set a temporary password and share it privately.
4. Settings → Data & privacy → Test data: delete the load-test and demo records.
5. Overview → Setup checklist: work through anything amber.

## 5. Before each drive

1. **Drives & colleges → New drive** (college, date). Note the hall code.
2. **Add resumes**: pick the drive, drop the PDFs. Fix anything in **Needs details**
   from the resume (Candidates → open → Fix details).
3. Existing v1 candidates have no drive: select them on Candidates → More → **Move to drive**.
4. Optional, stronger identity: select the candidates → More → **Generate personal codes**
   (print the slips) or **Email invite + code**. Once a student has a personal code,
   only that code works for them.
5. Question bank: check **Pool health** is green for every paper slot.

## 6. On the day

1. Drives → ⋯ → **Set live**. Students can sign in and read the rules before this,
   but nobody can start or see a question until the drive is live.
2. ⋯ → **Show code on projector**, or read the hall code out.
3. Watch **Overview → Live now** and **Candidates** (it refreshes every minute).
4. Problems:
   - *Laptop crashed / page reloaded*: Candidates → ⋯ → **Resume test** (same questions,
     saved answers, the time they had left).
   - *Wrong paper or unfair interruption*: **Give a retake** (new questions, full clock).
   - *Locked out after wrong codes*: issue a personal code (Generate personal codes), or
     wait 10 minutes.
5. After the last student: ⋯ → **Close drive**.

## 7. After the drive

1. **Grading & exports → Grade all submitted.** Keep the tab open; it grades in batches.
2. **Integrity → Check for similar answers.** Review signals in context.
3. Candidates: select → **Shortlist / Reject** (interview questions are prepared for
   shortlists of up to 10 at a time; open a candidate → Interview for more).
4. **Grading & exports → New export** (Excel, versioned). Share only with the panel.

## 8. Backups and recovery

- **Daily** at 03:00 UTC: a full snapshot to R2 (Settings → Data & privacy → Backups).
- **Every deletion** (single, bulk, test data, delete-all) writes a restorable backup
  first, including resume copies. Restore from the Backups list.
- **Whole database**: D1 Time Travel restores to any minute in the retention window
  (7 days on Workers Free, 30 days on Workers Paid):
  ```bash
  npx wrangler d1 time-travel restore campus-hiring-assessment-db --timestamp=<ISO time or bookmark>
  ```
- Everything with personal data (candidates, resumes, exports, backups) expires after
  the retention period in Settings (default 15 days).

## 9. Rolling back v2

The upgrade drops the v1 tables, so v1 code cannot run on the upgraded database.
To go back: restore D1 to the bookmark from step 1 (`wrangler d1 time-travel restore …
--bookmark=<bookmark>`), then deploy the v1 code (`git checkout <v1 tag> && npx wrangler deploy`).
Anything done in v2 after the upgrade is lost, so roll back only right after deploying.

## 10. If something looks wrong

- **Workers Logs**: Cloudflare dashboard → Workers → talo → Logs (every error has a request id
  that the user also sees).
- **Browser errors**: Settings → Data & privacy → Browser errors.
- **Database use**: Settings → Usage (rows read and written per route, per day).
- **Locked-out admin**: another manager → Settings → Team → ⋯ → Unlock, or Set a temporary password.
- **All managers locked out or deactivated**: reactivate one directly:
  ```bash
  npx wrangler d1 execute campus-hiring-assessment-db --remote \
    --command "UPDATE admin_users SET active = 1, locked_until = NULL, failed_logins = 0 WHERE email = '<manager email>'"
  ```
