import { Module } from '@nestjs/common';
import { AdminAuditService } from '../admin/admin-audit.service';
import { JwtModule } from '@nestjs/jwt';
import { adminJwtSecret } from '../admin/admin-jwt-secret';
import { ReloadingService } from './reloading.service';
import { LoadDataExtractionService } from './load-data-extraction.service';
import { ReloadingAdminController } from './reloading-admin.controller';

/**
 * Phase D — reloading-manual ingestion + indexing pipeline.
 *
 * Sprint 1 (this drop): server-filesystem storage + scan-inbox
 * workflow. Operator SCPs PDFs into RELOADING_MANUALS_INBOX_DIR on
 * prod, hits POST /admin/reloading/scan, the service hashes every
 * file (SHA-256 dedup), copies new ones into permanent storage,
 * extracts text with pdf-parse, and inserts ReloadingManualPage
 * rows. A Postgres tsvector + GIN index on the page text makes
 * Sprint 2's search instant across the full corpus.
 *
 * ⚠️ Sprint 2 wired this FTS index into the Ask GG chat's tool loop so a
 * member could ask a load-data question and get an answer with a citation
 * off the real manual page. That chat was RETIRED 2026-09-07 and AskGgModule
 * no longer imports this module; the index now serves the admin scan tools
 * and The Bench.
 */
@Module({
  imports: [
    // JwtModule for AdminJwtGuard verification — same secret + config
    // pattern as AdminModule. Kept local here so this module doesn't
    // need to import AdminModule and create a circular dependency.
    JwtModule.register({
      secret: adminJwtSecret(),
    }),
  ],
  controllers: [ReloadingAdminController],
  providers: [ReloadingService, LoadDataExtractionService, AdminAuditService],
  exports: [ReloadingService],
})
export class ReloadingModule {}
