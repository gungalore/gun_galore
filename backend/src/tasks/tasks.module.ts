import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './tasks.service';
import { OffersModule } from '../offers/offers.module';
import { SwapsModule } from '../swaps/swaps.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { FeaturedModule } from '../featured/featured.module';
import { KycModule } from '../kyc/kyc.module';
import { ShippingModule } from '../shipping/shipping.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminModule } from '../admin/admin.module';
import { PushModule } from '../push/push.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';
import { SavedSearchesModule } from '../saved-searches/saved-searches.module';
import { DealsModule } from '../deals/deals.module';
import { RaffleModule } from '../raffle/raffle.module';
import { RatingsModule } from '../ratings/ratings.module';

@Module({
  // AdminModule is imported so we can inject AdminCreditsService into
  // TasksService.pollCreditBalances (the 15-min credit-poll cron).
  // AdminModule exports AdminCreditsService for this purpose.
  // PushModule imported for the weekly subscription-prune cron.
  // SubscriptionsModule for the P1.1 subscription sweep cron.
  // ZohoBooksModule (NOT @Global) for the P1.3 swap-fee-receipt retry cron.
  imports: [
    ScheduleModule.forRoot(),
    OffersModule,
    SwapsModule,
    AuctionsModule,
    FeaturedModule,
    KycModule,
    ShippingModule,
    PaymentsModule,
    AdminModule,
    PushModule,
    SubscriptionsModule,
    ZohoBooksModule,
    SavedSearchesModule,
    // DD-4 — DealsModule exports DealsService for the daily-deal drop cron.
    // NOT @Global, so it MUST be listed here or Nest can't inject DealsService
    // into TasksService and the app crash-loops at boot (tsc stays green).
    DealsModule,
    // Prize-draw cron — RaffleModule exports RaffleService (NOT @Global,
    // same crash-loop rule as DealsModule above).
    RaffleModule,
    // Trust-score refresh cron — RatingsModule exports RatingsService.
    RatingsModule,
  ],
  providers: [TasksService],
})
export class TasksModule {}
