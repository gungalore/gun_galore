import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { FeaturedService } from './featured.service';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { PlaceFeaturedBidDto } from './dto/place-bid.dto';
import { BindFeaturedListingDto } from './dto/bind-listing.dto';
import { FeaturedBuyNowDto } from './dto/buy-now.dto';
import {
  BanFeaturedBidderDto,
  CloseAuctionEarlyDto,
  ForceEvictDto,
  ManualAwardDto,
  ShiftFeaturedUntilDto,
  UpdateFeaturedConfigDto,
} from './dto/admin-actions.dto';

// ─── Public: rail data + config (everyone, including signed-out) ───
// SkipThrottle: every browse/homepage SSR call hits these; the shared
// 60 req/min bucket would trip and render 404s.
@Controller('featured')
@SkipThrottle()
export class FeaturedPublicController {
  constructor(private readonly featured: FeaturedService) {}

  // Used by the <FeaturedRail> on every browse page.
  @Get('rail')
  rail() {
    return this.featured.getRail();
  }

  // Just the featured listings (no slot metadata). Drives the
  // homepage main grid where the live-listings browse used to be.
  @Get('listings')
  listings() {
    return this.featured.getFeaturedListings();
  }

  // Availability summary for the homepage "Featured spots" bar — open /
  // taking-bids counts + the biddable slots (click straight into a bid).
  @Get('summary')
  summary() {
    return this.featured.getFeaturedSummary();
  }

  // Tier table + bid floor — used by the bid page to show pricing
  // before the seller commits.
  @Get('config')
  config() {
    return this.featured.getConfig();
  }
}

// ─── Seller: bidding + binding ─────────────────────────────────────
@Controller('featured')
@UseGuards(ClerkGuard)
export class FeaturedSellerController {
  constructor(private readonly featured: FeaturedService) {}

  // Slots + per-slot top bid + the signed-in user's own current bid.
  @Get('slots')
  slots(@CurrentUser() clerkId: string) {
    return this.featured.getSlotsForBidder(clerkId);
  }

  // All featured-slot bids the signed-in user has placed — drives the
  // "Featured slot bids" section on /my/bids.
  @Get('me/bids')
  myBids(@CurrentUser() clerkId: string) {
    return this.featured.getMyFeaturedBids(clerkId);
  }

  @Post('bids')
  placeBid(
    @CurrentUser() clerkId: string,
    @Body() dto: PlaceFeaturedBidDto,
  ) {
    return this.featured.placeBid(clerkId, dto.slotId, dto.amountCents);
  }

  // Buy Now — claim the slot outright at 2× the chosen tier's price,
  // skipping the auction. Picks the listing up front so it's atomic.
  @Post('buy-now')
  buyNow(
    @CurrentUser() clerkId: string,
    @Body() dto: FeaturedBuyNowDto,
  ) {
    return this.featured.buyNow(clerkId, dto.slotId, dto.tier, dto.listingId);
  }

  // Within the 15-min bind window, the winner picks one of their
  // ACTIVE listings to put in the slot.
  @Post('bind')
  bind(
    @CurrentUser() clerkId: string,
    @Body() dto: BindFeaturedListingDto,
  ) {
    return this.featured.bindListingToSlot(clerkId, dto.slotId, dto.listingId);
  }
}

// ─── Admin: oversight + manual actions ─────────────────────────────
@Controller('admin/featured')
@UseGuards(AdminJwtGuard)
export class FeaturedAdminController {
  constructor(private readonly featured: FeaturedService) {}

  // Overview list — same as public rail but with full enrichments for
  // the admin slots-grid (bids, bidders, audit count).
  @Get('slots')
  slots() {
    return this.featured.getRail();
  }

  @Get('revenue')
  revenue() {
    return this.featured.getRevenueStats();
  }

  @Get('audit')
  audit(
    @Query('slotId') slotId?: string,
    @Query('eventType') eventType?: string,
    @Query('limit') limit?: string,
  ) {
    return this.featured.getAuditLog({
      slotId,
      eventType,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('banned-bidders')
  bannedBidders() {
    return this.featured.listBannedBidders();
  }

  @Post('slots/:id/force-evict')
  forceEvict(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: ForceEvictDto,
  ) {
    return this.featured.forceEvict(admin.sub, id, dto.reason, dto.refund ?? false);
  }

  @Post('slots/:id/manual-award')
  manualAward(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: ManualAwardDto,
  ) {
    return this.featured.manuallyAward(
      admin.sub,
      id,
      dto.listingId,
      dto.durationSeconds,
      dto.reason,
    );
  }

  @Post('slots/:id/shift-until')
  shiftUntil(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: ShiftFeaturedUntilDto,
  ) {
    return this.featured.shiftFeaturedUntil(
      admin.sub,
      id,
      dto.deltaSeconds,
      dto.reason,
    );
  }

  @Post('slots/:id/close-auction-early')
  closeAuctionEarly(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: CloseAuctionEarlyDto,
  ) {
    return this.featured.closeAuctionEarly(admin.sub, id, dto.reason);
  }

  @Post('config')
  updateConfig(
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: UpdateFeaturedConfigDto,
  ) {
    return this.featured.updateConfig(admin.sub, dto);
  }

  @Post('banned-bidders')
  banBidder(
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: BanFeaturedBidderDto,
  ) {
    return this.featured.banBidder(admin.sub, dto.userId, dto.reason);
  }

  @Delete('banned-bidders/:userId')
  unbanBidder(
    @CurrentAdmin() admin: { sub: string },
    @Param('userId') userId: string,
  ) {
    return this.featured.unbanBidder(admin.sub, userId);
  }
}
