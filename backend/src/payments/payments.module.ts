import { Module } from '@nestjs/common';
import { FeeCalculator } from './fee.calculator';
import { StitchService } from './stitch.service';
import { TransactionsService } from './transactions.service';
import { DispatchSlaService } from './dispatch-sla.service';
import { ExperienceSlaService } from './experience-sla.service';
import { DealerVerificationService } from './dealer-verification.service';
import { ReceiptService } from './receipt.service';
import { FraudRiskService } from './fraud-risk.service';
import { TransactionsController, PaymentsWebhookController } from './transactions.controller';
import { KycModule } from '../kyc/kyc.module';
import { ShippingModule } from '../shipping/shipping.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';
import { WishlistAlertsModule } from '../wishlist-alerts/wishlist-alerts.module';

@Module({
  imports: [
    KycModule, // TransactionsService → KycService.triggerSellerVerification
    ShippingModule, // TransactionsService → ShippingService.quoteForListing
    ZohoBooksModule, // DealerVerificationService → ZohoBooksService (commission invoice on APPROVED)
    WishlistAlertsModule, // P5.2 — TransactionsService → WishlistAlertsService (item-sold fan-out)
    // CloudinaryModule is @Global() — DealerVerificationService can inject
    // CloudinaryService without it being imported here explicitly.
  ],
  providers: [
    FeeCalculator,
    StitchService,
    TransactionsService,
    DispatchSlaService,
    ExperienceSlaService,
    DealerVerificationService,
    ReceiptService,
    FraudRiskService,
  ],
  controllers: [TransactionsController, PaymentsWebhookController],
  // StitchService exported so admin / featured can issue refunds and
  // the webhook controller can verify + confirm payments.
  // DealerVerificationService exported so AdminModule can use it for
  // admin-side override / re-scan.
  exports: [
    FeeCalculator,
    TransactionsService,
    DispatchSlaService,
    ExperienceSlaService,
    StitchService,
    DealerVerificationService,
  ],
})
export class PaymentsModule {}
