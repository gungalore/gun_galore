import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { AdminAuditService } from '../admin/admin-audit.service';
import { ReloadingService } from './reloading.service';

/**
 * Admin-only endpoints for managing the reloading-manual library
 * that powers Ask GG's load-data + reloading-theory answers (Phase D).
 *
 *   POST   /admin/reloading/scan                trigger inbox ingest
 *   GET    /admin/reloading/manuals             list everything indexed
 *   GET    /admin/reloading/manuals/:id/download stream PDF (admin auth)
 *   PATCH  /admin/reloading/manuals/:id         edit metadata (mfg/title/edition)
 *   POST   /admin/reloading/manuals/:id/retry   re-run pdf-parse
 *   POST   /admin/reloading/manuals/:id/archive hide from Ask GG queries
 *   POST   /admin/reloading/manuals/:id/activate un-hide
 *   DELETE /admin/reloading/manuals/:id         hard delete (disk + DB)
 *
 * No upload endpoint by design: operator SCPs PDFs into
 * RELOADING_MANUALS_INBOX_DIR on prod (default ~/app/manual-inbox/),
 * then triggers POST /scan to ingest them. SHA-256 dedup means
 * re-scanning the same files is a no-op.
 */
@Controller('admin/reloading')
@UseGuards(AdminJwtGuard)
@SkipThrottle()
export class ReloadingAdminController {
  constructor(
    private readonly reloading: ReloadingService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * Scan the inbox and ingest any new PDFs found. Returns a summary
   * the admin UI displays as a per-file status list.
   */
  @Post('scan')
  async scan(@CurrentAdmin() admin: { sub: string }) {
    const summary = await this.reloading.scanInbox(admin.sub);
    if (summary.ingested > 0 || summary.failed > 0) {
      await this.audit.record({
        adminUserId: admin.sub,
        action: 'RELOADING_INBOX_SCANNED',
        resourceType: 'ReloadingManual',
        newValue: {
          inboxDir: summary.inboxDir,
          scanned: summary.scanned,
          ingested: summary.ingested,
          skipped: summary.skipped,
          failed: summary.failed,
        },
        reason: `Scanned reloading inbox: ${summary.ingested} new manuals ingested, ${summary.skipped} already present, ${summary.failed} failed (of ${summary.scanned} PDFs found).`,
      });
    }
    return summary;
  }

  @Get('manuals')
  list() {
    return this.reloading.listManuals();
  }

  /**
   * Stream the stored PDF to the requesting admin. Auth is enforced
   * by AdminJwtGuard; the file never has a public URL.
   */
  @Get('manuals/:id/download')
  @Header('Content-Type', 'application/pdf')
  async download(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename, sizeBytes } =
      await this.reloading.openDownloadStream(id);
    res.set({
      'Content-Length': String(sizeBytes),
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    return new StreamableFile(stream);
  }

  @Patch('manuals/:id')
  async update(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { manufacturer?: string; title?: string; edition?: string | null },
  ) {
    const result = await this.reloading.updateMetadata(id, body);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'RELOADING_MANUAL_METADATA_EDITED',
      resourceType: 'ReloadingManual',
      resourceId: id,
      newValue: body,
      reason: `Edited reloading manual metadata: ${JSON.stringify(body)}`,
    });
    return result;
  }

  @Post('manuals/:id/retry')
  async retry(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
  ) {
    const result = await this.reloading.retryExtraction(id);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'RELOADING_MANUAL_REINDEXED',
      resourceType: 'ReloadingManual',
      resourceId: id,
      newValue: { status: result.status, pages: result.pageCount },
      reason: `Re-ran pdf-parse extraction on manual ${id} (now ${result.status}, ${result.pageCount} pages)`,
    });
    return result;
  }

  @Post('manuals/:id/archive')
  async archive(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const result = await this.reloading.archive(id);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'RELOADING_MANUAL_ARCHIVED',
      resourceType: 'ReloadingManual',
      resourceId: id,
      newValue: { status: result.status },
      reason:
        body.reason?.trim() ||
        'Hidden from Ask GG queries — superseded by newer edition or temporarily out of scope.',
    });
    return result;
  }

  @Post('manuals/:id/activate')
  async activate(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const result = await this.reloading.activate(id);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'RELOADING_MANUAL_ACTIVATED',
      resourceType: 'ReloadingManual',
      resourceId: id,
      newValue: { status: result.status },
      reason: body.reason?.trim() || 'Re-enabled manual for Ask GG queries.',
    });
    return result;
  }

  @Delete('manuals/:id')
  async remove(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    // Record BEFORE deleting so the audit row survives the cascade.
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'RELOADING_MANUAL_DELETED',
      resourceType: 'ReloadingManual',
      resourceId: id,
      reason:
        body.reason?.trim() ||
        'Hard-deleted manual + on-disk PDF (mis-upload or duplicate).',
    });
    return this.reloading.deleteManual(id);
  }
}
