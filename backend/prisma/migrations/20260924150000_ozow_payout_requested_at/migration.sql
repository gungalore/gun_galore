ALTER TABLE "Transaction"
    ADD COLUMN "payoutRequestedAt" TIMESTAMP(3);

CREATE INDEX "Transaction_paymentStatus_paidOutAt_payoutRequestedAt_payoutHeldAt_idx"
    ON "Transaction"("paymentStatus", "paidOutAt", "payoutRequestedAt", "payoutHeldAt");
