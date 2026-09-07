import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ListingIdentifyService } from './listing-identify.service';
import { ListingIdentifyController } from './listing-identify.controller';
import { AskGgKbService } from './ask-gg-kb.service';
import {
  AskGgKbAdminController,
  AskGgExpertAdminController,
} from './ask-gg-kb-admin.controller';
import { AskGgGuideAdminController } from './ask-gg-guide-admin.controller';
import { AskGgGuideService } from './ask-gg-guide.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { adminJwtSecret } from '../admin/admin-jwt-secret';

/**
 * What is left of Ask GG (retired 2026-09-07).
 *
 * The member-facing chat came off the site on 2026-08-26; the backend
 * kept serving it — a nine-turn tool loop over reloading manuals,
 * ballistics, listings and account data, a streaming route, a
 * grounded-web pass, 24k characters of replayed history — for a feature
 * nobody could open. All of it is gone, and with it the six modules this
 * one used to import purely to feed those tools (Reloading, Ballistics,
 * Listings, Payments, Offers, Auctions).
 *
 * TWO THINGS REMAIN:
 *  - POST /ask-gg/identify-listing — the Sell page's photo helper. Live.
 *  - The admin KB + page-guide editors. The desk still curates that
 *    content, and AskGgKbEntry / AskGgGuideOverride are still wired into
 *    the admin command centre.
 *
 * The Prisma models for conversations and messages are deliberately kept
 * (no migration); nothing writes them any more.
 */
@Module({
  imports: [
    // For the admin KB + guide controllers (AdminJwtGuard). Same
    // secret/config as AdminModule — kept local so we don't create a
    // circular dep importing AdminModule.
    JwtModule.register({
      secret: adminJwtSecret(),
    }),
  ],
  controllers: [
    ListingIdentifyController,
    AskGgKbAdminController,
    AskGgExpertAdminController,
    AskGgGuideAdminController,
  ],
  providers: [
    ListingIdentifyService,
    AskGgKbService,
    AskGgGuideService,
    AdminAuditService,
  ],
})
export class AskGgModule {}
