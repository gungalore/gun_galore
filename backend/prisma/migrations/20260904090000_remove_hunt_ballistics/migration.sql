-- Hunt Ballistics removed (operator 2026-09-04: "Hunt ballistics also will not be used again").
--
-- All three tables were EMPTY in production when this was written -- HuntPdf 0,
-- HuntPdfPage 0, RangeEstimate 0 -- so there is no data to migrate or preserve.
--
-- HuntPdfPage also carried a runtime-only GENERATED tsvector column (textTsv)
-- plus a GIN index, created by HuntPdfService.onModuleInit() raw SQL rather than
-- declared in schema.prisma. DROP TABLE removes both along with the table, and
-- nothing recreates them on the next boot because that service is deleted.
--
-- NOTE the FK drop has to come first: HuntPdfPage references HuntPdf, so
-- dropping the parent ahead of the constraint would abort the migration.

-- DropForeignKey
ALTER TABLE "HuntPdfPage" DROP CONSTRAINT "HuntPdfPage_pdfId_fkey";

-- DropTable
DROP TABLE "HuntPdf";

-- DropTable
DROP TABLE "HuntPdfPage";

-- DropTable
DROP TABLE "RangeEstimate";

-- DropEnum
DROP TYPE "HuntPdfCategory";

-- DropEnum
DROP TYPE "HuntPdfStatus";
