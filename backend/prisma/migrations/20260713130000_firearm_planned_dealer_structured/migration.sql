-- Firearm/barrel planned dealer-stock: split the single free-text hint into
-- structured, mandatory parts (dealer name + province + area). Additive and
-- all-nullable, so existing rows are unaffected. plannedDealerLocation stays
-- as the server-composed display string ("<name> — <area>, <province>").
ALTER TABLE "Listing" ADD COLUMN "plannedDealerName" TEXT;
ALTER TABLE "Listing" ADD COLUMN "plannedDealerProvince" TEXT;
ALTER TABLE "Listing" ADD COLUMN "plannedDealerArea" TEXT;
