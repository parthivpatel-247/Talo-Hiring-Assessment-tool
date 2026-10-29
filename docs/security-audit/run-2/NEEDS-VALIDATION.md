# NEEDS VALIDATION — talo-repo run-2

Both leads are source-grounded and were independently re-checked by a fresh verifier. They stayed `needs_validation` only because this run had no OS-enforced sandbox, so no target code ran inside the audit. They carry no severity. The owner-side results after the run are in REPORT.md §8.

## 1. Shared panel password re-enables a panel account a manager disabled, deleted or re-passworded in Access
- **Fingerprint:** `talo/auth/panel-config-signin-reactivates-revoked-shared-account`
- **Boundary:** a holder of the shared `PANEL_PASSWORD` versus a manager's account revocation in Admin → Access (support site).
- **Trace:**
  1. `src/routes/admin.ts:273`: `POST /api/admin/login`
  2. `:285`: the row lookup skips inactive rows
  3. `:309`: the config fallback accepts `PANEL_EMAIL` + `PANEL_PASSWORD`
  4. `:314`: `ensureConfigAccount`
  5. `:154`: `active = 1`, or `:157-165` recreates the row
  6. `:326`: a session is issued; `src/lib/auth.ts:243-251` accepts it
- **Evidence:**
  - Reactivation runs for the `member` role, but the doc comment (`admin.ts:143`) scopes recovery to the main manager.
  - Disable, Delete and Reset password only end current sessions (`admin.ts:566, 586`).
  - The Access UI promises "They will no longer be able to log in" (`public/admin/admin.js:529`).
- **Blockers:**
  - Product intent was not visible in source.
  - Whether `PANEL_PASSWORD` is set in the deployed support site is a deployment fact.
- **Local plan:** a vitest case that disables, deletes and re-passwords the panel row, then signs in with the panel password. The lead holds if each sign-in returns 200 and the row is active again.
- **Owner check:** confirm whether Disable, Delete and Reset password on the `PANEL_EMAIL` row should lock out holders of the shared password.

## 2. Revoke with reject lets an ungraded or never-tested candidate be shortlisted, and Restore access undoes a later rejection
- **Fingerprint:** `talo/admin/revoke-reject-status-not-reconciled-with-shortlist-reject-decisions`
- **Boundary:** a panel member's shortlist/reject decision versus the rule "only a graded candidate can be decided", and a later decision versus Restore access (both sites).
- **Trace:**
  1. `src/routes/admin.ts:1634`: shortlist/reject, which panel members can use
  2. `:1593`: revoke with reject sets status 'rejected' from any status and saves `status_before_revoke`
  3. `:1639` and `src/routes/admin-docs.ts:320`: the decision gate accepts 'rejected'
  4. `:1611`: Restore access writes `status_before_revoke` back over a later explicit rejection
- **Blocker:** the decisive end-to-end status transitions needed the workerd test suite, which could not run without a sandbox.
- **Local plan:**
  - Case 1: a never-started candidate is revoked with reject, then a panel member shortlists them. The invariant expects 409.
  - Case 2: an evaluated candidate is revoked with reject, then shortlisted, then rejected, then access is restored. The status should stay 'rejected'.
