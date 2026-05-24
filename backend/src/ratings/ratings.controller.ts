import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RatingsService } from './ratings.service';
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
}

// Public — no guard. Used by /sellers/[clerkId] page (SSR fetch, no
// auth token) so any visitor can see a seller's reviews.
@Controller('ratings')
export class RatingsPublicController {
  constructor(private readonly ratingsService: RatingsService) {}

  // Seller's public ratings (used on listing pages + /sellers/[clerkId]).
  @Get('seller/:clerkId')
  forSeller(@Param('clerkId') clerkId: string) {
    return this.ratingsService.findForSeller(clerkId);
  }
}
