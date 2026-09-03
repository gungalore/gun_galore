import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DeskService } from './desk.service';
import { DeskController } from './desk.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { DeskPayoutsService } from './desk-payouts.service';
import { DeskSiteService } from './desk-site.service';
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
 */
@Module({
  imports: [JwtModule.register({}), ManualPaymentsModule],
  controllers: [DeskController],
  providers: [DeskService, DeskPayoutsService, DeskSiteService, AdminJwtGuard],
})
export class DeskModule {}
