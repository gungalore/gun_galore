import { Global, Module } from '@nestjs/common';
import { OzowService } from './ozow.service';

// OzowService is a dependency-free adapter (it injects nothing), so making
// it @Global lets the checkout path (PaymentsModule), refund consumers
// (Admin/Featured/DispatchSLA) and the payout collector (ManualPayments) all
// inject it without importing the heavy PaymentsModule graph — the same
// pattern as PrismaModule.
@Global()
@Module({
  providers: [OzowService],
  exports: [OzowService],
})
export class OzowModule {}
