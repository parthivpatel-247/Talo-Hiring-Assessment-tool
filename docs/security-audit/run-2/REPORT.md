# Security audit run 2 — Talo (Cloudflare security-audit skill, 2026-10-29)

## 1. Run

| Item | Value |
|---|---|
| Method | Cloudflare `security-audit` skill, **quick** profile, **scoped**. This is a partial pass, not a full audit. |
| Scope | Everything on `main` that changed since run 1 and its round-4 fixes: source diff `f0badac..51fe9b5` in `src/`, `public/`, `writers/`, `migrations-docs/` and `wrangler.toml` (23 files, +1134/−259). It covers the writers question bank and grading, word limits, every-admin-login-is-an-account, support/writers parity, manual marks, tab-switch counts, revoke-and-reject, and repository readiness. |
| Out of scope | The `v2` branch, which is not deployed. Unchanged code, except where changed code relies on it. |
| Source ref | `51fe9b5c38583427ea891e8e685378efed02512f` (clean worktree) |
| Budget | 14 agents, 11 spent: 4 reconnaissance, 4 hunters, 1 final coverage critic, 2 verifiers |
| Execution | Source only, for every audit agent. No OS-enforced sandbox and no trusted no-follow promotion were available, so no agent ran target code. Decisive behaviour was kept as `needs_validation` with a local plan. |
| Prior runs | Run 1 (quick, ref `d08390b`): all three of its leads were used as current work (§7). |

## 2. Posture

The new code keeps the boundaries run 1 established:
- Manager-only gating covers every new write route on both sites.
- Manual marks are bound to the candidate's own assigned questions, and grading never overwrites them.
- Every new DOM sink escapes its input, and the CSP blocks script injection behind that.
- The new CSV columns cannot carry a formula.
- Candidate text in grading prompts stays inside a random boundary, and model output is clamped to marks.
- The 10,000-word answer cap is bounded.

The two leads are in **account and decision lifecycle**:
- the shared panel credential versus a manager's revocation;
- a revoke-time rejection versus later shortlist/reject decisions.

## 3. Confirmed findings

None. No record could reach `confirmed` in this run, because no sandboxed execution was available.

## 4. NEEDS VALIDATION (as recorded by the run)

| Lead | Trace | Blocker | Local step | Owner check |
|---|---|---|---|---|
| Shared panel password re-enables a panel account a manager disabled, deleted or re-passworded (`talo/auth/panel-config-signin-reactivates-revoked-shared-account`) | `admin.ts:273` → `:285` (active-only lookup) → `:309` (config fallback) → `:154`/`:157-165` (`ensureConfigAccount` reactivates or recreates the row) → `:326` | Product intent not visible in source; whether `PANEL_PASSWORD` is set in production | vitest: disable, delete or re-password the panel row, then sign in with the panel password | Should Access actions lock out holders of the shared password? |
| Revoke with reject lets an ungraded candidate be shortlisted, and Restore access undoes a later rejection (`talo/admin/revoke-reject-status-not-reconciled-with-shortlist-reject-decisions`) | `admin.ts:1634` → `:1593` → `:1639` / `admin-docs.ts:320` → `:1611` | End-to-end status transitions needed execution | vitest: revoke+reject a never-started candidate, then shortlist; revoke+reject an evaluated candidate, then shortlist, reject and restore | — |

## 5. Hardening notes and positive patterns

**Hardening (from hunters):**
- A session from the shared panel password inherits a promoted row's role.
- Reset password unlocked only `u:<id>`, not the `e:<email>` limiter key.
- `ensureConfigAccount` could dereference a null row.
- A writers Resume that reopens only Part 2 also wiped Part 1 marks.
- A revoke could race a test start.
- Pinning, enabling or restoring a question did not recheck saved counts.
- The CSV guard looked only at the first character.
- Unescaped numeric counters in the admin view.
- Word counting and the copy check could be dodged with invisible joiners or restyled letters.
- Writers Part 2 grading used an unbounded `Promise.all`.
- The grader pairs a stored Part 2 prompt with live guidance.
- The whole request body is parsed before the answer is capped.
- Assignment bookkeeping can drift under overlapping calls.

**Positive patterns:**
- Allowlisted `part` before identifier interpolation.
- Ownership joins for every manual mark.
- Claim-guarded grading writes that leave manual marks alone.
- `COALESCE(manual_score, ai_score)` used consistently.
- An escape-first rich renderer.
- Fixed text before free-text CSV cells.
- A per-call random answer boundary.
- Strict typing of the support `required` flag.

## 6. Coverage

| State | Units |
|---|---|
| covered | 6 |
| candidate | 2 (both `needs_validation` after independent verification) |
| deferred | 3 (accepted from the final critic; a quick profile allows no second hunter wave) |
| out_of_scope | 1 (run 1's quota lead: `src/lib/ratelimit.ts` is unchanged, so it stays a deployment check) |

The final critic resolved both run-1 leads that were in scope. It proposed three missing units, recorded as deferred:
1. sign-in limiter keys for config-email rows;
2. writers every-candidate questions in Part 2;
3. writers grading fan-out per invocation.

This is a quick, scoped pass. It makes no claim about unchanged code or the `v2` branch.

## 7. Prior leads

- **Bootstrap sessions surviving credential rotation:** revalidated and **resolved**. The `bc` tag is recomputed for row-bound and legacy config sessions.
- **Duplicate Part 1 sets:** revalidated and **resolved**. Per-position `INSERT OR IGNORE … WHERE NOT EXISTS` plus `UNIQUE(candidate_id, position)` survived the pinned-question change.
- **Per-network ceilings versus the account's daily quota:** out of scope (unchanged code). It remains the owner's deployment check: Workers Paid, or a WAF rate-limit rule on both login routes.

## 8. After the run (outside the audit agents' boundary)

The owner-side local plan for each lead and each deferred unit was run as a vitest case in `test/audit-round5.test.ts`. **Every one reproduced on `51fe9b5` (9 failing cases)** and was fixed with a regression test.

1. **Panel credential, reproduced and fixed.**
   - Disabling, deleting or re-passwording the `PANEL_EMAIL` account now retires the panel password in force at that moment. It is stored as a keyed tag (`settings.panel_config_retired`), so that password is refused until `PANEL_PASSWORD` is rotated or the account is enabled again.
   - A session from the shared panel password is always a panel member, even if its row is promoted (`getAdminRole` caps `bcr: member`).
   - The main-manager recovery login is unchanged and tested.
2. **Revoke and decisions, reproduced and fixed** (`src/lib/decisions.ts`, used by both sites).
   - Shortlist and reject refuse a candidate whose "rejected" came from a revoke before grading, with a clear message.
   - A decision clears `status_before_revoke`, so Restore access never undoes it.
3. **Deferred: writers every-candidate questions in Part 2, reproduced and fixed.** `assignDocsPart2` now always includes pinned Part 2 questions.
4. **Deferred: sign-in limiter keys, reproduced and fixed.**
   - The config row reached by its display name shares the email's counters.
   - Reset password lifts the `e:<email>` pause too.
5. **Deferred: grading fan-out, fixed.**
   - Writers Part 2 grading is capped at 6 calls at a time, like Part 1.
   - Writers keep `GRADING_BATCH_SIZE = 1`.
   - A killed invocation's claim still expires after 3 minutes.
6. **Hardening applied:**
   - Pinning, enabling or restoring past a category's per-candidate count is refused (`src/lib/pinned.ts`, both sites).
   - A test start never runs for a candidate revoked a moment earlier.
   - A writers Resume of Part 2 keeps Part 1 marks.
   - The CSV formula guard also catches formulas after leading spaces and in full-width characters.
   - Admin counters go through `num()`.
   - The copy check and word count normalise accents and full-width letters and drop invisible joiners.
   - The config account name never collides into a null row.

**Not changed (accepted, owner notes):**
- Candidate sign-in is email-only, by design. Identity verification (OTP) is a planned feature.
- The 100,000-character answer cap stays. JSON is parsed before the cap is applied (unchanged code).
- The stored-prompt versus live-guidance pairing for Part 2 is intended: guidance edits apply at the next grading.
- Assignment usage counters may drift by one under overlapping calls. That affects rotation fairness only.

## 9. Tests after the fixes

| Check | Result |
|---|---|
| Unit tests (`npm test`, includes 14 in `test/audit-round5.test.ts`) | 278/278 |
| Limits tests | 9/9 |
| TypeScript, including the unused-code check | pass |
| Support browser smoke (`scripts/support-smoke.mjs`) | 18/18 |
| Writers parity (`scripts/writers-parity-check.mjs`) | 17/17 |
| Manager-feature browser checks (both sites: length, pin, marks, tab switches, manual marks, total, revoke dialog, export) | all pass, no console errors |
