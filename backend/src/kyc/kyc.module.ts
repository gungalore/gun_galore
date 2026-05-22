import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { VerifyNowService } from './verifynow.service';

// KYC is self-contained — the service depends on PrismaService (global),
// NotificationsService (global), SmsService (global) and the locally
// scoped VerifyNowService. KycService is exported so TransactionsService
// can call triggerSellerVerification() from the buy-now path.
@Module({
  controllers: [KycController],
  providers: [KycService, VerifyNowService],
  exports: [KycService],
})
export class KycModule {}
