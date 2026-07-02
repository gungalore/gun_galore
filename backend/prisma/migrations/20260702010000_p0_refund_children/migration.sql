-- P0.3 — partial refunds on the manual rail settle via SYNTHETIC child
-- transactions (paymentStatus REFUNDED, buyerTotal = the refund slice,
-- sellerPayout 0). refundOfId links a child to the original sale so each
-- slice flows through the FNB refund batch with its own payoutBatchId /
-- paidOutAt lifecycle. Purely additive: one nullable column, one self-FK,
-- one index. No drops, no backfill, no behaviour change for existing rows
-- (legacy fully-refunded parents keep paying buyerTotal once — the refund
-- queue only excludes parents that HAVE children, and none exist yet).

ALTER TABLE "Transaction" ADD COLUMN "refundOfId" TEXT;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_refundOfId_fkey"
  FOREIGN KEY ("refundOfId") REFERENCES "Transaction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Transaction_refundOfId_idx" ON "Transaction"("refundOfId");
