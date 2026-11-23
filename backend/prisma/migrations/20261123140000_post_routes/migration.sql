-- Optional GPX route for a community post (Hiking and the other
-- route-capable outdoor types), alongside its text/photos/video.
--
-- ⚠️ Only the SIMPLIFIED, coordinate-only representation is stored:
-- `segments` is an array of segments of { lat, lon, ele, speedKph, gradientPct,
-- distM } points and `bounds` is { south, west, north, east }. There is NO raw
-- GPX file and no Cloudinary/public URL: a .gpx download is regenerated from
-- these rows, with timestamps and author metadata discarded.
--
-- One route per post (`postId` unique). Re-uploading replaces the row. The FK
-- cascades, so deleting a post removes its route without touching Cloudinary.

CREATE TABLE "PostRoute" (
  "id"              TEXT NOT NULL,
  "postId"          TEXT NOT NULL,
  "distanceM"       INTEGER NOT NULL,
  "ascentM"         INTEGER,
  "descentM"        INTEGER,
  "minElevationM"   INTEGER,
  "maxElevationM"   INTEGER,
  "durationSeconds" INTEGER,
  "pointCount"      INTEGER NOT NULL,
  "segmentCount"    INTEGER NOT NULL,
  "hasElevation"    BOOLEAN NOT NULL DEFAULT false,
  "hasSpeed"        BOOLEAN NOT NULL DEFAULT false,
  "gpxShared"       BOOLEAN NOT NULL DEFAULT true,
  "profile"         JSONB,
  "segments"        JSONB NOT NULL,
  "bounds"          JSONB NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PostRoute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostRoute_postId_key"
  ON "PostRoute"("postId");

ALTER TABLE "PostRoute"
  ADD CONSTRAINT "PostRoute_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "Post"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
