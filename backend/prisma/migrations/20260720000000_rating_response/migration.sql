-- Ratings hardening: seller reply + edit tracking (table had 0 rows).
ALTER TABLE "Rating" ADD COLUMN "sellerResponse" TEXT;
ALTER TABLE "Rating" ADD COLUMN "sellerRespondedAt" TIMESTAMP(3);
ALTER TABLE "Rating" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
