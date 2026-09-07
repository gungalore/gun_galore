import { Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { NewsPollService } from './news-poll.service';
import type { NewsPollOutcome } from './news.types';

/**
 * The press-clipping feeds — /api/admin/news.
 *
 * Admin JWT, exactly as every other admin surface. `AdminJwtGuard` opens safe
 * methods to any active admin and reserves every mutating one for a
 * SUPERADMIN, so "Poll now" is superadmin-only without this file saying so.
 */
@Controller('admin/news')
@UseGuards(AdminJwtGuard)
export class NewsAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly poll: NewsPollService,
  ) {}

  /**
   * Every registered feed with its last outcome.
   *
   * ⚠️ THE FAILED ONES ARE THE POINT. A title that vanishes from a member's
   * results is only explicable from the row that says its feed has been
   * answering 404 since March — which is the single most likely way this
   * feature decays, since we do not control any of these publishers.
   */
  @Get('sources')
  async sources(@Query('failing') failing?: string) {
    const rows = await this.prisma.newsSource.findMany({
      where: failing === 'true' ? { NOT: { lastError: null } } : {},
      orderBy: [{ province: 'asc' }, { key: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        homepage: true,
        feedUrl: true,
        province: true,
        district: true,
        towns: true,
        lat: true,
        lng: true,
        radiusKm: true,
        kind: true,
        enabled: true,
        lastPolledAt: true,
        lastError: true,
        itemCount: true,
      },
    });
    const [articles, crime, places] = await Promise.all([
      this.prisma.newsArticle.count(),
      this.prisma.newsArticle.count({ where: { isCrime: true } }),
      this.prisma.newsPlace.count(),
    ]);
    return {
      sources: rows,
      failing: rows.filter((r) => r.lastError !== null).length,
      articles,
      crime,
      places,
    };
  }

  /**
   * Run the nightly job now.
   *
   * ⚠️ SLOW BY NATURE — ~74 feeds, an article page per new item and a model
   * call per twenty — and deliberately not backgrounded, so the admin sees
   * the per-source lines rather than a spinner and a guess. The service
   * refuses a second concurrent run.
   */
  @Post('poll')
  @HttpCode(200)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  async pollNow(@Query('maxSources') maxSources?: string): Promise<NewsPollOutcome> {
    const n = Number(maxSources);
    return this.poll.runNow(
      Number.isFinite(n) && n > 0 ? { maxSources: Math.trunc(n) } : {},
    );
  }
}
