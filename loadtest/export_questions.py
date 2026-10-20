#!/usr/bin/env python3
"""
Talo — export the complete question bank to CSV.

Logs in as admin and pulls every question from the live deployment (all fields,
including the admin-only reference answer, rubric and marking checkpoints), then
writes them to a CSV you can open in Excel / Google Sheets.

By default it exports the LIVE bank. Add --include-deleted to also append the
soft-deleted bin (the "deleted" column marks which is which).

--------------------------------------------------------------------------------
RUN IT FROM YOUR OWN MACHINE:

    pip install requests

    export TALO_BASE_URL="https://talo.hevo-talo.workers.dev"
    export TALO_ADMIN_EMAIL="you@hevodata.com"
    export TALO_ADMIN_PASSWORD="your-admin-password"

    python3 loadtest/export_questions.py
    # -> writes question_bank.csv in the current folder

Flags:
    --out FILE           output path (default question_bank.csv)
    --include-deleted    also include soft-deleted questions
    --base-url URL       override TALO_BASE_URL
--------------------------------------------------------------------------------
"""
import argparse
import csv
import os
import sys

try:
    import requests
except ImportError:
    sys.exit("This script needs 'requests'. Install it with:  pip install requests")

# Column order for the CSV — readable first, admin-only grading fields after.
COLUMNS = [
    "id", "category", "difficulty", "marks", "status", "active", "deleted",
    "prompt", "sample_data", "expected_output",
    "reference_answer", "rubric", "checkpoints", "hint", "created_at",
]


def fetch(session, base, deleted=False):
    url = f"{base}/api/admin/questions" + ("?deleted=1" if deleted else "")
    r = session.get(url, timeout=120)
    if r.status_code != 200:
        sys.exit(f"ERROR: could not fetch questions ({r.status_code}): {r.text[:200]}")
    return r.json().get("questions", [])


def main():
    ap = argparse.ArgumentParser(description="Export the Talo question bank to CSV")
    ap.add_argument("--out", default="question_bank.csv")
    ap.add_argument("--include-deleted", action="store_true")
    ap.add_argument("--base-url", default=os.environ.get("TALO_BASE_URL", ""))
    args = ap.parse_args()

    base = (args.base_url or os.environ.get("TALO_BASE_URL") or "").rstrip("/")
    email = os.environ.get("TALO_ADMIN_EMAIL", "")
    pw = os.environ.get("TALO_ADMIN_PASSWORD", "")
    if not base:
        sys.exit("ERROR: set TALO_BASE_URL (or pass --base-url)")
    if not email or not pw:
        sys.exit("ERROR: set TALO_ADMIN_EMAIL and TALO_ADMIN_PASSWORD in your environment")

    s = requests.Session()
    r = s.post(f"{base}/api/admin/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"ERROR: admin login failed ({r.status_code}): {r.text[:200]}")

    live = fetch(s, base, deleted=False)
    for q in live:
        q["deleted"] = ""  # live rows
    rows = list(live)

    if args.include_deleted:
        binned = fetch(s, base, deleted=True)
        for q in binned:
            q["deleted"] = "deleted"
        rows += binned

    # Write CSV (csv handles quoting of multi-line prompts/answers safely).
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        for q in rows:
            w.writerow({c: ("" if q.get(c) is None else q.get(c)) for c in COLUMNS})

    # Small summary.
    from collections import Counter
    by_cat = Counter(q.get("category") for q in rows)
    print(f"Wrote {len(rows)} question(s) to {args.out}")
    print("By category: " + ", ".join(f"{k}={v}" for k, v in sorted(by_cat.items())))
    if not args.include_deleted:
        print("(live bank only — add --include-deleted to also include the deleted bin)")


if __name__ == "__main__":
    main()
