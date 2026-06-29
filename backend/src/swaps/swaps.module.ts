import { Module } from '@nestjs/common';
import { SwapProposalsService } from './swap-proposals.service';
import { SwapProposalsController } from './swap-proposals.controller';
import { SwapFundingService } from './swap-funding.service';
import { SwapFundingController } from './swap-funding.controller';
import { KycModule } from '../kyc/kyc.module';
import { ShippingModule } from '../shipping/shipping.module';
import { PaymentsModule } from '../payments/payments.module';

// Swop / Trade. NotificationsService, ContactDetailFilterService,
// ActionTokensService, ReferenceNumberService + PrismaService are @Global.
// KycModule → KYC-trigger both parties; ShippingModule → quoteForListing for
// each funding leg; PaymentsModule → FeeCalculator.breakdownSwapLeg.
@Module({
  imports: [KycModule, ShippingModule, PaymentsModule],
  controllers: [SwapProposalsController, SwapFundingController],
  providers: [SwapProposalsService, SwapFundingService],
  exports: [SwapProposalsService, SwapFundingService],
})
export class SwapsModule {}
