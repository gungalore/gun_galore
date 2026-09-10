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
import { AuthGuard } from '../auth/auth.guard';
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

  // BUYER: watchlist
  @UseGuards(AuthGuard)
  @Post(':listingId/watch')
  watch(@CurrentUser() userId: string, @Param('listingId') listingId: string) {
    return this.auctions.watch(userId, listingId);
  }

  @UseGuards(AuthGuard)
  @Delete(':listingId/watch')
  unwatch(@CurrentUser() userId: string, @Param('listingId') listingId: string) {
    return this.auctions.unwatch(userId, listingId);
  }
}
