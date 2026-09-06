-- The other side of a two-sided document (a proficiency's certificate and
-- its statement of results point at each other).
--
-- ADDITIVE ONLY: one nullable text column on Credential. Hand-written, not
-- `prisma migrate diff` - see CLAUDE.md [BC-SCHEMA-DRIFT].
ALTER TABLE "Credential" ADD COLUMN "otherSideId" TEXT;
