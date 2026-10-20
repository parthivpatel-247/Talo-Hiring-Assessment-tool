#!/usr/bin/env bash
# Run ONE local scenario from a freshly reseeded DB.
# Usage: run-local.sh <SCEN>   e.g. run-local.sh spike
set -u
SCEN="${1:?scenario required}"
cd "$(dirname "$0")/.."
export PATH="/home/claude/.local/bin:$PATH"
DB="campus-hiring-assessment-db"
PORT=8787
OUT="loadtest/results"; mkdir -p "$OUT"

echo "### [$SCEN] pkill any wrangler"
pkill -f "wrangler dev" 2>/dev/null; pkill -f "workerd" 2>/dev/null; sleep 2

echo "### [$SCEN] wipe + reseed (700 fresh candidates)"
rm -rf .wrangler/state
npx wrangler d1 execute "$DB" --local --file loadtest/load-seed.sql >/dev/null 2>&1 || { echo "SEED FAILED"; exit 1; }

echo "### [$SCEN] start wrangler dev"
npx wrangler dev --port $PORT --local >"$OUT/wrangler-$SCEN.log" 2>&1 &
WPID=$!

# wait for ready (max 60s)
for i in $(seq 1 60); do
  if curl -s "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then echo "### [$SCEN] server ready after ${i}s"; break; fi
  sleep 1
done

echo "### [$SCEN] run k6"
k6 run -e BASE_URL="http://127.0.0.1:$PORT" -e MODE=flow -e SCEN="$SCEN" \
  --summary-export "$OUT/summary-$SCEN.json" loadtest/candidate-flow.js 2>&1 | tee "$OUT/k6-$SCEN.txt"

echo "### [$SCEN] stop wrangler"
kill $WPID 2>/dev/null; pkill -f "wrangler dev" 2>/dev/null; pkill -f "workerd" 2>/dev/null; sleep 2
echo "### [$SCEN] done"
