# Talo — architecture summary (security audit run 1, quick profile)

Source ref: d08390bf2f8acb8283d78bab3550557a781f2965 (clean worktree). Repository: /home/claude/talo-repo.

## 1. Product, principals, protected resources
Talo is a campus-hiring assessment platform: one Cloudflare Worker deployed twice from the same source — the support site (`talo`, TEAM unset, a single-part timed coding/SQL test) and the writers site (`talo-docs`, TEAM="docs", a two-part writing test: Part 1 closed book, Part 2 open book) (README.md:3-15, src/lib/team.ts:13, wrangler.toml [env.docs]). Each deployment has its own D1 database, R2 bucket, secrets and admin accounts.

Principals:
- **Anonymous**: `/api/health`, `/api/candidate/config`, both login routes, both logout routes, static assets (src/index.ts:36-41).
- **Candidate**: signs in with an allowlisted email only (no password/OTP, by design: src/lib/auth.ts:7, src/routes/candidate.ts:40-91). One sitting per email; writers allows one re-login between parts. Reads own questions, saves own answers, heartbeat, tab-switch/integrity events, submit (candidate.ts:106-231, candidate-docs.ts:197-437).
- **Admin panel member** (`role='member'`): views candidates, detail, resume PDFs, flags, audit log, CSV export; runs grading and interview generation (OpenAI spend); shortlist/reject.
- **Admin manager**: everything, including Access (members), colleges, durations, open/close test, sign-in pause lift, resume upload/parse, question bank, delete/retake/resume/revoke/force-submit (src/lib/roles.ts:7-28).
- **Indirect principals**: resume authors (PDF text → parseResume → allowlisted email, name, skills, projects) and candidate answers (→ grading and interview prompts; → admin UI and CSV).

Protected resources: other candidates' answers, scores and PII; the integrity of each candidate's timed attempt (questions not visible before start, no saves after close); hiring outcomes; admin accounts; the OpenAI key and spend; D1/R2 free-plan quotas.

## 2. Comparable baseline
No comparable product is named in the repository; it uses standard pieces (HMAC cookies, PBKDF2-SHA256 100k, OpenAI chat completions).

## 3. Stack and deployment paths; offline limits
TypeScript on Cloudflare Workers (nodejs_compat), D1 (SQLite), R2, Workers Rate Limiting bindings, static assets via the ASSETS binding with headers from public/_headers; unpdf 0.12.2 for PDF text; OpenAI gpt-4o-mini via `chatJson` (src/lib/openai.ts:21-86; base URL from `OPENAI_BASE_URL`). Support: src/index.ts + ./public + migrations/ (0001–0016). Writers: same src/index.ts + dist-docs/ (built from public/ + writers/index.html) + migrations-docs/ (0001–0018).

Offline tests exist (vitest in workerd, test/*.test.ts, fake credentials) but no assembled OS-enforced sandbox and no trusted promotion helper exist in this workspace (recon 1d items 6-7). **This run executes no target code**: all hunters and verifiers are source-only; a decisive behavioural fact becomes `needs_validation` with a local plan (a vitest regression case) for the owner.

## 4. Entry surfaces and important paths
- HTTP (src/index.ts): global Origin guard on non-GET `/api/*` (L20-23; missing Origin allowed), per-request Workers Rate Limiting keyed by network and by hash of the raw (unverified) cookie value (src/lib/ratelimit.ts:337-350), dispatch to admin.ts / candidate.ts (→ candidate-docs.ts / admin-docs.ts when TEAM=docs).
- Candidate test lifecycle: login → prepare (assign, no questions) → start (open gate, deadline) → answer (conditional INSERT while running and before deadline) → heartbeat (server clock, close at 0/deadline) → submit (close, clear cookie). Writers adds Part 2 start rules, attempt_events (capped 300/part), metrics grace 2 min after close.
- Admin: sign-in (D1 counters before password check, trusted-device cookie), sessions in admin_sessions (role read live for named accounts), role gate isManagerOnlyRoute (admin.ts:489, and before writers dispatch admin.ts:301-305), candidate actions, resume upload (PDF magic, ≤10 MB, R2 key server-generated) and parse (claims, OpenAI), grading (claims, OpenAI), export CSV (formula-neutralised), retention cron (set-based purges).
- Model context: resume text, admin question text, candidate answers (random boundary), interview context → OpenAI; model output → D1 → admin UI, CSV, and (enrichment fields) candidate page.
- Browser: public/app.js candidate page (renderRich escapes first), public/admin/admin.js (many innerHTML sinks; escapeHtml + num helpers), CSP via _headers with hashed inline theme scripts.

## 5. Trust boundaries and strongest control
- Anonymous → candidate identity: allowlist email match + sign-in limits (unknown emails per network) + one-sitting rule. Email-only identity is a deliberate product decision.
- Candidate → other candidates' data / own attempt integrity: session HMAC (auth.ts:91-111), per-candidate scoping (`WHERE candidate_id = ?`), ownership check on question IDs, conditional INSERTs, deadlines, open gate.
- Anonymous → admin: PBKDF2 + bootstrap compare, sign-in counters, trusted device, session row with expiry.
- Panel member → manager authority: isManagerOnlyRoute + inline checks.
- Untrusted text → model decisions: email literal-in-text check, score clamping, answer boundary, "answer is data" rules.
- Untrusted text → admin browser: escapeHtml/num, CSP (script-src self + hashes; style unsafe-inline), frame-ancestors none.
- Cross-site → state change: Origin guard, SameSite=Lax cookies.

## 6. Starting paths
src/index.ts, src/lib/{auth,ratelimit,roles,db,openai,resume,timer,scoring,randomize,team}.ts, src/routes/{admin,admin-docs,candidate,candidate-docs}.ts, public/app.js, public/admin/admin.js, public/_headers, public/index.html, public/admin/index.html, writers/index.html, migrations/, migrations-docs/, wrangler.toml, package.json, package-lock.json.

## 7. Prior coverage
No prior coverage-ledger.json or findings.json exists for this repository; this is run 1. Earlier informal reviews in this session are not treated as coverage.

## 8. Companion selection
Selected: WEB-PROTOCOL-AND-AUTH.md (sessions, CSRF, cookies, API sign-in), CLIENT-SIDE.md (DOM rendering of stored text, clickjacking), AI-AND-LLM.md (resume/answer text into model prompts; model output rendered), DATA-ISOLATION-AND-LIFECYCLE.md (export, deletion, retention, soft delete/restore), RESOURCE-EXHAUSTION-AND-AVAILABILITY.md (OpenAI spend, D1 quotas, pre-auth work), CLOUD-AND-DEPLOYMENT.md (edge/runtime config, secrets, wrangler bindings), SUPPLY-CHAIN-AND-RELEASE.md (npm dependencies, build scripts). Excluded: MEMORY-SAFETY-AND-BINARY.md (no native code; JS/TS only), PROTOCOLS-RPC-AND-MESSAGING.md (no RPC, queues or webhooks), DESKTOP-MOBILE-AND-LOCAL-IPC.md (no native app or IPC).
