import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CrimeStatsService } from './crime-stats.service';
import type {
  CrimeStatsStation,
  NearestStationResult,
  PrecinctFigures,
} from './crime-stats.types';

/**
 * ⚠️ ON EVERY METHOD — Nest's `@Header` reads a property descriptor and so
 * cannot be applied to a class. Nothing here varies by viewer, but the
 * nearest-station route carries the member's ADDRESS in the query string and
 * must never sit in a shared cache.
 */
const NoStore = () => Header('Cache-Control', 'private, no-store');

/**
 * SAPS crime statistics — /api/crime-stats.
 *
 * 🚨 EVERY ROUTE TAKES AuthGuard, READS INCLUDED. CLAUDE.md's rule is that a
 * new PUBLIC read path is a deliberate decision that has to be taken; this one
 * has not been. The figures themselves are public record, but the QUESTION is
 * not: "which police station is nearest this address" asked by an anonymous
 * caller is a free geocoding proxy on our Google key, and "show me the
 * precinct crime figures" is a members-only feature of the motivation builder.
 */
@Controller('crime-stats')
@UseGuards(AuthGuard)
export class CrimeStatsController {
  constructor(private readonly crimeStats: CrimeStatsService) {}

  /** Type-ahead for the station picker. */
  @Get('stations')
  @NoStore()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async stations(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<{ stations: CrimeStatsStation[] }> {
    const n = Number(limit);
    return {
      stations: await this.crimeStats.searchStations(
        q ?? '',
        Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 10,
      ),
    };
  }

  /**
   * The precinct nearest an address.
   *
   * ⚠️ TIGHTLY THROTTLED, BECAUSE EVERY CALL CAN COST TWO GOOGLE REQUESTS.
   * A type-ahead wired to this by mistake would bill a geocode per keystroke;
   * ten a minute is enough for a member correcting their address and nowhere
   * near enough to be worth abusing.
   */
  @Get('stations/nearest')
  @NoStore()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async nearest(
    @Query('address') address?: string,
  ): Promise<NearestStationResult> {
    return this.crimeStats.nearestStation(address ?? '');
  }

  /**
   * The figures for one precinct. `null` when we hold no ready release, or no
   * such station — the caller shows the picker rather than an error.
   */
  @Get('precinct')
  @NoStore()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async precinct(
    @Query('station') station?: string,
    @Query('province') province?: string,
  ): Promise<{ figures: PrecinctFigures | null }> {
    return {
      figures: await this.crimeStats.precinct(
        station ?? '',
        province || undefined,
      ),
    };
  }
}
