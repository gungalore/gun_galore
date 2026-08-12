-- SWOP/Trade S0 — additive schema for the fully-managed two-way swap module.
-- New ListingType value, three new enums, Swap + SwapProposal tables, and
-- Transaction.swapId/swapRole. No drops, no backfill, no behaviour change
-- (nothing creates a SWOP listing or a Swap yet — ships dark).

-- 1. New ListingType value (not USED in this migration, so safe in-tx).
ALTER TYPE "ListingType" ADD VALUE IF NOT EXISTS 'SWOP';

-- 2. New enums.
CREATE TYPE "SwapProposalStatus" AS ENUM ('PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'CONVERTED');
CREATE TYPE "SwapStatus" AS ENUM ('AWAITING_FUNDING', 'LOCKED', 'IN_TRANSIT', 'AWAITING_VERIFICATION', 'COMPLETED', 'CANCELLED', 'DISPUTED');
CREATE TYPE "SwapRole" AS ENUM ('INITIATOR_GIVES', 'OWNER_GIVES');

-- 3. Transaction swap-leg columns (nullable; legs carry zero money).
ALTER TABLE "Transaction" ADD COLUMN "swapId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "swapRole" "SwapRole";

-- 4. Swap parent.
CREATE TABLE "Swap" (
    "id" TEXT NOT NULL,
    "status" "SwapStatus" NOT NULL DEFAULT 'AWAITING_FUNDING',
    "initiatorId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "cashPayerId" TEXT,
    "cashAmount" INTEGER NOT NULL DEFAULT 0,
    "swapFeeInitiator" INTEGER NOT NULL DEFAULT 0,
    "swapFeeOwner" INTEGER NOT NULL DEFAULT 0,
    "cashOrderReference" TEXT,
    "gatewayCheckoutId" TEXT,
    "gatewayPaymentId" TEXT,
    "cashPayByAt" TIMESTAMP(3),
    "cashDetectedAt" TIMESTAMP(3),
    "cashVerifiedAt" TIMESTAMP(3),
    "cashCancelledAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Swap_pkey" PRIMARY KEY ("id")
);

-- 5. SwapProposal negotiation.
CREATE TABLE "SwapProposal" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "proposerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "offeredListingId" TEXT NOT NULL,
    "cashAmount" INTEGER NOT NULL DEFAULT 0,
    "cashDirection" "SwapRole",
    "counterCashAmount" INTEGER,
    "counterCashDirection" "SwapRole",
    "proposerNote" TEXT,
    "ownerNote" TEXT,
    "status" "SwapProposalStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "swapId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SwapProposal_pkey" PRIMARY KEY ("id")
);

-- 6. Unique indexes.
CREATE UNIQUE INDEX "Swap_cashOrderReference_key" ON "Swap"("cashOrderReference");
CREATE UNIQUE INDEX "Swap_gatewayPaymentId_key" ON "Swap"("gatewayPaymentId");
CREATE UNIQUE INDEX "SwapProposal_swapId_key" ON "SwapProposal"("swapId");
CREATE UNIQUE INDEX "SwapProposal_listingId_proposerId_key" ON "SwapProposal"("listingId", "proposerId");

-- 7. Secondary indexes.
CREATE INDEX "Swap_initiatorId_status_idx" ON "Swap"("initiatorId", "status");
CREATE INDEX "Swap_ownerId_status_idx" ON "Swap"("ownerId", "status");
CREATE INDEX "Swap_status_cashPayByAt_idx" ON "Swap"("status", "cashPayByAt");
CREATE INDEX "SwapProposal_listingId_idx" ON "SwapProposal"("listingId");
CREATE INDEX "SwapProposal_proposerId_idx" ON "SwapProposal"("proposerId");
CREATE INDEX "SwapProposal_ownerId_idx" ON "SwapProposal"("ownerId");
CREATE INDEX "SwapProposal_status_idx" ON "SwapProposal"("status");

-- 8. Foreign keys.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "Swap"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_offeredListingId_fkey" FOREIGN KEY ("offeredListingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "Swap"("id") ON DELETE SET NULL ON UPDATE CASCADE;
