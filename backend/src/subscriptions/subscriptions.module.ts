import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { ZohoBooksModule } from '../zoho/zoho-books.module';
import { PaymentsModule } from '../payments/payments.module';

// P1.1 — MEMBER/PRO billing. The manual-EFT reconciler has been removed with
// the manual rail; the subscription state machine (charge/sweep/confirmPayment)
// is retained for the future card paygate. ZohoBooksModule is NOT @Global (the
// SwapsModule boot-crash lesson) — import it explicitly for the sales-receipt
// hook. PaymentsModule is imported for its exported PAYMENT_MODE constant
// (a plain export, no DI) — Prisma/Settings/ReferenceNumber/Notifications are
// all @Global. Exported so the cron (TasksModule) can call sweep.
@Module({
  imports: [ZohoBooksModule, PaymentsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
