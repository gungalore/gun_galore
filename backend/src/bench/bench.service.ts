import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv } from '../common/csv.util';
import { calibreFromG1 } from './bullet-calibre';
import {
  coalFlags,
  THUMB_DIM_FIELDS,
  type BenchView,
  type LoadsResponse,
  type LoadsWhy,
  type PublicLoadGroup,
  type PublicLoadRow,
} from './bench.types';

/** What a guest sends instead of a stored bench. */
export interface GuestBench {
  powderIds?: string[];
  bullets?: {
    maker: string;
    weightGr: number;
    category: string;
    /**
     * Inches, from the cartridge's C.I.P. G1 — see bullet-calibre.ts.
     *
     * ⚠️ OPTIONAL, AND IT HAS TO STAY OPTIONAL. Benches saved before calibres
     * were recorded hold none, and a bullet without one matches any calibre —
     * exactly the behaviour it had. See loads() for why.
     */
    calibreIn?: number | null;
  }[];
  cartridgeKeys?: string[];
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
  maker: string;
  weightGr: number;
  /** FMJ | MONO | TIP | HP | CAST | SP | OTHER. */
  category: string;
  /**
   * 🚨 A WEIGHT IS NOT A BULLET, AND THIS FIELD IS WHY. "Hornady 150gr SP"
   * names four projectiles — .277 for .270 Win, .308 for .308 Win, .311 for
   * .303 British, .323 for 8x57 — which are not interchangeable. Without it
   * one row stood for all four and the results told a member they could build
   * loads their bullets do not fit.
   *
   * Inches. Null only where the cartridge has no C.I.P. sheet to take a
   * diameter from; those rows are still offered, because the bullet is still
   * loadable.
   */
  calibreIn: number | null;
  loads: number;
}

/** One row of the cartridge picker. `loads` reads exactly as above. */
export interface BenchCartridgeOptionView {
  key: string;
  name: string;
  loads: number;
}

/**
 * One branch of the bullet OR — a shelf bullet, pinned to its own calibre.
 *
 * Named rather than inlined so the shape is stated once and the three callers
 * cannot drift apart: `cartridgeKey` is ABSENT for a bullet with no calibre
 * (matches any) and an explicit `in` list for one that has it, which may be
 * empty (matches nothing). Both are meaningful; neither is a default.
 */
interface BulletClause {
  bulletMaker: string;
  weightGr: number;
  bulletCategory: string;
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
function compareCalibre(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

@Injectable()
export class BenchService {
  constructor(private readonly prisma: PrismaService) {}

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
  private async resolveUserId(clerkSub: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: clerkSub },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('No member for this session');
    return user.id;
  }

  /* ── The bench itself ──────────────────────────────────────────────── */

  async getBench(clerkSub: string): Promise<BenchView> {
    const userId = await this.resolveUserId(clerkSub);
    const row = await this.prisma.userBench.findUnique({ where: { userId } });

    // A member who has never opened the page gets an empty bench rather than
    // a 404: "you have nothing on your shelf yet" is a state, not an error.
    if (!row) return { powders: [], bullets: [], cartridges: [], units: 'metric' };

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
      bullets: Array.isArray(row.bullets) ? (row.bullets as unknown as BenchView['bullets']) : [],
      cartridges: cartridges.map((c) => ({ key: c.key, name: c.name })),
      units: row.units,
    };
  }

  async putBench(
    clerkSub: string,
    body: { powderIds?: string[]; bullets?: unknown; cartridgeKeys?: string[]; units?: string },
  ): Promise<BenchView> {
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
   * has the powder AND a bullet matching maker + weight + category + calibre
   * AND the cartridge. Anything looser would answer a different question —
   * "loads that exist" rather than "loads I can make tonight" — which is the
   * whole point of the screen.
   */
  async loads(bench: GuestBench, filter: LoadsFilter): Promise<LoadsResponse> {
    const powderIds = bench.powderIds ?? [];
    const cartridgeKeys = bench.cartridgeKeys ?? [];
    const bullets = bench.bullets ?? [];

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
    const bulletOr = await this.bulletAxis(bullets, candidateKeys);

    const rows = await this.prisma.benchLoad.findMany({
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
      orderBy: [{ weightGr: 'asc' }],
    });

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
      for (const w of g.weights) w.rows.sort((a, b) => a.powder.localeCompare(b.powder));
    }

    // Only when there is nothing to show. A full screen explains itself, and
    // three extra counts on every search would be paid by every member who is
    // simply reading their loads.
    const why =
      rows.length === 0
        ? await this.whyEmpty({ cartridgeKeys, powderIds, bullets }, filter, bulletOr)
        : null;

    // Spread rather than `why: why ?? undefined`: a key that is present and
    // undefined survives into `Object.keys` and into every `'why' in result`
    // check the client might make, and "there is a diagnosis" must not be
    // true of a search that found loads.
    return { count: rows.length, groups, ...(why ? { why } : {}) };
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
   * 🚨 AND THE CALIBRE SURVIVES. Two of the three counts keep the bullet axis,
   * and a bullet is maker + weight + category + CALIBRE. Counted without it,
   * "ignoringPowders: 12" against a .308" 150 gr SP would be counting 8x57
   * loads that will not chamber — the same false promise the powder chips and
   * the spec card once made. So both go through bulletAxis(), and the count
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

  async powders(q: string | undefined, bench: GuestBench | null) {
    const rows = await this.prisma.benchPowder.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
      select: { id: true, name: true, maker: true },
      orderBy: { name: 'asc' },
      // ⚠️ NO take, AND NONE MAY BE ADDED — same rule as bullets() below. The
      // picker filters this list CLIENT-SIDE, so whatever a cap omits is
      // unreachable no matter what the member types: they get 'Nothing matches
      // that name' for a powder that exists, and nothing on screen says the
      // list was shortened. At 300, with 305 imported, the last five were
      // invisible. Raising the cap to 1000 only moved the trap one import
      // away; the canonical list is a few hundred rows, so there is no cap
      // worth paying for. A cap here is only ever acceptable if the picker
      // TELLS the member the list was cut, the way BulletPicker's draw cap
      // does.
    });
    // Rebuilt field by field rather than handed back as Prisma returned it —
    // see getBench(). The spread below is of OUR object, not of a Prisma row.
    const list = rows.map((p) => ({ id: p.id, name: p.name, maker: p.maker }));

    // Without a bench there is nothing to count against, and a zero would
    // read as "this powder has no loads" rather than "you have no shelf".
    if (!bench || !(bench.cartridgeKeys?.length && bench.bullets?.length)) return list;

    // ⚠️ THE SAME BULLET AXIS THE RESULTS USE, NOT A LOOSER ONE. This number
    // is a promise about what tapping the powder will show: counted without
    // the calibre it counts 8x57 loads for a member whose 150 gr SP is a .308,
    // and the chip then reads "12 loads" onto a screen with none on it.
    const counts = await this.prisma.benchLoad.groupBy({
      by: ['powderId'],
      where: {
        cartridgeKey: { in: bench.cartridgeKeys },
        OR: await this.bulletAxis(bench.bullets, bench.cartridgeKeys),
      },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.powderId, c._count._all]));
    return list.map((p) => ({ ...p, loadsForBench: byId.get(p.id) ?? 0 }));
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
   * The bullet axis: the OR clause that says "a load whose bullet is one of
   * the ones on this shelf, of the calibre that shelf bullet actually is".
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
    candidateKeys?: string[],
  ): Promise<BulletClause[]> {
    const keysByCalibre = bullets.some((b) => b.calibreIn != null)
      ? await this.cartridgeKeysByCalibre(candidateKeys)
      : null;

    return bullets.map((b) => ({
      bulletMaker: b.maker,
      weightGr: b.weightGr,
      bulletCategory: b.category,
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
   * Every bullet the consolidated set knows: the distinct maker + weight +
   * category + CALIBRE combinations, each with how many loads use it.
   *
   * 🚨 THE CALIBRE IS PART OF THE GROUP, NOT A LABEL ON IT. A (maker, weight,
   * category) triple that appears across three calibres is three different
   * projectiles and comes back as THREE rows. Folded into one, the picker
   * offers a member a "150gr SP" that stands for a .277, a .308, a .311 and a
   * .323 at once, and the results then tell them they can build loads their
   * bullets do not fit.
   *
   * ⚠️ THE GROUP BY CARRIES cartridgeKey BECAUSE BenchLoad HAS NO DIAMETER.
   * The calibre is one join away, on the cartridge's sheet, so Postgres groups
   * per cartridge and the calibres are folded together here — which is the
   * only place that knows calibreFromG1's answer. The aggregate still does the
   * expensive part: ~28 000 consolidated rows collapse to a few thousand
   * (triple, cartridge) pairs, where distinct-ing in node would drag the whole
   * table across the wire.
   *
   * This axis exists because the bench is an AND. A member with powders and
   * cartridges but no bullet matches nothing, for ever — which is precisely
   * what happened while all three Add buttons opened the powder picker.
   */
  async bullets(): Promise<BenchBulletOptionView[]> {
    const [groups, calibres] = await Promise.all([
      this.prisma.benchLoad.groupBy({
        by: ['bulletMaker', 'weightGr', 'bulletCategory', 'cartridgeKey'],
        // A bullet nobody named cannot be picked off a shelf: the picker would
        // draw a blank row that matches nothing a member types. Prisma types the
        // column non-null, but the manual rows it is consolidated from allow a
        // missing maker, so the guard belongs in SQL rather than in the types —
        // and `<> ''` drops a NULL too, should the column ever be relaxed.
        where: { bulletMaker: { not: '' } },
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

      // The identity, in one string — the same four parts, in the same order,
      // that the client's bulletKey() joins. Built from calibreFromG1's own
      // answer and never a rounded or bucketed form of it, which is how two
      // calibres end up in one group.
      const key = `${g.bulletMaker}|${g.weightGr}|${g.bulletCategory}|${calibreIn ?? ''}`;

      const row = byBullet.get(key);
      // Summed across every cartridge of the calibre: .308 Win, .300 H&H and
      // .300 Lapua all take the .308 bullet, so its count is all three.
      if (row) row.loads += g._count._all;
      else
        byBullet.set(key, {
          maker: g.bulletMaker,
          weightGr: g.weightGr,
          category: g.bulletCategory,
          calibreIn,
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
    // TIDINESS. A bullet is maker + weight + category + calibre — that is what
    // bulletKey() joins and what the results AND matches on — so two rows
    // differing only by calibre are two different bullets. A hash aggregate
    // guarantees no order at all, so anything the tie-breaks leave undecided
    // swaps places between one opening of the picker and the next, in a list
    // the member is scanning by eye. Every field is compared, so the order is
    // total.
    return [...byBullet.values()].sort(
      (a, b) =>
        b.loads - a.loads ||
        a.maker.localeCompare(b.maker) ||
        a.weightGr - b.weightGr ||
        compareCalibre(a.calibreIn, b.calibreIn) ||
        a.category.localeCompare(b.category),
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

  async cartridge(key: string, bench: GuestBench | null) {
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
        ? await this.bulletAxis(shelfBullets, [key])
        : null;

    const [loadCount, loadsForBench] = await Promise.all([
      this.prisma.benchLoad.count({ where: { cartridgeKey: key } }),
      bulletOr
        ? this.prisma.benchLoad.count({
            where: {
              cartridgeKey: key,
              powderId: { in: shelfPowders },
              OR: bulletOr,
            },
          })
        : Promise.resolve(0),
    ]);

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
        pmaxPsi: cartridge.pmaxPsi,
        pmaxBar: cartridge.pmaxBar,
      },
      // ⚠️ rawText is stripped. It is the sheet's own text block, kept for
      // audit, and it is the one field on this model that would put a
      // published page into a response.
      // A denylist rather than a rebuild, and deliberately: BenchCipDimension
      // is some sixty measurement columns whose whole point is that they are
      // all published, so naming each one here would be a list to forget to
      // extend. rawText is the single field on it that must not travel.
      dims: cartridge.dims ? this.stripAudit(cartridge.dims) : null,
      stations: [],
      shellHolderGroup: [],
      loadCount,
      loadsForBench,
    };
  }

  private stripAudit<T extends Record<string, unknown>>(dims: T) {
    const { rawText, ...safe } = dims as T & { rawText?: string };
    return safe;
  }

  /* ── The log ───────────────────────────────────────────────────────── */

  async log(clerkSub: string) {
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
      orderBy: { createdAt: 'desc' },
    });

    // The row stores only the key, and a key is not a thing to show someone —
    // "65creedmoor" is not what they loaded. Resolved here rather than in the
    // client so the CSV and the list agree.
    const names = new Map(
      (
        await this.prisma.benchCartridge.findMany({
          where: { key: { in: [...new Set(rows.map((r) => r.cartridgeKey))] } },
          select: { key: true, name: true },
        })
      ).map((c) => [c.key, c.name]),
    );

    // userId never goes back out — the caller already knows who they are.
    return rows.map(({ userId: _omit, ...rest }) => ({
      ...rest,
      cartridgeName: names.get(rest.cartridgeKey) ?? rest.cartridgeKey,
    }));
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
          r.shotAt.toISOString().slice(0, 10),
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

  async addLog(clerkSub: string, body: Record<string, unknown>) {
    const userId = await this.resolveUserId(clerkSub);
    const row = await this.prisma.benchLogEntry.create({
      data: {
        userId,
        cartridgeKey: String(body.cartridgeKey ?? ''),
        bulletLabel: String(body.bulletLabel ?? ''),
        powderName: String(body.powderName ?? ''),
        chargeGr: Number(body.chargeGr ?? 0),
        coalMm: body.coalMm === undefined ? null : Number(body.coalMm),
        primer: body.primer ? String(body.primer) : null,
        caseLabel: body.caseLabel ? String(body.caseLabel) : null,
        loadId: body.loadId ? String(body.loadId) : null,
        velocityMs: body.velocityMs === undefined ? null : Number(body.velocityMs),
        groupMm: body.groupMm === undefined ? null : Number(body.groupMm),
        notes: body.notes ? String(body.notes) : null,
        // The sheet offers a date, so it has to be honoured; without this the
        // column defaults to now() and a load logged for last weekend silently
        // files itself under today. An unparseable value falls back to the
        // default rather than throwing.
        ...(body.shotAt && !Number.isNaN(Date.parse(String(body.shotAt)))
          ? { shotAt: new Date(String(body.shotAt)) }
          : {}),
      },
    });
    const { userId: _omit, ...rest } = row;
    return rest;
  }

  async deleteLog(clerkSub: string, id: string) {
    const userId = await this.resolveUserId(clerkSub);
    // Scoped by userId as well as id: an id alone would let one member delete
    // another's log row by guessing a cuid.
    await this.prisma.benchLogEntry.deleteMany({ where: { id, userId } });
    return { ok: true };
  }
}
