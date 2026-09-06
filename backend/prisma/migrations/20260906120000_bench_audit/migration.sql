-- The Bench — the audit follow-ups.
--
-- ADDITIVE ONLY. One new table, one new column with a backfill, four indexes
-- and two foreign keys. Nothing is dropped and no existing column changes
-- type.
--
-- ⚠️ HAND-WRITTEN, NOT `prisma migrate diff`. Same reason the first Bench
-- migration was hand-filtered: the raw diff also wants to DROP the tsvector
-- columns three services add at boot (AskGgKbEntry.searchTsv, HuntPdfPage
-- .textTsv, ReloadingManualPage.textTsv) and would silently destroy full-text
-- search on three tables. See CLAUDE.md, [BC-SCHEMA-DRIFT].

-- ── BenchPowder.key — a canonical name the id can be stable against ────────
--
-- ⚠️ THE ID WAS ONLY AS STABLE AS THE DISPLAY NAME, AND THE DISPLAY NAME IS
-- CHOSEN BY FREQUENCY. The import upserted on `name` — the most common printed
-- form across the manuals — so one more source spelling it "VARGET" rather
-- than "Varget" elected a new display name, minted a NEW row with a new cuid,
-- and every UserBench.powderIds pointer at the old row silently stopped
-- matching. The member's shelf loses a powder and nothing errors.
ALTER TABLE "BenchPowder" ADD COLUMN "key" TEXT;

-- The same canonicalisation powderKey() applies in scripts/bench-import.ts:
-- strip a leading maker token, then upper-case and drop everything that is not
-- a letter or a digit. "H 4350" → H4350; "N-160" → N160; "Alliant RL-15" →
-- RL15.
--
-- ⚠️ THE MAKER LIST IS DELIBERATELY SHORT, AND MUST STAY THE SAME THREE WORDS
-- AS THE SCRIPT'S. "NORMA 203 B" canonicalises to NORMA203B — the spec says so
-- — and "IMR 4350" is a different powder from "H4350", so neither NORMA nor
-- IMR may be stripped. A prefix removed here that the script keeps (or the
-- other way round) re-splits the powder at the next import.
--
-- Collisions are possible precisely BECAUSE this fixes a split: "Alliant
-- RL-15" and "RL15" may both exist today and both canonicalise to RL15. The
-- unique index below would fail on them, so the second and later rows keep a
-- suffixed key. They are not merged here: merging powders means rewriting
-- BenchLoad.powderId and every member's UserBench.powderIds, which is an
-- import's job with the source data in hand, not a migration's in the dark.
UPDATE "BenchPowder" p
SET "key" = c.k
FROM (
  SELECT
    id,
    CASE WHEN rn = 1 THEN base ELSE base || '-' || rn END AS k
  FROM (
    SELECT
      id,
      base,
      row_number() OVER (PARTITION BY base ORDER BY id) AS rn
    FROM (
      SELECT
        id,
        COALESCE(
          NULLIF(
            upper(
              regexp_replace(
                regexp_replace(name, '^(alliant|hodgdon|vihtavuori)[ -]+', '', 'i'),
                '[^A-Za-z0-9]', '', 'g'
              )
            ),
            ''
          ),
          -- A name with no letters or digits at all keeps its id as its key:
          -- unique, meaningless, and it will be replaced at the next import.
          id
        ) AS base
      FROM "BenchPowder"
    ) s
  ) t
) c
WHERE p.id = c.id;

ALTER TABLE "BenchPowder" ALTER COLUMN "key" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "BenchPowder_key_key" ON "BenchPowder"("key");

-- ── Indexes the finder actually reads by ───────────────────────────────────

-- CreateIndex
-- Every results query narrows by cartridge and by bullet weight. The only
-- index that led with those columns led with bulletMaker first, which nothing
-- has matched on since a bullet became a weight in a calibre.
CREATE INDEX "BenchLoad_cartridgeKey_weightGr_idx" ON "BenchLoad"("cartridgeKey", "weightGr");

-- CreateIndex
-- The shell-holder family lookup on the spec card: R1, R and E1 within
-- ±0.05 mm. Without it, opening a card scans every sheet.
CREATE INDEX "BenchCipDimension_R1_R_E1_idx" ON "BenchCipDimension"("R1", "R", "E1");

-- CreateIndex
-- The log is ordered by the date the member fired it, not by the date the row
-- was written — a back-dated entry belongs where they dated it.
CREATE INDEX "BenchLogEntry_userId_shotAt_idx" ON "BenchLogEntry"("userId", "shotAt");

-- ── The shelf and the log belong to a member ───────────────────────────────
--
-- ⚠️ WITHOUT THESE, DELETING A MEMBER LEAVES THEIR SHELF AND THEIR LOAD LOG
-- BEHIND — a POPIA erasure that erases nothing. The log carries free text they
-- typed at the range.
--
-- Orphans are deleted first. There should be none (both tables are only ever
-- written with a User.id resolved from a Clerk subject), but a row pointing at
-- a member who no longer exists is unreachable data by definition: nothing can
-- read it, because every read resolves the caller first.
DELETE FROM "UserBench" ub
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = ub."userId");

DELETE FROM "BenchLogEntry" b
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = b."userId");

-- AddForeignKey
ALTER TABLE "UserBench" ADD CONSTRAINT "UserBench_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchLogEntry" ADD CONSTRAINT "BenchLogEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The permalink ──────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "BenchShare" (
    "token" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchShare_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "BenchShare_expiresAt_idx" ON "BenchShare"("expiresAt");
