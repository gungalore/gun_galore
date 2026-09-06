import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BenchService, type GuestBench } from './bench.service';
import { AddLogDto, PatchLogDto, PutBenchDto, ShareBenchDto } from './bench.dto';
import { benchBulletKey } from './bench.types';
import { resolveTolerance } from './bullet-weight';

/**
 * ⚠️ ON EVERY METHOD, BECAUSE NEST'S `@Header` IS METHOD-ONLY. It reads the
 * property descriptor, so applied to the class it throws at decoration time —
 * there is no way to state this once for the controller. A route added below
 * without it is a viewer-varying response the browser is free to hand to the
 * next person on that machine.
 */
const NoStore = () => Header('Cache-Control', 'private, no-store');

/**
 * THE BENCH — /api/bench.
 *
 * 🚨 EVERY ROUTE TAKES ClerkGuard, READS INCLUDED. The reads were on
 * OptionalClerkGuard so a guest could try the finder from a bench passed in
 * the query string — but the guest bench is deferred (SPEC-BUILD §10), the
 * `/bench` PAGE is behind Clerk, and nothing in the client has ever sent a
 * guest shelf. What that left was the whole consolidated catalogue readable by
 * anybody who could type a URL: every cartridge, every powder, every bullet
 * weight, and 28 000 charge ranges derived from reloading manuals. CLAUDE.md's
 * rule for a new public read path is that it must be a deliberate decision;
 * this one was never taken, and reloading data sits on the members-only side
 * of the line the site was twice restricted over.
 *
 * ⚠️ SO THE `?powders=` / `?bullets=` / `?cartridges=` QUERY PATH IS GONE, not
 * merely unreachable. Code that can only run for a caller the guard rejects is
 * code that comes back the day somebody relaxes a guard for an unrelated
 * reason. When the guest bench is built it gets its own decision and its own
 * route.
 *
 * ⚠️ NEVER CACHE A RESPONSE THAT VARIES BY VIEWER. Every route below is
 * viewer-dependent — /bench/loads is literally "what YOU can build" — so every
 * one of them carries `@NoStore()`, and that is not belt-and-braces: the
 * browser's own HTTP cache keys on the URL and not on the Authorization
 * header, so two members on one machine share `/api/bench/loads` exactly.
 */
@Controller('bench')
@UseGuards(ClerkGuard)
export class BenchController {
  constructor(private readonly bench: BenchService) {}

  /* ── the caller's own bench ─────────────────────────────────────────── */

  @Get('me')
  @NoStore()
  me(@CurrentUser() clerkSub: string) {
    return this.bench.getBench(clerkSub);
  }

  @Put('me')
  @NoStore()
  putMe(@CurrentUser() clerkSub: string, @Body() body: PutBenchDto) {
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
  @NoStore()
  async loads(@CurrentUser() clerkSub: string, @Query() q: Record<string, string>) {
    const bench = await this.benchFor(clerkSub, q);
    return this.bench.loads(bench, filterFrom(q));
  }

  /**
   * ⚠️ THE FILTER GOES IN TOO, AND IT IS THE SAME ONE THE RESULTS USED. Each
   * row's `loadsForBench` is a promise about what tapping that powder shows,
   * and the member is looking at a screen already narrowed by a cartridge tab
   * and a weight band. Counted without them the chip reads twelve over a list
   * of one.
   */
  @Get('powders')
  @NoStore()
  async powders(@CurrentUser() clerkSub: string, @Query() q: Record<string, string>) {
    return this.bench.powders(q.q || undefined, await this.benchFor(clerkSub, q), filterFrom(q));
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
  @NoStore()
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
  @NoStore()
  cartridges() {
    return this.bench.cartridgeList();
  }

  @Get('cartridges/:key')
  @NoStore()
  async cartridge(
    @Param('key') key: string,
    @CurrentUser() clerkSub: string,
    @Query() q: Record<string, string>,
  ) {
    return this.bench.cartridge(key, await this.benchFor(clerkSub, q), filterFrom(q));
  }

  /* ── the log ────────────────────────────────────────────────────────── */

  @Get('log')
  @NoStore()
  log(@CurrentUser() clerkSub: string) {
    return this.bench.log(clerkSub);
  }

  /**
   * ⚠️ DECLARED BEFORE 'log/:id' SO THE PARAM ROUTE CANNOT SWALLOW IT. Nest
   * matches in declaration order; registered after, "log.csv" would still be
   * reached, but the ordering is the thing that keeps it true.
   */
  @Get('log.csv')
  @NoStore()
  async logCsv(@CurrentUser() clerkSub: string, @Res() res: Response) {
    const { csv, filename } = await this.bench.logCsv(clerkSub);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Post('log')
  @NoStore()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  addLog(@CurrentUser() clerkSub: string, @Body() body: AddLogDto) {
    return this.bench.addLog(clerkSub, body);
  }

  /**
   * The results, once the member has been to the range.
   *
   * ⚠️ THE SHEET ALREADY PROMISED THIS. Its footer reads "Results (velocity,
   * group) are added after the range" over a form that saved them as null and
   * a list with no way to change them — so the one figure a reloader keeps a
   * log FOR could never be entered.
   */
  @Patch('log/:id')
  @NoStore()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  patchLog(
    @CurrentUser() clerkSub: string,
    @Param('id') id: string,
    @Body() body: PatchLogDto,
  ) {
    return this.bench.patchLog(clerkSub, id, body);
  }

  @Delete('log/:id')
  @NoStore()
  deleteLog(@CurrentUser() clerkSub: string, @Param('id') id: string) {
    return this.bench.deleteLog(clerkSub, id);
  }

  /* ── the permalink ──────────────────────────────────────────────────── */

  /**
   * ⚠️ BOTH HALVES ARE MEMBER-ONLY. A share is a shortcut between two people
   * who can both already open /bench, not a way to publish the catalogue to
   * somebody who cannot — see the class header.
   */
  @Post('share')
  @NoStore()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  share(@CurrentUser() clerkSub: string, @Body() body: ShareBenchDto) {
    return this.bench.share(clerkSub, body.payload);
  }

  @Get('share/:token')
  @NoStore()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  readShare(@Param('token') token: string) {
    return this.bench.readShare(token);
  }

  /**
   * The caller's stored bench, with this search's switched-off chips removed.
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
  private async benchFor(clerkSub: string, q: Record<string, string>): Promise<GuestBench> {
    const off = new Set(split(q.off));
    // ⚠️ THROUGH resolveTolerance(), NEVER Number(). An empty `?tolerance=` in
    // the URL is Number('') — which is 0, not NaN — and a silent zero
    // collapses the search back to the exact weight, the precise narrowness
    // this parameter exists to undo. It also clamps a stranger from the query
    // string to a width the finder actually offers.
    const toleranceGr = resolveTolerance(q.tolerance);

    // ⚠️ NO User ROW IS AN EMPTY SHELF, NOT A 404 — getBench() carries the
    // reasoning. Every read on this module comes through here, so a member
    // whose row has not synced would otherwise get an error on the results,
    // the chips and the spec card at once.
    const mine = await this.bench.getBench(clerkSub);
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
}

function split(v: string | undefined): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * The finder's three narrowing controls, off one query string.
 *
 * 🚨 BUILT ONCE AND HANDED TO ALL THREE SURFACES. The results, the powder
 * chips' counts and the spec card's bench count are three answers about ONE
 * screen, and a surface reading a control the others do not prints a figure
 * the list beside it contradicts — which is exactly what happened while
 * powders() and cartridge() received no filter at all.
 */
function filterFrom(q: Record<string, string>): {
  cartridgeKey?: string;
  powderId?: string;
  weightMin?: number;
  weightMax?: number;
} {
  return {
    cartridgeKey: q.cartridge || undefined,
    powderId: q.powderId || undefined,
    ...weightBand(q.weight),
  };
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
export const WEIGHT_BANDS: Record<string, { weightMin?: number; weightMax?: number }> = {
  lte100: { weightMax: 100 },
  '100to150': { weightMin: 100, weightMax: 150 },
  gte150: { weightMin: 150 },
};

export function weightBand(band: string | undefined): { weightMin?: number; weightMax?: number } {
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
