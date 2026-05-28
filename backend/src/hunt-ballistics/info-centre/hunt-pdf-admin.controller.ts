import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HuntPdfCategory, HuntPdfStatus } from '@prisma/client';
import { HuntBallisticsAdminGuard } from './hunt-ballistics-admin.guard';
import { HuntPdfService } from './hunt-pdf.service';

/**
 * Admin endpoints for the Hunt Ballistics INFO Centre — gated by
 * HuntBallisticsAdminGuard (shared secret in
 * process.env.HUNT_BALLISTICS_ADMIN_KEY, sent as the X-Hunt-Admin-Key
 * header).
 *
 *   POST   /admin/hunt-pdfs              create a new PDF (DRAFT)
 *   POST   /admin/hunt-pdfs/:id/pages    bulk-import pages (idempotent)
 *   PATCH  /admin/hunt-pdfs/:id          edit metadata / promote to ACTIVE
 *   DELETE /admin/hunt-pdfs/:id          hard delete (cascade pages)
 *
 * SkipThrottle on all routes — admin endpoints aren't rate-attacked
 * from random clients; if the secret leaks, the attacker can already
 * do anything regardless of throttle.
 */
@Controller('admin/hunt-pdfs')
@UseGuards(HuntBallisticsAdminGuard)
@SkipThrottle()
export class HuntPdfAdminController {
  constructor(private readonly service: HuntPdfService) {}

  @Post()
  create(
    @Body()
    body: {
      title: string;
      author?: string;
      edition?: string;
      publisher?: string;
      publishedYear?: number;
      category?: HuntPdfCategory;
      language?: string;
      blurb?: string;
      sortOrder?: number;
    },
  ) {
    return this.service.createPdf(body);
  }

  @Post(':id/pages')
  importPages(
    @Param('id') id: string,
    @Body()
    body: {
      pages: Array<{
        pageNumber: number;
        text: string;
        imageBase64?: string;
        imageMime?: string;
      }>;
    },
  ) {
    return this.service.importPages(id, body.pages);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      author?: string | null;
      edition?: string | null;
      publisher?: string | null;
      publishedYear?: number | null;
      category?: HuntPdfCategory;
      language?: string;
      status?: HuntPdfStatus;
      blurb?: string | null;
      sortOrder?: number;
    },
  ) {
    return this.service.updatePdf(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.deletePdf(id);
  }
}
