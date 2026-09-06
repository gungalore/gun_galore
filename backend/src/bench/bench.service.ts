import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv } from '../common/csv.util';
import { calibreFromG1 } from './bullet-calibre';
import { resolveTolerance, weightWindow, type WeightToleranceGr } from './bullet-weight';
import { parseShotAt, type AddLogDto, type PatchLogDto, type PutBenchDto } from './bench.dto';
import {
  benchBulletKey,
  coalFlags,
  logFlags,
  THUMB_DIM_FIELDS,
  type BenchView,
  type LoadsResponse,
  type LoadsWhy,
  type PublicLoadGroup,
  type PublicLoadRow,
  type PublicLogEntry,
} from './bench.types';

/** What a guest sends instead of a stored bench. */
export interface GuestBench {
  powderIds?: string[];
  bullets?: {
    weightGr: number;
    /**
     * Inches, from the cartridge's C.I.P. G1 — see bullet-calibre.ts.
     *
     * ⚠️ OPTIONAL, AND IT HAS TO STAY OPTIONAL. Benches saved before calibres
     * were recorded hold none, and a bullet without one matches any calibre —
     * exactly the behaviour it had. See loads() for why.
     */
    calibreIn?: number | null;
    /**
     * ⚠️ CARRIED, NEVER MATCHED ON. A bench saved under the old model still
     * names a maker and a category; keeping the fields means an old shelf
     * still parses, and matching on them again would undo the change. See
     * bulletAxis().
     */
    maker?: string;
    category?: string;
  }[];
  cartridgeKeys?: string[];
  /**
   * Grains either side of a shelf bullet's weight that still count as that
   * bullet — see bullet-weight.ts.
   *
   * 🚨 IT WIDENS THE SEARCH, NEVER A CHARGE. Every load returned is still
   * quoted at ITS OWN bullet weight with its own start and max, and nothing
   * here says a charge for a 145 gr bullet may be used with a 155 gr one. The
   * window decides what a member is SHOWN; it never decides what is safe to
   * load.
   *
   * ⚠️ IT RIDES ON THE BENCH BECAUSE EVERY SURFACE THAT READS A BENCH NEEDS
   * IT. The results list, the powder chips' counts and the spec card's count
   * all AND on the same shelf, and this module's history is a property that
   * reached one of the three and not the other two — the calibre did exactly
   * that. Coming through BenchController.benchFor with the rest of the shelf,
   * it cannot reach one surface and miss another.
   *
   * Absent means the default; anything unreadable or absurd is clamped by
   * resolveTolerance() rather than trusted.
   */
  toleranceGr?: number;
}

/**
 * One row of the bullet picker.
 *
 * ⚠️ `loads` IS A COUNT OF CONSOLIDATED LOADS AND NOTHING ELSE. It says "this
 * bullet appears in n loads you could look at", which is a fact about our own
 * consolidated set. A count of the manuals behind those loads would be a fact
 * about the manuals, and that is the line bench.leak.spec.ts guards.
 */
export interface BenchBulletOptionView {
  /**
   * 🚨 A WEIGHT IS NOT A BULLET, AND A BULLET IS NOT A BRAND. "150 gr" names
   * four projectiles — .277 for .270 Win, .308 for .308 Win, .311 for .303
   * British, .323 for 8x57 — which are not interchangeable, so the calibre is
   * half the identity. The MAKER is not part of it at all: a 150 gr .308 from
   * Hornady, Sierra or Barnes gives near enough the same pressures and speeds,
   * which is the whole point of the Bench.
   *
   * Inches. Null only where the cartridge has no C.I.P. sheet to take a
   * diameter from; those rows are still offered, because the bullet is still
   * loadable.
   */
  calibreIn: number | null;
  weightGr: number;
  loads: number;
}

/** One row of the cartridge picker. `loads` reads exactly as above. */
export interface BenchCartridgeOptionView {
  key: string;
  name: string;
  loads: number;
}

/**
 * One branch of the bullet OR — a shelf bullet as a WEIGHT WINDOW in a
 * calibre.
 *
 * 🚨 NO MAKER AND NO CATEGORY. A load is offered for a shelf bullet when its
 * bullet weighs what that bullet weighs, give or take the tolerance, and is of
 * the same diameter. Whose name is on the box narrows nothing.
 *
 * ⚠️ THE WINDOW IS A SEARCH WIDTH, NOT A SAFETY MARGIN. Each matched row keeps
 * its own weight, start and max — the member picks the load whose bullet they
 * actually have.
 *
 * Named rather than inlined so the shape is stated once and the three callers
 * cannot drift apart: `cartridgeKey` is ABSENT for a bullet with no calibre
 * (matches any) and an explicit `in` list for one that has it, which may be
 * empty (matches nothing). Both are meaningful; neither is a default.
 */
interface BulletClause {
  weightGr: { gte: number; lte: number };
  cartridgeKey?: { in: string[] };
}

/**
 * What the finder narrows the bench WITH — the cartridge tab, the weight band
 * and the powder chip.
 *
 * ⚠️ A FILTER IS NOT AN AXIS, AND THE DIFFERENCE IS WHAT KEEPS THE EMPTY-STATE
 * DIAGNOSIS HONEST. An axis is what the member OWNS; a filter is what they are
 * currently looking at. whyEmpty() relaxes an axis and NEVER a filter, because
 * "70 loads are available" about a weight band or a cartridge tab the member
 * cannot see from here is a number they can neither reach nor explain.
 */
interface LoadsFilter {
  cartridgeKey?: string;
  weightMin?: number;
  weightMax?: number;
  powderId?: string;
}

/**
 * The three axes a loads query ANDs on.
 *
 * ⚠️ `null` MEANS "RELAXED", NOT "EMPTY". An empty array is a real constraint
 * that matches nothing — that is what an out-of-calibre bullet resolves to —
 * whereas null drops the clause from the `where` altogether. The two are one
 * character apart and mean opposite things, which is why they are named here
 * rather than passed as bare arrays.
 */
interface LoadsAxes {
  cartridgeKeys: string[] | null;
  powderIds: string[] | null;
  bulletOr: BulletClause[] | null;
}

/**
 * Calibre tie-break for the picker's ordering.
 *
 * ⚠️ NOT `(a ?? Infinity) - (b ?? Infinity)`. Two nulls give Infinity minus
 * Infinity, which is NaN, and a comparator returning NaN leaves the pair in
 * whatever order the sort happened to see them — the exact instability the
 * tie-breaks exist to remove. Cartridges with no sheet sort last, together.
 */
/**
 * The most rows one search returns.
 *
 * ⚠️ A CAP HERE IS ONLY LEGITIMATE BECAUSE THE ANSWER SAYS IT WAS CAPPED
 * (`LoadsResponse.truncated`). Everything else on this module is uncapped on
 * purpose — the pickers filter in the browser, so a silent cut makes a real
 * powder unfindable — but the results list is different in two ways: it is not
 * filtered client-side (every control re-queries), and an unbounded findMany
 * with a nested cartridge per row is one shelf away from dragging the whole
 * consolidated table across the wire. A bench holding six cartridges and a
 * loose weight window can reach five figures.
 *
 * 600 is well past what anybody reads and well short of what hurts.
 */
const LOADS_MAX = 600;

/** Shell-holder chips past this go behind a count — see cartridge(). */
const SHELL_HOLDER_MAX = 12;

/** The biggest share payload we will store, in bytes of JSON. */
const SHARE_MAX_BYTES = 8 * 1024;

/** How long a permalink lives. Spec §4. */
const SHARE_TTL_DAYS = 90;

/**
 * How long the catalogue-wide aggregates are held.
 *
 * ⚠️ ONLY WHAT IS THE SAME FOR EVERY VIEWER. The bullet picker's group-by, the
 * cartridge list and the unsearched powder list are facts about the imported
 * catalogue, which changes when the operator runs the import and at no other
 * time. Nothing bench-relative may be cached here — a count is "what YOU can
 * build", and one member's answer served to the next is a stranger's shelf
 * (CLAUDE.md's viewer-varying rule). Five minutes is short enough that a fresh
 * import shows up while the operator is still watching it.
 */
const CATALOGUE_TTL_MS = 5 * 60_000;

/**
 * The words that may not travel, in any value on any public response.
 *
 * 🚨 THE SAME LIST bench.leak.spec.ts ASSERTS, AND FOR THE SAME REASON: which
 * book a figure was read out of is the book's, not ours. Kept beside the one
 * function that reads free text off a sheet, because that is the only place a
 * value can carry a sentence somebody else wrote.
 */
const FORBIDDEN_WORDS = ['source', 'manual', 'page', 'cip', 'saami', 'published'];

/**
 * The tolerances and footnotes maps, with any entry that names where it came
 * from dropped.
 *
 * ⚠️ ENTRY BY ENTRY, NOT ALL OR NOTHING. These are per-dimension annotations
 * the spec card shows beside each figure; one footnote reading "see the
 * published table" must not take the other thirteen tolerances with it.
 */
function sanitiseAnnotations(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    const text = String(v);
    const haystack = `${k} ${text}`.toLowerCase();
    if (FORBIDDEN_WORDS.some((w) => haystack.includes(w))) continue;
    out[k] = text;
  }
  // An empty map and an absent one mean the same thing to the card, and null
  // is the shape it already handles for a cartridge with no sheet.
  return Object.keys(out).length ? out : null;
}

/**
 * A stored instant as the calendar date it was in South Africa.
 *
 * ⚠️ `toISOString().slice(0, 10)` IS UTC, AND EVERY MEMBER OF THIS SITE IS TWO
 * HOURS AHEAD OF IT. A load fired at half past one on a Sunday morning filed
 * itself under the Saturday in the CSV they downloaded to keep — and the list
 * on screen, which formats in the browser's own zone, said Sunday. One record,
 * two dates, and the one they can print is the wrong one.
 *
 * en-CA is not relied on for the ORDER: the parts are read out by name, so a
 * runtime with a different locale data set cannot silently produce DD-MM-YYYY.
 */
const JHB = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function jhbDate(d: Date): string {
  const parts = new Map(JHB.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}

/**
 * ⚠️ A CALL, NOT A CONSTANT. Read at module scope the value is frozen at
 * import time, before dotenv has necessarily finished — the same trap
 * auctions.service.ts and offers.service.ts both note at their own APP_URL.
 */
const appUrl = () => process.env.FRONTEND_URL ?? 'https://alloutdoor.co.za';

/** An empty string a member left blank is not a value; it is a blank. */
function trimmedOrNull(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

/** Built fresh each time: the caller may keep it, and an empty bench is theirs. */
function EMPTY_BENCH(): BenchView {
  return { powders: [], bullets: [], cartridges: [], units: 'metric' };
}

function compareCalibre(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * One chip per bullet, where a bullet is now a weight in a calibre.
 *
 * ⚠️ TWO IDENTICAL CHIPS ARE WORSE THAN A LOST ROW. A bench holding "Hornady
 * 150 SP .308" and "Sierra 150 HP .308" was two bullets under the old model
 * and is ONE under this one, so both chips now read `.308" 150 gr` — the
 * member cannot tell them apart, cannot tell which × removes which, and
 * switching one off leaves the other matching exactly the same loads.
 *
 * The first is kept and the rest dropped, so the surviving chip is the one at
 * the position the member is used to seeing it, and its legacy maker/category
 * decoration is the one they added first.
 *
 * ⚠️ ON THE WAY OUT, NOT ON THE WAY IN. putBench() stores what the client
 * sends; folding here means a shelf saved before this shipped reads correctly
 * without a migration, and the next save writes the folded list back.
 */
function dedupeBullets(bullets: BenchView['bullets']): BenchView['bullets'] {
  const seen = new Set<string>();
  return bullets.filter((b) => {
    const key = benchBulletKey(b);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

@Injectable()
export class BenchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The catalogue-wide answers, held for CATALOGUE_TTL_MS.
   *
   * 🚨 NOTHING VIEWER-SPECIFIC MAY EVER BE PUT IN HERE. Every other figure on
   * this module is "what YOU can build" — one member's answer handed to the
   * next is a stranger's shelf, which is the exact failure CLAUDE.md's
   * viewer-varying rule is about. What IS in here is the imported catalogue:
   * the distinct calibre+weight pairs, the cartridges that have loads, the
   * powder list. Those change when the operator runs the import and never
   * between two members.
   *
   * ⚠️ AN INSTANCE FIELD, NOT A MODULE-LEVEL Map. Nest holds one BenchService,
   * so the cache is process-wide in production — but a test that builds a
   * second service must get a cold one, or a fixture written for one test
   * answers another.
   *
   * The PROMISE is stored rather than its value, so a hundred requests
   * arriving during one cold group-by share the single query. A rejection is
   * evicted immediately: a cached failure would outlive the outage that caused
   * it.
   */
  private readonly catalogue = new Map<string, { at: number; value: Promise<unknown> }>();

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.catalogue.get(key);
    if (hit && Date.now() - hit.at < CATALOGUE_TTL_MS) return hit.value as Promise<T>;

    const value = load().catch((err: unknown) => {
      this.catalogue.delete(key);
      throw err;
    });
    this.catalogue.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * Clerk subject → User.id.
   *
   * ⚠️ THESE ARE NOT THE SAME STRING AND TYPESCRIPT CANNOT TELL THEM APART.
   * `@CurrentUser()` hands back the Clerk `sub`; `UserBench.userId` is a cuid
   * from our own User table. Both are `string`, so swapping them compiles
   * cleanly and then silently reads or writes the wrong person's bench — or,
   * more often, nobody's, which looks like "my shelf keeps emptying".
   * Every entry point into this service resolves the sub through here first.
   */
  private async findUserId(clerkSub: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: clerkSub },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async resolveUserId(clerkSub: string): Promise<string> {
    const userId = await this.findUserId(clerkSub);
    if (!userId) throw new NotFoundException('No member for this session');
    return userId;
  }

  /* ── The bench itself ──────────────────────────────────────────────── */

  async getBench(clerkSub: string): Promise<BenchView> {
    // ⚠️ NO User ROW IS AN EMPTY SHELF, NOT A 404, AND ONLY ON THE READ.
    // ClerkGuard lazily provisions the row, but it refuses to create one for a
    // Clerk user with no email — so a signed-in caller can genuinely arrive
    // here with nothing. Every read on this module goes through here
    // (BenchController.benchFor is the one door), and a 404 on the results,
    // the powder chips AND the spec card is a page that looks broken to
    // somebody whose only problem is that they have not saved a shelf yet.
    // The WRITES still resolve strictly: without a User row the bench has
    // nowhere to be stored, and the foreign key would refuse it anyway.
    const userId = await this.findUserId(clerkSub);
    if (!userId) return EMPTY_BENCH();

    const row = await this.prisma.userBench.findUnique({ where: { userId } });

    // A member who has never opened the page gets an empty bench rather than
    // a 404: "you have nothing on your shelf yet" is a state, not an error.
    if (!row) return EMPTY_BENCH();

    const [powders, cartridges] = await Promise.all([
      this.prisma.benchPowder.findMany({
        where: { id: { in: row.powderIds } },
        select: { id: true, name: true, maker: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.benchCartridge.findMany({
        where: { key: { in: row.cartridgeKeys } },
        select: { key: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    // ⚠️ REBUILT FIELD BY FIELD, NOT HANDED STRAIGHT BACK. The `select` above
    // is the only thing keeping a Prisma row narrow, and a select widened to an
    // include — or one more column added "just for the rail" — would ride
    // through a pass-through unnoticed. BenchCartridge is the model that owns
    // the `sources` relation, so this is the exact shape cartridgeList() is
    // careful about, and the two paths now fail the same way.
    return {
      powders: powders.map((p) => ({ id: p.id, name: p.name, maker: p.maker })),
      // Prisma types this column as JsonValue; the shape is ours to promise,
      // so the cast goes through unknown rather than pretending the two
      // types overlap. Array.isArray is the actual guard.
      bullets: dedupeBullets(
        Array.isArray(row.bullets) ? (row.bullets as unknown as BenchView['bullets']) : [],
      ),
      cartridges: cartridges.map((c) => ({ key: c.key, name: c.name })),
      units: row.units,
    };
  }

  /**
   * ⚠️ THE BODY IS A CLASS NOW, WHICH IS THE ONLY REASON IT IS VALIDATED. It
   * was typed `Record<string, never>` — not a class, so the global
   * ValidationPipe skipped the route entirely and a non-array `bullets` was a
   * 500 while 100 000 powder ids were simply stored. See bench.dto.ts.
   */
  async putBench(clerkSub: string, body: PutBenchDto): Promise<BenchView> {
    const userId = await this.resolveUserId(clerkSub);
    const data = {
      powderIds: body.powderIds ?? [],
      bullets: (body.bullets ?? []) as object,
      cartridgeKeys: body.cartridgeKeys ?? [],
      units: body.units === 'imperial' ? 'imperial' : 'metric',
    };
    await this.prisma.userBench.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.getBench(clerkSub);
  }

  /* ── The answer the page exists for ────────────────────────────────── */

  /**
   * Consolidated loads buildable from a bench.
   *
   * The shelf is an AND across three axes: a load shows only if the reloader
   * has the powder AND a bullet of that WEIGHT in that CALIBRE AND the
   * cartridge. Anything looser would answer a different question — "loads that
   * exist" rather than "loads I can make tonight" — which is the whole point
   * of the screen.
   *
   * 🚨 AND ANYTHING TIGHTER ANSWERED NOTHING AT ALL. The bullet axis used to
   * carry the maker and the bullet type as well, which is how the SOURCE data
   * is shaped rather than how a reloader thinks: .30-06 with N550 and a
   * Hornady 150 gr SP returned 0 loads, because the 150 gr .30-06 loads on
   * N550 are a Barnes, a Sierra, a Lapua, a Norma and a Hornady TIP. Any maker
   * at exactly 150 gr finds 9; any maker at 150 ± 5 finds 17. Operator,
   * 2026-09-03: "this is the whole point of the Bench."
   */
  async loads(bench: GuestBench, filter: LoadsFilter): Promise<LoadsResponse> {
    const powderIds = bench.powderIds ?? [];
    const cartridgeKeys = bench.cartridgeKeys ?? [];
    const bullets = bench.bullets ?? [];
    // Clamped here as well as at the controller: a direct caller cannot ask
    // for a window wider than the finder offers, and a blank one from the
    // query string means the default rather than a silent zero.
    const tolerance = resolveTolerance(bench.toleranceGr);

    // An empty shelf is an empty answer, not the whole database. Returning
    // everything would bury the one thing the page is for.
    //
    // ⚠️ AND NO `why` HERE, DELIBERATELY. With an axis bare the diagnosis is
    // already in hand — the client names the empty axis and offers its Add
    // button — so three more counts would be spent to learn what the caller
    // knew before it asked. `why` answers a different question: "all three are
    // stocked and STILL nothing".
    if (powderIds.length === 0 || cartridgeKeys.length === 0 || bullets.length === 0) {
      return { count: 0, groups: [] };
    }

    // The calibre axis, built once for every surface — see bulletAxis(). The
    // candidate keys are the ones THIS query could return, so a filtered view
    // resolves calibres against the one cartridge it is showing rather than
    // the whole shelf.
    const candidateKeys = filter.cartridgeKey ? [filter.cartridgeKey] : cartridgeKeys;
    const bulletOr = await this.bulletAxis(bullets, tolerance, candidateKeys);

    // ⚠️ ONE MORE THAN THE CAP, DELIBERATELY. Asking for exactly LOADS_MAX
    // cannot tell "there were exactly 600" from "there were thousands", and
    // the answer has to say which — see LoadsResponse.truncated.
    const found = await this.prisma.benchLoad.findMany({
      take: LOADS_MAX + 1,
      where: this.benchLoadWhere({ cartridgeKeys, powderIds, bulletOr }, filter),
      // ⚠️ AN EXPLICIT SELECT, NOT AN INCLUDE. sourcesCount and the
      // BenchSourceLoad relation must never reach a response, and the surest
      // way to keep that true as this query grows is to never fetch them.
      select: {
        id: true,
        cartridgeKey: true,
        bulletMaker: true,
        bulletType: true,
        weightGr: true,
        startGr: true,
        startFps: true,
        maxGr: true,
        maxFps: true,
        coalMm: true,
        coalLoMm: true,
        coalHiMm: true,
        powder: { select: { name: true } },
        cartridge: {
          select: {
            key: true,
            name: true,
            maxLengthMm: true,
            pmaxBar: true,
            pmaxPsi: true,
            dims: { select: Object.fromEntries(THUMB_DIM_FIELDS.map((f) => [f, true])) as never },
          },
        },
      },
      // ⚠️ AND THE DATABASE ORDER IS TOTAL TOO, BECAUSE `take` MAKES IT
      // LOAD-BEARING. Ordered by weight alone, which 600 of several thousand
      // rows come back is decided by whatever order Postgres happened to
      // produce — so the same search would cut a different set each time.
      orderBy: [{ weightGr: 'asc' }, { cartridgeKey: 'asc' }, { id: 'asc' }],
    });

    const truncated = found.length > LOADS_MAX;
    const rows = truncated ? found.slice(0, LOADS_MAX) : found;

    // Bench order for cartridges, then weight ascending, then powder name.
    const order = new Map(cartridgeKeys.map((k, i) => [k, i]));
    const byCartridge = new Map<string, PublicLoadGroup>();

    for (const r of rows) {
      const head = byCartridge.get(r.cartridgeKey) ?? {
        cartridge: {
          key: r.cartridge.key,
          name: r.cartridge.name,
          maxLengthMm: r.cartridge.maxLengthMm,
          pmaxBar: r.cartridge.pmaxBar,
          pmaxPsi: r.cartridge.pmaxPsi,
          thumb: (r.cartridge.dims as Record<string, number | null> | null) ?? null,
        },
        weights: [],
      };

      const row: PublicLoadRow = {
        id: r.id,
        bulletMaker: r.bulletMaker,
        bulletType: r.bulletType,
        powder: r.powder.name,
        startGr: r.startGr,
        startFps: r.startFps,
        maxGr: r.maxGr,
        maxFps: r.maxFps,
        coalMm: r.coalMm,
        coalLoMm: r.coalLoMm,
        coalHiMm: r.coalHiMm,
        flags: coalFlags(r, r.cartridge.maxLengthMm),
      };

      const group = head.weights.find((w) => w.weightGr === r.weightGr);
      if (group) group.rows.push(row);
      else head.weights.push({ weightGr: r.weightGr, rows: [row] });

      byCartridge.set(r.cartridgeKey, head);
    }

    const groups = [...byCartridge.values()].sort(
      (a, b) => (order.get(a.cartridge.key) ?? 999) - (order.get(b.cartridge.key) ?? 999),
    );
    for (const g of groups) {
      g.weights.sort((a, b) => a.weightGr - b.weightGr);
      // ⚠️ THE TIE-BREAKS RUN TO THE ID, WHICH IS NOT TIDINESS. One powder at
      // one weight in one cartridge is several rows — a Hornady, a Sierra, a
      // Barnes — so the powder name alone leaves them in whatever order the
      // query happened to produce, and they visibly swap places between one
      // search and the next in a list the member is scanning by eye. The id is
      // the last resort that makes the order total.
      for (const w of g.weights) {
        w.rows.sort(
          (a, b) =>
            a.powder.localeCompare(b.powder) ||
            a.bulletMaker.localeCompare(b.bulletMaker) ||
            a.id.localeCompare(b.id),
        );
      }
    }

    // Only when there is nothing to show. A full screen explains itself, and
    // three extra counts on every search would be paid by every member who is
    // simply reading their loads.
    const why =
      rows.length === 0
        ? await this.whyEmpty({ cartridgeKeys, powderIds, bullets, tolerance }, filter, bulletOr)
        : null;

    // Spread rather than `why: why ?? undefined`: a key that is present and
    // undefined survives into `Object.keys` and into every `'why' in result`
    // check the client might make, and "there is a diagnosis" must not be
    // true of a search that found loads.
    // `truncated` is spread the same way and for the same reason: a key
    // present and false still passes `'truncated' in result`.
    return {
      count: rows.length,
      groups,
      ...(why ? { why } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
  }

  /**
   * The `where` every loads query is built from — the listing and the three
   * counts that explain an empty listing.
   *
   * 🚨 ONE BUILDER, FOR THE SAME REASON bulletAxis() IS ONE BUILDER. The
   * diagnosis is a claim ABOUT the result beside it — "drop your bullets and
   * there are 70 loads here" — and a claim built by a second hand-rolled
   * `where` is a claim that can disagree with the thing it explains. A count
   * that quietly forgot the weight band would tell a member 70 loads are
   * waiting behind a filter they cannot see from where they are standing,
   * and every one of them would vanish the moment they cleared the bullets.
   *
   * ⚠️ EVERY NARROWING BELONGS IN HERE, NOT IN THE CALLER. A clause added to
   * loads() alone is a clause the counts do not have, which is precisely the
   * drift this exists to prevent.
   *
   * ⚠️ A FILTER OUTRANKS ITS AXIS, RELAXED OR NOT. Relaxing the cartridge axis
   * on a screen pinned to one cartridge tab still shows that tab: the member
   * is asking "why is THIS view empty", and an answer about a view they are
   * not looking at is not an answer.
   */
  private benchLoadWhere(axes: LoadsAxes, filter: LoadsFilter): Prisma.BenchLoadWhereInput {
    return {
      ...(filter.cartridgeKey
        ? { cartridgeKey: { equals: filter.cartridgeKey } }
        : axes.cartridgeKeys
          ? { cartridgeKey: { in: axes.cartridgeKeys } }
          : {}),
      ...(filter.powderId
        ? { powderId: { equals: filter.powderId } }
        : axes.powderIds
          ? { powderId: { in: axes.powderIds } }
          : {}),
      // `?? {}` is wrong here and `axes.bulletOr ? … : {}` is right: an EMPTY
      // OR array is not a relaxed axis, it is Prisma for "match nothing".
      ...(axes.bulletOr ? { OR: axes.bulletOr } : {}),
      ...(filter.weightMin !== undefined || filter.weightMax !== undefined
        ? {
            weightGr: {
              ...(filter.weightMin !== undefined ? { gte: filter.weightMin } : {}),
              ...(filter.weightMax !== undefined ? { lte: filter.weightMax } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * The same search three more times, each with ONE axis relaxed.
   *
   * ⚠️ THE AXIS IS RELAXED. NOTHING ELSE IS. Same filter object, same builder,
   * so the cartridge tab, the weight band and the powder chip apply to all
   * four queries identically — see benchLoadWhere().
   *
   * 🚨 AND THE WINDOW AND THE CALIBRE BOTH SURVIVE. Two of the three counts
   * keep the bullet axis, and that axis is a weight WINDOW in a CALIBRE.
   * Counted at the exact weight, "ignoringPowders: 2" contradicts a list built
   * over ± 5 the moment the member clears a powder; counted without the
   * calibre, the same figure against a .308" 150 gr would be counting 8x57
   * loads that will not chamber — the false promise the powder chips and the
   * spec card once made. So both go through bulletAxis(), and the count
   * that drops the CARTRIDGE axis rebuilds its clause against every cartridge
   * rather than reusing the shelf-resolved one: relaxing the cartridges is
   * what widens the set of cartridges that bullet may legitimately be found
   * in, and reusing the narrow clause would answer "0, there are none
   * anywhere" about a bullet with thousands.
   *
   * Three counts, one round trip — they are independent, so they go together.
   */
  private async whyEmpty(
    bench: {
      cartridgeKeys: string[];
      powderIds: string[];
      bullets: NonNullable<GuestBench['bullets']>;
      /** The window the listing used. The same one, or the counts contradict it. */
      tolerance: WeightToleranceGr;
    },
    filter: LoadsFilter,
    /** The clause the main query used — resolved against the bench's cartridges. */
    bulletOr: BulletClause[],
  ): Promise<LoadsWhy> {
    // `undefined` here means "every cartridge there is", which is what
    // "ignoring the bench's cartridges" has to mean for a calibred bullet.
    // A cartridge tab still pins it, because a filter is not an axis.
    const bulletOrAnyCartridge = await this.bulletAxis(
      bench.bullets,
      bench.tolerance,
      filter.cartridgeKey ? [filter.cartridgeKey] : undefined,
    );

    const [ignoringBullets, ignoringPowders, ignoringCartridges] = await Promise.all([
      this.prisma.benchLoad.count({
        where: this.benchLoadWhere(
          { cartridgeKeys: bench.cartridgeKeys, powderIds: bench.powderIds, bulletOr: null },
          filter,
        ),
      }),
      this.prisma.benchLoad.count({
        where: this.benchLoadWhere(
          { cartridgeKeys: bench.cartridgeKeys, powderIds: null, bulletOr },
          filter,
        ),
      }),
      this.prisma.benchLoad.count({
        where: this.benchLoadWhere(
          { cartridgeKeys: null, powderIds: bench.powderIds, bulletOr: bulletOrAnyCartridge },
          filter,
        ),
      }),
    ]);

    return { ignoringBullets, ignoringPowders, ignoringCartridges };
  }

  /* ── The powder picker ─────────────────────────────────────────────── */

  /**
   * ⚠️ THE FILTER IS THE THIRD ARGUMENT BECAUSE A CHIP'S COUNT IS A PROMISE
   * ABOUT WHAT TAPPING IT SHOWS, AND THE FINDER'S CONTROLS ARE PART OF THAT
   * PROMISE. Counted without the cartridge tab and the weight band, a chip
   * reads "12 loads" over a screen the member has narrowed to one cartridge
   * and 150 gr +, and eleven of the twelve are behind controls they can see
   * are set. Same class of broken promise as counting without the calibre.
   *
   * The powder chip itself is deliberately NOT applied: a powder filter would
   * zero every other row, and the whole list is what the member is choosing
   * from.
   */
  async powders(q: string | undefined, bench: GuestBench | null, filter: LoadsFilter = {}) {
    const rows = await this.powderCatalogue(q);
    // Rebuilt field by field rather than handed back as Prisma returned it —
    // see getBench(). The spread below is of OUR object, not of a Prisma row.
    const list = rows.map((p) => ({ id: p.id, name: p.name, maker: p.maker }));

    // Without a bench there is nothing to count against, and a zero would
    // read as "this powder has no loads" rather than "you have no shelf".
    if (!bench || !(bench.cartridgeKeys?.length && bench.bullets?.length)) return list;

    // ⚠️ THE SAME BULLET AXIS THE RESULTS USE, NEITHER LOOSER NOR TIGHTER.
    // This number is a promise about what tapping the powder will show:
    // counted without the calibre it counts 8x57 loads for a member whose
    // 150 gr bullet is a .308, and counted at the exact weight while the list
    // runs over ± 5 it reads "4 loads" onto a screen showing nine. Same
    // window, from the same bench — see GuestBench.toleranceGr.
    //
    // ⚠️ AND THROUGH benchLoadWhere(), NOT A HAND-ROLLED CLAUSE. This is the
    // "powders relaxed" question the empty-state diagnosis already asks, so it
    // is built by the same builder with the powder axis dropped — which is how
    // the cartridge tab and the weight band reach it without anyone having to
    // remember them here.
    const candidateKeys = filter.cartridgeKey ? [filter.cartridgeKey] : bench.cartridgeKeys;
    const counts = await this.prisma.benchLoad.groupBy({
      by: ['powderId'],
      where: this.benchLoadWhere(
        {
          cartridgeKeys: bench.cartridgeKeys,
          powderIds: null,
          bulletOr: await this.bulletAxis(
            bench.bullets,
            resolveTolerance(bench.toleranceGr),
            candidateKeys,
          ),
        },
        // The powder chip is dropped: filtering by one powder would count 0
        // for every other row on a list whose whole job is choosing between
        // them.
        { ...filter, powderId: undefined },
      ),
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.powderId, c._count._all]));
    return list.map((p) => ({ ...p, loadsForBench: byId.get(p.id) ?? 0 }));
  }

  /**
   * The canonical powder list, cached — see CATALOGUE_TTL_MS.
   *
   * ⚠️ NO take, AND NONE MAY BE ADDED. The picker filters this list
   * CLIENT-SIDE, so whatever a cap omits is unreachable no matter what the
   * member types: they get 'Nothing matches that name' for a powder that
   * exists, and nothing on screen says the list was shortened. At 300, with
   * 305 imported, the last five were invisible. Raising the cap to 1000 only
   * moved the trap one import away; the canonical list is a few hundred rows,
   * so there is no cap worth paying for. A cap here is only ever acceptable if
   * the picker TELLS the member the list was cut, the way BulletPicker's draw
   * cap does.
   */
  private powderCatalogue(q: string | undefined) {
    const read = () =>
      this.prisma.benchPowder.findMany({
        where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
        select: { id: true, name: true, maker: true },
        orderBy: { name: 'asc' },
      });
    // ⚠️ ONLY THE UNSEARCHED LIST IS CACHED. A key per search term is a map
    // that grows with whatever anybody types; the picker's own first request
    // is the unsearched one and is the only call worth holding.
    return q ? read() : this.cached('powders', read);
  }

  /* ── Calibre, which lives on the cartridge ─────────────────────────── */

  /**
   * cartridgeKey → the calibre its bullets are, in inches.
   *
   * ⚠️ EVERY FIGURE GOES THROUGH calibreFromG1 AND NOTHING ELSE ROUNDS IT.
   * A thou of spread WITHIN one calibre (.308 Win publishes 0.309", .300 H&H
   * 0.308", .300 Lapua 0.310" — all three take a .308 bullet) is the same size
   * as the gap BETWEEN neighbouring calibres (.321" .32 Rem against .323"
   * 8mm). So there is no rounding, no bucketing and no chaining by tolerance
   * anywhere on this path: two figures are one calibre only when the snap says
   * they are.
   *
   * Only cartridgeKey and G1 are read. Nothing else on the sheet may travel
   * this far — see bench.leak.spec.ts.
   */
  private async calibreByCartridge(keys?: string[]): Promise<Map<string, number | null>> {
    const rows = await this.prisma.benchCipDimension.findMany({
      where: keys ? { cartridgeKey: { in: keys } } : undefined,
      select: { cartridgeKey: true, G1: true },
      // No take, for the reason spelled out in bullets() below: a calibre this
      // omits silently drops every bullet of that calibre off the picker.
    });
    return new Map(rows.map((r) => [r.cartridgeKey, calibreFromG1(r.G1)]));
  }

  /**
   * The inverse: a calibre → the cartridge keys that take that bullet.
   *
   * Cartridges with no sheet are absent rather than gathered under a null key.
   * A load whose cartridge has no published diameter cannot be shown to fit a
   * bullet of a known one — we would be guessing, in the direction that ends
   * with a round that does not chamber.
   */
  private async cartridgeKeysByCalibre(keys?: string[]): Promise<Map<number, string[]>> {
    const byKey = await this.calibreByCartridge(keys);
    const out = new Map<number, string[]>();
    for (const [key, calibre] of byKey) {
      if (calibre === null) continue;
      const list = out.get(calibre);
      if (list) list.push(key);
      else out.set(calibre, [key]);
    }
    return out;
  }

  /**
   * The bullet axis: the OR clause that says "a load whose bullet weighs what
   * one on this shelf weighs, give or take the tolerance, and is the calibre
   * that shelf bullet actually is".
   *
   * 🚨 A BULLET IS A WEIGHT IN A CALIBRE. The maker and the bullet type are
   * shown on every result and narrow nothing — a 150 gr .308 from Hornady,
   * Sierra or Barnes gives near enough the same pressures and speeds, and
   * matching on the name is what made a stocked bench return nothing at all.
   *
   * ⚠️ THE WINDOW WIDENS THE SEARCH AND NEVER A CHARGE. Each row that comes
   * back keeps its own weight and its own start and max; a 155 gr load found
   * for a 150 gr shelf bullet is a 155 gr load, quoted as one.
   *
   * 🚨 ONE BUILDER, AND EVERY SURFACE THAT FILTERS BY A BENCH CALLS IT. Three
   * places AND on the shelf's bullets — the results, the powder rows' counts
   * and the spec card's count — and while each wrote its own clause the
   * calibre reached only the first of them. The same shelf then said "12
   * loads" on a powder chip and showed none when the member tapped it, and the
   * spec card counted 8x57 loads against a .308" bullet that will not chamber
   * in one. A hand-rolled fourth copy is a fourth chance to leave the axis out,
   * so there is no hand-rolled copy: NEVER re-derive this clause.
   *
   * BenchLoad has no diameter column — the calibre lives one join away, on the
   * cartridge's sheet — so the constraint is expressed as the set of cartridge
   * keys of that calibre. `candidateKeys` is the set the calling query could
   * return, so the lookup stays as narrow as the question.
   *
   * ⚠️ `undefined` candidateKeys MEANS EVERY CARTRIDGE, AND IT IS NOT THE SAME
   * AS AN EMPTY ARRAY. Only whyEmpty()'s ignoringCartridges count passes it:
   * that question is "does this bullet appear ANYWHERE with this powder", so
   * the calibre still binds but the shelf no longer does. An empty array would
   * bind it to nothing and answer 0 for every bullet in the catalogue.
   *
   * ⚠️ A SHELF BULLET WITH NO CALIBRE MATCHES ANY CALIBRE, DELIBERATELY. Every
   * bench saved before calibres were recorded stores bullets without one, and
   * treating those as "matches nothing" would empty a member's screen overnight
   * through no action of theirs. They keep exactly the behaviour they had; a
   * bullet WITH a calibre is held to it.
   *
   * ⚠️ NO SHEET IS READ UNLESS A BULLET NEEDS ONE. An all-pre-calibre bench
   * costs the query it always cost.
   */
  private async bulletAxis(
    bullets: NonNullable<GuestBench['bullets']>,
    /**
     * ⚠️ REQUIRED, AND AHEAD OF THE OPTIONAL ARGUMENT ON PURPOSE. A default
     * here is a caller that can silently search a different width from the one
     * beside it, which is the drift this builder exists to stop.
     */
    toleranceGr: WeightToleranceGr,
    candidateKeys?: string[],
  ): Promise<BulletClause[]> {
    const keysByCalibre = bullets.some((b) => b.calibreIn != null)
      ? await this.cartridgeKeysByCalibre(candidateKeys)
      : null;

    return bullets.map((b) => ({
      // weightWindow() rather than arithmetic here: inclusive at both ends and
      // never inverted, stated once in bullet-weight.ts and tested there.
      weightGr: weightWindow(b.weightGr, toleranceGr),
      // `?? []` is not a fallback to "anything" — a calibre no candidate
      // cartridge shares must match NOTHING, which is what an empty `in` does.
      // Falling back to no clause at all would be the original bug with extra
      // steps: the bullet would match every cartridge on the shelf.
      ...(b.calibreIn != null && keysByCalibre
        ? { cartridgeKey: { in: keysByCalibre.get(b.calibreIn) ?? [] } }
        : {}),
    }));
  }

  /* ── The bullet picker ─────────────────────────────────────────────── */

  /**
   * Every bullet the consolidated set knows: the distinct CALIBRE + WEIGHT
   * pairs, each with how many loads use it.
   *
   * 🚨 A BULLET IS A WEIGHT IN A CALIBRE, AND THE PICKER IS WHERE THAT STARTS.
   * Grouped by maker and bullet type as well, this list was the source data's
   * shape rather than a reloader's shelf: 1723 rows, of which "Hornady 150 SP
   * .308" and "Sierra 150 SP .308" were two entries a member had to choose
   * between, and choosing wrong emptied their screen. Folded to the weight it
   * is roughly 636 rows and every one of them is a thing somebody owns.
   *
   * ⚠️ THE CALIBRE IS PART OF THE GROUP, NOT A LABEL ON IT. Dropping the maker
   * does not drop the diameter: a 150 gr weight that appears in three calibres
   * is three different projectiles and comes back as THREE rows. Folded into
   * one, the picker offers a "150 gr" that stands for a .277, a .308, a .311
   * and a .323 at once, and the results then tell a member they can build
   * loads their bullets do not fit.
   *
   * ⚠️ THE GROUP BY CARRIES cartridgeKey BECAUSE BenchLoad HAS NO DIAMETER.
   * The calibre is one join away, on the cartridge's sheet, so Postgres groups
   * per cartridge and the calibres are folded together here — which is the
   * only place that knows calibreFromG1's answer. The aggregate still does the
   * expensive part: ~28 000 consolidated rows collapse to a few thousand
   * (cartridge, weight) pairs, where distinct-ing in node would drag the whole
   * table across the wire.
   *
   * This axis exists because the bench is an AND. A member with powders and
   * cartridges but no bullet matches nothing, for ever — which is precisely
   * what happened while all three Add buttons opened the powder picker.
   */
  async bullets(): Promise<BenchBulletOptionView[]> {
    // Cached: the same list for every viewer, and one group-by over ~28 000
    // consolidated rows on every open of the picker.
    return this.cached('bullets', () => this.buildBullets());
  }

  private async buildBullets(): Promise<BenchBulletOptionView[]> {
    const [groups, calibres] = await Promise.all([
      this.prisma.benchLoad.groupBy({
        // ⚠️ NO WHERE, AND THE MAKER FILTER THAT WAS HERE IS GONE WITH THE
        // MAKER ITSELF. It excluded rows with a blank bulletMaker, because
        // such a row drew a picker entry nothing a member typed could match.
        // The entry is now `.308" 150 gr` — nothing about it is blank — and
        // loads() no longer looks at the maker either, so a filter here would
        // make this count smaller than the list it promises: the chip would
        // read 8 and the screen would show 9.
        by: ['cartridgeKey', 'weightGr'],
        _count: { _all: true },
      }),
      // Every cartridge, not just the ones with loads: the join below is a
      // lookup, and a missing entry is indistinguishable from a missing sheet.
      this.calibreByCartridge(),
    ]);

    // ⚠️ NO take/skip ANYWHERE ON THIS PATH, AND NONE MAY BE ADDED. The picker
    // filters this list in the browser, so whatever the server omits is
    // unreachable no matter how the member spells it. Capping the powder list
    // at 300 with 305 imported is exactly how five powders went invisible.
    const byBullet = new Map<string, BenchBulletOptionView>();
    for (const g of groups) {
      // ⚠️ A CARTRIDGE WITH NO SHEET KEEPS ITS ROW. Five of the 177 have none,
      // and their loads are still loads a member can build — dropping them
      // would make those bullets unaddable and their cartridges dead ends.
      // They group under null, which loads() then treats as "any calibre".
      const calibreIn = calibres.get(g.cartridgeKey) ?? null;

      // The identity, in one string — the same two parts, in the same order,
      // that the client's bulletKey() joins, and that benchBulletKey() spells
      // for a stored bullet. Built from calibreFromG1's own answer and never a
      // rounded or bucketed form of it, which is how two calibres end up in
      // one group.
      const key = benchBulletKey({ weightGr: g.weightGr, calibreIn });

      const row = byBullet.get(key);
      // Summed across every cartridge of the calibre: .308 Win, .300 H&H and
      // .300 Lapua all take the .308 bullet, so its count is all three.
      if (row) row.loads += g._count._all;
      else
        byBullet.set(key, {
          calibreIn,
          weightGr: g.weightGr,
          // Consolidated loads. Never the number of manuals behind them.
          loads: g._count._all,
        });
    }

    // Sorted here rather than in the GROUP BY: the aggregate has already
    // collapsed the table, so ordering in node costs nothing and the
    // tie-breaks stay readable. Most loads first, because the top of a picker
    // should be the part worth adding.
    //
    // ⚠️ THE TIE-BREAKS RUN ALL THE WAY THROUGH THE IDENTITY, WHICH IS NOT
    // TIDINESS. A bullet is calibre + weight — that is what bulletKey() joins
    // and what the results AND matches on — so the two tie-breaks below cover
    // it exactly and the order is total. A hash aggregate guarantees no order
    // at all, so anything they left undecided would swap places between one
    // opening of the picker and the next, in a list the member is scanning by
    // eye.
    return [...byBullet.values()].sort(
      (a, b) =>
        b.loads - a.loads ||
        compareCalibre(a.calibreIn, b.calibreIn) ||
        a.weightGr - b.weightGr,
    );
  }

  /* ── The cartridge picker ──────────────────────────────────────────── */

  /**
   * The cartridges a member can actually put on a bench.
   *
   * ⚠️ ONLY THE ONES THAT HAVE LOADS. The reference set carries far more
   * cartridges than we hold load data for, and adding one of those narrows the
   * AND to nothing — the member adds the cartridge they own, the screen stays
   * empty, and the Bench looks broken rather than unstocked.
   */
  async cartridgeList(): Promise<BenchCartridgeOptionView[]> {
    // Cached for the same reason bullets() is — see cached().
    return this.cached('cartridges', () => this.buildCartridgeList());
  }

  private async buildCartridgeList(): Promise<BenchCartridgeOptionView[]> {
    const counts = await this.prisma.benchLoad.groupBy({
      by: ['cartridgeKey'],
      _count: { _all: true },
    });
    const byKey = new Map(counts.map((c) => [c.cartridgeKey, c._count._all]));

    const rows = await this.prisma.benchCartridge.findMany({
      where: { key: { in: [...byKey.keys()] } },
      select: { key: true, name: true },
      orderBy: { name: 'asc' },
      // No take, for the reason spelled out in bullets() above.
    });

    // Rebuilt field by field rather than spread. A spread would carry whatever
    // a future `select` picks up, and this model is the one that owns `sources`.
    return rows.map((c) => ({ key: c.key, name: c.name, loads: byKey.get(c.key) ?? 0 }));
  }

  /* ── The spec card ─────────────────────────────────────────────────── */

  /**
   * ⚠️ THE FILTER REACHES THE BENCH COUNT, FOR THE REASON IT REACHES THE
   * POWDER CHIPS. "26 from your bench" is a promise about the list behind the
   * card, and the finder's weight band is part of that list. The cartridge tab
   * is NOT taken from the filter — this card is about THIS cartridge, whatever
   * tab the finder is on.
   */
  async cartridge(key: string, bench: GuestBench | null, filter: LoadsFilter = {}) {
    const cartridge = await this.prisma.benchCartridge.findUnique({
      where: { key },
      select: {
        key: true,
        name: true,
        slug: true,
        type: true,
        origin: true,
        year: true,
        caseLengthMm: true,
        maxLengthMm: true,
        pmaxPsi: true,
        pmaxBar: true,
        dims: true,
      },
    });
    if (!cartridge) throw new NotFoundException('Unknown cartridge');

    // ⚠️ THE BENCH COUNT IS BUILT THROUGH bulletAxis() LIKE EVERY OTHER ONE.
    // This card is where a member decides whether to add the cartridge, and
    // "4 for your bench" against a bullet three thou too fat is the exact
    // claim the calibre axis exists to stop us making. Resolved against this
    // one cartridge, so a shelf bullet of another calibre lands on the empty
    // `in` and counts nothing.
    const shelfBullets = bench?.bullets ?? [];
    const shelfPowders = bench?.powderIds ?? [];
    const bulletOr =
      shelfPowders.length && shelfBullets.length
        ? await this.bulletAxis(shelfBullets, resolveTolerance(bench?.toleranceGr), [key])
        : null;

    const family = await this.shellHolderGroup(key, cartridge.dims);

    const [loadCount, loadsForBench] = await Promise.all([
      // Every load for the cartridge, unnarrowed: this is the figure that
      // says the cartridge is worth adding, and narrowing it by the finder's
      // current view would answer a different question.
      this.prisma.benchLoad.count({ where: { cartridgeKey: key } }),
      bulletOr
        ? this.prisma.benchLoad.count({
            where: this.benchLoadWhere(
              { cartridgeKeys: [key], powderIds: shelfPowders, bulletOr },
              // The card's own cartridge wins over the finder's tab; the
              // weight band and the powder chip are the member's current view
              // and do narrow the list this count describes.
              { ...filter, cartridgeKey: key },
            ),
          })
        : Promise.resolve(0),
    ]);

    // ⚠️ CHIPS ARE CAPPED AND THE CAP IS DECLARED. The .473" head family runs
    // to dozens of cartridges; a card that lists them all buries the sections
    // under it. Unlike the pickers, nothing here is filtered in the browser,
    // so a cut list is not a thing the member cannot reach — but they must
    // still be told there is more, which is what shellHolderMore is for.
    const shellHolderGroup = family.slice(0, SHELL_HOLDER_MAX);
    const shellHolderMore = family.length - shellHolderGroup.length;

    // 🚨 THE SHEET'S OWN BAR FIGURE BEATS OUR CONVERSION OF THE PSI ONE.
    // BenchCartridge.pmaxBar is round(pmaxPsi / 14.5038) — a derived number,
    // which the schema's own comment forbids showing in a reloading context
    // where the exact figure exists. When the dimension sheet carries a bar
    // value it IS the exact figure, and the derived one is off by a bar or two.
    const sheetBar = (cartridge.dims as { pmaxBar?: number | null } | null)?.pmaxBar ?? null;

    // ⚠️ NAMED FIELD BY FIELD RATHER THAN `const { dims, ...rest }`. A rest
    // spread republishes whatever the `select` above happens to hold, so the
    // day somebody adds one column for the spec header — or swaps the select
    // for an include to get `sources` — the new column ships to the client
    // with it. This model is the one that owns the `sources` relation.
    return {
      cartridge: {
        key: cartridge.key,
        name: cartridge.name,
        slug: cartridge.slug,
        type: cartridge.type,
        origin: cartridge.origin,
        year: cartridge.year,
        caseLengthMm: cartridge.caseLengthMm,
        maxLengthMm: cartridge.maxLengthMm,
        /** The reference figure, in psi. */
        pmaxPsi: cartridge.pmaxPsi,
        /** The sheet's own bar figure where there is one, else psi / 14.5038. */
        pmaxBar: sheetBar ?? cartridge.pmaxBar,
        /**
         * True when `pmaxBar` above is the conversion rather than a figure
         * anybody printed. The client may soften how it renders it; it may not
         * say where either figure came from (the module's copy rule).
         */
        pmaxBarDerived: sheetBar === null,
      },
      // ⚠️ rawText is stripped. It is the sheet's own text block, kept for
      // audit, and it is the one field on this model that would put a
      // published page into a response.
      // A denylist rather than a rebuild, and deliberately: BenchCipDimension
      // is some sixty measurement columns whose whole point is that they are
      // all published, so naming each one here would be a list to forget to
      // extend. rawText is the single field on it that must not travel.
      dims: cartridge.dims ? this.stripAudit(cartridge.dims) : null,
      // `stations` is deliberately NOT returned. The calliper's snap points
      // are a pure function of these same dims and LatheView already
      // computes them; sending a second copy over the wire would be one
      // more place for the drawing and the ruler to disagree.
      shellHolderGroup,
      /** How many more share this head than the chips above. 0 when none. */
      shellHolderMore,
      loadCount,
      loadsForBench,
    };
  }

  /**
   * Cartridges whose case head this one shares, so a member knows the shell
   * holder already in their press will hold it.
   *
   * ⚠️ RIM GEOMETRY ONLY, AND NO MANUFACTURER'S NUMBER IS CLAIMED. A shell
   * holder grips the rim: its diameter (R1), its thickness (R) and the
   * extractor groove (E1). Two cartridges agreeing on all three to within a
   * twentieth of a millimetre take the same holder — .308 Win, .243 Win,
   * .260 Rem, 7mm-08 and 6,5 Creedmoor are one family on the .473" head.
   * What is NOT claimed is which numbered holder that is: those are each
   * maker's own catalogue and vary between them, so the card says "same
   * shell holder as these" and never "RCBS #3".
   *
   * ⚠️ THE TOLERANCE IS THE SPEC'S, NOT A GUESS (SPEC-BUILD §332). It is
   * tight enough that C.I.P.'s published rim thicknesses separate some
   * cartridges a press would in practice hold together — .30-06 publishes
   * 1.24 mm against .308 Win's 1.37 and so falls out of its group. Erring
   * narrow is right for a hint: a missing chip costs a member nothing, a
   * wrong one sends them to the bench with the wrong holder.
   */
  private async shellHolderGroup(
    key: string,
    dims: { R1: number | null; R: number | null; E1: number | null } | null,
  ): Promise<{ key: string; name: string }[]> {
    // No sheet, or a sheet missing any of the three, proves nothing. An
    // empty list renders no section, which is the honest outcome.
    if (!dims || dims.R1 == null || dims.R == null || dims.E1 == null) return [];
    const TOL = 0.05;

    const near = await this.prisma.benchCipDimension.findMany({
      where: {
        cartridgeKey: { not: key },
        R1: { gte: dims.R1 - TOL, lte: dims.R1 + TOL },
        R: { gte: dims.R - TOL, lte: dims.R + TOL },
        E1: { gte: dims.E1 - TOL, lte: dims.E1 + TOL },
      },
      select: { cartridgeKey: true },
    });
    if (!near.length) return [];

    // Only cartridges the member can actually reach. One with no loads is a
    // chip that leads nowhere.
    const rows = await this.prisma.benchCartridge.findMany({
      where: { key: { in: near.map((n) => n.cartridgeKey) }, loads: { some: {} } },
      select: { key: true, name: true },
      orderBy: { name: 'asc' },
    });
    // Rebuilt field by field: BenchCartridge owns the relation a spread would
    // one day carry into a public response.
    return rows.map((c) => ({ key: c.key, name: c.name }));
  }

  /**
   * The dimension sheet, minus everything that describes the SHEET rather than
   * the cartridge.
   *
   * 🚨 THE MEASUREMENTS ARE OURS TO PUBLISH; THE PAPER THEY WERE READ OFF IS
   * NOT. `rawText` is the page's own text block. `tab`, `sheetDate` and
   * `revision` identify the edition it was printed in — the spec (§6.3) says
   * the header carries "no TAB/revision chips" for exactly that reason — and
   * `imageOnly` is a fact about our parser, not about the round. Nothing
   * renders any of them, so the only thing they could ever do is leak.
   *
   * ⚠️ tolerances AND footnotes STAY, BECAUSE THEY ARE MEASUREMENTS. A
   * dimension without its tolerance is a dimension quoted more precisely than
   * it was ever stated, and the card is meant to show them beside each figure.
   * But they are free text off the sheet, so a footnote reading "see the
   * published table on page 214" would carry the one thing that may not
   * travel — and there is no way to know in advance which footnote does. So
   * every value in both is read, and any that names its source is dropped
   * rather than the whole map: losing one footnote costs a reader a caveat,
   * and losing the tolerances costs them the tolerances.
   */
  private stripAudit<T extends Record<string, unknown>>(dims: T) {
    const {
      rawText: _rawText,
      tab: _tab,
      sheetDate: _sheetDate,
      revision: _revision,
      imageOnly: _imageOnly,
      tolerances,
      footnotes,
      ...safe
    } = dims as T & Record<string, unknown>;

    return {
      ...safe,
      tolerances: sanitiseAnnotations(tolerances),
      footnotes: sanitiseAnnotations(footnotes),
    };
  }

  /* ── The log ───────────────────────────────────────────────────────── */

  async log(clerkSub: string): Promise<PublicLogEntry[]> {
    const userId = await this.resolveUserId(clerkSub);
    // ⚠️ NO take. This is the member's OWN log, and logCsv() below is built
    // from this method — a cap here silently short-changes the file they
    // downloaded to keep, which is the one list on the module where a missing
    // row is their record rather than our catalogue. Nothing in LogList or in
    // the CSV says a cap was applied, so under the module's own rule there
    // cannot be one. The table is per-member and indexed on [userId,
    // createdAt]; a shelf log is tens of rows, not tens of thousands.
    const rows = await this.prisma.benchLogEntry.findMany({
      where: { userId },
      // 🚨 THE DATE THE MEMBER FIRED, NOT THE DATE WE WROTE THE ROW. The sheet
      // offers a date and honours it, so an entry logged for last weekend
      // sorted to the TOP of the list above everything shot since — the one
      // list on this module that is the member's own record, ordered by a
      // column they cannot see. createdAt is kept as the tie-break: two
      // entries dated the same day belong in the order they were typed.
      orderBy: [{ shotAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!rows.length) return [];

    const loadIds = [...new Set(rows.map((r) => r.loadId).filter((id): id is string => !!id))];

    const [cartridges, loads] = await Promise.all([
      // The row stores only the key, and a key is not a thing to show someone
      // — "65creedmoor" is not what they loaded. Resolved here rather than in
      // the client so the CSV and the list agree. maxLengthMm comes with it:
      // the COAL flags are computed against the cartridge's own ceiling.
      this.prisma.benchCartridge.findMany({
        where: { key: { in: [...new Set(rows.map((r) => r.cartridgeKey))] } },
        select: { key: true, name: true, maxLengthMm: true },
      }),
      // ⚠️ THE WINDOW EACH ENTRY WAS WORKED UP AGAINST. The sheet warns
      // `ABOVE MAX 41.5` while the member types and the list then showed a
      // charge two grains over the maximum as an ordinary row — the one place
      // they go back to read what they did said nothing about it.
      loadIds.length
        ? this.prisma.benchLoad.findMany({
            where: { id: { in: loadIds } },
            select: { id: true, startGr: true, maxGr: true },
          })
        : Promise.resolve([]),
    ]);

    const byKey = new Map(cartridges.map((c) => [c.key, c]));
    const byLoad = new Map(loads.map((l) => [l.id, l]));

    // userId never goes back out — the caller already knows who they are.
    return rows.map(({ userId: _omit, ...rest }) => {
      const cartridge = byKey.get(rest.cartridgeKey);
      // ⚠️ A LOAD THAT NO LONGER EXISTS IS A NULL WINDOW, NOT A ZERO ONE. A
      // re-import can re-consolidate a group away; `startGr: 0` would then put
      // every entry above its own start charge.
      const window = rest.loadId ? (byLoad.get(rest.loadId) ?? null) : null;
      return {
        ...rest,
        cartridgeName: cartridge?.name ?? rest.cartridgeKey,
        startGr: window?.startGr ?? null,
        maxGr: window?.maxGr ?? null,
        flags: logFlags(rest, window, cartridge?.maxLengthMm ?? null),
      };
    });
  }

  /**
   * The log as a CSV the member can keep.
   *
   * ⚠️ EVERY FIELD IS ESCAPED, INCLUDING THE ONES THAT LOOK SAFE. `notes` is
   * free text a member typed, so it can hold a comma, a quote or a newline;
   * unescaped, one note shifts every following column and the file silently
   * stops meaning what it says.
   */
  async logCsv(clerkSub: string) {
    const rows = await this.log(clerkSub);
    const head = [
      'Date', 'Cartridge', 'Bullet', 'Powder', 'Charge (gr)', 'COAL (mm)',
      'Primer', 'Case', 'Velocity (m/s)', 'Group (mm)', 'Notes',
    ];
    // toCsv from common/csv.util rather than a local escape: the seller
    // statement, the admin export and the payout CSV all quote identically,
    // and a fourth hand-rolled version is a fourth chance to get free-text
    // notes wrong.
    return {
      csv: toCsv([
        head,
        ...rows.map((r) => [
          jhbDate(r.shotAt),
          r.cartridgeName,
          r.bulletLabel,
          r.powderName,
          r.chargeGr,
          r.coalMm,
          r.primer,
          r.caseLabel,
          r.velocityMs,
          r.groupMm,
          r.notes,
        ]),
      ]),
      filename: 'the-bench-load-log.csv',
    };
  }

  /**
   * ⚠️ `?? null` AND NEVER `Number(...)`. Velocity and group are ALWAYS posted
   * as null — the sheet says so on its own footer, "results are added after
   * the range" — and the old code tested `=== undefined` and then ran
   * `Number(null)`, which is 0. So every entry ever logged came back reading
   * 0 m/s and 0 mm, in the list and in the CSV the member downloaded to keep,
   * and a blank COAL printed as `0.00 mm`. A missing measurement is null all
   * the way through; zero is a measurement.
   *
   * ⚠️ AND THE TWO POINTERS ARE CHECKED. `cartridgeKey` is what the list
   * resolves a NAME from and what the COAL flags are judged against, and
   * `loadId` is the window the charge is judged against — a key naming nothing
   * silently produces an entry with no name and no flags, which looks like the
   * flags saying the load is fine.
   */
  async addLog(clerkSub: string, body: AddLogDto) {
    const userId = await this.resolveUserId(clerkSub);

    const cartridge = await this.prisma.benchCartridge.findUnique({
      where: { key: body.cartridgeKey },
      select: { key: true },
    });
    if (!cartridge) throw new BadRequestException('Unknown cartridge');

    if (body.loadId) {
      const load = await this.prisma.benchLoad.findUnique({
        where: { id: body.loadId },
        select: { id: true },
      });
      if (!load) throw new BadRequestException('Unknown load');
    }

    const row = await this.prisma.benchLogEntry.create({
      data: {
        userId,
        cartridgeKey: body.cartridgeKey,
        bulletLabel: body.bulletLabel,
        powderName: body.powderName,
        chargeGr: body.chargeGr,
        coalMm: body.coalMm ?? null,
        primer: trimmedOrNull(body.primer),
        caseLabel: trimmedOrNull(body.caseLabel),
        loadId: body.loadId ?? null,
        velocityMs: body.velocityMs ?? null,
        groupMm: body.groupMm ?? null,
        notes: trimmedOrNull(body.notes),
        // The sheet offers a date, so it has to be honoured; without this the
        // column defaults to now() and a load logged for last weekend silently
        // files itself under today. parseShotAt has already vetted it — the
        // DTO rejects an unreadable one at the door rather than falling back
        // to today, which is a different date from the one they typed.
        ...(body.shotAt ? { shotAt: parseShotAt(body.shotAt) ?? undefined } : {}),
      },
    });

    // ⚠️ THE SAME SHAPE THE LIST RETURNS, INCLUDING THE FLAGS. The sheet
    // warned `ABOVE MAX 41.5` while they typed; the row it hands back has to
    // carry that warning too, or an entry inserted optimistically into the
    // list is the one row on the screen with nothing on it. PATCH answers the
    // same way, so a client has one shape to render rather than three.
    return this.entry(clerkSub, row.id);
  }

  /** One log row in the list's own shape. */
  private async entry(clerkSub: string, id: string): Promise<PublicLogEntry> {
    const row = (await this.log(clerkSub)).find((r) => r.id === id);
    if (!row) throw new NotFoundException('Unknown log entry');
    return row;
  }

  /**
   * The results, added after the range.
   *
   * 🚨 SCOPED BY userId, LIKE THE DELETE. `updateMany` with the id ALONE would
   * let one member overwrite another's log row by guessing a cuid; a `count`
   * of 0 back from it is "not yours or not there", and both are a 404 to the
   * caller — telling the two apart would confirm the row exists.
   */
  async patchLog(clerkSub: string, id: string, body: PatchLogDto) {
    const userId = await this.resolveUserId(clerkSub);

    // ⚠️ EVERY FIELD IS OPTIONAL AND NULLABLE, SO ABSENT AND null MUST NOT
    // COLLAPSE. `velocityMs: undefined` means "leave it as it was"; null means
    // "clear the reading I entered". Building the data object from the keys
    // the member actually sent is the only way to keep those apart.
    const data: Prisma.BenchLogEntryUpdateManyMutationInput = {};
    if ('velocityMs' in body) data.velocityMs = body.velocityMs ?? null;
    if ('groupMm' in body) data.groupMm = body.groupMm ?? null;
    if ('notes' in body) data.notes = trimmedOrNull(body.notes);

    const { count } = await this.prisma.benchLogEntry.updateMany({
      where: { id, userId },
      data,
    });
    if (!count) throw new NotFoundException('Unknown log entry');

    return this.entry(clerkSub, id);
  }

  async deleteLog(clerkSub: string, id: string) {
    const userId = await this.resolveUserId(clerkSub);
    // Scoped by userId as well as id: an id alone would let one member delete
    // another's log row by guessing a cuid.
    await this.prisma.benchLogEntry.deleteMany({ where: { id, userId } });
    return { ok: true };
  }

  /* ── The permalink ─────────────────────────────────────────────────── */

  /**
   * Store a finder state and hand back a link to it.
   *
   * 🚨 THE TOKEN IS THE WHOLE ADDRESS, SO IT IS RANDOM AND NOT DERIVED. 16
   * bytes of crypto randomness — 22 url-safe characters — because a token
   * built from the payload would let anybody who guessed a common bench read
   * back the share, and a sequential one would let them walk the table.
   *
   * ⚠️ AND IT IS NOT A CAPABILITY. GET /bench/share/:token is behind the same
   * ClerkGuard as everything else on this module: the link is a shortcut for a
   * member, not a way to publish the catalogue to somebody who cannot see the
   * page. Spec §10 defers the guest bench, and the auth wall is why this site
   * is not blocked.
   */
  async share(clerkSub: string, payload: Record<string, unknown>) {
    await this.resolveUserId(clerkSub);

    // Capped by SIZE rather than by shape: the finder's controls change more
    // often than this endpoint should, and what a link may not do is store a
    // megabyte per click.
    const json = JSON.stringify(payload ?? {});
    if (Buffer.byteLength(json, 'utf8') > SHARE_MAX_BYTES) {
      throw new BadRequestException('That is too much to share in one link');
    }

    const token = randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.benchShare.create({
      data: { token, payload: payload as Prisma.InputJsonValue, expiresAt },
    });

    return { token, url: `${appUrl()}/bench?s=${token}` };
  }

  /**
   * ⚠️ AN EXPIRED TOKEN IS A 404 AND NOT A PARTIAL ANSWER. Opening a link that
   * has aged out must land the member on their OWN bench with a "that link has
   * expired" — never on a half-applied filter set they did not choose and
   * cannot see the rest of.
   */
  async readShare(token: string) {
    const row = await this.prisma.benchShare.findUnique({ where: { token } });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('That link has expired');
    }
    return { token: row.token, payload: row.payload, expiresAt: row.expiresAt };
  }
}
