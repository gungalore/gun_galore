-- Which firearm category a licence is for, in the clear.
--
-- The type is already read off every firearm licence, but it lands inside
-- detailsEncrypted where SQL cannot see it. A competency certificate's expiry
-- is the latest expiry among the licences IN ITS CATEGORY -- a group-by -- so
-- without this column the derivation cannot run at all.
--
-- No backfill here: the existing rows' types are inside the encrypted blob and
-- only the application can open it. list() fills this in on first read, the
-- same way it repairs a placeholder title, and leaves the row alone when it
-- cannot read one.

ALTER TABLE "Credential" ADD COLUMN "firearmCategory" VARCHAR(16);

-- The derivation groups a member's licences by category.
CREATE INDEX "Credential_userId_firearmCategory_idx"
  ON "Credential" ("userId", "firearmCategory");
