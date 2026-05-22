import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuctionsService } from './auctions.service';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlaceBidDto } from './dto/place-bid.dto';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  // PUBLIC: anyone can view live auction state
  // SkipThrottle: called from listing detail SSR, would trip the IP bucket.
  @Get(':listingId')
  @SkipThrottle()
  state(@Param('listingId') listingId: string) {
    return this.auctions.getAuctionState(listingId);
  }

  // BUYER: place / raise a proxy bid
  @UseGuards(ClerkGuard)
  @Post(':listingId/bids')
  placeBid(
    @CurrentUser() clerkId: string,
    @Param('listingId') listingId: string,
    @Body() dto: PlaceBidDto,
  ) {
    return this.auctions.placeBid(clerkId, listingId, dto);
  }

  // BUYER: prepare a Buy Now purchase (only if zero bids and buyNowPrice set)
  @UseGuards(ClerkGuard)
  @Post(':listingId/buy-now')
  buyNow(@CurrentUser() clerkId: string, @Param('listingId') listingId: string) {
    return this.auctions.buyNow(clerkId, listingId);
  }

  // BUYER: list of auctions you've bid on
  @UseGuards(ClerkGuard)
  @Get('me/bids')
  myBids(@CurrentUser() clerkId: string) {
    return this.auctions.getMyBids(clerkId);
  }

  // BUYER: your proxy state for a single listing — drives the
  // "Auto bid · ACTIVE · R500" label on the listing detail page.
  @UseGuards(ClerkGuard)
  @Get(':listingId/me')
  myBidForListing(
    @CurrentUser() clerkId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.auctions.getMyBidForListing(clerkId, listingId);
  }

  // BUYER: cancel an active proxy on a listing. Keeps the user as
  // current high bidder at the visible amount, but stops auto-
  // countering future bids.
  @UseGuards(ClerkGuard)
  @Post(':listingId/cancel-proxy')
  cancelProxy(
    @CurrentUser() clerkId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.auctions.cancelProxy(clerkId, listingId);
  }

  // BUYER: watchlist
  @UseGuards(ClerkGuard)
  @Post(':listingId/watch')
  watch(@CurrentUser() clerkId: string, @Param('listingId') listingId: string) {
    return this.auctions.watch(clerkId, listingId);
  }

  @UseGuards(ClerkGuard)
  @Delete(':listingId/watch')
  unwatch(@CurrentUser() clerkId: string, @Param('listingId') listingId: string) {
    return this.auctions.unwatch(clerkId, listingId);
  }
}
