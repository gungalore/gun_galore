import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DeskService } from './desk.service';
import { DeskController } from './desk.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { DeskPayoutsService } from './desk-payouts.service';
import { DeskSiteService } from './desk-site.service';
import { WardenController } from './warden.controller';
import { WardenService } from './warden.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { ManualPaymentsModule } from '../manual-payments/manual-payments.module';

/**
 * THE DESK — the operator's worklist.
 *
 * ⚠️ JwtModule.register({}) AND AdminJwtGuard MUST BOTH BE LOCAL. The
 * controller is @UseGuards(AdminJwtGuard), and that guard needs a JwtService
 * from this module's own injector. Omitting either compiles cleanly and then
 * crash-loops the whole API at boot with an unresolved-dependency error —
 * tsc cannot see it, so it is only ever found in production. Same pattern as
 * ComplaintsModule and SupportModule.
 *
 * PrismaService comes from the @Global() PrismaModule, so it is not imported.
 *
 * AdminAuditService is provided LOCALLY rather than by importing AdminModule:
 * AdminModule exports only AdminCreditsService and AdminHealthService, and
 * pulling the whole of it in here would drag Listings, Payments, Zoho and
 * Shipping behind it for one audit write. It is stateless over the @Global()
 * PrismaService, so a second instance is a second reference, not a second
 * source of truth — same as RatingsModule, AskGgModule and ReloadingModule
 * already do.
 */
@Module({
  imports: [JwtModule.register({}), ManualPaymentsModule],
  controllers: [DeskController, WardenController],
  providers: [
    DeskService,
    DeskPayoutsService,
    DeskSiteService,
    // WardenService reads gates through DeskSiteService rather than the env
    // directly, so /admin/warden/gates and the Site board cannot disagree.
    WardenService,
    AdminAuditService,
    AdminJwtGuard,
  ],
})
export class DeskModule {}
