import { Global, Module } from '@nestjs/common';
import { PeachService } from './peach.service';
import { BanvService } from './banv.service';

// PeachService is a dependency-free adapter (it injects nothing), so making
// it @Global lets the checkout path (PaymentsModule), refund consumers
// (Admin/DispatchSLA), the BANV hook (Users) and the payout collector
// (ManualPayments) all inject it without importing the heavy PaymentsModule
// graph — the same pattern as OzowModule.
@Global()
@Module({
  providers: [PeachService, BanvService],
  exports: [PeachService, BanvService],
})
export class PeachModule {}
