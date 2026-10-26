-- Dealer-portal invites + dealer contact details on the listing.
ALTER TABLE "Listing" ADD COLUMN "plannedDealerAddress" TEXT;
ALTER TABLE "Listing" ADD COLUMN "plannedDealerPhone" TEXT;
ALTER TABLE "Listing" ADD COLUMN "plannedDealerWebsite" TEXT;
ALTER TABLE "Listing" ADD COLUMN "plannedDealerEmail" TEXT;

ALTER TABLE "Dealer" ADD COLUMN "placeId" TEXT;
ALTER TABLE "Dealer" ADD COLUMN "website" TEXT;
CREATE UNIQUE INDEX "Dealer_placeId_key" ON "Dealer"("placeId");

ALTER TABLE "Transaction" ADD COLUMN "dealerVerificationRequestedAt" TIMESTAMP(3);

CREATE TABLE "DealerPortalRequest" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "dealerEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "stampPhotoUrl" TEXT,
    "saps534PhotoUrl" TEXT,
    "form" JSONB,
    "aiFindings" JSONB,
    "aiConfidence" DOUBLE PRECISION,
    "dealerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealerPortalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerPortalRequest_tokenHash_key" ON "DealerPortalRequest"("tokenHash");
CREATE INDEX "DealerPortalRequest_transactionId_idx" ON "DealerPortalRequest"("transactionId");
CREATE INDEX "DealerPortalRequest_status_idx" ON "DealerPortalRequest"("status");

ALTER TABLE "DealerPortalRequest"
    ADD CONSTRAINT "DealerPortalRequest_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealerPortalRequest"
    ADD CONSTRAINT "DealerPortalRequest_dealerId_fkey"
    FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
