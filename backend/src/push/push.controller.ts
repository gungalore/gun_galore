import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PushService } from './push.service';
import { SubscribeDto } from './dto/subscribe.dto';

/**
 * /push routes.
 *
 *   GET    /push/vapid-public-key   — PUBLIC. Returns the VAPID
 *                                     public key + a `ready` flag.
 *                                     Frontend calls this once to
 *                                     decide whether to show the
 *                                     opt-in UI (false → backend
 *                                     not configured, hide the
 *                                     button entirely).
 *   GET    /push/me                 — AUTH. Returns whether the
 *                                     user has any active push
 *                                     subscription. Drives the
 *                                     "Enabled" vs "Enable" toggle.
 *   POST   /push/subscribe          — AUTH. Registers a new endpoint.
 *   DELETE /push/subscribe?endpoint=… — AUTH. Removes one endpoint.
 */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  // Public read — needed before sign-in so the unsigned-in homepage
  // doesn't trigger a 401 just for asking whether push is available.
  @Get('vapid-public-key')
  @SkipThrottle()
  vapid(): { publicKey: string | null; ready: boolean } {
    return { publicKey: this.push.getPublicKey(), ready: this.push.isReady() };
  }

  @Get('me')
  @UseGuards(ClerkGuard)
  @SkipThrottle()
  async me(
    @CurrentUser() clerkId: string,
  ): Promise<{ subscribed: boolean }> {
    const subscribed = await this.push.hasAnySubscription(clerkId);
    return { subscribed };
  }

  @Post('subscribe')
  @UseGuards(ClerkGuard)
  @HttpCode(200)
  async subscribe(
    @CurrentUser() clerkId: string,
    @Body() dto: SubscribeDto,
  ) {
    return this.push.subscribe(clerkId, {
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: dto.userAgent,
      categories: dto.categories,
    });
  }

  @Delete('subscribe')
  @UseGuards(ClerkGuard)
  async unsubscribe(
    @CurrentUser() clerkId: string,
    @Query('endpoint') endpoint: string,
  ) {
    return this.push.unsubscribe(clerkId, endpoint);
  }
}
