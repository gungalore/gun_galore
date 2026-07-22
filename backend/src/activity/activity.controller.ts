import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { OptionalClerkGuard } from '../auth/optional-clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ActivityService } from './activity.service';

interface ClientEvent {
  eventType?: string;
  listingId?: string;
  query?: string;
  path?: string;
}

// Client beacon. The browser fires navigator.sendBeacon here for events that
// have no server touch (page navigation, cart adds) + optional anonymous
// view/search. OptionalClerkGuard stamps the signed-in user's clerkId when a
// token is present; anonymous callers are stitched by their first-party
// deviceId. Only a small allowlist of CLIENT-origin types is accepted — money
// events (offer/bid/checkout) are captured server-side and can't be spoofed
// through here.
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  private static readonly CLIENT_TYPES = new Set<string>([
    'page_view',
    'cart_add',
    'listing_view',
    'search',
  ]);

  @Post()
  @HttpCode(204)
  @SkipThrottle()
  @UseGuards(OptionalClerkGuard)
  ingest(
    @CurrentUser() clerkId: string | undefined,
    @Body() body: { deviceId?: string; events?: ClientEvent[] },
  ): void {
    const deviceId =
      typeof body?.deviceId === 'string' ? body.deviceId.slice(0, 64) : null;
    const events = Array.isArray(body?.events) ? body.events.slice(0, 30) : [];
    for (const e of events) {
      if (!e || !ActivityController.CLIENT_TYPES.has(e.eventType ?? '')) continue;
      this.activity.record({
        eventType: e.eventType as
          | 'page_view'
          | 'cart_add'
          | 'listing_view'
          | 'search',
        actor: { clerkId: clerkId ?? null, deviceId },
        listingId: e.listingId ?? null,
        query: e.query ?? null,
        path: e.path ?? null,
      });
    }
  }
}
