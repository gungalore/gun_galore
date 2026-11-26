import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuctionsService } from './auctions.service';
import { AuthGuard } from '../auth/auth.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { ContentAccessGuard } from '../auth/content-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlaceBidDto } from './dto/place-bid.dto';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  // PUBLIC for public-visible auctions; a members-only auction (firearms)
  // requires the same session the listing detail page requires. OptionalAuth
  // means an absent session is anonymous rather than a 401.
  // SkipThrottle: called from listing detail SSR/polling, would trip the IP bucket.
  @Get(':listingId')
  @SkipThrottle()
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  state(
    @Param('listingId') listingId: string,
    @CurrentUser() userId?: string,
  ) {
    return this.auctions.getAuctionState(listingId, userId);
  }

  // BUYER: place / raise a proxy bid
  @UseGuards(AuthGuard)
  @Post(':listingId/bids')
  placeBid(
    @CurrentUser() userId: string,
    @Param('listingId') listingId: string,
    @Body() dto: PlaceBidDto,
  ) {
    return this.auctions.placeBid(userId, listingId, dto);
  }

  // BUYER: list of auctions you've bid on
  @UseGuards(AuthGuard)
  @Get('me/bids')
  myBids(@CurrentUser() userId: string) {
    return this.auctions.getMyBids(userId);
  }

  // BUYER: your proxy state for a single listing — drives the
  // "Auto bid · ACTIVE · R500" label on the listing detail page.
  @UseGuards(AuthGuard)
  @Get(':listingId/me')
  myBidForListing(
    @CurrentUser() userId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.auctions.getMyBidForListing(userId, listingId);
  }

  // BUYER: cancel an active proxy on a listing. Keeps the user as
  // current high bidder at the visible amount, but stops auto-
  // countering future bids.
  @UseGuards(AuthGuard)
  @Post(':listingId/cancel-proxy')
  cancelProxy(
    @CurrentUser() userId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.auctions.cancelProxy(userId, listingId);
  }

  // NOTE (2026-11 audit L6): the POST/DELETE /auctions/:id/watch endpoints
  // were removed. They wrote the dormant AuctionWatch table, which no
  // frontend surface ever called — watching is the wishlist (WatchedListing),
  // whose ending-soon alert is the one that actually fires — so the routes
  // only existed as a misleading "0 watching" data source.
}
