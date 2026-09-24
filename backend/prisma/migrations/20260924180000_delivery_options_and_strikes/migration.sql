-- Delivery options (cheapest/fastest door + Pargo store pickup), the seller
-- pickup-scheduling fields, the Store Pickup payout clock, and the seller
-- reject-strike ledger. Additive only — nothing here drops or rewrites data.
--
-- Hand-authored and diff-verified against prisma/schema.prisma
-- (`prisma migrate diff --from-schema <prev> --to-schema prisma/schema.prisma`).
-- `migrate dev` is unusable in this repo (raw-DDL FTS drift), so migrations are
-- authored by hand. Guards make a re-run a no-op.

-- The buyer's delivery choice within the courier rail.
DO $$ BEGIN
  CREATE TYPE "DeliveryOption" AS ENUM ('DOOR_CHEAPEST', 'DOOR_FASTEST', 'STORE_PICKUP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Seller-nominated stocking dealer (Google Places) — the coords power the
-- "≈560 km from you" indicator on firearm/barrel listings.
ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "plannedDealerPlaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "plannedDealerLat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "plannedDealerLng" DOUBLE PRECISION;

-- Buyer delivery choice + Pargo counter snapshot; seller pickup scheduling;
-- Store Pickup payout clock.
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "deliveryOption" "DeliveryOption",
  ADD COLUMN IF NOT EXISTS "pickupPointLocationId" INTEGER,
  ADD COLUMN IF NOT EXISTS "pickupPointSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "collectionNotBeforeAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "collectionWindow" TEXT,
  ADD COLUMN IF NOT EXISTS "readyForPickupAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "collectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "adminPayoutEnabledAt" TIMESTAMP(3);

-- Seller reject-strike ledger. One row per strike; admin can remove a single
-- unfair strike and the ban is recomputed live (BAN_AT = 2).
CREATE TABLE IF NOT EXISTS "SellerStrike" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "listingId" TEXT,
  "referenceId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "removedById" TEXT,

  CONSTRAINT "SellerStrike_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SellerStrike_userId_removedAt_idx" ON "SellerStrike"("userId", "removedAt");
CREATE INDEX IF NOT EXISTS "SellerStrike_userId_createdAt_idx" ON "SellerStrike"("userId", "createdAt");

-- Complaint evidence accepts the required image plus an optional short video.
ALTER TABLE "ComplaintPhoto"
  ADD COLUMN IF NOT EXISTS "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
  ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "durationSeconds" DOUBLE PRECISION;

-- STORE_PICKUP: the parcel is at the Pargo counter awaiting the buyer. A
-- distinct status so the buyer is told "ready to collect" (not "out for
-- delivery") and the payout clock can start on the ready event.
ALTER TYPE "ShippingStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_PICKUP';
