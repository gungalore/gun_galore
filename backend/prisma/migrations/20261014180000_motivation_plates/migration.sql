-- The purpose exhibits for one motivation: one to two pages of photographic
-- plates under heading 3, each with a title and a neutral description.
--
-- One row per plate rather than one blob per motivation, so a safety refusal
-- or a slow call loses ONE plate and never the page, and so a plate can be
-- explained and redrawn on its own.
--
-- Bytes in the row rather than a data directory so the nightly pg_dump covers
-- them without a change to backup.sh that somebody would forget -- the failure
-- mode there is a pack rendering with a blank box, and it is silent.
CREATE TABLE "MotivationPlate" (
  "id"            TEXT         NOT NULL,
  "motivationId"  TEXT         NOT NULL,
  "purpose"       VARCHAR(30)  NOT NULL,
  "pageIndex"     INTEGER      NOT NULL,
  "plateIndex"    INTEGER      NOT NULL,
  "title"         VARCHAR(160) NOT NULL,
  "description"   TEXT         NOT NULL,
  "prompt"        TEXT         NOT NULL,
  "promptVersion" VARCHAR(40)  NOT NULL,
  "mimeType"      VARCHAR(40)  NOT NULL,
  "bytes"         BYTEA        NOT NULL,
  "width"         INTEGER      NOT NULL,
  "height"        INTEGER      NOT NULL,
  "model"         VARCHAR(80)  NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MotivationPlate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MotivationPlate_motivationId_pageIndex_plateIndex_key"
  ON "MotivationPlate"("motivationId", "pageIndex", "plateIndex");

CREATE INDEX "MotivationPlate_motivationId_pageIndex_plateIndex_idx"
  ON "MotivationPlate"("motivationId", "pageIndex", "plateIndex");

ALTER TABLE "MotivationPlate"
  ADD CONSTRAINT "MotivationPlate_motivationId_fkey"
  FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
