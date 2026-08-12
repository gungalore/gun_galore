-- Phase 4 P4.1 (additive): partial-refund accounting on Transaction.
-- refundedAmount tracks cumulative cents refunded to the buyer; the order
-- only flips to REFUNDED once it reaches buyerTotal.
ALTER TABLE "Transaction"
  ADD COLUMN "refundedAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastRefundAt" TIMESTAMP(3);
