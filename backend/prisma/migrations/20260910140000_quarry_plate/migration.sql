-- The quarry photograph for one motivation.
--
-- One per application rather than one per species: at three and a half US
-- cents the sharing would save almost nothing, and the same photograph in two
-- applicants' packs is the sort of thing a reviewer notices about a templated
-- document.
--
-- Stored rather than made on demand for LATENCY, not money. The pack renders
-- on every download and a picture model takes ten to twenty seconds against
-- the sixty-second nginx ceiling; the call happens once, during generation,
-- beside the research and the cover photograph.
--
-- Bytes in the row rather than a data directory so the nightly pg_dump covers
-- them without a change to backup.sh that somebody would forget -- the failure
-- mode there is a pack rendering with a blank box, and it is silent.
CREATE TABLE "QuarryPlate" (
  "motivationId"  TEXT PRIMARY KEY,
  "speciesKeys"   VARCHAR(200) NOT NULL,
  "promptVersion" VARCHAR(40)  NOT NULL,
  "mimeType"      VARCHAR(40)  NOT NULL,
  "bytes"         BYTEA        NOT NULL,
  "width"         INTEGER      NOT NULL,
  "height"        INTEGER      NOT NULL,
  "model"         VARCHAR(80)  NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuarryPlate_motivationId_fkey"
    FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
