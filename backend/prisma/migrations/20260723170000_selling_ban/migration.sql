-- Firm seller-standing policy: 3 strikes = banned from LISTING (buying
-- unaffected). Rename the suspension column to what it now means.
ALTER TABLE "User" RENAME COLUMN "offersSuspendedAt" TO "sellingBannedAt";
