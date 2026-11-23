-- Public listing Q&A distilled from private buyer↔seller inquiries.
--
-- One `ListingFaq` row per inquiry (`inquiryId` unique): the cleaned question
-- and the seller's answer, published once the seller has replied. The buyer is
-- never identified and no asker id is stored.
--
-- ⚠️ `hiddenAt` is PLATFORM moderation only. The seller cannot hide or delete
-- an answered question; no seller endpoint or UI may set this column.
--
-- `ListingInquiry.sellerFirstReplyAt` is stamped on the seller's first text or
-- media reply so the public "Usually replies within ..." badge can be computed
-- from inquiries alone (createdAt = the first buyer message). Nullable, so the
-- change is safe against production: existing threads simply have no reply
-- time measured until the seller answers again.

ALTER TABLE "ListingInquiry"
  ADD COLUMN "sellerFirstReplyAt" TIMESTAMP(3);

CREATE TABLE "ListingFaq" (
  "id"          TEXT NOT NULL,
  "listingId"   TEXT NOT NULL,
  "inquiryId"   TEXT NOT NULL,
  "question"    TEXT NOT NULL,
  "answer"      TEXT NOT NULL,
  "hiddenAt"    TIMESTAMP(3),
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ListingFaq_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingFaq_inquiryId_key"
  ON "ListingFaq"("inquiryId");

CREATE INDEX "ListingFaq_listingId_hiddenAt_updatedAt_idx"
  ON "ListingFaq"("listingId", "hiddenAt", "updatedAt");

ALTER TABLE "ListingFaq"
  ADD CONSTRAINT "ListingFaq_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListingFaq"
  ADD CONSTRAINT "ListingFaq_inquiryId_fkey"
  FOREIGN KEY ("inquiryId") REFERENCES "ListingInquiry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
