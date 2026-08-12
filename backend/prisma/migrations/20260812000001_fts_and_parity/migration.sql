-- Post-baseline parity: everything the Prisma schema cannot express.
--
-- The baseline migration is generated from schema.prisma and reproduces 1113 of
-- the 1116 columns in production. This file closes the remaining gap. It was
-- built by diffing a freshly-baselined database against the live production
-- schema, column by column — not from memory.
--
-- WHY THESE ARE NOT IN schema.prisma
--
-- Prisma has no `tsvector` type and no way to declare a GENERATED column, so
-- these three were created by hand directly on the production box and their DDL
-- existed nowhere in the repository. Two migrations even say so out loud:
-- "no touching of any runtime-added FTS/tsvector columns". That is how a schema
-- ends up unreproducible.
--
-- If you add another full-text column, add it HERE. Do not add it by hand on a
-- server; the next person to rebuild will not know it exists.

-- ── 1. Extension ───────────────────────────────────────────────────────────
-- Required by ReloadingManualPage_extractedText_trgm_idx below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 2. Full-text search columns ────────────────────────────────────────────
-- STORED generated columns: Postgres maintains them on write, so there are no
-- triggers to keep in step and no way for the index to drift from the text.

-- Ask Boet knowledge base — weighted so a title match outranks an answer match.
ALTER TABLE "AskGgKbEntry"
  ADD COLUMN IF NOT EXISTS "searchTsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(title, '')),    'A') ||
    setweight(to_tsvector('english', COALESCE(question, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(answer, '')),   'C')
  ) STORED;

-- Reloading manual pages — the search behind the PRO manual browser.
ALTER TABLE "ReloadingManualPage"
  ADD COLUMN IF NOT EXISTS "textTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', COALESCE("extractedText", ''))) STORED;

-- Hunt PDF pages. The ballistics app is NOT moving to this box, so this table
-- stays empty here — the column exists only to keep the schema identical to
-- production, so a future diff of the two is meaningful.
ALTER TABLE "HuntPdfPage"
  ADD COLUMN IF NOT EXISTS "textTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', COALESCE(text, ''))) STORED;

-- ── 3. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "AskGgKbEntry_searchTsv_idx"
  ON "AskGgKbEntry" USING gin ("searchTsv");
CREATE INDEX IF NOT EXISTS "ReloadingManualPage_textTsv_idx"
  ON "ReloadingManualPage" USING gin ("textTsv");
CREATE INDEX IF NOT EXISTS "HuntPdfPage_textTsv_idx"
  ON "HuntPdfPage" USING gin ("textTsv");
-- Trigram index for fuzzy/substring matching on the raw manual text, which the
-- tsvector index cannot serve.
CREATE INDEX IF NOT EXISTS "ReloadingManualPage_extractedText_trgm_idx"
  ON "ReloadingManualPage" USING gin ("extractedText" gin_trgm_ops);

-- ── 4. Scalar-list nullability ─────────────────────────────────────────────
-- Production has these NOT NULL; the Prisma version in use now emits them
-- nullable. Prisma always writes a value either way, so this is parity rather
-- than a bug fix — but NOT NULL is the stronger constraint and it makes a
-- schema diff between the two databases come back empty.
ALTER TABLE "Listing"            ALTER COLUMN "speciesList" SET NOT NULL;
ALTER TABLE "Transaction"        ALTER COLUMN "riskFlags"   SET NOT NULL;
ALTER TABLE "CategoryAttribute"  ALTER COLUMN "options"     SET NOT NULL;
