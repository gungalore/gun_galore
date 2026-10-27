-- Seller failure charges: recover the platform's unrecoverable costs when a
-- PAID sale ends through the seller's own failure (declined, never dispatched,
-- never delivered).
--
-- The failed sale is refunded, so its sellerPayout is already zero and there
-- is nothing left to dock on that row. The charge therefore lives in its own
-- ledger and is set off against a LATER payout.
--
-- No FK to "User" or "Transaction" on "SellerCharge": this is an audit + money
-- record that must outlive account deletion (same reasoning as SellerStrike).

CREATE TYPE "SellerChargeKind" AS ENUM ('SELLER_CANCELLED', 'NO_DISPATCH', 'NOT_DELIVERED', 'DEALER_TRANSFER_FAILED');
CREATE TYPE "SellerChargeRecoveryStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED');

CREATE TABLE "SellerCharge" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "kind" "SellerChargeKind" NOT NULL,
    "reason" TEXT,
    "handlingCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waivedAt" TIMESTAMP(3),
    "waivedById" TEXT,
    "waivedReason" TEXT,

    CONSTRAINT "SellerCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerCharge_transactionId_kind_key" ON "SellerCharge"("transactionId", "kind");
CREATE INDEX "SellerCharge_sellerId_waivedAt_idx" ON "SellerCharge"("sellerId", "waivedAt");
CREATE INDEX "SellerCharge_sellerId_createdAt_idx" ON "SellerCharge"("sellerId", "createdAt");

CREATE TABLE "SellerChargeRecovery" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "SellerChargeRecoveryStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "SellerChargeRecovery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SellerChargeRecovery_chargeId_idx" ON "SellerChargeRecovery"("chargeId");
CREATE INDEX "SellerChargeRecovery_transactionId_idx" ON "SellerChargeRecovery"("transactionId");

ALTER TABLE "SellerChargeRecovery" ADD CONSTRAINT "SellerChargeRecovery_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "SellerCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The seller's only notice: one email after the cooling-off window, stating
-- the costs that will be recovered if they do not deliver.
ALTER TABLE "Transaction" ADD COLUMN "deliveryObligationNotifiedAt" TIMESTAMP(3);

