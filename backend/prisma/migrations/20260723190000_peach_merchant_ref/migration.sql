-- Peach Payments merchant reference (8-16 char merchantTransactionId).
-- Additive; nullable + unique (NULLs exempt in Postgres).
ALTER TABLE "Transaction" ADD COLUMN "peachMerchantRef" TEXT;
CREATE UNIQUE INDEX "Transaction_peachMerchantRef_key" ON "Transaction"("peachMerchantRef");
