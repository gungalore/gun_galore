import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClerkGuard } from '../auth/clerk.guard';
import { OptionalClerkGuard } from '../auth/optional-clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BenchService, type GuestBench } from './bench.service';

/**
 * THE BENCH — /api/bench.
 *
 * Reads take OptionalClerkGuard: the page answers for a guest too, from a
 * bench passed in the query, so somebody can try it before signing in.
 * Writes take ClerkGuard, because they touch a member's own shelf.
 *
 * ⚠️ NEVER CACHE A RESPONSE THAT VARIES BY VIEWER. Every route below is
 * viewer-dependent — /bench/loads is literally "what YOU can build" — so none
 * of them may acquire a shared cache header. One cached bench served to the
 * next member is a stranger's shelf.
 */
@Controller('bench')
export class BenchController {
  constructor(private readonly bench: BenchService) {}

  /* ── the caller's own bench ─────────────────────────────────────────── */

  @Get('me')
  @UseGuards(ClerkGuard)
  me(@CurrentUser() clerkSub: string) {
    return this.bench.getBench(clerkSub);
  }

  @Put('me')
  @UseGuards(ClerkGuard)
  putMe(@CurrentUser() clerkSub: string, @Body() body: Record<string, never>) {
    return this.bench.putBench(clerkSub, body);
  }

  /* ── the answer ─────────────────────────────────────────────────────── */

  @Get('loads')
  @UseGuards(OptionalClerkGuard)
  async loads(@Req() req: { clerkUserId?: string }, @Query() q: Record<string, string>) {
    const bench = await this.benchFor(req, q);
    return this.bench.loads(bench, {
      cartridgeKey: q.cartridgeKey || undefined,
      powderId: q.powderId || undefined,
      weightMin: q.weightMin ? Number(q.weightMin) : undefined,
      weightMax: q.weightMax ? Number(q.weightMax) : undefined,
    });
  }

  @Get('powders')
  @UseGuards(OptionalClerkGuard)
  async powders(@Req() req: { clerkUserId?: string }, @Query() q: Record<string, string>) {
    return this.bench.powders(q.q || undefined, await this.benchFor(req, q));
  }

  @Get('cartridges/:key')
  @UseGuards(OptionalClerkGuard)
  async cartridge(
    @Param('key') key: string,
    @Req() req: { clerkUserId?: string },
    @Query() q: Record<string, string>,
  ) {
    return this.bench.cartridge(key, await this.benchFor(req, q));
  }

  /* ── the log ────────────────────────────────────────────────────────── */

  @Get('log')
  @UseGuards(ClerkGuard)
  log(@CurrentUser() clerkSub: string) {
    return this.bench.log(clerkSub);
  }

  /**
   * ⚠️ DECLARED BEFORE 'log/:id' SO THE PARAM ROUTE CANNOT SWALLOW IT. Nest
   * matches in declaration order; registered after, "log.csv" would still be
   * reached, but the ordering is the thing that keeps it true.
   */
  @Get('log.csv')
  @UseGuards(ClerkGuard)
  async logCsv(@CurrentUser() clerkSub: string, @Res() res: Response) {
    const { csv, filename } = await this.bench.logCsv(clerkSub);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Post('log')
  @UseGuards(ClerkGuard)
  addLog(@CurrentUser() clerkSub: string, @Body() body: Record<string, unknown>) {
    return this.bench.addLog(clerkSub, body);
  }

  @Delete('log/:id')
  @UseGuards(ClerkGuard)
  deleteLog(@CurrentUser() clerkSub: string, @Param('id') id: string) {
    return this.bench.deleteLog(clerkSub, id);
  }

  /**
   * A signed-in caller's stored bench, else the one in the query string.
   *
   * ⚠️ A GUEST BENCH IS NEVER PERSISTED AND NEVER TRUSTED BEYOND THIS CALL.
   * It is a filter the caller supplies, so it decides what they are shown and
   * nothing else — it cannot name another member, and it is not written
   * anywhere.
   */
  private async benchFor(
    req: { clerkUserId?: string },
    q: Record<string, string>,
  ): Promise<GuestBench> {
    if (req.clerkUserId) {
      const mine = await this.bench.getBench(req.clerkUserId);
      return {
        powderIds: mine.powders.map((p) => p.id),
        bullets: mine.bullets.map((b) => ({
          maker: b.maker,
          weightGr: b.weightGr,
          category: b.category,
        })),
        cartridgeKeys: mine.cartridges.map((c) => c.key),
      };
    }
    return {
      powderIds: split(q.powders),
      cartridgeKeys: split(q.cartridges),
      // "maker|weight|category", the shape the spec names.
      bullets: split(q.bullets)
        .map((s) => s.split('|'))
        .filter((p) => p.length === 3)
        .map(([maker, weight, category]) => ({
          maker,
          weightGr: Number(weight),
          category,
        }))
        .filter((b) => Number.isFinite(b.weightGr)),
    };
  }
}

function split(v: string | undefined): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
