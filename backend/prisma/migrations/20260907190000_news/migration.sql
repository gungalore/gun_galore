-- Local crime reporting near an applicant — three new tables.
--
-- HAND-WRITTEN, NOT `prisma migrate diff`. See [BC-SCHEMA-DRIFT] in
-- LAUNCH-CHECKLIST.md: three services (Ask GG KB, reloading-manual FTS,
-- listings FTS) add tsvector GENERATED columns and GIN indexes at boot via
-- raw DDL, and those columns are not declared in schema.prisma. A generated
-- diff reads them as drift and emits DROPs for them.
--
-- Purely ADDITIVE: three new tables, their indexes and one foreign key
-- between two of them. No existing table, column, constraint or index is
-- touched, so there is nothing to back-fill and nothing to roll back beyond
-- DROPs.

CREATE TABLE "NewsSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "homepage" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "district" TEXT,
    "towns" TEXT[],
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "radiusKm" INTEGER NOT NULL DEFAULT 25,
    "kind" TEXT NOT NULL DEFAULT 'local',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastPolledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NewsSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "standfirst" TEXT,
    "imageUrl" TEXT,
    "author" TEXT,
    "publishedOn" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCrime" BOOLEAN,
    "crimeType" TEXT,
    "places" TEXT[],
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "taggedAt" TIMESTAMP(3),

    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsPlace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "lookedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsPlace_pkey" PRIMARY KEY ("id")
);

-- The registry upsert matches on the key, every run.
CREATE UNIQUE INDEX "NewsSource_key_key" ON "NewsSource"("key");

-- "Every enabled feed", which is the whole of what the poll asks for.
CREATE INDEX "NewsSource_enabled_kind_idx" ON "NewsSource"("enabled", "kind");

-- ⚠️ THE DEDUPE KEY. Caxton titles syndicate each other's copy, so the same
-- article arrives from four feeds in one run; the URL is what makes it one
-- clipping. Unique so a concurrent poll collides rather than doubling.
CREATE UNIQUE INDEX "NewsArticle_url_key" ON "NewsArticle"("url");

-- The twelve-month window, and the nightly retention delete.
CREATE INDEX "NewsArticle_publishedOn_idx" ON "NewsArticle"("publishedOn");

CREATE INDEX "NewsArticle_sourceId_publishedOn_idx" ON "NewsArticle"("sourceId", "publishedOn");

-- Postgres cannot index a haversine, so the bounding box is what the read
-- narrows on before the distance is computed in the service.
CREATE INDEX "NewsArticle_lat_lng_idx" ON "NewsArticle"("lat", "lng");

CREATE UNIQUE INDEX "NewsPlace_name_key" ON "NewsPlace"("name");

ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
