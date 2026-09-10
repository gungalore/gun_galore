import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { DiditWebhookController } from './didit-webhook.controller';
import { KycService } from './kyc.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';

/**
 * KYC is self-contained. The service depends on PrismaService,
 * NotificationsService, SmsService, ActionTokensService and DiditService —
 * all @Global — plus the locally provided SecureFileStorageService.
 *
 * KycService is exported so TransactionsService can call
 * triggerSellerVerification() from the buy path.
 *
 * ⚠️ NO ScanHandoffGuard HERE ANY MORE. It was provided for the phone's
 * ID-upload door, which went when Didit took over document capture. Do not
 * re-add it "just in case": a guard provided for a controller this module no
 * longer mounts is dead wiring that reads like a live rule.
 */
@Module({
  controllers: [KycController, DiditWebhookController],
  // SecureFileStorageService is provided LOCALLY — it is not @Global, and the
  // modules that own it deliberately do not export it. Nothing writes to its
  // `kyc` namespace now, but members verified under the old flow still have
  // files there and purgeKycFiles is what removes them on erasure.
  providers: [KycService, SecureFileStorageService],
  exports: [KycService],
})
export class KycModule {}
