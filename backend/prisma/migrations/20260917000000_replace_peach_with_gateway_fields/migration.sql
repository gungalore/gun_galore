-- Replace Peach-prefixed gateway fields with vendor-neutral gateway* names
-- (operator decision 2026-09: Peach Payments → Ozow). Column + unique-index
-- renames only — no data is moved or dropped, and the raw-DDL FTS columns and
-- GIN/pg_trgm indexes (intentionally absent from schema.prisma) are untouched.

-- User
ALTER TABLE "User" RENAME COLUMN "peachCustomerId" TO "gatewayCustomerId";
ALTER INDEX "User_peachCustomerId_key" RENAME TO "User_gatewayCustomerId_key";

-- Transaction
ALTER TABLE "Transaction" RENAME COLUMN "peachCheckoutId" TO "gatewayCheckoutId";
ALTER TABLE "Transaction" RENAME COLUMN "peachMerchantRef" TO "gatewayMerchantRef";
ALTER INDEX "Transaction_peachMerchantRef_key" RENAME TO "Transaction_gatewayMerchantRef_key";
ALTER TABLE "Transaction" RENAME COLUMN "peachPayoutId" TO "gatewayPayoutId";
ALTER INDEX "Transaction_peachPayoutId_key" RENAME TO "Transaction_gatewayPayoutId_key";
ALTER TABLE "Transaction" RENAME COLUMN "peachPaymentId" TO "gatewayPaymentId";
ALTER INDEX "Transaction_peachPaymentId_key" RENAME TO "Transaction_gatewayPaymentId_key";
ALTER TABLE "Transaction" RENAME COLUMN "peachResultCode" TO "gatewayResultCode";

-- FeaturedSlotBid
ALTER TABLE "FeaturedSlotBid" RENAME COLUMN "peachPaymentId" TO "gatewayPaymentId";

-- Subscription
ALTER TABLE "Subscription" RENAME COLUMN "peachCustomerId" TO "gatewayCustomerId";

-- SubscriptionCharge
ALTER TABLE "SubscriptionCharge" RENAME COLUMN "peachPaymentId" TO "gatewayPaymentId";
