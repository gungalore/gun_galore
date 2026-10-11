-- Value My Item external research: the curated registry of price sources.
-- Config only. We read prices/specs from these domains but never store their
-- URLs. Hand-written because the dev DB carries intentional raw-DDL FTS drift,
-- so `prisma migrate dev` offers a reset. Applied with `prisma migrate deploy`.

CREATE TABLE "ValuationSource" (
    "id"           TEXT NOT NULL,
    "domain"       TEXT NOT NULL,
    "label"        TEXT NOT NULL,
    "platform"     TEXT NOT NULL,
    "roles"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "categories"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "saVerified"   BOOLEAN NOT NULL DEFAULT true,
    "enabled"      BOOLEAN NOT NULL DEFAULT false,
    "needsApify"   BOOLEAN NOT NULL DEFAULT false,
    "specFields"   JSONB,
    "pricedHits"   INTEGER NOT NULL DEFAULT 0,
    "totalHits"    INTEGER NOT NULL DEFAULT 0,
    "lastCheckAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValuationSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ValuationSource_domain_key" ON "ValuationSource"("domain");
CREATE INDEX "ValuationSource_enabled_idx" ON "ValuationSource"("enabled");
CREATE INDEX "ValuationSource_platform_idx" ON "ValuationSource"("platform");
