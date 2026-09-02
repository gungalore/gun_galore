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

  /**
   * The bullet picker's list.
   *
   * No bench is read: `loads` here is how many consolidated loads use the
   * bullet at all, not how many the caller could build. A member choosing what
   * to put ON the shelf is asking about the world, not about their shelf —
   * and a bench-relative count would read 0 for every row until they already
   * had the thing they are trying to add.
   */
  @Get('bullets')
  @UseGuards(OptionalClerkGuard)
  bullets() {
    return this.bench.bullets();
  }

  /**
   * ⚠️ DECLARED BEFORE 'cartridges/:key', AND IT STAYS THERE. Express tells
   * the two apart on its own today — ':key' demands a segment, so
   * /bench/cartridges cannot fall into it — but Nest matches in declaration
   * order, and that ordering is what keeps this route reachable if the param
   * route ever gains an optional segment or a wildcard. Same rule that keeps
   * 'log.csv' ahead of 'log/:id' below.
   */
  @Get('cartridges')
  @UseGuards(OptionalClerkGuard)
  cartridges() {
    return this.bench.cartridgeList();
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
   *
   * 🚨 EVERY FIELD OF A BULLET COMES THROUGH HERE OR IT DOES NOT EXIST. This
   * is the ONLY path from a member's stored shelf into loads(), powders() and
   * cartridge(), and it rebuilds each bullet field by field — so a field left
   * out here is silently absent everywhere downstream, with nothing failing.
   * That is exactly how the calibre axis shipped inert: loads() was taught to
   * pin a bullet to its calibre, the picker was taught to show it and store
   * it, and this map dropped it on the way back in, so every signed-in
   * member's .308" 150 gr SP went on matching 8x57 loads it will not chamber
   * in. The service's own spec could not catch it — it calls loads() directly
   * and never comes through the controller.
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
          calibreIn: storedCalibre(b.calibreIn),
        })),
        cartridgeKeys: mine.cartridges.map((c) => c.key),
      };
    }
    return {
      powderIds: split(q.powders),
      cartridgeKeys: split(q.cartridges),
      // "maker|weight|category" or "maker|weight|category|calibre" — the two
      // shapes the client's bulletKey() emits, and it emits the second for
      // every bullet added since calibres were recorded. Both are accepted:
      // dropping the four-part form would make a guest's whole shelf parse to
      // nothing, which reads as the page being broken.
      bullets: split(q.bullets)
        .map((s) => s.split('|'))
        .filter((p) => p.length === 3 || p.length === 4)
        .map(([maker, weight, category, calibre]) => ({
          maker,
          weightGr: Number(weight),
          category,
          // An empty fourth part is how bulletKey() writes "no calibre", so it
          // has to mean the same thing here as a missing one.
          calibreIn: calibre ? storedCalibre(Number(calibre)) : null,
        }))
        .filter((b) => Number.isFinite(b.weightGr)),
    };
  }
}

function split(v: string | undefined): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * A stored bullet's calibre, in inches, or null.
 *
 * UserBench.bullets is a Json column, so nothing in the database enforces the
 * shape and the value arriving here is whatever was written. Two cases both
 * land on null, and they mean the same thing to loads():
 *
 *   — a bench saved before calibres were recorded, which has no field at all;
 *   — a value that is not a finite number, which is a bench we cannot read.
 *
 * ⚠️ NULL MEANS "MATCHES ANY CALIBRE", WHICH IS THE PRE-CALIBRE BEHAVIOUR AND
 * IS DELIBERATE. The alternative — treating an unreadable figure as a calibre
 * of its own — matches no cartridge at all and empties a member's screen with
 * nothing on it saying why, through no action of theirs. Nothing is rounded,
 * bucketed or snapped here: a readable figure is passed through exactly as the
 * picker stored it, because that is the only way it still equals the figure
 * calibreFromG1() will compare it against.
 */
function storedCalibre(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
