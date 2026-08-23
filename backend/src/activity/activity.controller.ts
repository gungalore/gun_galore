import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OptionalClerkGuard } from '../auth/optional-clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ActivityService } from './activity.service';

interface ClientEvent {
  eventType?: string;
  listingId?: string;
  query?: string;
  path?: string;
  /** Install events only. Allowlisted below — never stored raw. */
  platform?: string;
  /** Install events only. Which surface fired it. Allowlisted below. */
  surface?: string;
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
    // Install funnel — client-only by nature. There is no server touch when a
    // browser shows an install popup, so if we do not accept it here we have
    // no record of it at all.
    'install_shown',
    'install_clicked',
    'install_dismissed',
    'install_completed',
  ]);

  // The install events carry two extra labels. Both are ALLOWLISTED rather
  // than stored as sent: this endpoint is unauthenticated, so anything that
  // reaches the database from it has to come from a closed set, or the
  // metadata column becomes a free-text write for anyone with curl.
  private static readonly PLATFORMS = new Set<string>([
    'ios-safari',
    'ios-other',
    'android',
    'desktop',
    'unknown',
  ]);
  private static readonly SURFACES = new Set<string>([
    'popup',
    'bar',
    'help',
    'nav',
    'footer',
  ]);

  // Deliberately NOT @SkipThrottle: this is an unauthenticated write — the
  // default per-IP rate limit is ample for legit use (~1 event per page nav)
  // and stops anyone flooding the UserEvent table.
  @Post()
  @HttpCode(204)
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
      const platform = ActivityController.PLATFORMS.has(e.platform ?? '')
        ? e.platform
        : undefined;
      const surface = ActivityController.SURFACES.has(e.surface ?? '')
        ? e.surface
        : undefined;
      this.activity.record({
        eventType: e.eventType as
          | 'page_view'
          | 'cart_add'
          | 'listing_view'
          | 'search'
          | 'install_shown'
          | 'install_clicked'
          | 'install_dismissed'
          | 'install_completed',
        actor: { clerkId: clerkId ?? null, deviceId },
        listingId: e.listingId ?? null,
        query: e.query ?? null,
        path: e.path ?? null,
        metadata:
          platform || surface ? { platform, surface } : null,
      });
    }
  }
}
