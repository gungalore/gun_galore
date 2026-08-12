-- PRO prize draw (promotional competition) — inert until pro_draw_enabled.
CREATE TYPE "PrizeDrawStatus" AS ENUM ('LIVE', 'DRAWN', 'FULFILLED', 'CANCELLED');

CREATE TABLE "PrizeDraw" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "prizeValueCents" INTEGER NOT NULL,
    "imageUrls" TEXT[],
    "status" "PrizeDrawStatus" NOT NULL DEFAULT 'LIVE',
    "displayStartAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drawAt" TIMESTAMP(3) NOT NULL,
    "drawnAt" TIMESTAMP(3),
    "winnerUserId" TEXT,
    "entrantCount" INTEGER NOT NULL DEFAULT 0,
    "drawAudit" JSONB,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilmentNote" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrizeDraw_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrizeDraw_status_drawAt_idx" ON "PrizeDraw"("status", "drawAt");

ALTER TABLE "PrizeDraw" ADD CONSTRAINT "PrizeDraw_winnerUserId_fkey"
    FOREIGN KEY ("winnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
