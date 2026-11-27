-- Multi-item checkout: order-level card payment + status/expiry indexes.
--
-- The Order owns the ONE gateway capture for a multi-seller cart, so the
-- gateway identity (provider, merchant ref, redirect URL, result code) and the
-- AWAITING_PAYMENT deadline live here. Child Transactions keep their own
-- gatewayPaymentId, written only after the order payment is verified.
--
-- No enum values change: PaymentProvider already carries OZOW/PEACH/YOCO
-- (YOCO is refused by the marketplace checkout in code) and OrderStatus
-- already carries AWAITING_PAYMENT/PAID/PARTIALLY_FULFILLED/COMPLETED/
-- CANCELLED/REFUNDED. No db push: this migration is the schema change.

ALTER TABLE "Order"
  ADD COLUMN "paymentProvider" "PaymentProvider",
  ADD COLUMN "gatewayMerchantRef" TEXT,
  ADD COLUMN "gatewayRedirectUrl" TEXT,
  ADD COLUMN "gatewayResultCode" TEXT,
  ADD COLUMN "paymentAttemptExpiresAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "zohoBuyerInvoiceId" TEXT,
  ADD COLUMN "zohoBuyerInvoiceEmailedAt" TIMESTAMP(3);

-- The 5-minute expiry sweep scans unpaid attempts by status + deadline.
CREATE INDEX "Order_status_paymentAttemptExpiresAt_idx"
  ON "Order"("status", "paymentAttemptExpiresAt");

-- Webhook/verify fallback: checkout id is the primary match, merchant ref the
-- fallback when a rail echoes only the reference.
CREATE INDEX "Order_gatewayCheckoutId_idx" ON "Order"("gatewayCheckoutId");
CREATE INDEX "Order_gatewayMerchantRef_idx" ON "Order"("gatewayMerchantRef");

-- Buyer's order list (newest first).
CREATE INDEX "Order_buyerId_createdAt_idx" ON "Order"("buyerId", "createdAt");
