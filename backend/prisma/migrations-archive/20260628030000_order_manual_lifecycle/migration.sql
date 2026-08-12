-- Phase 8b-2: order-level manual-EFT lifecycle (additive). Mirrors the
-- per-Transaction manual fields so a multi-item order has ONE pay-by window,
-- ONE provisional-detect flag and ONE cancel flag — letting the order freeze
-- sweep release all lines together. Inert until order checkout writes Orders.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "manualPayByAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "manualDetectedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "manualCancelledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_status_manualPayByAt_idx" ON "Order"("status", "manualPayByAt");

-- AlterTable: ManualPayment can point at an Order (multi-item) instead of a tx
ALTER TABLE "ManualPayment" ADD COLUMN "matchedOrderId" TEXT;

-- AddForeignKey
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_matchedOrderId_fkey" FOREIGN KEY ("matchedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
