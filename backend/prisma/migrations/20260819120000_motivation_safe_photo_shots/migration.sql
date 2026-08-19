-- The three safe photographs a DFO actually looks for, as three separate
-- requirements instead of one.
--
-- SAFE_PHOTO was a single kind, and `documentStatus` satisfies a need by SET
-- MEMBERSHIP — so one photograph of a closed door ticked the whole box. Nor
-- could counting files have fixed it: MotivationUpload carries no caption and
-- no ordering column, so three files of one kind are genuinely
-- indistinguishable, and a pack holding three shots of the same closed door
-- would report itself complete.
--
-- Operator, 2026-08-19: "enforce three photos. closed safe, half open with key
-- in door, full open showing roll bolts."
--
-- SAFE_PHOTO IS DELIBERATELY LEFT IN THE ENUM. Postgres has no
-- ALTER TYPE ... DROP VALUE. It keeps its label and its annexure letter so any
-- row already carrying it stays readable, but it leaves the required lists and
-- the upload picker, so it reads as extra evidence and can never be chosen
-- again.
--
-- NO BACKFILL, deliberately. An existing SAFE_PHOTO row could be any of the
-- three shots, and relabelling it SAFE_PHOTO_CLOSED would assert something we
-- do not know on a pack a DFO will inspect. (Checked on the live box before
-- writing this: SELECT kind, count(*) FROM "MotivationUpload" GROUP BY kind
-- returned no rows at all, so there is nothing to relabel in any case.)
--
-- ⚠️ ALTER TYPE ... ADD VALUE cannot run inside a transaction block before
-- Postgres 12, and Prisma runs each migration in one. The live box is well
-- past 12 — the same note as 20260818150000. A backfill UPDATE also cannot sit
-- in this file: Postgres rejects "unsafe use of new value of enum type" in the
-- transaction that added it. It would need its own later migration.

ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'SAFE_PHOTO_CLOSED';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'SAFE_PHOTO_AJAR';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'SAFE_PHOTO_BOLTS';
