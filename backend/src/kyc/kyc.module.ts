import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { VerifyNowService } from './verifynow.service';
import { ClaudeKycService } from './claude-kyc.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';

// KYC is self-contained — the service depends on PrismaService (global),
// NotificationsService (global), SmsService (global) and the locally
// scoped VerifyNowService + ClaudeKycService (Claude-vision flow).
// KycService is exported so TransactionsService can call
// triggerSellerVerification() / maybeUpgradeKycTier() from the buy path.
@Module({
  controllers: [KycController],
  // SecureFileStorageService is provided LOCALLY — it is not @Global, and
  // the modules that own it deliberately do not export it. Identity
  // documents and selfies live in its `kyc` namespace since they came off
  // the public CDN.
  providers: [
    KycService,
    VerifyNowService,
    ClaudeKycService,
    SecureFileStorageService,
  ],
  exports: [KycService],
})
export class KycModule {}
