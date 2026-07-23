-- Seller reject-reason policy (offers + sales). Additive only.

-- AlterTable Offer
ALTER TABLE "Offer" ADD COLUMN "metAutoAccept" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Offer" ADD COLUMN "rejectReason" TEXT;
ALTER TABLE "Offer" ADD COLUMN "rejectNote" TEXT;

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "sellerRejectStrikes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "offersSuspendedAt" TIMESTAMP(3);
