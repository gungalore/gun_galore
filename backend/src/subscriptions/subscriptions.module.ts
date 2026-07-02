import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { ZohoBooksModule } from '../zoho/zoho-books.module';
import { PaymentsModule } from '../payments/payments.module';

// P1.1 — MEMBER/PRO billing on the manual-EFT rail.
// ZohoBooksModule is NOT @Global (the SwapsModule boot-crash lesson) —
// import it explicitly for the sales-receipt hook. PaymentsModule is
// imported only for its exported constants module context (PAYMENT_MODE /
// GG_BANK_DETAILS are plain exports, no DI) — Prisma/Settings/
// ReferenceNumber/Notifications are all @Global. Exported so the
// reconciler (ManualPaymentsModule) and the cron (TasksModule) can call
// confirmPayment/sweep.
@Module({
  imports: [ZohoBooksModule, PaymentsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
