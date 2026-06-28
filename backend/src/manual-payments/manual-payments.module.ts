import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ManualPaymentsService } from './manual-payments.service';
import { ManualPaymentsController } from './manual-payments.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { PaymentsModule } from '../payments/payments.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';

// Manual-EFT reconciliation (no live card gateway). PaymentsModule is
// imported for TransactionsService.confirmManualPayment; JwtModule +
// AdminJwtGuard secure the admin statement-upload + queue endpoints.
// ManualPaymentsService is exported so the TasksService cron can run the
// 10-minute inContact inbox scan.
@Module({
  imports: [JwtModule.register({}), PaymentsModule, ZohoBooksModule],
  controllers: [ManualPaymentsController],
  providers: [ManualPaymentsService, AdminJwtGuard],
  exports: [ManualPaymentsService],
})
export class ManualPaymentsModule {}
