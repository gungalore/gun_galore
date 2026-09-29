import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ManualPaymentsService } from './manual-payments.service';
import { ManualPaymentsController } from './manual-payments.controller';
import { OzowPayoutTestController } from './ozow-payout-test.controller';
import { OzowPayoutTestService } from './ozow-payout-test.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';

// Admin money-state reports plus the operator-triggered Ozow seller-payout run
// and the Ozow payout test-case harness. The manual-EFT reconciler and FNB
// batch builder were removed; payout requests use the global OzowService.
// JwtModule + AdminJwtGuard are registered here so this module resolves its
// controller guard dependencies locally.
@Module({
  imports: [JwtModule.register({})],
  controllers: [ManualPaymentsController, OzowPayoutTestController],
  providers: [ManualPaymentsService, OzowPayoutTestService, AdminJwtGuard],
  exports: [ManualPaymentsService],
})
export class ManualPaymentsModule {}
