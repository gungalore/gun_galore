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
import { benchBulletKey } from './bench.types';
import { resolveTolerance } from './bullet-weight';

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

  /**
   * 🚨 THE PARAMETER NAMES HERE ARE THE ONES THE CLIENT ACTUALLY SENDS, AND
   * THEY WERE NOT. lib/bench/api.ts writes `?cartridge=`, `?weight=` and
   * `?off=`; this method read `cartridgeKey`, `weightMin` and `weightMax` and
   * nothing at all read `off`. Every one of the finder's three controls was
   * therefore inert: the cartridge tab, the weight band and every chip the
   * member switched off changed the query string and nothing else. Nothing
   * errored — an unread query parameter is just an unread query parameter —
   * so the screen answered the same question however it was narrowed.
   *
   * ⚠️ AND THE EMPTY-STATE DIAGNOSIS IS WHAT MADE IT A LIE RATHER THAN A DEAD
   * CONTROL. LoadsResponse.why counts loads with one AXIS relaxed and the
   * FILTERS held, and the panel prints those counts beside the member's own
   * product names with the switched-off chips taken out. Counted against the
   * full shelf and printed against the narrowed one, "your .30-06 and N550
   * have 70 loads together" credits N550 with loads that were found on the
   * H4350 the member had just switched off.
   *
   * ⚠️ SO A CONTROL THE MEMBER CAN SEE IS A PARAMETER THIS METHOD READS.
   * A new filter added to the toolbar and not added here does not fail — it
   * silently widens every figure on the screen, the diagnosis included.
   *
   * `?tolerance=` is the grain window, and it is read in benchFor() with the
   * rest of the shelf so the results, the powder chips and the spec card
   * cannot answer over three different widths.
   */
  @Get('loads')
  @UseGuards(OptionalClerkGuard)
  async loads(@Req() req: { clerkUserId?: string }, @Query() q: Record<string, string>) {
    const bench = await this.benchFor(req, q);
    return this.bench.loads(bench, {
      cartridgeKey: q.cartridge || undefined,
      powderId: q.powderId || undefined,
      ...weightBand(q.weight),
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
   *
   * 🚨 AND A BULLET IS NOW A WEIGHT IN A CALIBRE, SO THAT IS ALL THAT CROSSES.
   * The stored maker and category are deliberately left behind rather than
   * carried: they are decoration on the chip, nothing matches on them, and a
   * field that reaches the query is a field something can start narrowing on
   * again. `weightGr` and `calibreIn` are the whole identity.
   *
   * 🚨 THE GRAIN WINDOW COMES THROUGH THE SAME DOOR. It changes which loads a
   * shelf bullet finds, so a surface reading it and a surface not reading it
   * would print two different numbers about one shelf — which is the exact
   * shape of the calibre bug above. It widens the SEARCH and never a charge:
   * every load is still quoted at its own bullet weight.
   *
   * 🚨 AND THE SWITCHED-OFF CHIPS COME OUT HERE, IN THE ONE DOOR, so the
   * results, the powder chips' counts and the spec card's count all answer
   * for the SAME shelf. `off` is what the member has greyed out for this
   * search — it never touches the saved bench — and a surface that skipped it
   * would print a figure for a shelf the member can see they are not using.
   */
  private async benchFor(
    req: { clerkUserId?: string },
    q: Record<string, string>,
  ): Promise<GuestBench> {
    const off = new Set(split(q.off));
    // ⚠️ THROUGH resolveTolerance(), NEVER Number(). An empty `?tolerance=` in
    // the URL is Number('') — which is 0, not NaN — and a silent zero
    // collapses the search back to the exact weight, the precise narrowness
    // this parameter exists to undo. It also clamps a stranger from the query
    // string to a width the finder actually offers.
    const toleranceGr = resolveTolerance(q.tolerance);

    if (req.clerkUserId) {
      const mine = await this.bench.getBench(req.clerkUserId);
      return {
        toleranceGr,
        powderIds: mine.powders.filter((p) => !off.has(p.id)).map((p) => p.id),
        // ⚠️ KEYED OFF THE STORED BULLET, NOT THE SANITISED ONE. The client
        // builds these keys from what GET /bench/me handed it, which is the
        // raw Json column — so an unreadable calibre keys as the client wrote
        // it here and as storedCalibre() reads it below, and the chip the
        // member switched off is the bullet that leaves.
        bullets: mine.bullets
          .filter((b) => !off.has(benchBulletKey(b)))
          .map((b) => ({
            weightGr: b.weightGr,
            calibreIn: storedCalibre(b.calibreIn),
          })),
        cartridgeKeys: mine.cartridges.filter((c) => !off.has(c.key)).map((c) => c.key),
      };
    }
    return {
      toleranceGr,
      powderIds: split(q.powders).filter((id) => !off.has(id)),
      cartridgeKeys: split(q.cartridges).filter((key) => !off.has(key)),
      bullets: split(q.bullets)
        .filter((s) => !off.has(s))
        .map(parseGuestBullet)
        .filter((b): b is { weightGr: number; calibreIn: number | null } => b !== null),
    };
  }
}

function split(v: string | undefined): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * One entry of a guest's `?bullets=` list, as a shelf bullet.
 *
 * 🚨 THE KEY IS bulletKey()'s, AND ITS SPELLING IS benchBulletKey() — imported
 * rather than rewritten, because a key that disagrees by so much as an empty
 * part does not error: it leaves the chip switched off on the screen and
 * switched on in the query. Today's shape is `calibre|weight`, with an empty
 * first part for a bullet with no calibre.
 *
 * ⚠️ THE OLD SHAPES ARE STILL READ, AND THAT IS NOT POLITENESS. Links shared
 * before this change carry `maker|weight|category` or
 * `maker|weight|category|calibre`; rejecting them would turn a shared bench
 * into an empty page. Only the weight and the calibre are taken from them —
 * the maker and the category are dropped on the floor, which is exactly what
 * this change means. The three shapes cannot be confused: two parts is the new
 * form, three or four the old.
 *
 * A weight that is not a number is not a bullet, and returns null.
 */
function parseGuestBullet(s: string): { weightGr: number; calibreIn: number | null } | null {
  const parts = s.split('|');
  // An empty part is how a missing calibre is written, at either end.
  const [weight, calibre] =
    parts.length === 2
      ? [parts[1], parts[0]]
      : parts.length === 3 || parts.length === 4
        ? [parts[1], parts[3]]
        : [undefined, undefined];

  // ⚠️ `!weight` RATHER THAN `weight === undefined`. Number('') IS 0, NOT NaN,
  // so a key with a blank weight would otherwise parse as a 0 gr bullet and
  // quietly search a window nothing sits in.
  if (!weight) return null;
  const weightGr = Number(weight);
  if (!Number.isFinite(weightGr)) return null;

  return { weightGr, calibreIn: calibre ? storedCalibre(Number(calibre)) : null };
}

/**
 * The finder's weight band as a range on `weightGr`.
 *
 * ⚠️ THE IDS ARE THE CLIENT'S, VERBATIM — see WEIGHT_BANDS in
 * components/bench/contract.ts, whose own comment promises "values match the
 * API's `weight` query". They did not: nothing on this side read the
 * parameter at all, so every band searched every weight.
 *
 * ⚠️ THE BOUNDS OVERLAP BECAUSE THE LABELS DO. "≤ 100 gr", "100–150 gr" and
 * "150 gr +" all claim their endpoint, so a 150 gr bullet is in two bands —
 * which is what a reloader reading those labels expects. Nudging one bound to
 * make the set disjoint would hide a weight from the band that names it.
 *
 * An unknown or absent band narrows nothing, which is what 'any' means.
 */
const WEIGHT_BANDS: Record<string, { weightMin?: number; weightMax?: number }> = {
  lte100: { weightMax: 100 },
  '100to150': { weightMin: 100, weightMax: 150 },
  gte150: { weightMin: 150 },
};

function weightBand(band: string | undefined): { weightMin?: number; weightMax?: number } {
  return (band && WEIGHT_BANDS[band]) || {};
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
