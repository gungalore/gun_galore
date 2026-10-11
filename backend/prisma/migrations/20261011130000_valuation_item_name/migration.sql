-- Value My Item: the item name the member types on intake. It is mandatory at
-- the identify step (enforced in the API) but nullable here so valuations that
-- already exist survive the migration without a backfill.
ALTER TABLE "Valuation" ADD COLUMN "itemName" TEXT;
