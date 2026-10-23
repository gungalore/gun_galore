-- Email-delivery stamps: both the buyer and the seller receive their Zoho
-- document by email, and these timestamps make the send idempotent across
-- retries.
ALTER TABLE "Transaction" ADD COLUMN "zohoBuyerInvoiceEmailedAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "zohoSellerInvoiceEmailedAt" TIMESTAMP(3);
