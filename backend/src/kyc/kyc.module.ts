import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycScanController } from './kyc-scan.controller';
import { ScanHandoffGuard } from '../auth/scan-handoff.guard';
import { KycService } from './kyc.service';
import { VerifyNowService } from './verifynow.service';
import { ClaudeKycService } from './claude-kyc.service';
import { AwsKycService } from './aws-kyc.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';

// KYC is self-contained — the service depends on PrismaService (global),
// NotificationsService (global), SmsService (global) and the locally
// scoped VerifyNowService + ClaudeKycService (Claude-vision flow).
// KycService is exported so TransactionsService can call
// triggerSellerVerification() / maybeUpgradeKycTier() from the buy path.
//
// ActionTokensService is @Global (ActionTokensModule) so KycScanController and
// the guard can inject it without importing anything here.
@Module({
  controllers: [KycController, KycScanController],
  // SecureFileStorageService is provided LOCALLY — it is not @Global, and
  // the modules that own it deliberately do not export it. Identity
  // documents and selfies live in its `kyc` namespace since they came off
  // the public CDN.
  providers: [
    // ⚠️ THE GUARD IS PROVIDED, NOT MERELY IMPORTED. A controller decorated
    // with a guard this module cannot resolve crash-loops Nest at boot while
    // tsc passes clean — the same trap documented in motivations.module.ts.
    ScanHandoffGuard,
    KycService,
    VerifyNowService,
    ClaudeKycService,
    AwsKycService,
    SecureFileStorageService,
  ],
  exports: [KycService],
})
export class KycModule {}
