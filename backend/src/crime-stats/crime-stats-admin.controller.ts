import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  CrimeStatsFetchService,
  type CrimeStatsRunOutcome,
} from './crime-stats-fetch.service';

/**
 * SAPS crime-statistics releases — /api/admin/crime-stats.
 *
 * Admin JWT, exactly as every other admin surface. `AdminJwtGuard` opens safe
 * methods to any active admin and reserves every mutating one for a
 * SUPERADMIN, so the "Fetch now" POST is superadmin-only without this file
 * having to say so.
 */
@Controller('admin/crime-stats')
@UseGuards(AdminJwtGuard)
export class CrimeStatsAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: CrimeStatsFetchService,
  ) {}

  /**
   * Every release we have tried to load, newest first — including the failed
   * ones, which is the point: a quarter missing from the site is only
   * explicable from the row that records why.
   */
  @Get('releases')
  async releases() {
    const releases = await this.prisma.crimeStatsRelease.findMany({
      orderBy: [{ latestPeriod: 'desc' }, { fetchedAt: 'desc' }],
      select: {
        id: true,
        key: true,
        status: true,
        periodLabel: true,
        latestPeriod: true,
        sourceUrl: true,
        rowCount: true,
        fetchedAt: true,
        error: true,
      },
    });
    const [stations, figures] = await Promise.all([
      this.prisma.crimeStatsStation.count(),
      this.prisma.crimeStatsFigure.count(),
    ]);
    return { releases, stations, figures };
  }

  /**
   * Run the weekly job now.
   *
   * ⚠️ SLOW BY NATURE — a release is ~258 000 figures — and deliberately not
   * backgrounded, so the admin sees the outcome lines rather than a spinner
   * and a guess. The service refuses a second concurrent run.
   */
  @Post('fetch')
  @HttpCode(200)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  async fetchNow(): Promise<CrimeStatsRunOutcome> {
    return this.fetcher.runNow();
  }
}
