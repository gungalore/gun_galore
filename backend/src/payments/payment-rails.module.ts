import { Global, Module } from '@nestjs/common';
import { PaymentRailsService } from './payment-rails.service';

// The provider router depends only on the two @Global adapters and the
// @Global SettingsModule, so it can be injected anywhere without importing
// the heavy PaymentsModule graph.
@Global()
@Module({
  providers: [PaymentRailsService],
  exports: [PaymentRailsService],
})
export class PaymentRailsModule {}
