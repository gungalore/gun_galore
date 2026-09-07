-- SAPS station-level crime statistics — three new tables.
--
-- HAND-WRITTEN, NOT `prisma migrate diff`. See [BC-SCHEMA-DRIFT] in
-- LAUNCH-CHECKLIST.md: three services (Ask GG KB, reloading-manual FTS,
-- listings FTS) add tsvector GENERATED columns and GIN indexes at boot via
-- raw DDL, and those columns are not declared in schema.prisma. A generated
-- diff reads them as drift and emits DROPs for them.
--
-- Purely ADDITIVE: three new tables, their indexes and two foreign keys
-- between them. No existing table, column, constraint or index is touched,
-- so there is nothing to back-fill and nothing to roll back beyond DROPs.

CREATE TABLE "CrimeStatsRelease" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "latestPeriod" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'loading',
    "error" TEXT,

    CONSTRAINT "CrimeStatsRelease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrimeStatsStation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "province" TEXT NOT NULL,

    CONSTRAINT "CrimeStatsStation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrimeStatsFigure" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" INTEGER,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "CrimeStatsFigure_pkey" PRIMARY KEY ("id")
);

-- The weekly fetch's "do we already hold this one?" check.
CREATE UNIQUE INDEX "CrimeStatsRelease_key_key" ON "CrimeStatsRelease"("key");

-- A re-published workbook under a name we already hold must collide here
-- rather than merge silently into the release it differs from.
CREATE UNIQUE INDEX "CrimeStatsRelease_fileSha256_key" ON "CrimeStatsRelease"("fileSha256");

-- "Newest ready release", which every read starts with.
CREATE INDEX "CrimeStatsRelease_status_latestPeriod_idx" ON "CrimeStatsRelease"("status", "latestPeriod");

-- Two provinces may spell a station the same way; name alone is not a key.
CREATE UNIQUE INDEX "CrimeStatsStation_name_province_key" ON "CrimeStatsStation"("name", "province");

CREATE INDEX "CrimeStatsStation_province_idx" ON "CrimeStatsStation"("province");

-- Idempotent load: re-running a release cannot double a count.
CREATE UNIQUE INDEX "CrimeStatsFigure_releaseId_stationId_category_period_key"
    ON "CrimeStatsFigure"("releaseId", "stationId", "category", "period");

-- The precinct read: one station, one release, every category and quarter.
CREATE INDEX "CrimeStatsFigure_stationId_releaseId_idx" ON "CrimeStatsFigure"("stationId", "releaseId");

ALTER TABLE "CrimeStatsFigure" ADD CONSTRAINT "CrimeStatsFigure_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "CrimeStatsRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrimeStatsFigure" ADD CONSTRAINT "CrimeStatsFigure_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "CrimeStatsStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
