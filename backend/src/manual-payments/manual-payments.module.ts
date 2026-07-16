import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ManualPaymentsService } from './manual-payments.service';
import { ManualPaymentsController } from './manual-payments.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';

// Read-only money-state views (payouts-due preview, held-funds, Zoho
// failed-sync radar). The manual-EFT reconciler + FNB payout-batch builder
// have been removed with the manual-EFT rail, so the reconciler's provider
// dependencies (PaymentsModule/SwapsModule/SubscriptionsModule/FeaturedModule/
// ZohoBooksModule) are no longer imported. JwtModule + AdminJwtGuard secure the
// admin read endpoints; PrismaService is provided globally. ManualPaymentsService
// is exported for anything that reads the money-state views.
@Module({
  imports: [JwtModule.register({})],
  controllers: [ManualPaymentsController],
  providers: [ManualPaymentsService, AdminJwtGuard],
  exports: [ManualPaymentsService],
})
export class ManualPaymentsModule {}
