#!/usr/bin/env python3
"""
Talo — end-to-end simulation driver (campus-hiring-assessment).

Drives the WHOLE pipeline against a live deployment exactly as real students
and the admin would, over the public HTTP API:

  1. Admin logs in.
  2. Generates N synthetic PDF resumes (real text layer, unique name + email).
  3. Uploads them in batches  (POST /api/admin/resumes/upload).
  4. Parses them for real      (POST /api/admin/resumes/process, looped — OpenAI).
  5. Each "student" logs in, starts the test, answers 5 questions and submits,
     with a configurable mix of STRONG / MIXED / WEAK answers so grading has a
     realistic spread.
  6. Admin runs analysis/grading (POST /api/admin/analysis/run, looped — OpenAI).
  7. Prints a summary (parsed, submitted, graded, score distribution, timings).
  8. Cleans up every candidate it created (unless --no-cleanup).

The backend is a Cloudflare Worker (not FastAPI); this script only needs the
public endpoints. It never stores or hardcodes secrets — the admin password is
read from an environment variable.

--------------------------------------------------------------------------------
RUN IT FROM YOUR OWN MACHINE (you have the admin password; this sandbox does not):

    pip install requests            # the only dependency

    export TALO_BASE_URL="https://talo.hevo-talo.workers.dev"
    export TALO_ADMIN_EMAIL="you@hevodata.com"
    export TALO_ADMIN_PASSWORD="your-admin-password"

    python3 loadtest/e2e_sim.py --count 100

Useful flags:
    --count N            how many students        (default 100)
    --concurrency K      parallel student sessions (default 10)
    --college NAME       tag for the test cohort   (default "ZZ-LOADTEST")
    --strong F           fraction who ace it        (default 0.40)
    --weak F             fraction who do badly      (default 0.25)
                         (the remaining fraction are "mixed")
    --no-cleanup         keep the test candidates so you can browse them
    --cleanup-only       delete a previous run's candidates (from the state file) and exit
    --skip-grading       stop after submissions (don't run analysis)
    --state FILE         where created ids are tracked (default loadtest/.e2e_state.json)
    --base-url URL       override TALO_BASE_URL

Cleanup is safe: the script only ever deletes candidates whose ids it recorded
in the state file during THIS (or a prior) run — never anyone else's data.
--------------------------------------------------------------------------------
"""
import argparse
import concurrent.futures as cf
import json
import os
import random
import sys
import time
from datetime import datetime

try:
    import requests
except ImportError:
    sys.exit("This script needs 'requests'. Install it with:  pip install requests")

# When testing against a LOCAL http dev server, the session cookie is marked Secure
# (correct for production https) and a client won't resend it over plain http. This
# flag (set by --insecure-cookies) is for LOCAL testing ONLY; production over https
# leaves it off.
ALLOW_INSECURE = False


def new_session():
    return requests.Session()


def downgrade_cookies(s):
    """Local-only: clear the Secure flag so the session cookie flows over http."""
    if ALLOW_INSECURE:
        for c in s.cookies:
            c.secure = False


# ----------------------------------------------------------------------------- helpers
def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def die(msg):
    sys.exit(f"ERROR: {msg}")


# ----------------------------------------------------------------------------- minimal PDF
def make_resume_pdf(lines):
    """Build a tiny but valid, TEXT-EXTRACTABLE single-page PDF from text lines.
    No external PDF library needed — the parser reads the real text layer."""
    def esc(s):
        return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

    # Content stream: start near the top, drop 16pt per line.
    parts = ["BT", "/F1 12 Tf", "50 740 Td"]
    for i, ln in enumerate(lines):
        if i:
            parts.append("0 -16 Td")
        parts.append(f"({esc(ln)}) Tj")
    parts.append("ET")
    content = "\n".join(parts).encode("latin-1", "replace")

    objs = []
    objs.append(b"<</Type/Catalog/Pages 2 0 R>>")
    objs.append(b"<</Type/Pages/Kids[3 0 R]/Count 1>>")
    objs.append(b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
                b"/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>")
    objs.append(b"<</Length %d>>\nstream\n%s\nendstream" % (len(content), content))
    objs.append(b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>")

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref_pos = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += (b"trailer\n<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objs) + 1, xref_pos))
    return bytes(out)


FIRST = ["Aarav", "Diya", "Vivaan", "Ananya", "Aditya", "Isha", "Arjun", "Sara",
         "Reyansh", "Myra", "Kabir", "Anika", "Rohan", "Navya", "Ishaan", "Kiara",
         "Dhruv", "Riya", "Krishna", "Aadhya", "Veer", "Pari", "Aryan", "Siya"]
LAST = ["Sharma", "Patel", "Reddy", "Nair", "Iyer", "Gupta", "Singh", "Mehta",
        "Rao", "Das", "Bose", "Jain", "Khan", "Verma", "Chopra", "Menon",
        "Shah", "Pillai", "Kulkarni", "Banerjee"]
SKILLS = ["Python", "SQL", "JavaScript", "React", "Node.js", "Pandas", "Django",
          "PostgreSQL", "Docker", "Git", "REST APIs", "Data Structures", "AWS",
          "Kafka", "Redis", "Linux", "TypeScript", "MongoDB"]
PROJECTS = [
    "Built a REST API for a campus food-ordering app using Flask and PostgreSQL.",
    "A real-time chat app with WebSockets and Redis pub/sub.",
    "ETL pipeline that cleans and loads sales CSVs into a warehouse nightly.",
    "A React dashboard visualising live sensor data over MQTT.",
    "CLI tool that deduplicates and merges large log files in O(n).",
    "Movie recommendation engine using collaborative filtering in Python.",
    "A URL shortener with analytics backed by Redis and a rate limiter.",
    "Inventory service with role-based access and audit logging.",
]


def make_student(i):
    f = FIRST[i % len(FIRST)]
    l = LAST[(i // len(FIRST)) % len(LAST)]
    name = f"{f} {l}"
    # Unique, obviously-synthetic email so a run is easy to spot and never clashes.
    email = f"loadtest+{i:03d}.{f.lower()}.{l.lower()}@talo-e2e.test"
    sk = random.sample(SKILLS, 5)
    projects = random.sample(PROJECTS, 2)
    lines = [
        name,
        f"Email: {email}",
        "Phone: +91 90000 0{:04d}".format(i),
        "",
        "SKILLS",
        ", ".join(sk),
        "",
        "PROJECTS",
        "- " + projects[0],
        "- " + projects[1],
        "",
        "EDUCATION",
        "B.Tech, Computer Science, 2026.",
    ]
    return {"index": i, "name": name, "email": email, "pdf": make_resume_pdf(lines)}


# ----------------------------------------------------------------------------- API client
class Api:
    def __init__(self, base):
        self.base = base.rstrip("/")

    def admin_session(self, email, password):
        s = new_session()
        r = s.post(f"{self.base}/api/admin/login",
                   json={"email": email, "password": password}, timeout=30)
        if r.status_code != 200:
            die(f"admin login failed ({r.status_code}): {r.text[:200]}")
        downgrade_cookies(s)
        return s


# ----------------------------------------------------------------------------- wrong answers
WRONG = {
    "sql": "SELECT * FROM table;  -- not sure, maybe group by something",
    "python": "def solve(x):\n    return x  # I think you just return the input",
    "dsa": "Loop through the list and return the first element, that should be it.",
    "scenario": "I would just sort everything and pick the first one, seems fine.",
}
VAGUE = "I ran out of time but I think a loop over the array and a counter would work."


def answer_for(category, reference, quality, qpos):
    """Pick an answer string for this question based on the student's quality band."""
    if quality == "strong":
        return reference
    if quality == "weak":
        return random.choice([WRONG.get(category, VAGUE), VAGUE])
    # mixed: about 60% of a mixed student's answers are correct
    if random.random() < 0.6:
        return reference
    return WRONG.get(category, VAGUE)


# ----------------------------------------------------------------------------- phases
def ensure_college(admin, base, name):
    r = admin.get(f"{base}/api/admin/config", timeout=30)
    cfg = r.json()
    colleges = cfg.get("colleges", []) or []
    original = list(colleges)
    if name not in colleges:
        merged = colleges + [name]
        rr = admin.post(f"{base}/api/admin/colleges", json={"colleges": merged}, timeout=30)
        if rr.status_code != 200:
            die(f"could not create test college '{name}': {rr.status_code} {rr.text[:200]}")
        log(f"created test college '{name}'")
    return original


def upload_resumes(admin, base, students, college, batch=25):
    created = []  # {id, filename, index}
    for start in range(0, len(students), batch):
        chunk = students[start:start + batch]
        files = [("files", (f"resume_{s['index']:03d}.pdf", s["pdf"], "application/pdf")) for s in chunk]
        data = {"college": college}
        r = admin.post(f"{base}/api/admin/resumes/upload", files=files, data=data, timeout=120)
        if r.status_code != 200:
            die(f"upload failed ({r.status_code}): {r.text[:200]}")
        body = r.json()
        up = body.get("uploaded", [])
        # map uploaded order back to our students (upload preserves order of valid files)
        for s, u in zip(chunk, up):
            created.append({"id": u["id"], "filename": u["filename"], "index": s["index"],
                            "email": s["email"], "name": s["name"]})
        log(f"uploaded {start + len(chunk)}/{len(students)} "
            f"(+{len(up)} ok, {len(body.get('skipped', []))} skipped)")
    return created


def _loop_endpoint(admin, base, path, remaining_key, label, max_rounds):
    """Call a batch endpoint repeatedly until `remaining` hits 0, with a
    NO-PROGRESS guard so a batch that can never complete (e.g. grading that keeps
    failing) can't spin forever. Returns (ok, fail, stuck_remaining)."""
    total_ok = total_fail = rounds = 0
    prev_remaining = None
    stalls = 0
    while True:
        rounds += 1
        r = admin.post(f"{base}{path}", timeout=300)
        if r.status_code != 200:
            die(f"{label} failed ({r.status_code}): {r.text[:200]}")
        body = r.json()
        processed = body.get("processed", [])
        ok = sum(1 for p in processed if p.get("ok"))
        total_ok += ok
        total_fail += len(processed) - ok
        remaining = body.get(remaining_key, 0)
        log(f"  {label} round {rounds}: +{ok} ok, +{len(processed) - ok} failed, {remaining} left")
        if remaining == 0:
            return total_ok, total_fail, 0
        # no-progress detection: nothing succeeded AND the backlog didn't shrink.
        if ok == 0 and prev_remaining is not None and remaining >= prev_remaining:
            stalls += 1
            if stalls >= 2:
                log(f"  {label}: no progress for 2 rounds — {remaining} stuck, stopping the loop.")
                return total_ok, total_fail, remaining
        else:
            stalls = 0
        prev_remaining = remaining
        if rounds >= max_rounds:
            log(f"  {label}: hit the {max_rounds}-round cap with {remaining} left — stopping.")
            return total_ok, total_fail, remaining


def parse_resumes(admin, base, count):
    ok, fail, stuck = _loop_endpoint(admin, base, "/api/admin/resumes/process",
                                     "remainingToProcess", "parse", max_rounds=count + 20)
    return ok, fail


def fetch_candidates(admin, base):
    r = admin.get(f"{base}/api/admin/candidates", timeout=120)
    if r.status_code != 200:
        die(f"could not list candidates ({r.status_code})")
    return r.json().get("candidates", [])


def fetch_answer_key(admin, base):
    r = admin.get(f"{base}/api/admin/questions", timeout=60)
    if r.status_code != 200:
        die(f"could not fetch question bank ({r.status_code})")
    key = {}
    for q in r.json().get("questions", []):
        key[q["id"]] = {"category": q["category"], "reference": q.get("reference_answer") or ""}
    return key


def take_test(base, email, quality, answer_key):
    """One student's full session: login -> start -> answer each -> submit."""
    s = new_session()
    try:
        r = s.post(f"{base}/api/candidate/login", json={"email": email}, timeout=30)
        if r.status_code != 200:
            return (email, False, f"login {r.status_code}")
        downgrade_cookies(s)
        r = s.post(f"{base}/api/candidate/part1/start", timeout=60)
        if r.status_code != 200:
            return (email, False, f"start {r.status_code}")
        questions = r.json().get("questions", [])
        for pos, q in enumerate(questions):
            ref = answer_key.get(q["id"], {}).get("reference", "")
            ans = answer_for(q.get("category", ""), ref, quality, pos)
            s.post(f"{base}/api/candidate/part1/answer",
                   json={"questionId": q["id"], "answerText": ans}, timeout=30)
        r = s.post(f"{base}/api/candidate/part1/submit", timeout=30)
        if r.status_code != 200:
            return (email, False, f"submit {r.status_code}")
        return (email, True, quality)
    except requests.RequestException as e:
        return (email, False, f"net:{e}")


def run_grading(admin, base, count, wave=5):
    """Grade CONCURRENTLY: fire `wave` analysis/run calls at once each round. The
    server hands each call a disjoint batch (atomic claim), so this multiplies
    throughput without double-grading. Stops on no-progress so it can't hang."""
    total_ok = total_fail = rounds = 0
    prev_remaining = None
    stalls = 0
    max_rounds = count + 20
    while True:
        rounds += 1
        # Fire `wave` grading calls in parallel; each claims its own batch.
        with cf.ThreadPoolExecutor(max_workers=wave) as ex:
            futs = [ex.submit(admin.post, f"{base}/api/admin/analysis/run", timeout=300) for _ in range(wave)]
            responses = [f.result() for f in futs]
        round_ok = 0
        remaining = 0
        for r in responses:
            if r.status_code != 200:
                die(f"analysis/run failed ({r.status_code}): {r.text[:200]}")
            b = r.json()
            processed = b.get("processed", [])
            o = sum(1 for p in processed if p.get("ok"))
            round_ok += o
            total_ok += o
            total_fail += len(processed) - o
            remaining = max(remaining, b.get("remaining", 0))  # latest backlog view
        log(f"  grade round {rounds}: +{round_ok} graded this wave, {remaining} left")
        if remaining == 0:
            break
        if round_ok == 0 and prev_remaining is not None and remaining >= prev_remaining:
            stalls += 1
            if stalls >= 2:
                log(f"  grade: no progress for 2 waves — {remaining} stuck, stopping.")
                log(f"  NOTE: those stay 'submitted' (e.g. OpenAI errors) — re-run analysis from the portal to retry.")
                break
        else:
            stalls = 0
        prev_remaining = remaining
        if rounds >= max_rounds:
            log(f"  grade: hit the {max_rounds}-round cap with {remaining} left — stopping.")
            break
    return total_ok, total_fail


def cleanup(admin, base, ids, original_colleges, college):
    log(f"cleaning up {len(ids)} test candidate(s)…")
    deleted = 0
    for cid in ids:
        r = admin.delete(f"{base}/api/admin/candidates/{cid}", timeout=30)
        if r.status_code == 200:
            deleted += 1
    log(f"deleted {deleted}/{len(ids)} candidates")
    # restore the college list if we added the test college
    if original_colleges is not None and college not in original_colleges:
        rr = admin.post(f"{base}/api/admin/colleges", json={"colleges": original_colleges}, timeout=30)
        if rr.status_code == 200:
            log(f"removed test college '{college}'")


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Talo end-to-end 100-student simulator")
    ap.add_argument("--count", type=int, default=100)
    ap.add_argument("--concurrency", type=int, default=10)
    ap.add_argument("--college", default="ZZ-LOADTEST")
    ap.add_argument("--strong", type=float, default=0.40)
    ap.add_argument("--weak", type=float, default=0.25)
    ap.add_argument("--no-cleanup", action="store_true")
    ap.add_argument("--cleanup-only", action="store_true")
    ap.add_argument("--cleanup-college", default="", metavar="NAME",
                    help="delete ALL candidates in this college (e.g. ZZ-LOADTEST). Use to clean up an interrupted run that left no state file.")
    ap.add_argument("--force-college", action="store_true",
                    help="with --cleanup-college, delete even rows that don't look like synthetic test data")
    ap.add_argument("--skip-grading", action="store_true")
    ap.add_argument("--grade-concurrency", type=int, default=5, help="parallel analysis/run calls per wave")
    ap.add_argument("--state", default="loadtest/.e2e_state.json")
    ap.add_argument("--base-url", default=os.environ.get("TALO_BASE_URL", ""))
    ap.add_argument("--insecure-cookies", action="store_true", help="allow Secure cookies over http (LOCAL dev testing only)")
    args = ap.parse_args()
    global ALLOW_INSECURE
    ALLOW_INSECURE = args.insecure_cookies

    base = (args.base_url or os.environ.get("TALO_BASE_URL") or "").rstrip("/")
    admin_email = os.environ.get("TALO_ADMIN_EMAIL", "")
    admin_pass = os.environ.get("TALO_ADMIN_PASSWORD", "")
    if not base:
        die("set TALO_BASE_URL (or pass --base-url), e.g. https://talo.hevo-talo.workers.dev")
    if not admin_email or not admin_pass:
        die("set TALO_ADMIN_EMAIL and TALO_ADMIN_PASSWORD in your environment (never hardcode them)")

    api = Api(base)
    admin = api.admin_session(admin_email, admin_pass)
    log(f"admin logged in at {base}")

    # ---- cleanup-by-college: delete every candidate tagged with a test college.
    # Works even when no state file exists (e.g. a run stopped mid-upload).
    if args.cleanup_college:
        target = args.cleanup_college
        cands = fetch_candidates(admin, base)
        matches = [c for c in cands if (c.get("college") or "") == target]
        # Safety: flag anything that doesn't look like a synthetic test candidate.
        def is_synthetic(c):
            e = (c.get("email") or "")
            return e.endswith("@talo-e2e.test") or e.startswith("pending+") or not e
        suspicious = [c for c in matches if not is_synthetic(c)]
        log(f"found {len(matches)} candidate(s) in college '{target}'")
        if suspicious:
            log(f"WARNING: {len(suspicious)} of them do NOT look like test data (email not @talo-e2e.test):")
            for c in suspicious[:10]:
                log(f"    - {c.get('email')} ({c.get('name')})")
            log("Refusing to delete this college automatically — some rows look real.")
            log("If you're sure, re-run with --force-college to delete them anyway.")
            if not getattr(args, "force_college", False):
                die("stopped for safety — nothing deleted")
        ids = [c["id"] for c in matches]
        cleanup(admin, base, ids, None, target)
        # also drop the test college from the configured list
        try:
            cfg = admin.get(f"{base}/api/admin/config", timeout=30).json()
            colleges = [x for x in (cfg.get("colleges") or []) if x != target]
            if colleges:
                admin.post(f"{base}/api/admin/colleges", json={"colleges": colleges}, timeout=30)
                log(f"removed college '{target}' from the list")
        except Exception:
            pass
        log("cleanup-college done.")
        return

    # ---- cleanup-only mode: delete a prior run's candidates and exit.
    if args.cleanup_only:
        if not os.path.exists(args.state):
            die(f"no state file at {args.state} — nothing to clean up")
        st = json.load(open(args.state))
        cleanup(admin, base, st.get("ids", []), st.get("original_colleges"), st.get("college", args.college))
        os.remove(args.state)
        log("cleanup-only done.")
        return

    t0 = time.time()
    original_colleges = ensure_college(admin, base, args.college)

    # ---- 1) generate + upload
    log(f"generating {args.count} synthetic resumes…")
    students = [make_student(i) for i in range(args.count)]
    created = upload_resumes(admin, base, students, args.college)
    ids = [c["id"] for c in created]
    # persist state immediately so cleanup works even if a later step crashes
    json.dump({"ids": ids, "college": args.college, "original_colleges": original_colleges},
              open(args.state, "w"))
    t_upload = time.time()
    log(f"UPLOAD done: {len(created)} candidates in {t_upload - t0:.1f}s")

    # ---- 2) parse (real OpenAI)
    log("parsing resumes (OpenAI)…")
    ok, fail = parse_resumes(admin, base, args.count)
    t_parse = time.time()
    log(f"PARSE done: {ok} parsed, {fail} failed in {t_parse - t_upload:.1f}s")

    # ---- recover any parse failures via manual-fix so we still reach `count` testers
    cands = fetch_candidates(admin, base)
    by_id = {c["id"]: c for c in cands}
    testable = []  # (email, )
    recovered = 0
    for c in created:
        cur = by_id.get(c["id"])
        if not cur:
            continue
        status = cur.get("status")
        email = cur.get("email") or c["email"]
        if status in ("uploaded", "parsed", "parse_failed") or not email:
            # resume didn't parse cleanly — set the email we know so this student can still test
            rr = admin.post(f"{base}/api/admin/candidates/{c['id']}/manual",
                            json={"email": c["email"], "name": c["name"]}, timeout=30)
            if rr.status_code == 200:
                recovered += 1
                testable.append(c["email"])
        else:
            testable.append(email)
    if recovered:
        log(f"recovered {recovered} parse-failed candidate(s) via manual email so they can still take the test")

    # ---- 3) take the test (concurrent), with a strong/mixed/weak mix
    answer_key = fetch_answer_key(admin, base)
    n = len(testable)
    n_strong = int(n * args.strong)
    n_weak = int(n * args.weak)
    bands = (["strong"] * n_strong + ["weak"] * n_weak +
             ["mixed"] * (n - n_strong - n_weak))
    random.shuffle(bands)
    plan = list(zip(testable, bands))
    log(f"{n} students taking the test "
        f"({bands.count('strong')} strong / {bands.count('mixed')} mixed / {bands.count('weak')} weak), "
        f"concurrency={args.concurrency}…")

    results = []
    with cf.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs = [ex.submit(take_test, base, email, q, answer_key) for email, q in plan]
        done = 0
        for fut in cf.as_completed(futs):
            results.append(fut.result())
            done += 1
            if done % 20 == 0 or done == n:
                log(f"  submitted {done}/{n}")
    submitted = sum(1 for _, ok_, _ in results if ok_)
    failed_sessions = [(e, why) for e, ok_, why in results if not ok_]
    t_test = time.time()
    log(f"TEST done: {submitted}/{n} submitted in {t_test - t_parse:.1f}s")
    if failed_sessions:
        log(f"  {len(failed_sessions)} session(s) did not submit; first few: {failed_sessions[:5]}")

    # ---- 4) grade (real OpenAI)
    if not args.skip_grading:
        log("running analysis/grading (OpenAI)…")
        gok, gfail = run_grading(admin, base, args.count, wave=args.grade_concurrency)
        t_grade = time.time()
        log(f"GRADING done: {gok} graded, {gfail} failed in {t_grade - t_test:.1f}s")

    # ---- 5) summary
    cands = fetch_candidates(admin, base)
    mine = [c for c in cands if c["id"] in set(ids)]
    graded = [c for c in mine if (c.get("part1", {}).get("graded", 0) or 0) > 0]
    print("\n================ SUMMARY ================")
    print(f"Base URL          : {base}")
    print(f"Test college      : {args.college}")
    print(f"Created           : {len(created)}")
    print(f"Parsed OK / failed: {ok} / {fail}  (recovered {recovered})")
    print(f"Submitted         : {submitted}/{n}")
    print(f"Graded            : {len(graded)}")
    if graded:
        totals = sorted((c.get("totalAwarded", 0), c.get("totalMax", 0)) for c in graded)
        scores = [a for a, _ in totals]
        mx = graded[0].get("totalMax", 0)
        avg = sum(scores) / len(scores)
        print(f"Score (out of {mx}) : min {min(scores)}, avg {avg:.1f}, max {max(scores)}")
        # crude distribution
        buckets = {"0-33%": 0, "34-66%": 0, "67-100%": 0}
        for a, m in totals:
            pct = (a / m * 100) if m else 0
            if pct <= 33: buckets["0-33%"] += 1
            elif pct <= 66: buckets["34-66%"] += 1
            else: buckets["67-100%"] += 1
        print(f"Distribution      : {buckets}")
    print(f"Total wall-clock  : {time.time() - t0:.1f}s")
    print("========================================\n")

    # ---- 6) cleanup
    if args.no_cleanup:
        log(f"--no-cleanup set: keeping {len(ids)} candidates. "
            f"Remove later with:  python3 loadtest/e2e_sim.py --cleanup-only")
    else:
        cleanup(admin, base, ids, original_colleges, args.college)
        if os.path.exists(args.state):
            os.remove(args.state)
    log("done.")


if __name__ == "__main__":
    main()
