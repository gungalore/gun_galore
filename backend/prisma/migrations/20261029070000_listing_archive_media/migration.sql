-- Safe retention for cancelled listings that never became a sale.
-- The row stays for offer/bid/audit references; only its media and seller-list
-- visibility are retired once the archive sweep runs.
ALTER TABLE "Listing"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "mediaPurgedAt" TIMESTAMP(3);

CREATE INDEX "Listing_status_archivedAt_idx"
  ON "Listing"("status", "archivedAt");
