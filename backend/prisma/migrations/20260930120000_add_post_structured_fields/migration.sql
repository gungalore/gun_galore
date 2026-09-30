-- Optional per-category "details" fields on community posts. ALL are
-- nullable / defaulted, so existing rows are untouched. The permitted value
-- sets per PostType live in backend/src/feed/feed.types.ts and are enforced in
-- the service layer, not as DB enums, so a vocabulary can grow without a
-- migration. See docs/design/community-feed/spec.md.

ALTER TABLE "Post"
    ADD COLUMN     "flair"          TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN     "species"        TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN     "occurredAt"     TIMESTAMP(3),
    ADD COLUMN     "calibre"        VARCHAR(40),
    ADD COLUMN     "firearmType"    VARCHAR(20),
    ADD COLUMN     "firearmModel"   VARCHAR(60),
    ADD COLUMN     "bulletWeightGr" INTEGER,
    ADD COLUMN     "powderChargeGr" INTEGER,
    ADD COLUMN     "testResult"     VARCHAR(120),
    ADD COLUMN     "waterType"      VARCHAR(20),
    ADD COLUMN     "sizeCm"         INTEGER,
    ADD COLUMN     "shotDistanceM"  INTEGER,
    ADD COLUMN     "siteType"       VARCHAR(20),
    ADD COLUMN     "tripDays"       INTEGER,
    ADD COLUMN     "gearCategory"   VARCHAR(20),
    ADD COLUMN     "gearRating"     INTEGER,
    ADD COLUMN     "gearCondition"  VARCHAR(20),
    ADD COLUMN     "context"        VARCHAR(20);

-- The free-form `gear` JSON was written but never read or rendered; the typed
-- columns above replace it.
ALTER TABLE "Post" DROP COLUMN "gear";

CREATE INDEX "Post_species_idx"    ON "Post" USING GIN ("species" array_ops);
CREATE INDEX "Post_flair_idx"      ON "Post" USING GIN ("flair" array_ops);
CREATE INDEX "Post_calibre_idx"    ON "Post"("calibre");
CREATE INDEX "Post_gearRating_idx" ON "Post"("gearRating");
