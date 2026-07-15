-- CreateEnum
CREATE TYPE "AskGgGuideStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "AskGgGuideOverride" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "points" TEXT[],
    "ctas" JSONB,
    "status" "AskGgGuideStatus" NOT NULL DEFAULT 'DRAFT',
    "updatedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AskGgGuideOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AskGgGuideOverride_key_key" ON "AskGgGuideOverride"("key");

-- CreateIndex
CREATE INDEX "AskGgGuideOverride_status_idx" ON "AskGgGuideOverride"("status");
