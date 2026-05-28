import { Module } from '@nestjs/common';
import { HuntPdfController } from './hunt-pdf.controller';
import { HuntPdfAdminController } from './hunt-pdf-admin.controller';
import { HuntPdfService } from './hunt-pdf.service';
import { HuntBallisticsAdminGuard } from './hunt-ballistics-admin.guard';

/**
 * INFO Centre — knowledge base for Hunt Ballistics.
 *
 * Routes:
 *   /api/hunt-ballistics/info-centre/*    public read (browse, search, page)
 *   /api/admin/hunt-pdfs/*                admin write (create, import, edit)
 *
 * The admin guard reads HUNT_BALLISTICS_ADMIN_KEY from env. PrismaService
 * is provided by the global PrismaModule.
 */
@Module({
  controllers: [HuntPdfController, HuntPdfAdminController],
  providers: [HuntPdfService, HuntBallisticsAdminGuard],
  exports: [HuntPdfService],
})
export class InfoCentreModule {}
