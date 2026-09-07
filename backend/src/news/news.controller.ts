import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { NewsService } from './news.service';
import type { NewsIncident } from './news.types';

/**
 * ⚠️ ON EVERY METHOD — Nest's `@Header` reads a property descriptor and so
 * cannot be applied to a class. The answer varies by station and can trigger a
 * billed geocode and a live search, so it must never sit in a shared cache.
 */
const NoStore = () => Header('Cache-Control', 'private, no-store');

/**
 * Local crime reporting — /api/news.
 *
 * 🚨 ClerkGuard, READS INCLUDED, and the same reasoning as crime-stats: the
 * clippings themselves are public journalism, but the QUESTION is not. "What
 * crime happened near this police station" asked anonymously is a free
 * geocoding proxy on our Google key and a free Google News proxy on top of
 * it, and this is a members-only feature of the motivation builder.
 */
@Controller('news')
@UseGuards(ClerkGuard)
export class NewsController {
  constructor(private readonly news: NewsService) {}

  /**
   * Clippings near a precinct.
   *
   * ⚠️ TIGHTLY THROTTLED, BECAUSE A COLD PRECINCT COSTS REAL CALLS — a
   * geocode for the station and, when the registry is thin there, two Google
   * News fetches and a model call. Twenty a minute is more than a member
   * building one motivation will ever need.
   */
  @Get('incidents')
  @NoStore()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async incidents(
    @Query('station') station?: string,
    @Query('province') province?: string,
    @Query('limit') limit?: string,
    @Query('withinKm') withinKm?: string,
    @Query('months') months?: string,
  ): Promise<{ incidents: NewsIncident[] }> {
    const name = (station ?? '').trim();
    const prov = (province ?? '').trim();
    // Without both halves there is no precinct to answer about — two
    // provinces spell stations the same way, so a name alone is not a place.
    if (!name || !prov) return { incidents: [] };

    return {
      incidents: await this.news.incidentsNear({
        station: { name, province: prov },
        limit: num(limit),
        withinKm: num(withinKm),
        months: num(months),
      }),
    };
  }
}

function num(v?: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
