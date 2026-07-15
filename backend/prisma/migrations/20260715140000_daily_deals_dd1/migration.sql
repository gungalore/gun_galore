-- Daily Deals (DD-1) — first-party OneDayOnly-style deals module.
--
-- Additive + safe: a new Deal table + DealStatus enum + one nullable-safe
-- boolean column on Listing (defaulted false, so every existing listing is
-- a non-deal). No data backfill needed; no existing rows change meaning.
-- The isDealListing flag is what excludes house deals from every public
-- marketplace surface (see DAILY-DEALS-PLAN.md §2.2).

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'EXTENDED', 'ENDED', 'SOLD_OUT', 'CANCELLED');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "isDealListing" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Listing_isDealListing_idx" ON "Listing"("isDealListing");

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'DRAFT',
    "costPriceCents" INTEGER NOT NULL,
    "wasPriceCents" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "extendedUntil" TIMESTAMP(3),
    "dropDate" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "soldOutAt" TIMESTAMP(3),
    "heroRank" INTEGER NOT NULL DEFAULT 0,
    "initialStock" INTEGER NOT NULL,
    "perCustomerCap" INTEGER NOT NULL DEFAULT 10,
    "shipsInDaysMin" INTEGER NOT NULL DEFAULT 3,
    "shipsInDaysMax" INTEGER NOT NULL DEFAULT 7,
    "supplierName" TEXT,
    "supplierRef" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deal_listingId_key" ON "Deal"("listingId");

-- CreateIndex
CREATE INDEX "Deal_status_startsAt_idx" ON "Deal"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Deal_dropDate_idx" ON "Deal"("dropDate");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
