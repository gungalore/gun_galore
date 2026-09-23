import { Module } from '@nestjs/common';
import { ListingIdentifyService } from './listing-identify.service';
import { ListingIdentifyController } from './listing-identify.controller';

/**
 * What is left of Ask GG.
 *
 * The member-facing chat came off the site on 2026-08-26 and its backend
 * was retired on 2026-09-07. The admin KB + page-guide editors that
 * outlived it were removed on 2026-09-22 together with the Desk: their
 * only UI was the Desk command centre, and the Desk is being rebuilt.
 *
 * ONE THING REMAINS:
 *  - POST /ask-gg/identify-listing — the Sell page's photo helper. Live.
 *
 * The Prisma models for conversations, messages, KbEntry and GuideOverride
 * are deliberately kept (no migration); nothing writes them any more.
 */
@Module({
  controllers: [ListingIdentifyController],
  providers: [ListingIdentifyService],
})
export class AskGgModule {}
