---
name: supabase-safe-migration
description: Write, review and hand over a Supabase SQL migration for Project Tracker without risking production data. Use whenever a change needs a new table, column, constraint, index or realtime publication, or whenever you are about to touch schema.sql or any migrations_*.sql file.
---

# Safe Supabase migrations for Project Tracker

The live database holds the team's real projects, comments, tasks and leave.
**Nothing may be deleted.** There is no staging database: every migration
runs straight against production, pasted by a human into the Supabase SQL
Editor. You never run SQL yourself: `config.js` holds only the anon key and
the app has no migration runner.

## Hard rules

1. **Additive only.** Allowed: `CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS ... DEFAULT ...`, `CREATE INDEX IF NOT EXISTS`,
   `ALTER COLUMN ... DROP NOT NULL`, widening a `CHECK`.
   Forbidden: `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE`, `UPDATE`
   without a narrow `WHERE`, `ALTER COLUMN ... TYPE`, narrowing a `CHECK`,
   changing an FK to `ON DELETE CASCADE`.
2. **Widening a CHECK is drop-and-recreate.** That is safe only when the new
   list is a superset of the old one. Before writing it, get the *live*
   definition (step 1 below); `schema.sql` is out of date and has lied before
   (its `projects.phase` check still lists the Spanish phase names).
3. **Idempotent.** The file must be safe to paste twice. Use `IF NOT EXISTS`,
   `DROP CONSTRAINT IF EXISTS` right before `ADD CONSTRAINT`,
   `DROP POLICY IF EXISTS` before `CREATE POLICY`, and wrap
   `ALTER PUBLICATION` in the `DO $$ ... EXCEPTION WHEN duplicate_object` block
   used in `migrations_capacity_tasks_archive.sql`.
4. **Old code must keep working after the migration, and new code must not be
   deployed before it.** Every new column has a `DEFAULT` that reproduces
   today's behaviour, so the currently deployed `app.js` (which inserts
   without the new column) still works. Deploy order is always:
   migration → verify → code.
5. **Match conventions.** RLS on, permissive `"Allow all on <table>"` policy
   (the app does its own login against `app_users`, not Supabase Auth; do
   not harden it here). Stored enum values follow the table's existing
   language (`'Baja'/'Media'/'Alta'/'Crítica'`, `'Normal'/'Alta'/'Máxima'`);
   English labels are produced in JS (`getPriorityLabel`, `getUrgencyLabel`).
   Comments in the SQL explain *why*, in Spanish, like the existing files.

## Procedure

1. **Inspect live state first.** Give the user these queries to run and paste
   back, and do not write the migration until you have the output:

   ```sql
   SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN (<tables you touch>)
    ORDER BY table_name, ordinal_position;

   SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid)
     FROM pg_constraint
    WHERE conrelid::regclass::text IN (<tables you touch>);

   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
   ```

   Plus a `SELECT col, count(*) ... GROUP BY col` for every column whose CHECK
   you widen, so you can prove that no existing value falls outside the new list.

2. **Snapshot before you migrate.** Start the file with a backup block that
   copies every table you alter into a dated schema. It only creates things
   and never touches the source tables:

   ```sql
   CREATE SCHEMA IF NOT EXISTS backup_YYYYMMDD;
   CREATE TABLE IF NOT EXISTS backup_YYYYMMDD.team_vacations AS TABLE public.team_vacations;
   ```

   Also ask the user to download CSVs from the Table Editor for the same tables.

3. **Record row counts** (`SELECT count(*)` per table) before and after. They
   must be identical. A migration that changes a row count is wrong.

4. **Write `migrations_<topic>.sql`** in the repo root, following the header
   and section style of `migrations_capacity_tasks_archive.sql`, ending with a
   commented-out verification query block.

5. **Fold the change into `supabase/schema.sql`** so that a fresh install
   matches production. Keep `CREATE ... IF NOT EXISTS` style.

6. **Teach the test stub.** `harness/stub.js` in `verify-tracker` seeds the
   tables in memory. Add new tables there and new columns to seed rows, then
   run `verify-tracker`.

7. **Hand-over message to the user** must contain: the file to paste, the
   pre-check queries, the expected post-check output, and an explicit
   "deploy the code only after this succeeds".
