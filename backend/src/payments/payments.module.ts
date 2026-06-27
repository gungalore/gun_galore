import { Module } from '@nestjs/common';
import { FeeCalculator } from './fee.calculator';
import { StitchService } from './stitch.service';
import { TransactionsService } from './transactions.service';
import { DispatchSlaService } from './dispatch-sla.service';
import { DealerVerificationService } from './dealer-verification.service';
import { ReceiptService } from './receipt.service';
import { TransactionsController, PaymentsWebhookController } from './transactions.controller';
import { KycModule } from '../kyc/kyc.module';
import { ShippingModule } from '../shipping/shipping.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';

@Module({
  imports: [
    KycModule, // TransactionsService → KycService.triggerSellerVerification
    ShippingModule, // TransactionsService → ShippingService.quoteForListing
    ZohoBooksModule, // DealerVerificationService → ZohoBooksService (commission invoice on APPROVED)
    // CloudinaryModule is @Global() — DealerVerificationService can inject
    // CloudinaryService without it being imported here explicitly.
  ],
  providers: [
    FeeCalculator,
    StitchService,
    TransactionsService,
    DispatchSlaService,
    DealerVerificationService,
    ReceiptService,
  ],
  controllers: [TransactionsController, PaymentsWebhookController],
  // StitchService exported so admin / raffles / featured can issue
  // refunds and the webhook controller can verify + confirm payments.
  // DealerVerificationService exported so AdminModule can use it for
  // admin-side override / re-scan.
  exports: [
    FeeCalculator,
    TransactionsService,
    DispatchSlaService,
    StitchService,
    DealerVerificationService,
  ],
})
export class PaymentsModule {}
