import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './tasks.service';
import { OffersModule } from '../offers/offers.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { KycModule } from '../kyc/kyc.module';
import { ShippingModule } from '../shipping/shipping.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminModule } from '../admin/admin.module';
import { PushModule } from '../push/push.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';
import { SavedSearchesModule } from '../saved-searches/saved-searches.module';
import { RatingsModule } from '../ratings/ratings.module';
import { WishlistAlertsModule } from '../wishlist-alerts/wishlist-alerts.module';
import { ListingsModule } from '../listings/listings.module';
import { FeedModule } from '../feed/feed.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ManualPaymentsModule } from '../manual-payments/manual-payments.module';

@Module({
  // AdminModule is imported so we can inject AdminCreditsService into
  // TasksService.pollCreditBalances (the 15-min credit-poll cron).
  // AdminModule exports AdminCreditsService for this purpose.
  // PushModule imported for the weekly subscription-prune cron.
  // ZohoBooksModule (NOT @Global) for the hourly Zoho revenue-doc retry cron.
  imports: [
    ScheduleModule.forRoot(),
    OffersModule,
    AuctionsModule,
    KycModule,
    ShippingModule,
    PaymentsModule,
    AdminModule,
    PushModule,
    ZohoBooksModule,
    SavedSearchesModule,
    //
    // Trust-score refresh cron — RatingsModule exports RatingsService.
    RatingsModule,
    // Auction ending-soon watcher alerts — WishlistAlertsModule exports
    // WishlistAlertsService. NOT @Global, so it MUST be listed here or Nest
    // can't inject it into TasksService and the app crash-loops at boot
    // (tsc stays green).
    WishlistAlertsModule,
    // Stale-listing expiry + photo-less listing sweeps need ListingsService
    // to yank a de-activated listing out of the Meilisearch index.
    ListingsModule,
    // Community-feed moderation sweep needs FeedService.runModeration.
    FeedModule,
    // WhatsApp retry/outage cron needs WhatsappService.retryFailed.
    WhatsappModule,
    // Auto-payout sweep needs ManualPaymentsService.runDuePayouts.
    ManualPaymentsModule,
  ],
  providers: [TasksService],
})
export class TasksModule {}
