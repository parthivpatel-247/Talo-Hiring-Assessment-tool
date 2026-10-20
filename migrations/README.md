# Migrations

Since Talo v2 the database schema is managed in code (`src/db/schema.ts` +
`src/db/migrate.ts`). The Worker upgrades the database automatically on its
first request after a deploy, after writing a full backup of the old tables to
R2. There is nothing to run with `wrangler d1 migrations apply`.

The v1 SQL migration files (0001–0015) are kept for reference in
`db/legacy-v1/`; the automated tests use them to build a v1 database and prove
the upgrade preserves every record.
