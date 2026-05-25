import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './tasks.service';
import { OffersModule } from '../offers/offers.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { RafflesModule } from '../raffles/raffles.module';
import { FeaturedModule } from '../featured/featured.module';
import { KycModule } from '../kyc/kyc.module';
import { ShippingModule } from '../shipping/shipping.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminModule } from '../admin/admin.module';
import { PushModule } from '../push/push.module';

@Module({
  // AdminModule is imported so we can inject AdminCreditsService into
  // TasksService.pollCreditBalances (the 15-min credit-poll cron).
  // AdminModule exports AdminCreditsService for this purpose.
  // PushModule imported for the weekly subscription-prune cron.
  imports: [
    ScheduleModule.forRoot(),
    OffersModule,
    AuctionsModule,
    RafflesModule,
    FeaturedModule,
    KycModule,
    ShippingModule,
    PaymentsModule,
    AdminModule,
    PushModule,
  ],
  providers: [TasksService],
})
export class TasksModule {}
