-- CreateEnum
CREATE TYPE "HuntPdfCategory" AS ENUM ('SPECIES_GUIDE', 'CARTRIDGE_DATA', 'REGULATIONS', 'BALLISTICS_THEORY', 'HUNTING_TECHNIQUE', 'FLORA_REFERENCE', 'GENERAL');

-- CreateEnum
CREATE TYPE "HuntPdfStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "HuntPdf" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "edition" TEXT,
    "publisher" TEXT,
    "publishedYear" INTEGER,
    "category" "HuntPdfCategory" NOT NULL DEFAULT 'GENERAL',
    "language" TEXT NOT NULL DEFAULT 'en',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "status" "HuntPdfStatus" NOT NULL DEFAULT 'DRAFT',
    "blurb" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HuntPdf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HuntPdfPage" (
    "id" TEXT NOT NULL,
    "pdfId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "imageBase64" TEXT,
    "imageMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HuntPdfPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HuntPdf_status_category_sortOrder_idx" ON "HuntPdf"("status", "category", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "HuntPdfPage_pdfId_pageNumber_key" ON "HuntPdfPage"("pdfId", "pageNumber");

-- CreateIndex
CREATE INDEX "HuntPdfPage_pdfId_pageNumber_idx" ON "HuntPdfPage"("pdfId", "pageNumber");

-- AddForeignKey
ALTER TABLE "HuntPdfPage" ADD CONSTRAINT "HuntPdfPage_pdfId_fkey" FOREIGN KEY ("pdfId") REFERENCES "HuntPdf"("id") ON DELETE CASCADE ON UPDATE CASCADE;
