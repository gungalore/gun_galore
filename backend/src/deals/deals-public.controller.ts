import { Controller, Get, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DealsService } from './deals.service';

/**
 * Public Daily Deals storefront API (DD-3). UNAUTHENTICATED reads only.
 *
 *   GET /deals        live storefront grid — { enabled, deals[] }
 *   GET /deals/:id    single deal (by deal id / listing id / reference)
 *
 * Both are gated inside DealsService on the FLAGS.dealsEnabled master
 * killswitch: with Daily Deals turned off the list returns
 * `{enabled:false, deals:[]}` and the detail 404s, so this surface ships
 * INERT and flips live the instant the operator toggles the flag — no
 * deploy. Deals are first-party (All Outdoor is the seller); the buyer buys
 * through the existing cart / checkout rails unchanged (the DD-2 money path
 * branches on Listing.isDealListing). @SkipThrottle because SSR fans these
 * reads out from a single localhost IP (same reasoning as GET /listings).
 *
 * NOTE (NestJS route ordering): the literal GET '' must be declared before
 * GET ':id' so the index isn't captured by the param route. There is only
 * one param route here, so ordering is trivially correct.
 */
@Controller('deals')
export class DealsPublicController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @SkipThrottle()
  list() {
    return this.deals.listLivePublic();
  }

  @Get(':id')
  @SkipThrottle()
  one(@Param('id') id: string) {
    return this.deals.findOnePublic(id);
  }
}
