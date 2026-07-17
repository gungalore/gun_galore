import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { VerifyNowService } from './verifynow.service';
import { ClaudeKycService } from './claude-kyc.service';

// KYC is self-contained — the service depends on PrismaService (global),
// NotificationsService (global), SmsService (global) and the locally
// scoped VerifyNowService + ClaudeKycService (Claude-vision flow).
// KycService is exported so TransactionsService can call
// triggerSellerVerification() / maybeUpgradeKycTier() from the buy path.
@Module({
  controllers: [KycController],
  providers: [KycService, VerifyNowService, ClaudeKycService],
  exports: [KycService],
})
export class KycModule {}
