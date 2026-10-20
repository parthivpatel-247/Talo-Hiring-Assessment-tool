import type { Env } from '../types';
import { ensureOnce } from './db';

/**
 * Part 3 — closed-book debugging & break-fix.
 *
 * Two kinds of question, both graded on the SAME four axes (root CAUSE, how to
 * CHECK/verify, the FIX, and CLARITY of communication):
 *   - buggy_fix: a short broken SQL/Python snippet to diagnose and correct
 *   - scenario : a data-pipeline support ticket to troubleshoot (Hevo-support flavour)
 *
 * These are the DEFAULT bank, embedded in code so Part 3 works out of the box:
 * the app seeds them automatically the first time a candidate is assigned Part 3
 * (if the bank is empty), and the admin can also seed/re-seed them from the UI.
 * IDs are stable slugs so re-seeding never creates duplicates.
 */

export interface Part3Seed {
  id: string;
  kind: 'buggy_fix' | 'scenario';
  title: string;
  prompt: string;
  code_snippet?: string | null;
  reference_answer: string;
  rubric: string;
  marks: number;
  difficulty?: string;
}

const RUBRIC_CAUSE_CHECK_FIX =
  'Grade on four things, partial credit: (1) ROOT CAUSE — correctly identifies what is actually going wrong and why; ' +
  '(2) HOW TO CHECK — names a sensible way to confirm the cause (a query to run, a log/field to inspect, data to compare); ' +
  '(3) THE FIX — proposes a correct, safe fix and, where relevant, how to prevent a recurrence; ' +
  '(4) CLARITY — explains it clearly, in their own words, the way they would to a customer or teammate. ' +
  'A strong answer nails the cause and a workable fix. A weak answer only restates the symptom, guesses without a way to verify, or proposes a fix that would lose or corrupt data.';

export const DEFAULT_PART3_QUESTIONS: Part3Seed[] = [
  // ---------- buggy_fix ----------
  {
    id: 'p3-bug-dedup-rownumber',
    kind: 'buggy_fix',
    title: 'De-duplicate query keeps the wrong row',
    prompt:
      'A table `orders` receives the same order more than once (at-least-once delivery), so there are duplicate rows per `order_id`. A teammate wrote the query below to keep only the LATEST version of each order (by `updated_at`). In testing it still returns duplicates AND sometimes keeps an older row. Find the bug(s) and rewrite the query so it returns exactly one row per `order_id` — the one with the most recent `updated_at`. Explain what was wrong.',
    code_snippet:
      'SELECT *\nFROM (\n  SELECT\n    o.*,\n    ROW_NUMBER() OVER (ORDER BY updated_at DESC) AS rn\n  FROM orders o\n) t\nWHERE rn = 1;',
    reference_answer:
      'The window has no PARTITION BY, so ROW_NUMBER() numbers ALL rows as one group and only ONE row in the entire table gets rn=1 — not one per order. It must partition by order_id: ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY updated_at DESC). With the partition, rn=1 is the latest row per order_id. (If updated_at can tie, add a tiebreaker like a monotonically increasing id to make "latest" deterministic.) Correct: SELECT * FROM (SELECT o.*, ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY updated_at DESC) AS rn FROM orders o) t WHERE rn = 1;',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'medium',
  },
  {
    id: 'p3-bug-incremental-cursor',
    kind: 'buggy_fix',
    title: 'Incremental sync misses updated rows',
    prompt:
      'This Python function pulls "new or changed" rows from a source since the last run, using a saved high-water mark on `updated_at`. Customers report that rows which were EDITED at the source never make it to the destination — only brand-new rows do. There is also an occasional off-by-one where a row is skipped between runs. Find the bug(s), fix the function, and explain the cause.',
    code_snippet:
      'def fetch_changes(db, state):\n    last = state.get("last_synced_at", "1970-01-01")\n    rows = db.query(\n        "SELECT * FROM customers WHERE created_at > ?",\n        [last],\n    )\n    if rows:\n        state["last_synced_at"] = max(r["created_at"] for r in rows)\n    return rows',
    reference_answer:
      'Two bugs. (1) It filters and advances the cursor on created_at, so edited rows (whose created_at is old but updated_at is new) are never picked up — it should filter on updated_at (the change timestamp), e.g. WHERE updated_at > ?, and advance the water mark from updated_at. (2) The comparison is strictly-greater AND the water mark is set to the max updated_at seen; any row written with the SAME timestamp after this run (or in the same second) is skipped forever. Safer: use >= with de-duplication downstream, or track (updated_at, id) as the cursor, or re-fetch a small overlap window. Fixed core: rows = db.query("SELECT * FROM customers WHERE updated_at > ? ORDER BY updated_at", [last]); then state["last_synced_at"] = max(r["updated_at"] for r in rows). Mention the destination should upsert on primary key so re-fetched rows update rather than duplicate.',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'medium',
  },
  {
    id: 'p3-bug-join-fanout',
    kind: 'buggy_fix',
    title: 'Revenue report doubled after a join',
    prompt:
      'A daily revenue query returned correct totals until a new `payments` table was joined in to show the payment method. Overnight the reported revenue roughly doubled, even though no new orders were added. The query is below. Explain why the totals inflated and fix it so revenue is correct.',
    code_snippet:
      'SELECT o.order_date,\n       SUM(o.amount) AS revenue\nFROM orders o\nJOIN payments p ON p.order_id = o.order_id\nGROUP BY o.order_date;',
    reference_answer:
      'A join fan-out: some orders have more than one row in payments (e.g. a split payment, a retry, or a refund + charge). The JOIN produces one row per (order, payment) pair, so o.amount is counted once per matching payment — inflating SUM(o.amount). Ways to verify: count payments per order (SELECT order_id, COUNT(*) FROM payments GROUP BY order_id HAVING COUNT(*)>1) and compare row counts before/after the join. Fixes: aggregate payments to one row per order before joining (JOIN a subquery that does SUM/GROUP BY order_id), or compute revenue from orders alone and join payment info separately, or SUM a payments column instead of the duplicated orders.amount. The key point: never SUM a column from the "one" side across a one-to-many join.',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'medium',
  },

  // ---------- scenario (break-fix support tickets) ----------
  {
    id: 'p3-scn-duplicate-pk',
    kind: 'scenario',
    title: 'Pipeline failing: duplicate primary key',
    prompt:
      'A customer\'s pipeline into their warehouse started failing overnight with errors like: `duplicate key value violates unique constraint "users_pkey"`. It had been running fine for weeks. Loads are now stuck and no new data is landing. Walk through how you would investigate this, what the most likely root cause is, and how you would get the pipeline healthy again — without losing or corrupting the customer\'s data.',
    reference_answer:
      'Likely cause: the source now emits more than one record with the same primary key in a single batch (e.g. a row was inserted then updated between syncs, or the source key is no longer unique the way the destination expects), so a straight INSERT collides. How to check: look at the failing batch and count keys — find the id(s) appearing more than once; confirm whether the source truly has duplicate keys or whether two events for the same key arrived in one batch; check if the primary/unique key configuration on the destination matches the true source key. Fix: switch the load to an UPSERT/merge (insert-or-update on the primary key) so a repeated key updates the existing row instead of failing; de-duplicate within the batch keeping the latest version before loading; if the destination key is mis-configured, correct it to the real business key. Prevent recurrence: keep the merge/upsert strategy, and dedupe on key + latest updated_at. Communicate: reassure the customer no data is lost — the rows are still in the source — and that reprocessing the batch after the fix will catch them up.',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'medium',
  },
  {
    id: 'p3-scn-type-mismatch-na',
    kind: 'scenario',
    title: 'Load failing on a numeric column',
    prompt:
      'A pipeline that loads a `revenue` column (expected to be a number) into the warehouse is now failing with a type/casting error such as `invalid input syntax for type numeric: "N/A"`. The customer says nothing changed on their side. New rows are not loading. How do you investigate, what is the likely cause, and how do you fix it so the pipeline recovers and stays healthy?',
    reference_answer:
      'Cause: the source started sending non-numeric values in a numeric column — here the literal string "N/A" (or blank/"-"/"null") where a number is expected — so the cast to numeric fails. Even if the customer changed nothing intentionally, an upstream system, a manual export, or a new record can introduce it. How to check: inspect the failing rows/values for the revenue field and confirm which non-numeric values appear; check whether the destination column type or a transformation is doing the strict cast. Fix: handle the bad values rather than letting them abort the load — map "N/A"/blank to NULL (or 0 if that is the agreed business meaning) in a transformation before the cast, or load the column as text and cast safely downstream (TRY_CAST / a cast that returns NULL on failure). Reprocess the stuck batch after the fix. Prevent recurrence: add the null-mapping rule so future "N/A"s are handled automatically, and agree with the customer what "N/A" should mean. Communicate the trade-off (NULL vs 0) so the numbers stay trustworthy.',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'medium',
  },
  {
    id: 'p3-scn-api-429',
    kind: 'scenario',
    title: 'Source API returning 429 (rate limited)',
    prompt:
      'A pipeline pulling from a customer\'s SaaS source (via its REST API) has become very slow and is throwing frequent `429 Too Many Requests` errors, so syncs are backing up. The customer wants their data flowing again. How do you diagnose this, what is happening, and what are the right ways to fix it — both immediately and longer term?',
    reference_answer:
      'What is happening: the source API enforces a rate limit and the pipeline is exceeding it, so the API rejects requests with 429; retries that ignore the limit make it worse (a retry storm). How to check: look at the API responses and headers (many APIs return Retry-After or X-RateLimit-Remaining/Reset), confirm the limit and current request rate, and check whether other integrations on the same account share that quota. Fix (immediate): honour the Retry-After header, back off and retry with exponential backoff + jitter, reduce concurrency/parallel requests, and let the current backlog drain. Fix (longer term): lower the request rate to stay under quota, use incremental syncs so you fetch only changed data instead of full pulls, increase the sync interval, request a higher quota from the source vendor, or use bulk/export endpoints where available. Communicate: explain to the customer this is a source-side limit, that data is not lost (it will catch up once within limits), and set expectations on catch-up time.',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'medium',
  },
  {
    id: 'p3-scn-schema-drift',
    kind: 'scenario',
    title: 'Source added/renamed a column (schema drift)',
    prompt:
      'A customer reports that a column they rely on in their warehouse "suddenly stopped updating" and a new field they added at the source "isn\'t showing up" in the destination. Older data looks fine. Explain what is most likely going on, how you would confirm it, and how you would resolve it so both the renamed and the new column behave correctly going forward.',
    reference_answer:
      'Cause: schema drift at the source. The relied-on column was most likely RENAMED at the source, so the pipeline now writes the new name and the old destination column stops receiving values (it looks "frozen"); the brand-new field isn\'t mapped/created in the destination yet, so it doesn\'t appear. How to check: compare the current source schema to the destination mapping, look at when values stopped, and check the pipeline\'s handling of new/renamed columns (auto-mapping on or off). Fix: enable/allow schema change handling so new columns are auto-created and mapped; add the mapping for the new field; for the rename, decide whether to backfill/merge the old column\'s history into the new one or treat it as a new column, and communicate that choice. Re-sync so the destination picks up the new structure. Prevent recurrence: keep automatic schema-drift handling on where appropriate, and alert on source schema changes. Communicate clearly that no history was lost — the values moved to a differently named column.',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'medium',
  },
  {
    id: 'p3-scn-incremental-updates-missing',
    kind: 'scenario',
    title: 'Updates at source not reflected in destination',
    prompt:
      'A customer says new records appear in their warehouse correctly, but when a record is EDITED at the source (e.g. an order status changes from "pending" to "shipped"), the change never reaches the destination — the old value stays. Full historical data is otherwise fine. How do you investigate, what is the likely root cause, and how do you fix it?',
    reference_answer:
      'Cause: the incremental sync is insert-only — it tracks new rows (e.g. by created_at or an ever-increasing id) but not changes, so updates to existing rows are never captured; or the source doesn\'t expose an updated_at / change signal the pipeline can key on; or the destination is append-only instead of upserting on the primary key. How to check: confirm what column the incremental sync uses (created_at vs updated_at), check whether the source has a reliable "last modified" field or change-data-capture, and verify the destination merges on the primary key rather than only inserting. Fix: key the incremental sync on updated_at (or CDC/log-based capture if available) so edited rows are re-pulled, and configure the destination to UPSERT on the primary key so a re-pulled row updates in place. If the source truly has no change timestamp, options are periodic full re-syncs or capturing changes another way. Communicate the chosen approach and any catch-up needed to correct already-stale rows.',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'medium',
  },
  {
    id: 'p3-scn-duplicate-rows-dest',
    kind: 'scenario',
    title: 'Duplicate rows appearing in the destination',
    prompt:
      'After a pipeline was paused and resumed (and once after a source outage), a customer noticed the SAME records now appear multiple times in their warehouse table, throwing off their counts and dashboards. They want accurate, de-duplicated data. What is causing the duplicates, how would you confirm it, and how do you fix both the existing duplicates and future ones?',
    reference_answer:
      'Cause: at-least-once delivery. When a pipeline is paused/resumed or recovers from an outage, a batch can be re-processed, and if the load is a plain INSERT (not an upsert/merge on a primary key), the re-processed rows are inserted again → duplicates. How to check: pick a known record and count its occurrences (GROUP BY primary_key HAVING COUNT(*)>1); correlate the duplicate timestamps with the pause/resume or outage window. Fix (future): load with UPSERT/merge on the primary key so a re-delivered row updates instead of duplicating; ensure a real unique key is configured. Fix (existing): de-duplicate the table keeping the latest version per key — e.g. keep the row with the max updated_at using ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) and delete rn>1, ideally into a rebuilt/deduped table verified before swap. Communicate: reassure the customer no data was lost (these are duplicates, not corruption) and that the merge strategy prevents recurrence.',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'medium',
  },
  {
    id: 'p3-scn-stuck-no-error',
    kind: 'scenario',
    title: 'Pipeline "running" but zero rows, no error',
    prompt:
      'A customer\'s pipeline shows as healthy and "running" with no error, but zero new rows have loaded for the last several hours, even though they insist there is new data at the source. Nothing is failing. How do you approach this? Give the checks you would run, the most likely causes, and how you would get data flowing again.',
    reference_answer:
      'Because there is no error, this is about why the pipeline sees "no new data" rather than a crash. Checks (breadth matters here): (1) Is new data actually queryable at the source right now, and does it satisfy the pipeline\'s incremental filter? (2) The incremental cursor / high-water mark — has it advanced past the new rows, or is it stuck/ahead so new rows fall below the threshold (e.g. a clock/timezone skew on updated_at, or a bad water mark set too high)? (3) Are new rows written with a timestamp the sync uses (created_at/updated_at) — or are they added with an older/backdated timestamp so the > filter skips them? (4) Is the source returning an empty page due to a filter, permission, or a paused/renamed object? (5) Is the schedule actually triggering, and is the object still selected? Likely causes: a stuck/too-high incremental cursor, timestamp/timezone mismatch, or new rows not matching the change filter. Fix: correct or reset the cursor to a safe earlier point (accepting a small re-sync with upsert to avoid duplicates), align on the timestamp field/timezone, and re-run. Communicate what was found and that a bounded re-sync will catch up the missing rows.',
    rubric: RUBRIC_CAUSE_CHECK_FIX,
    marks: 5,
    difficulty: 'hard',
  },
];

/**
 * Self-heal the Part 3 schema at runtime, so the feature works even if migration
 * 0008 was never applied (the app deploys with `wrangler deploy`, which does NOT
 * run migrations). Mirrors ensureCollegeSchema / ensureAuthSchema.
 */
export async function ensurePart3Schema(env: Env): Promise<void> {
  try {
    await ensureOnce('part3', async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS part3_questions (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          title TEXT,
          prompt TEXT NOT NULL,
          code_snippet TEXT,
          reference_answer TEXT,
          rubric TEXT,
          marks INTEGER NOT NULL DEFAULT 5,
          difficulty TEXT DEFAULT 'medium',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')))`
      ).run();
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS part3_assignments (
          candidate_id TEXT NOT NULL, question_id TEXT NOT NULL, position INTEGER NOT NULL,
          PRIMARY KEY (candidate_id, question_id))`
      ).run();
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS part3_answers (
          candidate_id TEXT NOT NULL, question_id TEXT NOT NULL, answer_text TEXT,
          ai_score REAL, ai_reasoning TEXT, deductions TEXT, max_marks INTEGER DEFAULT 5,
          scored_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (candidate_id, question_id))`
      ).run();
      // Add the six part3_* columns to attempts if they are missing.
      const cols = await env.DB.prepare('PRAGMA table_info(attempts)').all<{ name: string }>();
      const have = new Set((cols.results ?? []).map((c) => c.name));
      const toAdd: [string, string][] = [
        ['part3_started_at', 'TEXT'],
        ['part3_remaining_seconds', 'INTEGER'],
        ['part3_last_heartbeat_at', 'TEXT'],
        ['part3_submitted_at', 'TEXT'],
        ['part3_tab_switch_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['part3_tab_switch_log', 'TEXT'],
      ];
      for (const [name, type] of toAdd) {
        if (!have.has(name)) {
          await env.DB.prepare(`ALTER TABLE attempts ADD COLUMN ${name} ${type}`).run();
        }
      }
    });
  } catch { /* best effort — reads tolerate a missing table/column */ }
}

/**
 * Seed the default Part 3 bank. Idempotent: uses stable ids and INSERT OR IGNORE,
 * so re-seeding never creates duplicates and never overwrites admin edits.
 * Returns how many rows were newly inserted.
 */
export async function seedDefaultPart3(env: Env): Promise<number> {
  await ensurePart3Schema(env);
  const before = await env.DB.prepare('SELECT COUNT(*) as n FROM part3_questions').first<{ n: number }>();
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO part3_questions
       (id, kind, title, prompt, code_snippet, reference_answer, rubric, marks, difficulty, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );
  await env.DB.batch(
    DEFAULT_PART3_QUESTIONS.map((q) =>
      stmt.bind(q.id, q.kind, q.title, q.prompt, q.code_snippet ?? null, q.reference_answer, q.rubric, q.marks, q.difficulty ?? 'medium')
    )
  );
  const after = await env.DB.prepare('SELECT COUNT(*) as n FROM part3_questions').first<{ n: number }>();
  return (after?.n ?? 0) - (before?.n ?? 0);
}
