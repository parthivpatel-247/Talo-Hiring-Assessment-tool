#!/usr/bin/env bash
# Local Worker for the browser tests: fresh database and storage every run.
# The v2 schema and the question bank are created on the first request.
set -e
cd "$(dirname "$0")/.."
rm -rf .wrangler/e2e-state
exec npx wrangler dev --local --port 8787 --ip 127.0.0.1 \
  --persist-to .wrangler/e2e-state \
  --env-file e2e/e2e.env \
  --var ADMIN_EMAIL:admin@talo.test --var APP_ORIGIN:http://127.0.0.1:8787 --var ENVIRONMENT:development \
  --var EMAIL_PROVIDER: --var TURNSTILE_SITE_KEY:
