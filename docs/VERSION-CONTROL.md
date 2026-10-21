# Branches and deploying

| Branch / tag | What it is | Deploy from it? |
|---|---|---|
| `main` | What runs in production. Small features and fixes for upcoming drives land here. | **Yes** — the only branch that is deployed. |
| `v2` | The full v2 rebuild (new UI, schema v2, security work). Not live yet. | Not until the planned v2 release. |
| `v1-production-2026-10-20` (tag) | Production as it was when version control started. | Rollback point. |

`main` deploys **two separate sites**: the support site (`npx wrangler deploy`) and the
writers / documentation site (`npx wrangler deploy --env docs`, see `docs/WRITERS-SITE.md`).
Each command deploys only its own site.

## Day to day

1. New work for production: branch off `main` (`git switch -c feature/<name> main`), build, test, merge into `main`, deploy from `main`.
2. Keep `v2` current: after each production change, merge `main` into `v2` and resolve any conflicts there, so the v2 release carries every fix.
3. Before deploying, check you are on `main` with a clean tree: `git status` should say "On branch main, nothing to commit".

## Releasing v2 later

The writers site's two-part test is built on v1 (on `main`). v2 does not have it yet, so
before `v2` is merged into `main`, port the writers mode to v2 — or deploy the writers site
from the `writers-v1` tag until the port is done. Deploying `--env docs` from a `main` that
no longer has writers mode would replace the writers' test with the support one.


Follow `docs/RUNBOOK.md` on the `v2` branch (database backup first), then merge `v2` into `main` and deploy from `main`.
