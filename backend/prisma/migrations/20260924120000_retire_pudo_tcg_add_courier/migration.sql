-- Retire the Pudo + TCG courier rails. Bob Go (door-to-door) is the only
-- courier rail from 2026-09-24; the platform books the cheapest Bob Go door
-- rate for every non-firearm couriered parcel.
--
-- The PUDO and TCG enum values are deliberately KEPT (deprecated) so historical
-- rows and stored JSON still parse. Nothing writes them any more.

-- New single courier value. Added at the end of the enum by Postgres; the
-- Prisma schema lists it first, which is cosmetic only.
ALTER TYPE "ShippingMethod" ADD VALUE IF NOT EXISTS 'COURIER';

-- The seller no longer pre-picks a Pudo drop-off locker.
ALTER TABLE "Listing" DROP COLUMN IF EXISTS "pickupPudoLockerId";

-- Per-carrier Pudo/TCG tracking + label columns, unused once the rail is gone.
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "pudoDropoffLockerId";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "pudoPickupLockerId";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "pudoTrackingCode";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "tcgWaybill";
