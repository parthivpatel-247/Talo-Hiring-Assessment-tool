#!/usr/bin/env bash
# Fresh local Worker + the end-to-end tour. Usage: bash scripts/tour.sh <screenshot-dir>
cd "$(dirname "$0")/.."
pkill -f "wrangler dev" 2>/dev/null; pkill -f workerd 2>/dev/null; sleep 1
(setsid nohup bash e2e/serve.sh > "${1:-tour-shots}.log" 2>&1 < /dev/null &)
for i in $(seq 1 60); do sleep 1; curl -sf http://127.0.0.1:8787/api/health >/dev/null && break; done
rm -rf "${1:-tour-shots}"
timeout 400 node scripts/e2e-tour.mjs "${1:-tour-shots}"
