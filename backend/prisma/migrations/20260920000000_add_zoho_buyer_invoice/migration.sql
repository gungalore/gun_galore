-- Add zohoBuyerInvoiceId to Transaction — the All Outdoor → Buyer invoice for
-- the platform's own supplies to the buyer (Buyer Protection Fee + delivery).
-- Operator 2026-09: route buyer and seller paperwork through Zoho Books so an
-- audit has one accounting system of record. Additive and nullable; no data
-- is moved or dropped.

ALTER TABLE "Transaction" ADD COLUMN "zohoBuyerInvoiceId" TEXT;
