import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
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
  /** page_dwell only. Active foreground seconds, clamped below. */
  durationSec?: number;
  /** page_dwell only. Product area, allowlisted below. */
  section?: string;
}

// Client beacon. The browser fires navigator.sendBeacon here for events that
// have no server touch (page navigation, cart adds) + optional anonymous
// view/search. OptionalAuthGuard stamps the signed-in user's userId when a
// token is present; anonymous callers are stitched by their first-party
// deviceId. Only a small allowlist of CLIENT-origin types is accepted — money
// events (offer/bid/checkout) are captured server-side and can't be spoofed
// through here.
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  private static readonly CLIENT_TYPES = new Set<string>([
    'page_view',
    'page_dwell',
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

  // Product areas the admin "time spent on what" board reports. A closed set
  // for the same reason as the install labels: this endpoint is
  // unauthenticated, so metadata must never be a free-text write.
  private static readonly SECTIONS = new Set<string>([
    'marketplace',
    'auctions',
    'listing',
    'community',
    'bench',
    'motivations',
    'valuations',
    'checkout',
    'account',
    'other',
  ]);

  /**
   * The dwell cap. A tab left open all day would otherwise report a single
   * 12-hour "visit" and skew every average; 30 minutes is long enough for a
   * genuine deep read and short enough to bound a forgotten tab.
   */
  private static readonly MAX_DWELL_SEC = 30 * 60;
  private static readonly MIN_DWELL_SEC = 1;

  // Deliberately NOT @SkipThrottle: this is an unauthenticated write — the
  // default per-IP rate limit is ample for legit use (~1 event per page nav)
  // and stops anyone flooding the UserEvent table.
  @Post()
  @HttpCode(204)
  @UseGuards(OptionalAuthGuard)
  ingest(
    @CurrentUser() userId: string | undefined,
    @Body() body: { deviceId?: string; events?: ClientEvent[] },
    @Req() req?: Request & { sessionId?: string },
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
      const section = ActivityController.SECTIONS.has(e.section ?? '')
        ? e.section
        : undefined;

      let metadata: Record<string, unknown> | null = null;
      if (e.eventType === 'page_dwell') {
        const raw = Number(e.durationSec);
        // A dwell with no usable duration answers no question; drop it rather
        // than storing a zero that would drag every average down.
        if (!Number.isFinite(raw)) continue;
        metadata = {
          durationSec: Math.min(
            ActivityController.MAX_DWELL_SEC,
            Math.max(ActivityController.MIN_DWELL_SEC, Math.round(raw)),
          ),
          section: section ?? 'other',
        };
      } else if (platform || surface || section) {
        metadata = {
          ...(platform ? { platform } : {}),
          ...(surface ? { surface } : {}),
          ...(section ? { section } : {}),
        };
      }

      this.activity.record({
        eventType: e.eventType as
          | 'page_view'
          | 'page_dwell'
          | 'cart_add'
          | 'listing_view'
          | 'search'
          | 'install_shown'
          | 'install_clicked'
          | 'install_dismissed'
          | 'install_completed',
        actor: { userId: userId ?? null, deviceId },
        listingId: e.listingId ?? null,
        query: e.query ?? null,
        path: e.path ?? null,
        sessionId: req?.sessionId ?? null,
        metadata,
      });
    }
  }
}
