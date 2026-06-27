-- Phase 4 P4.2 (additive): buyer-initiated cancellation of a paid-but-
-- undispatched courier order. Stamped when the buyer cancels; the cancel
-- path full-refunds + reactivates the listing.
ALTER TABLE "Transaction"
  ADD COLUMN "cancelledByBuyerAt" TIMESTAMP(3),
  ADD COLUMN "cancelledReason" TEXT;
