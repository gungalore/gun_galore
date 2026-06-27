import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { SearchModule } from './search/search.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { ModerationModule } from './moderation/moderation.module';
import { SmsModule } from './sms/sms.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ListingsModule } from './listings/listings.module';
import { ShippingModule } from './shipping/shipping.module';
import { PaymentsModule } from './payments/payments.module';
// MessagesModule removed — buyer/seller chat replaced by Q&A
// (ListingQuestionsService in ListingsModule) + PRIVATE_ARRANGE
// contact reveal. Prisma `Message` model retained dormantly to
// preserve historical rows for any future audit.
import { RatingsModule } from './ratings/ratings.module';
import { AdminModule } from './admin/admin.module';
import { OffersModule } from './offers/offers.module';
import { AuctionsModule } from './auctions/auctions.module';
import { RafflesModule } from './raffles/raffles.module';
import { FeaturedModule } from './featured/featured.module';
import { TasksModule } from './tasks/tasks.module';
import { KycModule } from './kyc/kyc.module';
import { ReferenceNumberModule } from './common/reference-number.service';
import { ZohoBooksModule } from './zoho/zoho-books.module';
import { ActionTokensModule } from './actions/action-tokens.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { ReportsModule } from './reports/reports.module';
import { PushModule } from './push/push.module';
import { AskGgModule } from './ask-gg/ask-gg.module';
import { ReloadingModule } from './reloading/reloading.module';
import { HuntBallisticsModule } from './hunt-ballistics/hunt-ballistics.module';
import { ManualPaymentsModule } from './manual-payments/manual-payments.module';
import { LoadLabModule } from './load-lab/load-lab.module';

@Module({
  imports: [
    // Global rate limiter. ONE bucket only, applied to every route by
    // the APP_GUARD below. The original CRIT-5 setup had three named
    // buckets (default 60/min, strict 10/min, write 5/min) — but
    // @nestjs/throttler runs ALL named buckets on every request, so
    // the effective global limit silently became 5/min. That tripped
    // the Next.js dev-server SSR fan-out (every page-render hits the
    // API a handful of times from the same localhost IP) and surfaced
    // as "404 on every listing" because apiFetch threw → notFound().
    //
    // Per-route stricter limits now opt in via
    //   @Throttle({ default: { limit: 5, ttl: 60_000 } })
    // which overrides the default bucket for that route. @SkipThrottle()
    // (no args) bypasses entirely — used for SSR-facing public reads.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 60 },
    ]),
    PrismaModule,
    CloudinaryModule,
    SearchModule,
    NotificationsModule,
    SettingsModule,
    ModerationModule,
    SmsModule,
    UsersModule,
    AuthModule,
    CategoriesModule,
    ListingsModule,
    ShippingModule,
    PaymentsModule,
    RatingsModule,
    AdminModule,
    OffersModule,
    AuctionsModule,
    RafflesModule,
    FeaturedModule,
    TasksModule,
    KycModule,
    ReferenceNumberModule,
    ZohoBooksModule,
    ActionTokensModule,
    WishlistModule,
    ReportsModule,
    PushModule,
    AskGgModule,
    ReloadingModule,
    HuntBallisticsModule,
    ManualPaymentsModule,
    LoadLabModule,
  ],
  controllers: [AppController],
  providers: [
    // Apply throttling to every route by default. Individual routes
    // can override with @SkipThrottle() (for webhooks, health checks)
    // or @Throttle({ strict: { limit: 10, ttl: 60_000 } }).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
