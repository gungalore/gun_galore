import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ManualPaymentsService } from './manual-payments.service';
import { ManualPaymentsController } from './manual-payments.controller';
import { OzowPayoutTestController } from './ozow-payout-test.controller';
import { OzowPayoutTestService } from './ozow-payout-test.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { ZohoBooksModule } from '../zoho/zoho-books.module';

// Admin money-state reports plus the operator-triggered Ozow seller-payout run
// and the Ozow payout test-case harness. The manual-EFT reconciler and FNB
// batch builder were removed; payout requests use the global OzowService.
// JwtModule + AdminJwtGuard are registered here so this module resolves its
// controller guard dependencies locally.
//
// ZohoBooksModule: a completed payout is the moment the seller's Books
// documents (commission, courier re-weigh) are settled. Without the import the
// service compiles, injects undefined and silently stops settling — which is
// the bug this module entry exists to fix.
@Module({
  imports: [JwtModule.register({}), ZohoBooksModule],
  controllers: [ManualPaymentsController, OzowPayoutTestController],
  providers: [ManualPaymentsService, OzowPayoutTestService, AdminJwtGuard],
  exports: [ManualPaymentsService],
})
export class ManualPaymentsModule {}
