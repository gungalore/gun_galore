import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WishlistService } from './wishlist.service';

/**
 * /wishlist routes — heart-icon save-for-later.
 *
 *   POST   /wishlist/:listingId   — add (idempotent)
 *   DELETE /wishlist/:listingId   — remove (idempotent)
 *   GET    /wishlist              — list saved listings (full Listing payload)
 *   GET    /wishlist/ids          — string[] of saved listing IDs (hydrate hearts)
 *
 * Every route is auth-gated — anonymous users can't save anything.
 * The /ids endpoint runs on every page load (provider hydration) so
 * we SkipThrottle to keep it cheap; it's a fast indexed COUNT-style
 * query.
 */
@Controller('wishlist')
@UseGuards(ClerkGuard)
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(@CurrentUser() clerkId: string) {
    return this.wishlist.list(clerkId);
  }

  // SkipThrottle: hydration call on every SSR'd page render → would
  // trip the 60/min default bucket on a single browsing session.
  @Get('ids')
  @SkipThrottle()
  listIds(@CurrentUser() clerkId: string) {
    return this.wishlist.listIds(clerkId);
  }

  @Post(':listingId')
  add(
    @CurrentUser() clerkId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.wishlist.add(clerkId, listingId);
  }

  @Delete(':listingId')
  remove(
    @CurrentUser() clerkId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.wishlist.remove(clerkId, listingId);
  }
}
