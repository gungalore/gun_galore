import { Module } from '@nestjs/common';
import { AdminAuditService } from '../admin/admin-audit.service';
import { JwtModule } from '@nestjs/jwt';
import { ReloadingService } from './reloading.service';
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
 * Sprint 2: tool-use wiring in AskGgClaudeService so users can ask
 * load-data / reloading-theory questions, Claude searches the FTS
 * index, fetches the relevant pages from disk via pdf-lib, reads
 * the actual table, and answers with citation.
 */
@Module({
  imports: [
    // JwtModule for AdminJwtGuard verification — same secret + config
    // pattern as AdminModule. Kept local here so this module doesn't
    // need to import AdminModule and create a circular dependency.
    JwtModule.register({
      secret: process.env.JWT_ADMIN_SECRET || 'dev-admin-secret-change-in-prod',
    }),
  ],
  controllers: [ReloadingAdminController],
  providers: [ReloadingService, AdminAuditService],
  exports: [ReloadingService],
})
export class ReloadingModule {}
