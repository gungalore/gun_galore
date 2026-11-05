-- A searchable, section-level South African firearms law corpus.
--
-- The source documents are the Firearms Control Act 60 of 2000, the Firearms
-- Control Regulations 2004 (GN R345), and the Firearms Control Amendment Act
-- 2006. The ingest script (backend/scripts/ingest-legal.ts) is the only writer;
-- this migration creates the store and its full-text index.
--
-- The tsvector is a generated column so it can never drift from the text it
-- indexes. Prisma cannot express tsvector, so it lives here in raw DDL, the same
-- posture as the existing AskGgKbEntry / ReloadingManualPage columns.

CREATE TABLE "LegalSource" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortTitle" TEXT NOT NULL,
    "citation" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "licence" TEXT,
    "sourceUrl" TEXT,
    "sourcePath" TEXT NOT NULL,
    "fullText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalSource_slug_key" ON "LegalSource"("slug");
CREATE INDEX "LegalSource_documentType_idx" ON "LegalSource"("documentType");

CREATE TABLE "LegalProvision" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "chapter" TEXT,
    "part" TEXT,
    "sectionNumber" TEXT NOT NULL,
    "heading" TEXT,
    "citation" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalProvision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalProvision_sourceId_sectionNumber_ordinal_key"
  ON "LegalProvision"("sourceId", "sectionNumber", "ordinal");
CREATE INDEX "LegalProvision_sourceId_sectionNumber_idx"
  ON "LegalProvision"("sourceId", "sectionNumber");
CREATE INDEX "LegalProvision_sourceId_ordinal_idx"
  ON "LegalProvision"("sourceId", "ordinal");

ALTER TABLE "LegalProvision"
  ADD CONSTRAINT "LegalProvision_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "LegalSource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LegalProvision"
  ADD COLUMN "searchTsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE("sectionNumber", '')), 'A') ||
    setweight(to_tsvector('english', COALESCE("heading", '')), 'A') ||
    setweight(to_tsvector('english', COALESCE("citation", '')), 'B') ||
    setweight(to_tsvector('english', COALESCE("text", '')), 'C')
  ) STORED;

CREATE INDEX "LegalProvision_searchTsv_idx"
  ON "LegalProvision" USING gin ("searchTsv");
