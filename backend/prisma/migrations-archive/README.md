# Archived migrations (2026-06 → 2026-08)

These 98 migrations built the original **GunGalore** production database. They are kept
because they record how the schema evolved and why — several carry reasoning in their
comments that exists nowhere else. **They are not deleted, and they must not be moved back
into `prisma/migrations/`.**

## Why they were retired

They do not work. Replaying them against an empty database fails partway through:

```
ERROR: relation "ReloadingManual" does not exist
  at 20260625130000_reloading_ocr_flag
```

That is not a one-off. **27 of the 70 models in `schema.prisma` have no `CREATE TABLE` in
any of these files** — the chain reproduces about 61% of the schema. Those tables were
created with `prisma db push` (or by hand) directly against production and the migration
history was never backfilled. Two of the files admit it in their own comments:

> *"no touching of any runtime-added FTS/tsvector columns … this file never diffs the
> schema — it is hand-applied via psql and marked applied with `prisma migrate resolve`"*

The practical consequence: **the repository could not rebuild its own database.** Not for a
new production box, not for disaster recovery, and not for a developer setting up locally.
That was discovered on 2026-08-12 by actually trying it, during the clean-slate build.

## What replaced them

Two migrations in `prisma/migrations/`:

| | |
|---|---|
| `20260812000000_baseline` | Generated with `prisma migrate diff --from-empty --to-schema` — 70 tables, 38 enums, 179 indexes, 81 foreign keys. |
| `20260812000001_fts_and_parity` | The three `tsvector` generated columns, their GIN indexes, `pg_trgm`, and three `NOT NULL` constraints. Prisma cannot express any of it, so it lived only on the production server. |

Verified against the live GunGalore database, not assumed: **1116 of 1116 columns identical,
253 of 253 indexes identical.** The single intentional difference is
`Transaction.peachPaymentId`, which `schema.prisma` declares `@unique` and production only
had as a plain index — the baseline applies the constraint the schema always claimed.

## ⚠️ Never run `prisma migrate deploy` against the old GunGalore database with this repo

That database has all 98 of these recorded as applied and knows nothing about the baseline.
Prisma would see an unapplied migration and try to `CREATE TABLE` over live tables. It would
fail rather than destroy anything, but it leaves the migration table in a failed state that
then needs manual repair.

The old box is being decommissioned. If you need to touch its schema, do it by hand.

## If you need the history

`git log --follow prisma/migrations-archive/<name>/migration.sql` still works — these were
moved with `git mv`, so authorship and dates are intact.
