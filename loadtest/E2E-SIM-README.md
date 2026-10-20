# End-to-end simulator — `e2e_sim.py`

Drives the **whole pipeline** against a live Talo deployment, exactly as real
students and the admin would, over the public HTTP API:

1. Admin logs in.
2. Generates N synthetic PDF resumes (real text layer, unique name + email each).
3. Uploads them in batches → `POST /api/admin/resumes/upload`.
4. Parses them for real (OpenAI) → `POST /api/admin/resumes/process`, looped.
   - Any resume the AI can't parse is recovered with the admin "fix email"
     endpoint so the run still reaches N test-takers.
5. Each student logs in, starts the test, answers all 5 questions and submits —
   with a configurable **strong / mixed / weak** answer mix so grading has a
   realistic spread. "Strong" answers reuse the bank's reference answers (so they
   grade high); "weak" submit plausible-but-wrong answers.
6. Admin runs grading (OpenAI) → `POST /api/admin/analysis/run`, looped.
7. Prints a summary: parsed, submitted, graded, score min/avg/max + distribution,
   and total wall-clock.
8. **Cleans up** every candidate it created (unless `--no-cleanup`).

> The backend is a **Cloudflare Worker**, not FastAPI — the script just needs the
> public endpoints.

## Run it (from your own machine)

You run this, not the assistant — it needs your admin password, which stays with you.

```bash
pip install requests                      # the only dependency

export TALO_BASE_URL="https://talo.hevo-talo.workers.dev"
export TALO_ADMIN_EMAIL="you@hevodata.com"       # your manager email
export TALO_ADMIN_PASSWORD="your-admin-password" # never commit this

python3 loadtest/e2e_sim.py --count 100
```

That's it. It will create 100 test candidates under the college `ZZ-LOADTEST`,
run them through, print a summary, and delete them again.

### Flags

| Flag | Default | What it does |
|------|---------|--------------|
| `--count N` | 100 | number of students |
| `--concurrency K` | 10 | parallel student sessions during the test phase |
| `--college NAME` | `ZZ-LOADTEST` | the college tag for the test cohort |
| `--strong F` | 0.40 | fraction who ace it (reference answers) |
| `--weak F` | 0.25 | fraction who do badly (the rest are "mixed") |
| `--no-cleanup` | off | keep the test candidates so you can browse them in the portal |
| `--cleanup-only` | off | delete a previous run's candidates (from the state file) and exit |
| `--skip-grading` | off | stop after submissions, don't run analysis |
| `--state FILE` | `loadtest/.e2e_state.json` | where created candidate ids are tracked |
| `--insecure-cookies` | off | **local dev only** — allow the Secure cookie over `http://` |

### Watch them in the portal first

Want to actually see the 100 in the admin UI before they're deleted? Run with
`--no-cleanup`, open the portal, filter by college `ZZ-LOADTEST`, look at scores /
flags / export, then clean up when done:

```bash
python3 loadtest/e2e_sim.py --count 100 --no-cleanup
# ...browse the portal...
python3 loadtest/e2e_sim.py --cleanup-only
```

## Cost note (you're on Enterprise)

A full 100-student run makes real OpenAI calls: ~100 parse calls + ~500 grading
calls (100 students × 5 questions). That's well within Enterprise limits but it is
real usage. Start with a smaller `--count 10` to sanity-check, then scale to 100.

## Safety

- The admin password is read from an env var; it is never stored or hardcoded.
- Cleanup only ever deletes candidates whose ids the script recorded in the state
  file during this (or a prior) run — never any other candidate.
- If the run crashes partway, the created ids are already saved — recover with
  `--cleanup-only`.
- The grading/parse loops have a **no-progress guard**: if a batch can never
  complete (e.g. OpenAI errors), the loop stops after 2 idle rounds instead of
  spinning forever, and tells you how many were left ungraded (re-run analysis
  from the portal to retry them).

## What was validated

Run locally against `wrangler dev` (count 3): admin login, college create, resume
generation, upload, parse call, parse-failure recovery, candidate login, start,
answer, submit, the grading loop's no-progress guard, the summary, and full
cleanup (candidates + test college) all work. The PDF text layer was verified to
extract cleanly with `unpdf` — the exact library the Worker uses to read resumes —
so real parsing works on prod where the OpenAI key is live. (In the build sandbox
the OpenAI calls are blocked, which is why parse/grade only complete on your
machine against prod.)
