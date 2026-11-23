import { Controller, Get, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ListingFaqService } from './listing-faq.service';

/**
 * The PUBLIC "Questions & answers" block on a listing.
 *
 * No auth, like the listing itself. `SkipThrottle` because the PDP is rendered
 * server-side and a signed-out page view would otherwise share the caller's
 * IP bucket with the API fan-out.
 *
 * ⚠️ The service enforces the same visibility as the listing detail page: a
 * hidden or non-public listing returns 404, never an empty FAQ, so this route
 * cannot be used to probe an id.
 */
@Controller('listings')
export class ListingFaqController {
  constructor(private readonly faq: ListingFaqService) {}

  @Get(':id/faq')
  @SkipThrottle()
  list(@Param('id') listingId: string) {
    return this.faq.listPublic(listingId);
  }
}
