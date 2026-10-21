# Talo security audit — run 1 (quick profile)

## 1. Run

| Item | Value |
|---|---|
| Method | Cloudflare `security-audit` skill, **quick** profile (a bounded first pass, not a full audit) |
| Target | talo repository (support site `talo` and writers site `talo-docs`, one Worker source) |
| Source ref audited | `d08390bf2f8acb8283d78bab3550557a781f2965` (clean worktree) |
| Budget | 24 agents; 12 spent (4 reconnaissance, 4 hunters, 1 final critic, 3 verifiers) |
| Execution | Source-only for every audit agent. No OS-enforced sandbox was available, so no agent ran target code; decisive behavioural facts were left as `needs_validation` with a local plan |
| Prior runs | None (run 1) |
| Coverage | 19 ledger units: 14 covered, 3 candidate, 2 deferred by the final critic (quick profile allows no second wave) |
| Excluded companions | Memory safety (no native code), RPC/messaging (none), desktop/mobile IPC (none) |

**After the run** (outside the audit agents' boundary): the owner-side local plan for each lead was run as a vitest case in the repository. All three reproduced. They were fixed with regression tests. The two deferred units were then reviewed by separate follow-up reviewers, and every real defect they found was fixed and tested. A final adversarial review of the fix diff found 2 regressions, fixed before release. Fixes: commits `3a10927` and `2784b16` on branch `audit-round-4`.

## 2. Posture

The core boundaries hold in source:
- per-candidate data scoping and question ownership;
- the server-enforced timed test;
- manager vs panel-member gating;
- CSRF (Origin guard plus explicit SameSite);
- escaping of every DOM sink and the CSP;
- parameterised SQL;
- a single-registry, integrity-pinned lockfile.

The weaknesses were in **state over time**: sessions that outlive credential rotation, races between overlapping requests, and admin actions that change an attempt while other work is in flight.

## 3. Confirmed findings

None in `findings.json`. In this run no record could reach `confirmed` under the skill's rules, because no sandboxed execution was available. The three leads below were reproduced afterwards by the owner-side local plans (section 5).

## 4. NEEDS VALIDATION (as recorded by the run)

| Lead | Trace | Blocker | Local step | Owner check |
|---|---|---|---|---|
| Overlapping prepare/start on the support site can assign two Part 1 sets | `candidate.ts:144` → `randomize.ts:32` (check) → `:62` (plain INSERT batch) → `candidate.ts:173` | Whether requests interleave against D1 needed execution | 8 parallel `prepare` calls × 15 rounds, then count rows per candidate | `SELECT candidate_id, COUNT(*) n, COUNT(DISTINCT position) p FROM part1_assignments GROUP BY candidate_id HAVING n > 5 OR p < n` |
| Bootstrap (config) admin sessions survive `ADMIN_PASSWORD`/`PANEL_PASSWORD` rotation | `admin.ts:254` → `auth.ts:159` → `auth.ts:195` | Accepted-after-rotation needed execution | Rotate the password in a test env, reuse the old cookie | Count live `admin_sessions WHERE user_id IS NULL` |
| Anonymous traffic can drain the account's daily Workers request / D1 write allowance; all ceilings are per network | `index.ts:27` → `ratelimit.ts:338/291/179` → `countStmt` | Cloudflare plan and any edge rule are deployment facts | 1,000 unknown-email sign-ins over 5 IPv6 /64s, count `rate_limits` rows | Check the plan (Free or Paid) and any WAF rule in front of both Workers |

## 5. What happened to each lead after the run

1. **Duplicate Part 1 sets: reproduced (15 rows = 3 sets for one candidate) and fixed.**
   - Each position is now inserted only if it is free (`INSERT OR IGNORE … WHERE NOT EXISTS`), as the writers path already did.
   - New support migration `0017_assignment_position_unique.sql` adds `UNIQUE(candidate_id, position)`.
   - Book-keeping counts only the rows that were kept.
   - Regression test: `test/audit-round4.test.ts` "overlapping prepare/start…".
2. **Bootstrap sessions after rotation: reproduced (200 as manager) and fixed.**
   - A bootstrap token now carries `bc`, a keyed tag of the email and password that issued it. `getAdminRole` recomputes the tag on every request.
   - Changing or blanking the credential ends those sessions at once.
   - Tokens also carry a random nonce. Signing in ends that browser's previous session.
   - Config passwords are compared as SHA-256 digests, so their length does not leak through timing.
3. **Daily allowance drain: partly fixed in code, rest is the owner's.**
   - The D1-writing sign-in counters now group IPv6 by **/48**, so one routed block can't create thousands of fresh budgets (reproduced: 50 different /64s previously got 50 budgets).
   - The request allowance can only be protected at the edge: Workers Paid, or a WAF rate-limit rule on `/api/candidate/login` and `/api/admin/login`.

## 6. Follow-up review of the deferred units: fixed

**Grading and lifecycle (both sites):**
- every per-answer score write now requires the grading claim, so a grader still running after a Retake or Resume can't recreate or overwrite rows;
- Shortlist and Reject apply only to graded candidates (and the menu shows them only then);
- Analyze keeps a shortlist made while grading;
- Manual fix no longer resets a finished candidate;
- the stale sweeps use each attempt's own deadline, so shortening the duration mid-drive can't close running tests;
- writers Resume reopens a Part 1 closed by its deadline;
- Grade-now checks "finished" inside the claim;
- the interview guide is dropped if a new attempt starts while it is being written;
- editing an answer or using Resume clears stale marks;
- support Retake also clears legacy Part 2 questions;
- Revoke runs as one transaction.

**One browser per sitting:**
- Candidate tokens carry a random `sid`, and starting a part binds it to that sign-in.
- Every other browser gets 401 `other_session`, and the page explains why.
- Resume, Retake, Restore access and email fixes void older sign-ins.
- Writers `part2/submit` needs a started test.

**Release review (2 fixed):**
- Support's final save at time-up now lands: it is stored before the clock moves.
- Restore access on a candidate who is mid-test no longer strands them.

## 7. Hardening applied

- strict token shape (exactly `body.signature`);
- generic OpenAI errors to the admin page (details logged server-side);
- `OPENAI_BASE_URL` honoured only for https or local addresses;
- resume-parse output coerced to a safe shape, and malformed stored JSON tolerated;
- the interview prompt quotes answers inside a random boundary;
- resume files are never orphaned:
  - upload rollback;
  - delete stops if R2 fails;
  - purge postpones;
- rate-limit hashing fails closed without `SESSION_SECRET`;
- HSTS header;
- support saves advance the clock.

**Not changed (accepted, owner notes):**
- the Origin guard allows a missing Origin (the explicit SameSite=Lax covers it);
- `GET analysis/status` runs the stale sweep;
- the 90-day trusted-device cookie can't be revoked on a password reset (it only affects sign-in limits);
- panel members can read the `member_add` audit detail;
- `loadtest/prod-seed-100.sql` must always be followed by `prod-cleanup.sql`.

## 8. Positive patterns

- Conditional `INSERT … SELECT … WHERE EXISTS` for time-bound writes.
- Claim tokens for parse and grade work.
- Constant-time HMAC verification.
- PBKDF2 for named accounts.
- The PDF magic-byte check and server-generated R2 keys.
- CSV formula neutralisation.
- CSP with hashed inline scripts, checked at build time.
- Set-based retention purge.

## 9. Tests after the fixes

| Check | Result |
|---|---|
| Unit tests (`npm test`, includes 27 new in `test/audit-round4.test.ts`) | 228/228 |
| Limits tests | 9/9 |
| Deploy dry runs (both sites) | pass |
| Writers UI audit | 71/71 |
| Writers parity | 17/17 |
| 429 checks | 13/13 (writers), 12/12 (support) |
| New support browser smoke (`scripts/support-smoke.mjs`) | 18/18 |
