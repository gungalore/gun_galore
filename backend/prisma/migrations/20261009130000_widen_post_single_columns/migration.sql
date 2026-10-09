-- Community post single-select detail columns become free text (operator
-- decision 2026-10-09). The member may type any word, not only the seed
-- vocabulary, so the 20-char cap that matched the old fixed lists is raised to
-- 32 (FEED_MAX_SINGLE_LENGTH). Widening a varchar is metadata-only in
-- Postgres — no table rewrite.
-- (species/flair are text[] and already uncapped; see FEED_MAX_CHIP_LENGTH.)

ALTER TABLE "Post" ALTER COLUMN "firearmType" SET DATA TYPE VARCHAR(32);
ALTER TABLE "Post" ALTER COLUMN "waterType" SET DATA TYPE VARCHAR(32);
ALTER TABLE "Post" ALTER COLUMN "siteType" SET DATA TYPE VARCHAR(32);
ALTER TABLE "Post" ALTER COLUMN "gearCategory" SET DATA TYPE VARCHAR(32);
ALTER TABLE "Post" ALTER COLUMN "gearCondition" SET DATA TYPE VARCHAR(32);
ALTER TABLE "Post" ALTER COLUMN "context" SET DATA TYPE VARCHAR(32);
