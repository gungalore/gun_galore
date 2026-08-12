-- P5.1 — Saved search (retention). A user persists browse filters and gets
-- an in-app + push alert when a NEW ACTIVE listing matching them is published.
--
-- Purely additive: one new table + FK + indexes. No existing table touched.
-- Idempotent (IF NOT EXISTS everywhere) so it can be replayed safely.

CREATE TABLE IF NOT EXISTS "SavedSearch" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "label"          TEXT,
  "q"              TEXT,
  "categoryId"     TEXT,
  "categorySlug"   TEXT,
  "listingType"    TEXT,
  "condition"      TEXT,
  "province"       TEXT,
  "make"           TEXT,
  "minPrice"       INTEGER,
  "maxPrice"       INTEGER,
  "sort"           TEXT,
  "attrs"          TEXT,
  "fingerprint"    TEXT NOT NULL,
  "notifyEnabled"  BOOLEAN NOT NULL DEFAULT true,
  "lastNotifiedAt" TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- Idempotent unique + indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "SavedSearch_userId_fingerprint_key"
  ON "SavedSearch"("userId", "fingerprint");
CREATE INDEX IF NOT EXISTS "SavedSearch_userId_createdAt_idx"
  ON "SavedSearch"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SavedSearch_notifyEnabled_idx"
  ON "SavedSearch"("notifyEnabled");

-- FK to User, cascade-delete with the user. Guarded so replay doesn't error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SavedSearch_userId_fkey'
  ) THEN
    ALTER TABLE "SavedSearch"
      ADD CONSTRAINT "SavedSearch_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Listing.listedAt (P5.1 matcher key) ──────────────────────────────────────
-- The saved-search matcher must key "new since I last looked" on when a
-- listing FIRST became discoverable (entered ACTIVE), NOT createdAt — else a
-- listing created 10:00, human-approved 14:00, keeps createdAt=10:00 and the
-- cursor (already at ~14:00) silently skips it forever. Additive nullable
-- column; backfill existing ACTIVE rows so they have a sensible value.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "listedAt" TIMESTAMP(3);

-- Backfill: an ACTIVE listing became discoverable at its admin-review time if
-- it was human-reviewed, otherwise at create (auto-approved straight to ACTIVE).
-- Safe to run before any saved search exists (no cursor predates these times,
-- so no spurious "new" alert). Only touches rows still NULL, so replay is a
-- no-op.
UPDATE "Listing"
SET "listedAt" = COALESCE("adminReviewedAt", "createdAt")
WHERE "status" = 'ACTIVE' AND "listedAt" IS NULL;

-- Matcher hot-path index.
CREATE INDEX IF NOT EXISTS "Listing_status_listedAt_idx"
  ON "Listing"("status", "listedAt");
