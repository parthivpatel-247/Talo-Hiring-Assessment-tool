#!/usr/bin/env python3
"""
Talo — FRESH RESET (keep the question bank).

Deletes EVERY candidate on the deployment and everything attached to them —
attempts, Part 1/2/3 answers, assignments, interview questions — AND each
candidate's resume file in R2 storage. It does this through the admin API's
delete endpoint, which is exactly why resumes get cleaned up (a raw SQL wipe
would leave the resume files orphaned in storage).

It does NOT touch: the question bank, colleges, or admin logins.

After this, run the one SQL command printed at the end to clear the activity
log, and your product is empty and ready for a new drive.

--------------------------------------------------------------------------------
RUN IT FROM YOUR OWN MACHINE:

    pip install requests

    export TALO_BASE_URL="https://talo.hevo-talo.workers.dev"
    export TALO_ADMIN_EMAIL="you@hevodata.com"
    export TALO_ADMIN_PASSWORD="your-admin-password"

    # 1) See what WOULD be deleted (no changes made):
    python3 loadtest/reset_fresh.py

    # 2) Actually delete everything (irreversible):
    python3 loadtest/reset_fresh.py --yes

Flags:
    --yes            actually delete (without it, this is a safe dry-run)
    --concurrency K  parallel deletes (default 8)
    --base-url URL   override TALO_BASE_URL
--------------------------------------------------------------------------------
"""
import argparse
import concurrent.futures as cf
import os
import sys
from datetime import datetime

try:
    import requests
except ImportError:
    sys.exit("This script needs 'requests'. Install it with:  pip install requests")


def log(m): print(f"[{datetime.now():%H:%M:%S}] {m}", flush=True)
def die(m): sys.exit(f"ERROR: {m}")


def main():
    ap = argparse.ArgumentParser(description="Talo fresh reset — delete all candidates + resumes (keep questions)")
    ap.add_argument("--yes", action="store_true", help="actually delete (otherwise dry-run)")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--base-url", default=os.environ.get("TALO_BASE_URL", ""))
    args = ap.parse_args()

    base = (args.base_url or os.environ.get("TALO_BASE_URL") or "").rstrip("/")
    email = os.environ.get("TALO_ADMIN_EMAIL", "")
    pw = os.environ.get("TALO_ADMIN_PASSWORD", "")
    if not base:
        die("set TALO_BASE_URL (or pass --base-url)")
    if not email or not pw:
        die("set TALO_ADMIN_EMAIL and TALO_ADMIN_PASSWORD in your environment")

    s = requests.Session()
    r = s.post(f"{base}/api/admin/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        die(f"admin login failed ({r.status_code}): {r.text[:200]}")
    log(f"admin logged in at {base}")

    cands = s.get(f"{base}/api/admin/candidates", timeout=120).json().get("candidates", [])
    n = len(cands)
    if n == 0:
        log("No candidates found — the product is already fresh. (Still clear the audit log below if you like.)")
    else:
        log(f"Found {n} candidate(s). A few: " +
            ", ".join((c.get("name") or c.get("email") or c["id"]) for c in cands[:5]) +
            (" …" if n > 5 else ""))

    if not args.yes:
        print("\nThis was a DRY RUN — nothing was deleted.")
        print(f"To actually delete all {n} candidate(s) and their resumes, re-run with --yes:\n")
        print("    python3 loadtest/reset_fresh.py --yes\n")
        return

    if n:
        log(f"Deleting {n} candidate(s) and their resumes…")
        deleted = [0]
        def rm(c):
            rr = s.delete(f"{base}/api/admin/candidates/{c['id']}", timeout=60)
            return rr.status_code == 200
        with cf.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            for ok in ex.map(rm, cands):
                if ok: deleted[0] += 1
        log(f"Deleted {deleted[0]}/{n} candidates (their answers, attempts, assignments, interview questions and resumes are gone).")
        left = s.get(f"{base}/api/admin/candidates", timeout=120).json().get("candidates", [])
        if left:
            log(f"WARNING: {len(left)} candidate(s) still remain — re-run with --yes to finish.")
        else:
            log("All candidates removed. ✓")

    print("\n================ ONE MORE STEP ================")
    print("Clear the activity/audit log (delete snapshots, logins, flags) so the")
    print("portal shows no history. Run this once:\n")
    print('    npx wrangler d1 execute campus-hiring-assessment-db --remote \\')
    print('      --command "DELETE FROM admin_audit;"\n')
    print("Your question bank, colleges and admin logins are untouched.")
    print("The product is now fresh and ready for a new drive. 🎉")
    print("==============================================\n")


if __name__ == "__main__":
    main()
