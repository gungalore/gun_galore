-- Phase 2 (additive): notification channel preferences + address book.

-- Per-channel email/SMS mute on User. Default true = receive everything
-- (the historical behaviour), so existing rows are unaffected.
ALTER TABLE "User"
  ADD COLUMN "notifyEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifySmsEnabled"   BOOLEAN NOT NULL DEFAULT true;

-- Saved delivery addresses (address book). Purely additive — the legacy
-- single address on User.addr* stays as the fallback default at checkout.
CREATE TABLE "Address" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "label"      TEXT,
  "building"   TEXT,
  "street"     TEXT NOT NULL,
  "address2"   TEXT,
  "suburb"     TEXT,
  "city"       TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "province"   "Province" NOT NULL,
  "lat"        DOUBLE PRECISION,
  "lng"        DOUBLE PRECISION,
  "isDefault"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Address_userId_idx" ON "Address"("userId");
CREATE INDEX "Address_userId_isDefault_idx" ON "Address"("userId", "isDefault");

ALTER TABLE "Address"
  ADD CONSTRAINT "Address_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
