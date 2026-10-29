# Architecture — talo-repo run-2 (scoped quick pass)

**Scope.** Source diff `f0badac..51fe9b5` on `main` (everything changed since run 1 and its round-4 fixes): writers question bank and grading, word limits, every-admin-login-is-an-account, support/writers parity, manual marks, tab-switch counts, revoke-and-reject, repository readiness. The `v2` branch is out of scope (not deployed). Unchanged code is in scope only where changed code relies on it.

## 1. Product, principals, resources
Talo is Hevo Data's campus-hiring assessment tool (README.md). One Cloudflare Worker source deploys two isolated sites: support `talo` (TEAM unset) and writers `talo-docs` (TEAM="docs"; `src/lib/team.ts:14-16`), each with its own D1, R2 and secrets.
- **Anonymous**: `/api/admin/login`, `/api/candidate/login`, `/api/candidate/config` (now returns the question total, `src/routes/candidate.ts:101`), static assets.
- **Candidate**: email-on-allowlist sign-in (no OTP, by design, `src/lib/auth.ts:3-9`); per-candidate sessions scoped by `session.cid`; one browser per sitting.
- **Panel member** (`member`): view/grade/shortlist/export all candidates.
- **Manager**: everything, including routes in `src/lib/roles.ts:7-26`.
- **Config sign-in**: `ADMIN_EMAIL`+`ADMIN_PASSWORD` (manager), `PANEL_EMAIL`+`PANEL_PASSWORD` (member, support only; writers has `PANEL_EMAIL=""`). Since 998ba8c a config sign-in creates/reactivates an `admin_users` row via `ensureConfigAccount` (`src/routes/admin.ts:135-168`) and issues a session bound to that row plus a `bc` credential tag (`src/lib/auth.ts:183-200, 243-258`).
Protected resources: candidate PII and resumes, answers, AI and manual marks, hiring status (shortlist/reject), question bank with model answers and marking guidance, admin accounts.

## 2. Comparable baseline
None source-grounded.

## 3. Stack and execution limits
TypeScript Worker (`src/index.ts`), vanilla JS admin/candidate UIs (`public/`, `writers/index.html`), D1 SQL, R2, OpenAI chat API (`src/lib/openai.ts`), Workers rate-limit bindings. Offline tests: `npm test` (vitest in workerd, in-memory D1/R2, OpenAI mocked), `npm run test:limits`. **No OS-enforced sandbox and no trusted no-follow promotion are available** (recon 1d), so audit agents do not execute target code; decisive behaviour goes to `needs_validation` with a local plan.

## 4. Entry surfaces and paths in scope
- `POST /api/admin/candidates/:id/marks` and `/total` (`src/routes/admin.ts:1487-1563`): `part` allowlisted then interpolated into `${part}_answers` / `${part}_submitted_at`; question ownership via assignment join; 0..max in 0.25 steps; reason ≤300; `manual_by` from `adminWho` (`src/lib/auth.ts:317-328`). Totals via `COALESCE(manual_score, ai_score)` (`src/lib/scoring.ts`).
- `POST .../revoke|unrevoke` with `{reject}` (`src/routes/admin.ts:1566-1614`): `status_before_revoke` saved/restored; Resume/Retake clear manual marks (support Resume clears Part 1 only, `admin.ts:1475`; writers clears Parts 1–2, `admin-docs.ts:276-279`).
- Support `POST /api/admin/assessment-length` (`admin.ts:414-446`, inline manager check), settings `support_q_*` (`src/lib/supportconfig.ts`), pinned `required` questions in `assignPart1Questions` (`src/lib/randomize.ts`); question create/edit/bulk-import `required` (support strict booleans; writers truthy).
- Admin login (`admin.ts:273-335`): lookup `email = ? OR username = ?`, sign-in limits before password check, own password then config secret, `ensureConfigAccount` re-promotes the ADMIN_EMAIL row to manager and reactivates; panel config reactivates a deactivated row and keeps the row's role.
- Admin UI sinks (`public/admin/admin.js`): manual note, score pill title, revoke dialog, tab badges, total cell, `renderRich(a.prompt)` in the answer view (was escapeHtml), all via `escapeHtml` (line 62) / escape-first renderer (67-145).
- CSV exports: new score/AI/manual-reason/total-override columns (`admin.ts:1208-1260`, `admin-docs.ts:519-572`), formula guard `esc`/`csvEsc` on the first character.
- Writers grading (`src/lib/openai.ts:352-497`): candidate answer inside a random boundary; question, model answer, guidance and a server-computed `copyNote` outside; `copiedFromQuestion` auto-zero for Part 2; model output clamped. Answer cap `max(15000, wordLimit*10)` with word limits now up to 10,000 (`candidate-docs.ts:154-156, 373`); word-limit triggers recreated at runtime (`src/lib/db.ts`) and in `migrations-docs/0019`.

## 5. Trust boundaries and strongest controls
- Admin session → role: `getAdminRole` (named row's current role/active; `bc` tag for config sessions), `isManagerOnlyRoute` (writers before docs routes at `admin.ts:369`; support at `admin.ts:594`) plus inline checks for routes above 594.
- Candidate data isolation for admin edits: assignment joins in `/marks`.
- Browser: HttpOnly Secure SameSite=Lax cookies; Origin guard on non-GET `/api/` when Origin present (`src/index.ts:20-23`); CSP with hashed inline scripts (`public/_headers`).
- SQL: bound parameters; interpolated identifiers only from literals/allowlists.
- LLM: random boundary around candidate text; numeric clamping of outputs.

## 6. Starting paths
`src/routes/admin.ts`, `src/routes/admin-docs.ts`, `src/lib/auth.ts`, `src/lib/roles.ts`, `src/lib/scoring.ts`, `src/lib/db.ts`, `src/lib/supportconfig.ts`, `src/lib/randomize.ts`, `src/lib/openai.ts`, `src/routes/candidate-docs.ts`, `src/routes/candidate.ts`, `public/admin/admin.js`, `public/app.js`.

## 7. Prior coverage
Run 1 (quick, source ref d08390b) produced three `needs_validation` leads, all later reproduced and fixed by the owner: duplicate Part 1 sets (`randomize.ts`, source changed again in this diff → revalidation), bootstrap sessions surviving rotation (`auth.ts`/admin login, source changed by 998ba8c → revalidation), daily allowance drain (`ratelimit.ts`, unchanged, deployment fact → out of scope for this scoped run). Run 1 was quick and makes no "rest is fine" claim.

## 8. Companion selection
- WEB-PROTOCOL-AND-AUTH.md: account-transition and browser-session classes for config-account provisioning, reactivation and session binding.
- DATA-ISOLATION-AND-LIFECYCLE.md: object isolation for `/marks` and `/total`; revocation and lifecycle for revoke/restore/resume/retake.
- CLIENT-SIDE.md: DOM sinks in the admin UI.
- AI-AND-LLM.md: candidate text and manager guidance in grading prompts; model output used as marks.
- Excluded: memory safety, RPC/messaging, desktop/mobile IPC (none present); cloud/deployment and supply chain (no changes in scope beyond wrangler vars); resource exhaustion considered only for the enlarged answer cap.
