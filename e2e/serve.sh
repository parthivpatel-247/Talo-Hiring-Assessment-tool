#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
rm -rf .wrangler/state/v3/d1 2>/dev/null || true
npx wrangler d1 execute campus-hiring-assessment-db --local --file e2e/seed.sql >/dev/null
exec npx wrangler dev --local --port 8787 --ip 127.0.0.1
