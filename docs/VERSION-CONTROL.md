# Branches, releases and deploying

| Branch / tag | What it is | Deploy from it? |
|---|---|---|
| `main` | Production: the support site and the writers site, from one codebase. | **Yes**, the only branch that is deployed. |
| `v1.5.1` (tag) | Security audit run 2 fixes on top of v1.5 (29 Oct 2026): see `docs/security-audit/run-2/REPORT.md`. No new migrations. | Deploy this. |
| `v1.5` (tag) | The complete release of 28 Oct 2026: both sites at feature parity, tab-switch counts, manual marks, revoke-and-reject. | Rollback point. |
| `writers-v1` … `writers-v1.4` (tags) | Earlier writers-site releases. | Rollback points for the writers site. |
| `v1-production-2026-10-20` (tag) | Production when version control started. | Rollback point for the support site. |
| `v2` | An earlier full rebuild of the support site only (new screens and database layout). **Not deployed.** It has none of the writers site and none of the work since 20 Oct 2026. Kept for reference. | No. |

`main` deploys **two separate sites**; each command deploys only its own site:

- `npx wrangler deploy`: support (`talo`, database `campus-hiring-assessment-db`).
- `npx wrangler deploy --env docs`: writers (`talo-docs`, database `talo-docs-db`, see `docs/WRITERS-SITE.md`).

## Day to day

1. Branch off `main` (`git switch -c feature/<name> main`), build, run `npm test` and `npm run test:limits`, merge into `main`.
2. Before deploying: `git status` on `main` says "nothing to commit".
3. Apply any new migrations for the site you deploy, then deploy it (commands below).
4. Tag a release you may need to roll back to: `git tag -a v1.6 -m "…"`.

## Migrations

```bash
npx wrangler d1 migrations list  campus-hiring-assessment-db --remote          # support: what is pending
npx wrangler d1 migrations apply campus-hiring-assessment-db --remote
npx wrangler d1 migrations list  talo-docs-db --remote --env docs                # writers
npx wrangler d1 migrations apply talo-docs-db --remote --env docs
```

Support `0017_assignment_position_unique.sql` adds a unique index: run the duplicate
check in its header first. Writers `0019_word_limit_10000.sql` is also applied by the
Worker at runtime, so it is safe before or after a deploy.

**Columns added at runtime** by the Worker (race-safe, once per instance). Never add
these in a migration: the runtime may already have added them, and the migration would
fail with "duplicate column".

- `attempts`: `part1/2_deadline_at`, `part1_reopen_until`, `resumed_at`, `part1_sid`, `part2_sid`, `sessions_valid_after`.
- `admin_sessions.user_id`; `admin_users.email`.
- `candidates`: `parse_claim`, `parse_claimed_at`, `parse_attempts`, `grading_claim`, `grading_claimed_at`,
  `manual_total`, `manual_total_reason`, `manual_total_by`, `manual_total_at`, `status_before_revoke`.
- `part1_answers`, `part2_answers`, `part3_answers`: `manual_score`, `manual_reason`, `manual_by`, `manual_at`.
- `question_bank`: `hint`, `deleted_at`, `checkpoints`, `required`.

## Rolling back

Deploy an earlier tag from a clean checkout, for one site at a time:

```bash
git switch --detach v1.5.1    # or v1.5, writers-v1.4, v1-production-2026-10-20
npx wrangler deploy           # or: npx wrangler deploy --env docs
git switch main
```

Data is not rolled back by a code rollback. For the database, D1 Time Travel restores
a point in time (`npx wrangler d1 time-travel info|restore …`); export a backup first
(`npx wrangler d1 export … --remote --output=backup.sql`) and keep it private.

## Kept out of the repository

- `.dev.vars*` (local secrets), `dist-docs/` (build output).
- Real candidate data, e.g. SQL files with student emails, and the teams' question
  banks with model answers (`question_bank*.csv/sql`, `writers-question-bank.json`).
  These stay on the hiring team's machines; listed in `.gitignore` / `.git/info/exclude`.
