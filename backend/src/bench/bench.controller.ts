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
import { AuthGuard } from '../auth/auth.guard';
import { ContentAccessGuard } from '../auth/content-access.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
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
 * A query value as Nest hands it over.
 *
 * ⚠️ IT IS NOT ALWAYS A STRING. The guest shelf arrives as repeated array
 * parameters (`?powders[]=…&powders[]=…`) and Express's default query parser
 * keeps the brackets in the key, so the shape and the spelling both differ from
 * the scalar filter parameters beside them. See guestArray().
 */
type BenchQuery = Record<string, string | string[] | undefined>;

/**
 * THE BENCH — /api/bench.
 *
 * 🚨 WRITES ARE MEMBER-ONLY; THE FINDER'S READS ARE BEHIND THE 18+ GATE.
 * `GET/PUT /bench/me` and the whole log are a member's own data and take
 * AuthGuard. The finder — loads, powders, bullets, cartridges, the spec card
 * and a read of a shared link — takes `OptionalAuthGuard, ContentAccessGuard`,
 * so a signed-out visitor who has accepted the gate can try the Bench read-only
 * (the guest bench SPEC-BUILD §10 deferred), and a caller with neither a
 * session nor a valid `ao_cat` declaration gets a 404 exactly as it would from
 * any other content controller.
 *
 * ⚠️ THE READS WERE ON OptionalAuthGuard ALONE ONCE, AND THAT WAS A LEAK. The
 * whole consolidated catalogue — every cartridge, every powder, every bullet
 * weight, and 28 000 charge ranges derived from reloading manuals — was
 * readable by anybody who could type a URL. `ContentAccessGuard` is what makes
 * this a deliberate gated read path rather than an accident: reloading data
 * sits on the content side of the 18+ gate, and the declaration is the door.
 *
 * ⚠️ THE GUEST BENCH IS A FILTER THE CALLER SUPPLIES, NOT A SESSION. It is
 * never stored, it cannot name another member, and it reaches the service only
 * through benchFor(). See that method for the parameters and the empty case.
 *
 * ⚠️ NEVER CACHE A RESPONSE THAT VARIES BY VIEWER. Every route below is
 * viewer-dependent — /bench/loads is literally "what YOU can build" — so every
 * one of them carries `@NoStore()`, and that is not belt-and-braces: the
 * browser's own HTTP cache keys on the URL and not on the Authorization
 * header, so two members on one machine share `/api/bench/loads` exactly.
 */
@Controller('bench')
export class BenchController {
  constructor(private readonly bench: BenchService) {}

  /* ── the caller's own bench ─────────────────────────────────────────── */

  @Get('me')
  @NoStore()
  @UseGuards(AuthGuard)
  me(@CurrentUser() userId: string) {
    return this.bench.getBench(userId);
  }

  @Put('me')
  @NoStore()
  @UseGuards(AuthGuard)
  putMe(@CurrentUser() userId: string, @Body() body: PutBenchDto) {
    return this.bench.putBench(userId, body);
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
   *
   * ⚠️ AND IT ANSWERS FOR EITHER SHELF: the member's stored bench when there is
   * a session, the guest's query shelf when there is not. benchFor() is the one
   * door that decides, so the results and the two counts beside them can never
   * be drawn from two different shelves.
   */
  @Get('loads')
  @NoStore()
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  async loads(@CurrentUser() userId: string | undefined, @Query() q: BenchQuery) {
    const bench = await this.benchFor(userId, q);
    return this.bench.loads(bench, filterFrom(q));
  }

  /**
   * ⚠️ THE FILTER GOES IN TOO, AND IT IS THE SAME ONE THE RESULTS USED. Each
   * row's `loadsForBench` is a promise about what tapping that powder shows,
   * and the member is looking at a screen already narrowed by a cartridge tab
   * and a weight band. Counted without them the chip reads twelve over a list
   * of one.
   *
   * ⚠️ A GUEST GETS COUNTS TOO, against the shelf in their query. The service
   * only counts when a shelf holds bullets AND cartridges, so a visitor who has
   * added only powders gets the plain list — exactly what a member with an
   * empty bench gets.
   */
  @Get('powders')
  @NoStore()
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  async powders(@CurrentUser() userId: string | undefined, @Query() q: BenchQuery) {
    return this.bench.powders(first(q.q) || undefined, await this.benchFor(userId, q), filterFrom(q));
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
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
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
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  cartridges() {
    return this.bench.cartridgeList();
  }

  @Get('cartridges/:key')
  @NoStore()
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  async cartridge(
    @Param('key') key: string,
    @CurrentUser() userId: string | undefined,
    @Query() q: BenchQuery,
  ) {
    return this.bench.cartridge(key, await this.benchFor(userId, q), filterFrom(q));
  }

  /* ── the log ────────────────────────────────────────────────────────── */

  /**
   * 🚨 THE LOG IS A MEMBER'S OWN RECORD AND TAKES AuthGuard, ALWAYS. It is the
   * one surface on this module that is not derived from the catalogue: it is
   * what THEY loaded, what THEY measured, and when THEY fired it. There is no
   * guest version of it — a signed-out visitor gets a sign-in prompt on the
   * page, and the guard here is what makes that prompt the whole story.
   */

  @Get('log')
  @NoStore()
  @UseGuards(AuthGuard)
  log(@CurrentUser() userId: string) {
    return this.bench.log(userId);
  }

  /**
   * ⚠️ DECLARED BEFORE 'log/:id' SO THE PARAM ROUTE CANNOT SWALLOW IT. Nest
   * matches in declaration order; registered after, "log.csv" would still be
   * reached, but the ordering is the thing that keeps it true.
   */
  @Get('log.csv')
  @NoStore()
  @UseGuards(AuthGuard)
  async logCsv(@CurrentUser() userId: string, @Res() res: Response) {
    const { csv, filename } = await this.bench.logCsv(userId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Post('log')
  @NoStore()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  addLog(@CurrentUser() userId: string, @Body() body: AddLogDto) {
    return this.bench.addLog(userId, body);
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
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  patchLog(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: PatchLogDto,
  ) {
    return this.bench.patchLog(userId, id, body);
  }

  @Delete('log/:id')
  @NoStore()
  @UseGuards(AuthGuard)
  deleteLog(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.bench.deleteLog(userId, id);
  }

  /* ── the permalink ──────────────────────────────────────────────────── */

  /**
   * ⚠️ CREATING A SHARE WRITES A ROW AND IS MEMBER-ONLY; READING ONE IS
   * CONTENT. The write records whose finder state it was, so it takes
   * AuthGuard. The read returns a stored filter object — the same catalogue
   * names any declared visitor can already see — so a signed-out visitor may
   * open a link somebody sent them, behind the same 18+ gate as the finder.
   * The link is not a capability: it publishes no shelf of anybody's that the
   * reader cannot already assemble from the public pickers.
   */
  @Post('share')
  @NoStore()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  share(@CurrentUser() userId: string, @Body() body: ShareBenchDto) {
    return this.bench.share(userId, body.payload);
  }

  @Get('share/:token')
  @NoStore()
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  readShare(@Param('token') token: string) {
    return this.bench.readShare(token);
  }

  /**
   * The shelf this request answers for: the caller's stored bench when there is
   * a session, else the shelf handed in the query string.
   *
   * 🚨 EVERY FIELD OF A BULLET COMES THROUGH HERE OR IT DOES NOT EXIST. This is
   * the ONLY path from either shelf into loads(), powders() and cartridge(),
   * and it rebuilds each bullet field by field — so a field left out here is
   * silently absent everywhere downstream, with nothing failing. That is
   * exactly how the calibre axis shipped inert: loads() was taught to pin a
   * bullet to its calibre, the picker was taught to show it and store it, and
   * this map dropped it on the way back in, so every signed-in member's .308"
   * 150 gr SP went on matching 8x57 loads it will not chamber in. The service's
   * own spec could not catch it — it calls loads() directly and never comes
   * through the controller.
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
   * results, the powder chips' counts and the spec card's count all answer for
   * the SAME shelf. `off` is what the caller has greyed out for this search —
   * it never touches a saved bench — and a surface that skipped it would print
   * a figure for a shelf they can see they are not using.
   *
   * ⚠️ THE GUEST SHELF IS THE QUERY ARRAYS FROM SPEC-BUILD §4 AND NOTHING ELSE:
   * `powders[]`, `bullets[]` (`calibre|weight`) and `cartridges[]`. It is
   * caller-supplied, so it decides what they are SHOWN and nothing else: no
   * write path can reach it, and no User row is read for it — the guest branch
   * below never calls getBench(), so a signed-out request costs no personal
   * read at all.
   *
   * ⚠️ AN EMPTY GUEST SHELF IS A VALID, EMPTY ANSWER AND NOT A 500. The service
   * treats an empty axis as a real constraint that matches nothing, so the
   * finder draws its own "add a powder / bullet / cartridge" state: loads()
   * answers `{ count: 0, groups: [] }`, powders() is the plain catalogue list
   * with no bench counts, and cartridge() reports a zero bench count.
   */
  private async benchFor(userId: string | undefined, q: BenchQuery): Promise<GuestBench> {
    const off = new Set(split(q.off));
    // ⚠️ THROUGH resolveTolerance(), NEVER Number(). An empty `?tolerance=` in
    // the URL is Number('') — which is 0, not NaN — and a silent zero
    // collapses the search back to the exact weight, the precise narrowness
    // this parameter exists to undo. It also clamps a stranger from the query
    // string to a width the finder actually offers.
    const toleranceGr = resolveTolerance(first(q.tolerance));

    if (userId) {
      // ⚠️ NO User ROW IS AN EMPTY SHELF, NOT A 404 — getBench() carries the
      // reasoning. Every member read on this module comes through here, so a
      // member whose row has not synced would otherwise get an error on the
      // results, the chips and the spec card at once.
      const mine = await this.bench.getBench(userId);
      return {
        toleranceGr,
        powderIds: mine.powders.filter((p) => !off.has(p.id)).map((p) => p.id),
        // ⚠️ KEYED OFF THE STORED BULLET, NOT THE SANITISED ONE. The client
        // builds these keys from what GET /bench/me handed it, which is the raw
        // Json column — so an unreadable calibre keys as the client wrote it
        // here and as storedCalibre() reads it below, and the chip the member
        // switched off is the bullet that leaves.
        bullets: mine.bullets
          .filter((b) => !off.has(benchBulletKey(b)))
          .map((b) => ({
            weightGr: b.weightGr,
            calibreIn: storedCalibre(b.calibreIn),
          })),
        cartridgeKeys: mine.cartridges.filter((c) => !off.has(c.key)).map((c) => c.key),
      };
    }

    // ⚠️ A GUEST'S `off` IS APPLIED TO THE QUERY SHELF HERE, BEFORE THE SERVICE
    // EVER SEES IT. The frontend draws the same chips for a guest, and a chip
    // switched off must leave the search for a guest exactly as it does for a
    // member — but the shelf is unsaved either way, so this is the whole of
    // what a toggle means.
    return {
      toleranceGr,
      powderIds: guestArray(q, 'powders').filter((id) => !off.has(id)),
      bullets: guestArray(q, 'bullets')
        .filter((key) => !off.has(key))
        .map(parseGuestBullet)
        .filter((b): b is { weightGr: number; calibreIn: number | null } => b !== null),
      cartridgeKeys: guestArray(q, 'cartridges').filter((key) => !off.has(key)),
    };
  }
}

/** The first value of a query parameter. Repeated parameters arrive as arrays. */
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * A comma-separated query value as a list.
 *
 * ⚠️ BOTH SPELLINGS ARE READ, DELIBERATELY. `off` is a single comma-joined
 * string today, and arrays are what the guest shelf parameters are; a repeated
 * scalar must not silently become a comma-joined string with a comma in it.
 */
function split(v: string | string[] | undefined): string[] {
  const list = v === undefined ? [] : Array.isArray(v) ? v : [v];
  return list
    .flatMap((part) => part.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * One of a guest's shelf arrays.
 *
 * 🚨 THE SPEC'S SPELLING IS `powders[]` — see SPEC-BUILD §4 — and the plain
 * name is read as well so an older hand-written link (`?powders=a,b`, the shape
 * the removed parser used) still answers. Both forms are lists of ids/keys; the
 * `[]` form is what the client sends because a powder id or a bullet key can
 * never be confused for another axis once the name says which it is.
 */
function guestArray(
  q: BenchQuery,
  name: 'powders' | 'bullets' | 'cartridges',
): string[] {
  return split(q[`${name}[]`] ?? q[name]);
}

/**
 * One entry of a guest's `?bullets[]=` list, as a shelf bullet.
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
 * The finder's narrowing controls, off one query string.
 *
 * 🚨 BUILT ONCE AND HANDED TO ALL THREE SURFACES. The results, the powder
 * chips' counts and the spec card's bench count are three answers about ONE
 * screen, and a surface reading a control the others do not prints a figure
 * the list beside it contradicts — which is exactly what happened while
 * powders() and cartridge() received no filter at all.
 *
 * ⚠️ THE CLIENT'S NAMES WIN, AND THE SPEC'S NAMES ARE READ AS A FALLBACK.
 * lib/bench/api.ts sends `?cartridge=` and `?weight=`; SPEC-BUILD §4 documents
 * `cartridgeKey`, `weightMin` and `weightMax`. Both are accepted so a
 * hand-written request is not silently wider than it says — and an explicit
 * bound always beats a band, because it is the more specific statement.
 */
function filterFrom(q: BenchQuery): {
  cartridgeKey?: string;
  powderId?: string;
  weightMin?: number;
  weightMax?: number;
} {
  const weightMin = numberOrUndefined(first(q.weightMin));
  const weightMax = numberOrUndefined(first(q.weightMax));
  return {
    cartridgeKey: first(q.cartridge) || first(q.cartridgeKey) || undefined,
    powderId: first(q.powderId) || undefined,
    ...weightBand(first(q.weight)),
    ...(weightMin !== undefined ? { weightMin } : {}),
    ...(weightMax !== undefined ? { weightMax } : {}),
  };
}

/** A finite number, or absent. Blank is absent, not Number('') === 0. */
function numberOrUndefined(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
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
