import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

/**
 * P1.1 — subscription purchase over the manual-EFT rail.
 *   GET  /subscriptions/pricing   public tier pricing (for the upgrade page)
 *   GET  /subscriptions/me        my tier + period + open EFT (auth)
 *   POST /subscriptions/checkout  start/resume a tier purchase → EFT details
 */
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('pricing')
  pricing() {
    return this.subscriptions.pricing();
  }

  @UseGuards(ClerkGuard)
  @Get('me')
  me(@CurrentUser() clerkId: string) {
    return this.subscriptions.getMine(clerkId);
  }

  @UseGuards(ClerkGuard)
  @Post('checkout')
  checkout(@CurrentUser() clerkId: string, @Body() body: { tier?: string }) {
    return this.subscriptions.checkout(clerkId, body?.tier ?? '');
  }
}
