import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { HuntPdfService } from './hunt-pdf.service';

/**
 * Public INFO Centre endpoints for the Hunt Ballistics iOS app.
 *
 *   GET /hunt-ballistics/info-centre/library          browse all PDFs grouped by category
 *   GET /hunt-ballistics/info-centre/search?q=...     FTS across all pages
 *   GET /hunt-ballistics/info-centre/pdf/:id          single PDF metadata
 *   GET /hunt-ballistics/info-centre/pdf/:id/page/:n  single page (text + optional image)
 *
 * All routes are anonymous — Hunt Ballistics uses device-UUID identity
 * for analytics but the library content itself is public-read.
 *
 * Throttling: browse + read endpoints are SkipThrottle (they're cheap
 * Postgres reads). Search is the only paid surface, so it gets a
 * 60/min/IP cap to defend against search-as-you-type loops.
 */
@Controller('hunt-ballistics/info-centre')
export class HuntPdfController {
  constructor(private readonly service: HuntPdfService) {}

  @Get('library')
  @SkipThrottle()
  library() {
    return this.service.listLibrary();
  }

  @Get('search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  search(@Query('q') q?: string, @Query('limit') limit?: string) {
    const safeQuery = (q ?? '').trim();
    if (safeQuery.length === 0) return [];
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 10;
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException('limit must be a positive integer.');
    }
    return this.service.searchPages(safeQuery, parsedLimit);
  }

  @Get('pdf/:id')
  @SkipThrottle()
  pdf(@Param('id') id: string) {
    return this.service.getPdf(id);
  }

  @Get('pdf/:id/page/:n')
  @SkipThrottle()
  page(
    @Param('id') id: string,
    @Param('n', ParseIntPipe) pageNumber: number,
  ) {
    return this.service.getPage(id, pageNumber);
  }
}
