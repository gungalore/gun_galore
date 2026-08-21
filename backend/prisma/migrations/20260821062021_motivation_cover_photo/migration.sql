-- The cover photograph: which one, and where the applicant's own one lives.
--
-- Three nullable columns, no default and no backfill. A pack rendered before
-- this migration has coverPhotoChoice NULL, which reads as "nobody has been
-- asked" — the same state a brand-new motivation is in, and the correct one:
-- those applicants have not seen a cover photograph either.
ALTER TABLE "Motivation" ADD COLUMN "coverPhotoChoice" VARCHAR(12);
ALTER TABLE "Motivation" ADD COLUMN "coverPhotoKey" VARCHAR(120);
ALTER TABLE "Motivation" ADD COLUMN "coverPhotoMime" VARCHAR(40);
