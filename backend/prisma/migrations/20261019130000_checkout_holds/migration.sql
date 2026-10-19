-- 15-minute reservation created when a buyer opens a BUY_NOW checkout page.
-- Holds one unit for a multi-unit listing or the single item for a legacy
-- listing. The sale Transaction row is still created only at Pay.
CREATE TABLE "CheckoutHold" (
  "id"        TEXT         NOT NULL,
  "listingId" TEXT         NOT NULL,
  "buyerId"   TEXT         NOT NULL,
  "quantity"  INTEGER      NOT NULL DEFAULT 1,
  "claimedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CheckoutHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutHold_buyerId_listingId_key"
  ON "CheckoutHold"("buyerId", "listingId");
CREATE INDEX "CheckoutHold_listingId_idx" ON "CheckoutHold"("listingId");
CREATE INDEX "CheckoutHold_expiresAt_idx" ON "CheckoutHold"("expiresAt");

ALTER TABLE "CheckoutHold"
  ADD CONSTRAINT "CheckoutHold_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckoutHold"
  ADD CONSTRAINT "CheckoutHold_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
