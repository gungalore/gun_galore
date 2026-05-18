import { Module } from '@nestjs/common';
import { FeeCalculator } from './fee.calculator';
import { PeachService } from './peach.service';
import { TransactionsService } from './transactions.service';
import { TransactionsController, PaymentsWebhookController } from './transactions.controller';

@Module({
  providers: [FeeCalculator, PeachService, TransactionsService],
  controllers: [TransactionsController, PaymentsWebhookController],
  exports: [FeeCalculator, TransactionsService],
})
export class PaymentsModule {}
