import { Module } from '@nestjs/common';
import { SwapProposalsService } from './swap-proposals.service';
import { SwapProposalsController } from './swap-proposals.controller';
import { KycModule } from '../kyc/kyc.module';

// Swop / Trade. NotificationsService, ContactDetailFilterService,
// ActionTokensService + PrismaService are all @Global, so only KycModule
// (SwapProposalsService → KycService.triggerSellerVerification for BOTH
// parties) needs an explicit import.
@Module({
  imports: [KycModule],
  controllers: [SwapProposalsController],
  providers: [SwapProposalsService],
  exports: [SwapProposalsService],
})
export class SwapsModule {}
