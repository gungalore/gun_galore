-- Zoho Books: record the carrier expense raised for a courier sale.
-- Nullable so every existing transaction remains valid.
ALTER TABLE "Transaction" ADD COLUMN "zohoShippingExpenseId" TEXT;
