import { Module } from '@nestjs/common';
import { FeeCalculator } from './fee.calculator';
import { PeachService } from './peach.service';
import { TransactionsService } from './transactions.service';
import { DispatchSlaService } from './dispatch-sla.service';
import { DealerVerificationService } from './dealer-verification.service';
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
    PeachService,
    TransactionsService,
    DispatchSlaService,
    DealerVerificationService,
  ],
  controllers: [TransactionsController, PaymentsWebhookController],
  // PeachService also exported so UsersModule can use it for the
  // post-publish profile-complete AVS check.
  // DealerVerificationService exported so AdminModule can use it for
  // admin-side override / re-scan.
  exports: [
    FeeCalculator,
    TransactionsService,
    DispatchSlaService,
    PeachService,
    DealerVerificationService,
  ],
})
export class PaymentsModule {}
