import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RatingsService } from './ratings.service';
import { OptionalClerkGuard } from '../auth/optional-clerk.guard';
import { CreateRatingDto } from './dto/create-rating.dto';

@Controller('transactions/:transactionId/rating')
@UseGuards(ClerkGuard)
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post()
  create(
    @Param('transactionId') transactionId: string,
    @CurrentUser() clerkId: string,
    @Body() dto: CreateRatingDto,
  ) {
    return this.ratingsService.create(transactionId, clerkId, dto);
  }

  // Buyer corrects their rating (30-day window, closes when the seller
  // replies).
  @Patch()
  update(
    @Param('transactionId') transactionId: string,
    @CurrentUser() clerkId: string,
    @Body() dto: CreateRatingDto,
  ) {
    return this.ratingsService.update(transactionId, clerkId, dto);
  }
}

// Admin moderation — remove an abusive review (reason mandatory, audited).
@Controller('admin/ratings')
@UseGuards(AdminJwtGuard)
export class RatingsAdminController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post(':id/remove')
  remove(
    @Param('id') id: string,
    @CurrentAdmin() adminId: string,
    @Body() body: { reason?: string },
  ) {
    return this.ratingsService.adminRemove(id, adminId, body?.reason ?? '');
  }
}

// Auth-gated dashboard endpoint. NOTE: split from the public seller
// ratings controller below because Nest applies class-level guards to
// every method — having `forSeller` under the same `@UseGuards(ClerkGuard)`
// class would 401 the public /sellers/:clerkId page that needs to load
// without an auth token (server-fetched SSR for guests).
@Controller('ratings')
@UseGuards(ClerkGuard)
export class RatingsDashboardController {
  constructor(private readonly ratingsService: RatingsService) {}

  // Seller's private trust dashboard
  @Get('dashboard')
  dashboard(@CurrentUser() clerkId: string) {
    return this.ratingsService.getTrustDashboard(clerkId);
  }

  // Seller's single public reply to a review on their profile.
  @Post(':id/response')
  respond(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @Body() body: { response?: string },
  ) {
    return this.ratingsService.respond(id, clerkId, body?.response ?? '');
  }
}

// Public, but OptionalClerkGuard (never rejects): a review embeds the listing
// title, so signed-out callers get only reviews on publicly-visible listings.
// Used by /sellers/[clerkId] (SSR) and the listing page.
@Controller('ratings')
@UseGuards(OptionalClerkGuard)
export class RatingsPublicController {
  constructor(private readonly ratingsService: RatingsService) {}

  // Seller's public ratings (used on listing pages + /sellers/[clerkId]).
  @Get('seller/:clerkId')
  forSeller(
    @Param('clerkId') sellerClerkId: string,
    @CurrentUser() viewerClerkId?: string,
  ) {
    return this.ratingsService.findForSeller(sellerClerkId, viewerClerkId);
  }
}
