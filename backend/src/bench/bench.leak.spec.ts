import { HttpException } from '@nestjs/common';
import { BenchController } from './bench.controller';
import { BenchService } from './bench.service';
import { DEFAULT_WEIGHT_TOLERANCE_GR } from './bullet-weight';

/**
 * THE BENCH — the leak test.
 *
 * ⚠️ THIS IS A COPYRIGHT BOUNDARY, NOT A TIDINESS RULE. The consolidated
 * loads are derived from published reloading manuals. What we may publish is
 * the consolidation — the lowest start and highest max across every manual
 * that lists a combination, which is a fact about the combination. What we
 * may not publish is any manual's own table: which book a charge came from,
 * which page it sat on, or its individual start/max pair.
 *
 * So every public response is asserted to contain none of `source`, `manual`,
 * `page`, `CIP`, `SAAMI` or `published` — in KEYS or in VALUES. A `select`
 * quietly widened to an `include`, or a new field named `sourceManual`, fails
 * here rather than in a letter from a powder company.
 *
 * The mock deliberately returns rows carrying every forbidden field, so the
 * test proves the service strips them rather than proving the fixture was
 * clean.
 */

const FORBIDDEN = ['source', 'manual', 'page', 'cip', 'saami', 'published'];

function assertNoLeak(payload: unknown, where: string): void {
  const json = JSON.stringify(payload ?? null).toLowerCase();
  for (const word of FORBIDDEN) {
    expect({ where, word, found: json.includes(word) }).toEqual({
      where,
      word,
      found: false,
    });
  }
}

/** A row shaped like the real one, plus every field that must never escape. */
const dirtyLoad = {
  id: 'load_1',
  cartridgeKey: '65creedmoor',
  bulletMaker: 'Hornady',
  bulletType: 'ELD Match',
  weightGr: 140,
  startGr: 35.6,
  startFps: 2400,
  maxGr: 41.5,
  maxFps: 2700,
  coalMm: 71.2,
  coalLoMm: null,
  coalHiMm: null,
  powder: { name: 'H4350' },
  cartridge: {
    key: '65creedmoor',
    name: '6,5 Creedmoor',
    maxLengthMm: 71.76,
    pmaxBar: 4350,
    pmaxPsi: 63092,
    dims: { L3: 48.77, L6: 71.76 },
  },
  // ── none of these may survive ──
  sourcesCount: 7,
  sources: [{ source: 'Hodgdon Annual Manual', sourcePage: 214 }],
};

/**
 * The fields that must never ride along, spread onto EVERY row the double
 * returns. The mock ignores `select` and `by` the way a mock does, so a service
 * that maps a row field by field drops these and a service that hands the row
 * back as Prisma returned it does not.
 *
 * ⚠️ ON EVERY FIXTURE, NOT JUST THE PICKERS'. A clean fixture only proves the
 * fixture was clean. This file's header promises that "a `select` quietly
 * widened to an `include`" fails here, and that promise is only true of a path
 * whose fixture is dirty — so /bench/me, /bench/powders and the spec card
 * carry the dirt too, and their services rebuild their rows field by field
 * rather than passing a Prisma row through.
 */
const DIRT = {
  sourcesCount: 7,
  source: 'Hodgdon Annual Manual',
  sourcePage: 214,
};

/**
 * A dimension sheet carrying every field that describes the SHEET rather than
 * the cartridge — and annotations that name where they came from.
 *
 * 🚨 THE TOLERANCES AND FOOTNOTES ARE THE HARD CASE, WHICH IS WHY THEY ARE
 * HERE. They are free text off the page and they must SURVIVE — a dimension
 * quoted without its tolerance is quoted more precisely than it was ever
 * stated — so they cannot simply be dropped like `rawText`. What must go is
 * the individual entry that names its origin, and nothing else: `L1` and `P1`
 * below are still expected on the far side.
 */
const DIRTY_DIMS = {
  cartridgeKey: '65creedmoor',
  L3: 48.77,
  L6: 71.76,
  pmaxBar: 4351,
  // The audit field, which must be stripped whole.
  rawText: 'C.I.P. TDCC sheet — 6,5 Creedmoor, published 2019, page 3',
  // The edition the figures were printed in. Nothing renders these, and the
  // spec (§6.3) says the header carries no TAB or revision chips.
  tab: 'TAB IV',
  sheetDate: '2019-06-12',
  revision: 'Rev. 2',
  imageOnly: false,
  tolerances: {
    L1: '-0.20',
    P1: '-0.10',
    // Two that must not travel, for two different reasons.
    L3: 'as published in the 2019 edition',
    L6: 'see the CIP table, page 3',
  },
  footnotes: { P1: '*', G1: 'from the source manual' },
};

/**
 * Real C.I.P. G1 figures, in millimetres, straight off the sheets.
 *
 * 🚨 THE .270 / .308 PAIR IS THE BUG THIS MODULE EXISTS FOR. One "Hornady
 * 150gr SP" row stood for both, and the results told a member with .270 and
 * .308 on the bench that they could build every load for both. A .277 bullet
 * three thou under a .308 bore is not a near miss.
 *
 * .300 H&H is here to prove the other half: its G1 (7.82) differs from .308
 * Win's (7.85) by a thou, and both take the same .308 bullet, so their loads
 * must SUM into one row rather than split into two.
 */
const G1_MM = {
  creedmoor65: 6.72, // → .264
  win270: 7.06, //      → .277
  win308: 7.85, //      → .308
  hh300: 7.82, //       → .308, one thou off .308 Win and the same bullet
};

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'usr_1' }) },
    userBench: {
      findUnique: jest.fn().mockResolvedValue({
        userId: 'usr_1',
        powderIds: ['pwd_1'],
        cartridgeKeys: ['65creedmoor'],
        bullets: [{ maker: 'Hornady', weightGr: 140, category: 'TIP' }],
        units: 'metric',
      }),
      upsert: jest.fn(),
    },
    benchPowder: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'pwd_1', name: 'H4350', maker: 'Hodgdon', ...DIRT }]),
    },
    benchCartridge: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ key: '65creedmoor', name: '6,5 Creedmoor', ...DIRT }]),
      findUnique: jest.fn().mockResolvedValue({
        ...DIRT,
        key: '65creedmoor',
        name: '6,5 Creedmoor',
        slug: '6-5-creedmoor',
        type: '1 rimless',
        origin: 'USA',
        year: 2007,
        caseLengthMm: 48.77,
        maxLengthMm: 71.76,
        pmaxPsi: 63092,
        pmaxBar: 4350,
        dims: DIRTY_DIMS,
      }),
    },
    benchLoad: {
      findMany: jest.fn().mockResolvedValue([dirtyLoad]),
      count: jest.fn().mockResolvedValue(12),
      /**
       * groupBy answers three different questions on this service — the powder
       * counts, the bullet list and the cartridge list — so the double
       * dispatches on `by` rather than pretending one canned array fits all
       * three. Typed loosely on purpose: the no-cap test below reads `take` off
       * these same call arguments.
       */
      groupBy: jest.fn((args: Record<string, unknown>) => {
        const by = ([] as string[]).concat((args.by ?? []) as string[]);
        // ⚠️ weightGr IS TESTED FIRST AND MUST STAY FIRST. Both the bullet
        // picker and the cartridge list group by cartridgeKey — the calibre
        // lives on the cartridge — so the cartridge-list branch below would
        // swallow the picker's call if the order were reversed, and bullets()
        // would silently receive the cartridge counts.
        if (by.includes('weightGr')) {
          // 🚨 NO MAKER AND NO CATEGORY IN THE ROW, BECAUSE THERE IS NONE IN
          // THE GROUP BY. Postgres has already folded every maker at one
          // weight in one cartridge into a single row; that is the change.
          //
          // Deliberately out of order: the 120's 9 must come back above the
          // 140's 6, so the ordering is proven rather than inherited.
          return Promise.resolve([
            { cartridgeKey: '65creedmoor', weightGr: 140, _count: { _all: 6 }, ...DIRT },
            { cartridgeKey: '65creedmoor', weightGr: 120, _count: { _all: 9 }, ...DIRT },
            // 🚨 ONE WEIGHT, THREE PROJECTILES. .277 for the .270 Win, .308
            // for the .308 Win, and the .300 H&H's .308 which is the same
            // bullet as the .308 Win's.
            { cartridgeKey: '270win', weightGr: 150, _count: { _all: 4 }, ...DIRT },
            { cartridgeKey: '308win', weightGr: 150, _count: { _all: 5 }, ...DIRT },
            { cartridgeKey: '300hh', weightGr: 150, _count: { _all: 3 }, ...DIRT },
            // Three rows tying on 6, across two calibres and three weights —
            // the tie-breaks below are what keeps them in a fixed order.
            { cartridgeKey: '65creedmoor', weightGr: 95, _count: { _all: 6 }, ...DIRT },
            { cartridgeKey: '270win', weightGr: 130, _count: { _all: 6 }, ...DIRT },
            // No sheet at all — five of the 177 cartridges have none. Still a
            // load a member can build, so still a row.
            { cartridgeKey: 'nosheet', weightGr: 180, _count: { _all: 2 }, ...DIRT },
          ]);
        }
        if (by.includes('cartridgeKey')) {
          return Promise.resolve([{ cartridgeKey: '65creedmoor', _count: { _all: 9 }, ...DIRT }]);
        }
        return Promise.resolve([{ powderId: 'pwd_1', _count: { _all: 4 } }]);
      }),
    },
    /**
     * The sheets the calibre is read off. Only cartridgeKey and G1 are ever
     * read, but the fixture carries the dirt anyway: this table is the one
     * whose rawText is a published page, and it is now on the bullet picker's
     * path.
     */
    benchCipDimension: {
      /**
       * ⚠️ THIS DOUBLE HONOURS ITS `where`, UNLIKE THE OTHERS. The narrowing
       * is the behaviour under test on the count paths: a card for the .270
       * asks for the .270's sheet alone, and a double that hands back every
       * sheet regardless would let a .308" bullet find a .308 cartridge that
       * the query never even looked at — the test would pass on a service
       * that counts loads the member cannot build.
       */
      findMany: jest.fn((args?: { where?: { cartridgeKey?: { in: string[] } } }) => {
        const sheets = [
          { cartridgeKey: '65creedmoor', G1: G1_MM.creedmoor65, ...DIRT },
          { cartridgeKey: '270win', G1: G1_MM.win270, ...DIRT },
          { cartridgeKey: '308win', G1: G1_MM.win308, ...DIRT },
          { cartridgeKey: '300hh', G1: G1_MM.hh300, ...DIRT },
          // 'nosheet' is deliberately absent rather than present with a null
          // G1: the two must behave the same way.
        ];
        const keys = args?.where?.cartridgeKey?.in;
        return Promise.resolve(keys ? sheets.filter((s) => keys.includes(s.cartridgeKey)) : sheets);
      }),
    },
    benchLogEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
    },
    benchShare: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data)),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

describe('The Bench — no manual ever leaks into a public response', () => {
  const bench = {
    powderIds: ['pwd_1'],
    cartridgeKeys: ['65creedmoor'],
    bullets: [{ maker: 'Hornady', weightGr: 140, category: 'TIP' }],
  };

  it('GET /bench/loads', async () => {
    const svc = new BenchService(makePrisma() as never);
    const out = await svc.loads(bench, {});
    expect(out.count).toBe(1);
    assertNoLeak(out, 'loads');
  });

  it('GET /bench/loads does not carry sourcesCount even though the row had one', async () => {
    const svc = new BenchService(makePrisma() as never);
    const out = await svc.loads(bench, {});
    const json = JSON.stringify(out);
    // The count and the per-manual rows are both internal. Checked by key
    // rather than by value: a bare '7' also appears inside 71.76 and 2700,
    // which made the first version of this assertion fail on clean output.
    expect(json).not.toContain('sourcesCount');
    expect(json).not.toContain('sources');
  });

  it('GET /bench/cartridges/:key strips the sheet rawText', async () => {
    const svc = new BenchService(makePrisma() as never);
    const out = await svc.cartridge('65creedmoor', bench);
    expect(JSON.stringify(out)).not.toContain('rawText');
    assertNoLeak(out, 'cartridge');
  });

  it('GET /bench/me', async () => {
    const svc = new BenchService(makePrisma() as never);
    assertNoLeak(await svc.getBench('user_clerk_sub'), 'me');
  });

  it('GET /bench/powders', async () => {
    const svc = new BenchService(makePrisma() as never);
    assertNoLeak(await svc.powders(undefined, bench), 'powders');
  });

  it('GET /bench/bullets', async () => {
    const svc = new BenchService(makePrisma() as never);
    assertNoLeak(await svc.bullets(), 'bullets');
  });

  it('GET /bench/cartridges', async () => {
    // The default benchCartridge.findMany carries DIRT, so this proves
    // cartridgeList() strips it rather than proving the fixture was clean.
    const svc = new BenchService(makePrisma() as never);
    assertNoLeak(await svc.cartridgeList(), 'cartridges');
  });
});

/**
 * The two picker lists the bench's other axes are added from.
 *
 * ⚠️ THE BENCH IS AN AND ACROSS THREE AXES. A member who cannot add a bullet
 * or a cartridge sees an empty screen for ever, however many powders they own,
 * which is what these endpoints exist to end. So the shape is asserted whole,
 * not field by field.
 */
describe('The Bench — the bullet and cartridge pickers', () => {
  it('bullets are the distinct calibre+weight rows, most loads first, and carry nothing else', async () => {
    const svc = new BenchService(makePrisma() as never);

    // toEqual on the whole array rather than a key-by-key check: an extra
    // field rides along unnoticed under a per-field assertion, and
    // `sourcesCount` is exactly the kind of field that would — as would a
    // maker, which is the field this change exists to remove.
    expect(await svc.bullets()).toEqual([
      { calibreIn: 0.264, weightGr: 120, loads: 9 },
      // .308 Win's 5 and .300 H&H's 3 are the same bullet, so they sum.
      { calibreIn: 0.308, weightGr: 150, loads: 8 },
      // Three tying on 6: calibre decides before weight, so the two .264s
      // come first and are ordered light to heavy between themselves.
      { calibreIn: 0.264, weightGr: 95, loads: 6 },
      { calibreIn: 0.264, weightGr: 140, loads: 6 },
      { calibreIn: 0.277, weightGr: 130, loads: 6 },
      { calibreIn: 0.277, weightGr: 150, loads: 4 },
      // No sheet, so no calibre — and still offered, because the bullet is
      // still loadable.
      { calibreIn: null, weightGr: 180, loads: 2 },
    ]);
  });

  /**
   * 🚨 THE OPERATOR'S REPORT, 2026-09-03: "when 150gr is selected it should
   * spit out all 150gr bullets, not just what specifically matches that exact
   * same criteria. a 150gr bullet of any manufacturer would yield almost the
   * exact same pressures and speeds."
   *
   * Grouped by maker and type as well, "Hornady 150 SP .308" and "Sierra 150
   * SP .308" were two entries a member had to choose between, and choosing
   * wrong emptied their screen. The fold happens in the GROUP BY, so this is
   * asserted on the query rather than on the rows.
   */
  it('groups by the calibre and the weight and by nothing else', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).bullets();

    const [args] = prisma.benchLoad.groupBy.mock.calls.find(([a]) =>
      ([] as string[]).concat(a.by as string[]).includes('weightGr'),
    ) as [{ by: string[]; where?: unknown }];

    expect(args.by).toEqual(['cartridgeKey', 'weightGr']);
    // ⚠️ AND NO `where`. The maker filter that lived here excluded loads whose
    // bulletMaker was blank — sensible while the maker was half the row's
    // name, wrong now that it is not: loads() does not look at the maker
    // either, so a filter here would make this count smaller than the list it
    // promises. The chip would read 8 over a screen showing 9.
    expect(args.where).toBeUndefined();
  });

  /**
   * 🚨 DROPPING THE MAKER DOES NOT DROP THE DIAMETER. A member with .270 Win
   * and .308 Win on the bench and one "150 gr" entry would be shown loads for
   * both and told they could build them. A .277 bullet in a .308 case will not
   * chamber; the other way round it chambers and spikes pressure.
   */
  it('a .277 and a .308 at one weight are two rows and never one', async () => {
    const rows = await new BenchService(makePrisma() as never).bullets();
    const gr150 = rows.filter((r) => r.weightGr === 150);

    expect(gr150).toHaveLength(2);
    // Two calibres, and neither of them a blend of the two.
    expect(new Set(gr150.map((r) => r.calibreIn))).toEqual(new Set([0.277, 0.308]));

    // ⚠️ NO ROW MAY EVER HOLD TWO CALIBRES. Asserted across the whole list
    // rather than on this pair alone: the failure mode is a fold that reaches
    // one row too far, and it would show up on whichever pair happens to be
    // adjacent.
    const seen = new Set<string>();
    for (const r of rows) {
      const identity = `${r.calibreIn}|${r.weightGr}`;
      expect(seen.has(identity)).toBe(false);
      seen.add(identity);
    }
  });

  it('the picker carries the calibre and nothing off the sheet it came from', async () => {
    const rows = await new BenchService(makePrisma() as never).bullets();

    // The field the frontend's bulletKey() folds in. Present on every row —
    // null is an answer, `undefined` is a field that never shipped.
    for (const r of rows) {
      expect(Object.prototype.hasOwnProperty.call(r, 'calibreIn')).toBe(true);
      expect(r.calibreIn === null || typeof r.calibreIn === 'number').toBe(true);
    }
    // The calibre is read off a C.I.P. sheet, so the picker is now on that
    // table's path — and none of it may travel. `cartridgeKey` is not
    // forbidden, but it is not a bullet's business either, and leaving it on
    // would re-split one bullet into a row per cartridge.
    expect(JSON.stringify(rows)).not.toContain('cartridgeKey');
    // ⚠️ AND NEITHER TRAVELS ANY LONGER. A maker on the row is a maker the
    // picker can start filtering on again, which is the model this replaced.
    expect(JSON.stringify(rows)).not.toContain('maker');
    expect(JSON.stringify(rows)).not.toContain('category');
    assertNoLeak(rows, 'bullets/calibre');
  });

  it('only cartridges that have loads are offered, named and counted', async () => {
    const prisma = makePrisma({
      benchCartridge: {
        // The double ignores `select`, so the row arrives carrying everything
        // the real select leaves behind — which is the point of the fixture.
        findMany: jest
          .fn()
          .mockResolvedValue([{ key: '65creedmoor', name: '6,5 Creedmoor', ...DIRT }]),
      },
    });
    const out = await new BenchService(prisma as never).cartridgeList();

    expect(out).toEqual([{ key: '65creedmoor', name: '6,5 Creedmoor', loads: 9 }]);
    // Keyed off the loads aggregate, so a cartridge with no loads is never in
    // the list: adding one narrows the AND to nothing and reads as a bug.
    expect(prisma.benchCartridge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: { in: ['65creedmoor'] } } }),
    );
  });

  it('no list is capped — a client-side filter cannot reach what the server omits', async () => {
    const prisma = makePrisma();
    const svc = new BenchService(prisma as never);
    await svc.bullets();
    await svc.cartridgeList();
    // ⚠️ THE POWDERS AND THE LOG BELONG IN THIS TEST TOO. The powder list is
    // where the regression actually shipped, and the log is worse than a
    // catalogue: logCsv() is built from log(), so a cap there short-changes
    // the file a member downloaded to keep their own record.
    await svc.powders(undefined, null);
    await svc.log('user_2abcCLERKsub');

    // 🚨 THE RESULTS LIST IS THE ONE EXCEPTION, AND IT IS EXEMPT ONLY BECAUSE
    // IT SAYS SO. It is not filtered in the browser — every control re-queries
    // — and an unbounded findMany with a nested cartridge per row can drag
    // five figures of rows across the wire for one loose shelf. So it takes
    // LOADS_MAX and answers `truncated: true`, which is the rule this test
    // enforces everywhere else: nothing may be shortened SILENTLY. See
    // bench-results.spec.ts.

    // The regression this guards is live history: the powder list was capped
    // at 300 with 305 imported, the picker filters in the browser, and five
    // powders became unreachable however they were spelled. ~1139 bullets and
    // ~165 cartridges make that mistake far cheaper to repeat here.
    const calls = [
      ...prisma.benchLoad.groupBy.mock.calls,
      ...prisma.benchLoad.findMany.mock.calls,
      ...prisma.benchCartridge.findMany.mock.calls,
      ...prisma.benchPowder.findMany.mock.calls,
      ...prisma.benchLogEntry.findMany.mock.calls,
      // The sheet lookup the bullet picker's calibres come from. A cap here
      // would not shorten the list — it would silently blank the calibre on
      // every cartridge past the cap, and those bullets would fold back into
      // the ambiguous rows this whole change exists to split apart.
      ...prisma.benchCipDimension.findMany.mock.calls,
    ];
    expect(calls.length).toBeGreaterThan(0);
    for (const [args] of calls) {
      expect(args.take).toBeUndefined();
      expect(args.skip).toBeUndefined();
    }
  });
});

/**
 * 🚨 THE OTHER HALF OF THE FIX. Splitting the picker is worthless if the
 * results still AND on maker + weight + category alone: the member adds the
 * .277 "150gr SP", and the screen hands them .308 Win loads anyway.
 *
 * BenchLoad has no diameter column, so the calibre is enforced through the
 * cartridge — the assertions read the `where` the service builds, which is
 * where the constraint actually lives.
 */
describe('The Bench — a shelf bullet only matches its own calibre', () => {
  /** The OR branch the service built for one shelf bullet. */
  function bulletClauses(prisma: ReturnType<typeof makePrisma>) {
    const [args] = prisma.benchLoad.findMany.mock.calls[0] as [
      { where: { OR: Record<string, unknown>[] } },
    ];
    return args.where.OR;
  }

  const shelf = {
    powderIds: ['pwd_1'],
    cartridgeKeys: ['65creedmoor', '270win', '308win', '300hh'],
  };

  it('pins a .308 bullet to the .308 cartridges and keeps the .270 out', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).loads(
      { ...shelf, bullets: [{ weightGr: 150, calibreIn: 0.308 }] },
      {},
    );

    expect(bulletClauses(prisma)).toEqual([
      {
        // 🚨 A WINDOW AND A CALIBRE. No maker, no category — the whole clause
        // is here, so a field creeping back in fails on this line.
        weightGr: { gte: 145, lte: 155 },
        // .308 Win and .300 H&H publish maxima a thou apart and take the same
        // bullet, so both are in. .270 Win is three thou away and is not.
        cartridgeKey: { in: ['308win', '300hh'] },
      },
    ]);
  });

  /**
   * 🚨 THE DEFECT THE OPERATOR REPORTED, IN ONE ASSERTION. The bench held
   * .30-06, N550 and a Hornady 150 gr SP, and the screen was empty: the loads
   * that exist at 150 grains on that powder are a Barnes, a Sierra, a Lapua, a
   * Norma and a Hornady TIP. Nothing about the maker or the type may reach the
   * query, however the shelf entry was saved.
   */
  it('ignores a legacy maker and category still stored beside the weight', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).loads(
      { ...shelf, bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 }] },
      {},
    );

    expect(bulletClauses(prisma)).toEqual([
      { weightGr: { gte: 145, lte: 155 }, cartridgeKey: { in: ['308win', '300hh'] } },
    ]);
    const where = JSON.stringify(prisma.benchLoad.findMany.mock.calls[0][0].where);
    expect(where).not.toContain('Hornady');
    expect(where).not.toContain('bulletCategory');
  });

  it('pins a .277 bullet to the .270, which is the pair that started this', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).loads(
      { ...shelf, bullets: [{ weightGr: 150, calibreIn: 0.277 }] },
      {},
    );

    expect(bulletClauses(prisma)[0]).toMatchObject({ cartridgeKey: { in: ['270win'] } });
  });

  it('matches nothing when no cartridge on the shelf takes that bullet', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).loads(
      // 8x57 IS is .323. Nothing on this shelf is.
      { ...shelf, bullets: [{ weightGr: 150, calibreIn: 0.323 }] },
      {},
    );

    // ⚠️ AN EMPTY `in`, NOT AN ABSENT CLAUSE. "I have no cartridge this bullet
    // fits" must return nothing; falling back to no constraint at all would
    // return every 150gr SP load on the shelf, which is the original bug with
    // extra steps.
    expect(bulletClauses(prisma)[0]).toMatchObject({ cartridgeKey: { in: [] } });
  });

  it('resolves calibres only against the cartridges the query could return', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).loads(
      { ...shelf, bullets: [{ weightGr: 150, calibreIn: 0.308 }] },
      { cartridgeKey: '308win' },
    );

    // Narrowed by the filter, not by the whole shelf: the sheet lookup is
    // scoped to what the load query is already restricted to.
    expect(prisma.benchCipDimension.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cartridgeKey: { in: ['308win'] } } }),
    );
  });

  /**
   * ⚠️ BACKWARD COMPATIBILITY, AND IT IS NOT COSMETIC. Every bench saved
   * before calibres were recorded stores bullets without one. If those stopped
   * matching, a member would open the page one morning to an empty screen
   * having changed nothing — so a stored bullet with no calibre keeps matching
   * any calibre, exactly as it did.
   */
  it('a stored bullet with no calibre still matches every calibre', async () => {
    const prisma = makePrisma();
    const out = await new BenchService(prisma as never).loads(
      { ...shelf, bullets: [{ maker: 'Hornady', weightGr: 140, category: 'TIP' }] },
      {},
    );

    expect(bulletClauses(prisma)).toEqual([
      // No cartridgeKey on the branch at all — the clause it had before, now
      // over a window rather than an exact weight.
      { weightGr: { gte: 135, lte: 145 } },
    ]);
    expect(out.count).toBe(1);
    // And the old bench costs no extra query: nothing needed a calibre.
    expect(prisma.benchCipDimension.findMany).not.toHaveBeenCalled();
  });

  it('holds a new bullet to its calibre while an old one beside it stays loose', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).loads(
      {
        ...shelf,
        bullets: [
          { maker: 'Hornady', weightGr: 140, category: 'TIP' },
          { weightGr: 150, calibreIn: 0.277 },
        ],
      },
      {},
    );

    // One shelf, two eras, and the branches are independent — a mixed bench is
    // the normal case the day this ships.
    expect(bulletClauses(prisma)).toEqual([
      { weightGr: { gte: 135, lte: 145 } },
      { weightGr: { gte: 145, lte: 155 }, cartridgeKey: { in: ['270win'] } },
    ]);
  });

  /**
   * 🚨 EVERY SURFACE THAT COUNTS, NOT JUST THE ONE THAT LISTS. loads() is
   * where the member reads the loads, but the powder chips and the spec card
   * put a NUMBER in front of them first, and a number is a promise about what
   * tapping it will show. While those two built their own bullet clause the
   * calibre reached only loads(): the same shelf said "12 loads" on a powder
   * and then showed none, and the spec card counted 8x57 loads against a .308"
   * bullet that will not chamber in one.
   *
   * Both now go through bulletAxis(), and these two tests are what stops a
   * fourth surface being hand-rolled without it.
   */
  const shelfWith308 = {
    ...shelf,
    bullets: [{ weightGr: 150, calibreIn: 0.308 }],
  };

  it('counts a powder against the calibre and the window the results will honour', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).powders(undefined, shelfWith308);

    const groupBy = prisma.benchLoad.groupBy.mock.calls
      .map(([args]) => args as { by: string[]; where?: { OR?: unknown[] } })
      .find((a) => a.by.includes('powderId'));

    // The .270 is on this shelf and must not be counted: the bullet is a .308.
    // ⚠️ AND THE SAME WINDOW. A chip counted at the exact weight over a list
    // built at ± 5 reads "4 loads" onto a screen showing nine.
    expect(groupBy?.where?.OR).toEqual([
      { weightGr: { gte: 145, lte: 155 }, cartridgeKey: { in: ['308win', '300hh'] } },
    ]);
  });

  /**
   * 🚨 EVERY SURFACE READS THE WINDOW FROM THE SAME SHELF. It rides on the
   * bench through BenchController.benchFor, so a member who narrows the finder
   * to Exact gets an Exact powder chip too — a chip counted over ± 5 beside a
   * list built at 0 is the same broken promise as a chip counted without the
   * calibre.
   */
  it('carries a narrowed window onto the powder chips as well', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).powders(undefined, {
      ...shelfWith308,
      toleranceGr: 0,
    });

    const groupBy = prisma.benchLoad.groupBy.mock.calls
      .map(([args]) => args as { by: string[]; where?: { OR?: unknown[] } })
      .find((a) => a.by.includes('powderId'));

    expect(groupBy?.where?.OR).toEqual([
      { weightGr: { gte: 150, lte: 150 }, cartridgeKey: { in: ['308win', '300hh'] } },
    ]);
  });

  it("counts a cartridge's card against the calibre too, and zero when it does not fit", async () => {
    const prisma = makePrisma();
    // The card is the .270's; the only bullet on the shelf is a .308.
    await new BenchService(prisma as never).cartridge('270win', {
      ...shelfWith308,
      cartridgeKeys: ['270win'],
    });

    const [args] = prisma.benchLoad.count.mock.calls.at(-1) as [
      { where: { OR?: { cartridgeKey?: { in: string[] } }[] } },
    ];
    // ⚠️ AN EMPTY `in`, WHICH COUNTS NOTHING. "4 loads for your bench" on a
    // cartridge none of your bullets fit is the claim this whole axis exists
    // to stop us making.
    expect(args.where.OR?.[0].cartridgeKey).toEqual({ in: [] });
    // Resolved against the one cartridge the card is for, not the whole shelf.
    expect(prisma.benchCipDimension.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cartridgeKey: { in: ['270win'] } } }),
    );
  });

  /**
   * 🚨 THE THIRD SURFACE, AND THE ONE NOTHING WAS WATCHING. The results and
   * the powder chips each have a test above pinning them to the shelf's
   * window; the spec card's "loads on your bench" had one for the calibre and
   * none for the width, so a caller that resolved the tolerance differently
   * here — or a `resolveTolerance()` dropped from this line — would have
   * printed a figure over ± 5 gr beside a list built at Exact and no test
   * would have said so. That is the drift the whole one-builder rule exists
   * to stop, so the card is asserted like the other two.
   */
  it("carries a narrowed window onto the card's bench count as well", async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).cartridge('308win', {
      ...shelfWith308,
      cartridgeKeys: ['308win'],
      toleranceGr: 0,
    });

    const [args] = prisma.benchLoad.count.mock.calls.at(-1) as [
      { where: { OR?: { weightGr?: { gte: number; lte: number } }[] } },
    ];
    expect(args.where.OR?.[0].weightGr).toEqual({ gte: 150, lte: 150 });
  });

  /**
   * ⚠️ AND THE DEFAULT REACHES IT TOO. A bench that names no width is the
   * every-request case — the finder starts on ± 5 and the client omits nothing
   * else — so the card must land on the inherited five grains rather than on a
   * silent zero, which is the narrowing this parameter exists to undo.
   */
  it("counts the card's bench figure over the inherited default when none is named", async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).cartridge('308win', {
      ...shelfWith308,
      cartridgeKeys: ['308win'],
    });

    const [args] = prisma.benchLoad.count.mock.calls.at(-1) as [
      { where: { OR?: { weightGr?: { gte: number; lte: number } }[] } },
    ];
    expect(DEFAULT_WEIGHT_TOLERANCE_GR).toBe(5);
    expect(args.where.OR?.[0].weightGr).toEqual({ gte: 145, lte: 155 });
  });

  it('leaves an old bench costing exactly the queries it always cost', async () => {
    const prisma = makePrisma();
    const svc = new BenchService(prisma as never);
    const old = { ...shelf, bullets: [{ maker: 'Hornady', weightGr: 140, category: 'TIP' }] };

    await svc.powders(undefined, old);
    await svc.cartridge('65creedmoor', old);

    // Nothing on the shelf carries a calibre, so no sheet is read on any of
    // the three paths — the counts stay one query each, as before.
    expect(prisma.benchCipDimension.findMany).not.toHaveBeenCalled();
  });
});

/**
 * 🚨 THE TOLERANCE WIDENS THE SEARCH AND NEVER A CHARGE.
 *
 * Operator, 2026-09-03: "also need a tolerance on the bullet weight to give a
 * wider variety." On the real bench — .30-06 with N550 — the exact 150 grains
 * finds 9 loads and 150 ± 5 finds 17, because 145 to 155 grains in a .30
 * calibre is one shelf of bullets to a reloader.
 *
 * ⚠️ AND THAT IS ALL IT IS: A SEARCH WIDTH. Every load that comes back is
 * quoted at ITS OWN bullet weight, in its own weight group, with its own start
 * and max charge. Nothing here says a charge worked up for a 145 gr bullet may
 * be used with a 155 gr one — the member picks the load whose bullet they
 * actually have, and the assertions below are what keep the rows separable.
 */
describe('The Bench — the weight window', () => {
  /** Each weight carries its own charges, so a blurred one would show. */
  const CHARGES: Record<number, { startGr: number; maxGr: number }> = {
    147: { startGr: 47.5, maxGr: 52.0 },
    150: { startGr: 46.8, maxGr: 51.2 },
    155: { startGr: 45.1, maxGr: 49.6 },
    165: { startGr: 43.0, maxGr: 47.4 },
  };

  /**
   * A double whose findMany HONOURS the OR's weight window, so what comes back
   * is decided by the clause the service built rather than by the fixture.
   */
  function weightPrisma() {
    const base = makePrisma();
    const rows = Object.entries(CHARGES).map(([w, c]) => ({
      ...dirtyLoad,
      id: `load_${w}`,
      weightGr: Number(w),
      ...c,
    }));
    return makePrisma({
      benchLoad: {
        ...base.benchLoad,
        findMany: jest.fn(
          (args: { where: { OR?: { weightGr?: { gte: number; lte: number } }[] } }) =>
            Promise.resolve(
              rows.filter((r) =>
                (args.where.OR ?? []).some(
                  (c) =>
                    !c.weightGr || (r.weightGr >= c.weightGr.gte && r.weightGr <= c.weightGr.lte),
                ),
              ),
            ),
        ),
      },
    });
  }

  const bench = (toleranceGr?: number) => ({
    powderIds: ['pwd_1'],
    cartridgeKeys: ['65creedmoor'],
    bullets: [{ weightGr: 150, calibreIn: 0.264 }],
    ...(toleranceGr === undefined ? {} : { toleranceGr }),
  });

  it('finds a 147 and a 155 for a 150 gr bullet, and stops before a 165', async () => {
    const out = await new BenchService(weightPrisma() as never).loads(bench(5), {});

    expect(out.count).toBe(3);
    expect(out.groups[0].weights.map((w) => w.weightGr)).toEqual([147, 150, 155]);
  });

  it('defaults to the inherited five grains when the bench names no width', async () => {
    const out = await new BenchService(weightPrisma() as never).loads(bench(), {});

    expect(DEFAULT_WEIGHT_TOLERANCE_GR).toBe(5);
    expect(out.groups[0].weights.map((w) => w.weightGr)).toEqual([147, 150, 155]);
  });

  /**
   * 🚨 THE ASSERTION THE SAFETY RULE RESTS ON. A 155 gr load found for a 150 gr
   * shelf bullet arrives in its OWN weight group carrying its OWN start and
   * max. Nothing merges, averages or re-labels a charge across the window.
   */
  it('quotes every load at its own weight, with its own start and max', async () => {
    const out = await new BenchService(weightPrisma() as never).loads(bench(5), {});

    for (const group of out.groups[0].weights) {
      const expected = CHARGES[group.weightGr];
      for (const row of group.rows) {
        expect({ startGr: row.startGr, maxGr: row.maxGr }).toEqual(expected);
      }
    }
    // Spelled out for the pair a reader would worry about: the 155's charge is
    // the 155's, never the 150's.
    const at155 = out.groups[0].weights.find((w) => w.weightGr === 155);
    expect(at155?.rows[0]).toMatchObject({ startGr: 45.1, maxGr: 49.6 });
  });

  it('collapses to the stated weight on Exact', async () => {
    const out = await new BenchService(weightPrisma() as never).loads(bench(0), {});

    // ⚠️ 0 IS A REAL ANSWER, NOT AN ABSENT ONE. A width the member chose must
    // survive the trip; treating it as "unset" would silently widen the search
    // they just narrowed.
    expect(out.groups[0].weights.map((w) => w.weightGr)).toEqual([150]);
  });

  it('widens to the whole shelf at fifteen grains', async () => {
    const out = await new BenchService(weightPrisma() as never).loads(bench(15), {});

    expect(out.groups[0].weights.map((w) => w.weightGr)).toEqual([147, 150, 155, 165]);
  });

  /**
   * ⚠️ A CALLER IS A STRANGER TOO. resolveTolerance() runs at the controller
   * door AND here, so a width nobody offers cannot reach the query however it
   * arrives — unbounded, one request would ask for every bullet weight in the
   * catalogue.
   */
  it('clamps an absurd width to one the finder offers', async () => {
    const prisma = weightPrisma();
    await new BenchService(prisma as never).loads(bench(9999), {});

    const [args] = prisma.benchLoad.findMany.mock.calls[0] as [
      { where: { OR: { weightGr: { gte: number; lte: number } }[] } },
    ];
    expect(args.where.OR[0].weightGr).toEqual({ gte: 135, lte: 165 });
  });

  it('never inverts the window on a negative width', async () => {
    const prisma = weightPrisma();
    await new BenchService(prisma as never).loads(bench(-40), {});

    // An inverted range matches nothing, and an empty screen reads as a broken
    // one rather than as a bad input.
    const [args] = prisma.benchLoad.findMany.mock.calls[0] as [
      { where: { OR: { weightGr: { gte: number; lte: number } }[] } },
    ];
    expect(args.where.OR[0].weightGr).toEqual({ gte: 150, lte: 150 });
  });

  /**
   * ⚠️ THE FINDER'S BAND STILL BINDS. The weight band is a filter and the
   * window is the axis, so both apply: a 150 gr bullet at ± 15 inside the
   * "100–150 gr" band cannot reach a 165 the band excludes.
   */
  it('is ANDed with the finder weight band rather than replacing it', async () => {
    const prisma = weightPrisma();
    await new BenchService(prisma as never).loads(bench(15), {
      weightMin: 100,
      weightMax: 150,
    });

    const [args] = prisma.benchLoad.findMany.mock.calls[0] as [
      {
        where: {
          weightGr: { gte: number; lte: number };
          OR: { weightGr: { gte: number; lte: number } }[];
        },
      },
    ];
    expect(args.where.weightGr).toEqual({ gte: 100, lte: 150 });
    expect(args.where.OR[0].weightGr).toEqual({ gte: 135, lte: 165 });
  });
});

/**
 * 🚨 THE OTHER HALF OF THE OPERATOR'S REPORT: "when I choose a cartridge and a
 * bullet, nothing comes up."
 *
 * Nothing was broken. The bench held N550, .30-06 and a 150 gr Hornady SP;
 * .30-06 with N550 has 70 loads and that bullet in .30-06 has 13, and the
 * intersection of the two is genuinely empty. The results are an AND across
 * three axes, so ONE starving axis empties the page — and a correct empty
 * screen that says nothing is indistinguishable from a broken one. THAT is
 * the defect these counts fix.
 *
 * ⚠️ THE DIAGNOSIS IS A CLAIM ABOUT THE RESULT BESIDE IT. Every count is built
 * from the same where-builder as the listing, so it cannot drift from the
 * thing it explains: relax the AXIS, never the filter, and never the calibre.
 */
describe('The Bench — an empty answer explains itself', () => {
  /** Full on all three axes, and still empty on screen. The reported bench. */
  const fullBench = {
    powderIds: ['pwd_1'],
    cartridgeKeys: ['308win'],
    bullets: [{ weightGr: 150, calibreIn: 0.308 }],
  };

  /**
   * A double whose load table has nothing for the combination asked for, and
   * whose count() answers by WHICH AXIS THE CALLER DROPPED.
   *
   * ⚠️ THE THREE ANSWERS ARE DELIBERATELY DIFFERENT NUMBERS. One canned count
   * would pass on a service that ran the same relaxed query three times, which
   * is the failure that makes the whole diagnosis useless — three equal
   * figures name no axis at all.
   */
  function emptyPrisma() {
    const base = makePrisma();
    return makePrisma({
      benchLoad: {
        ...base.benchLoad,
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn((args: { where: Record<string, unknown> }) => {
          const where = args.where;
          if (!where.OR) return Promise.resolve(70); // bullets relaxed
          if (!where.powderId) return Promise.resolve(13); // powders relaxed
          if (!where.cartridgeKey) return Promise.resolve(41); // cartridges relaxed
          // Nothing relaxed — which would mean the service asked the question
          // it had already answered.
          return Promise.resolve(-1);
        }),
      },
    });
  }

  it('says nothing about why when there are loads to show', async () => {
    const prisma = makePrisma();
    const out = await new BenchService(prisma as never).loads(fullBench, {});

    expect(out.count).toBe(1);
    // ⚠️ ABSENT, NOT PRESENT-AND-UNDEFINED. A key that exists with an
    // undefined value passes `'why' in result`, and "there is a diagnosis"
    // must not be true of a screen that found loads.
    expect(Object.prototype.hasOwnProperty.call(out, 'why')).toBe(false);
    // And it costs nothing: three counts on every search is waste paid for by
    // every member who is simply reading their loads.
    expect(prisma.benchLoad.count).not.toHaveBeenCalled();
  });

  it('names the starving axis with three counts when the bench is full and the screen is not', async () => {
    const prisma = emptyPrisma();
    const out = await new BenchService(prisma as never).loads(fullBench, {});

    expect(out.count).toBe(0);
    expect(out.groups).toEqual([]);
    expect(out.why).toEqual({ ignoringBullets: 70, ignoringPowders: 13, ignoringCartridges: 41 });
    // Three, and exactly three — one per axis, not one per axis plus the
    // question that was already answered.
    expect(prisma.benchLoad.count).toHaveBeenCalledTimes(3);
  });

  it('offers no diagnosis when an axis is bare — the caller already knows the answer', async () => {
    const prisma = emptyPrisma();
    const svc = new BenchService(prisma as never);

    for (const bare of [
      { ...fullBench, bullets: [] },
      { ...fullBench, powderIds: [] },
      { ...fullBench, cartridgeKeys: [] },
    ]) {
      const out = await svc.loads(bare, {});
      expect(out).toEqual({ count: 0, groups: [] });
      expect(Object.prototype.hasOwnProperty.call(out, 'why')).toBe(false);
    }

    // ⚠️ NOT ONE COUNT SPENT. On a bench missing an axis the diagnosis is
    // already in hand — the client says "add a bullet" — and "no combination
    // exists" would be both slower and wrong.
    expect(prisma.benchLoad.count).not.toHaveBeenCalled();
  });

  /**
   * 🚨 RELAX THE AXIS, NOTHING ELSE. The weight band is a filter, not an axis:
   * counted without it the screen tells a member 70 loads are waiting on a
   * shelf they are looking at, and clearing their bullets would reveal none of
   * them — because those 70 are outside the band the finder is holding.
   */
  it('carries the weight band into all three counts', async () => {
    const prisma = emptyPrisma();
    const out = await new BenchService(prisma as never).loads(fullBench, {
      weightMin: 100,
      weightMax: 150,
    });

    const wheres = prisma.benchLoad.count.mock.calls.map(([a]) => a.where);
    expect(wheres).toHaveLength(3);
    for (const where of wheres) expect(where.weightGr).toEqual({ gte: 100, lte: 150 });
    // The band narrowed every count and relaxed none of them: the three
    // answers still differ, so the axes were still the thing being dropped.
    expect(out.why).toEqual({ ignoringBullets: 70, ignoringPowders: 13, ignoringCartridges: 41 });
  });

  it('keeps the cartridge tab and the powder chip pinned in every count', async () => {
    const prisma = emptyPrisma();
    await new BenchService(prisma as never).loads(fullBench, {
      cartridgeKey: '308win',
      powderId: 'pwd_1',
    });

    for (const [args] of prisma.benchLoad.count.mock.calls) {
      // ⚠️ A FILTER OUTRANKS ITS OWN AXIS EVEN WHERE THE AXIS IS RELAXED. The
      // member asked why THIS view is empty; a number about a view they are
      // not looking at is not an answer to that.
      expect(args.where.cartridgeKey).toEqual({ equals: '308win' });
      expect(args.where.powderId).toEqual({ equals: 'pwd_1' });
    }
  });

  /**
   * 🚨 AND THE CALIBRE SURVIVES THE RELAXATION. A bullet is maker + weight +
   * category + CALIBRE, so a count that keeps the bullet axis keeps all four —
   * otherwise "13 loads" against a .308" 150 gr SP is counting 8x57 loads that
   * will not chamber, which is the exact false promise the powder chips and
   * the spec card once made.
   */
  it('holds a calibred bullet to its calibre in both counts that keep the bullet axis', async () => {
    const prisma = emptyPrisma();
    await new BenchService(prisma as never).loads(
      {
        powderIds: ['pwd_1'],
        // A .270 sits on the shelf beside the .308 and must never be counted.
        cartridgeKeys: ['308win', '270win'],
        bullets: [{ weightGr: 150, calibreIn: 0.308 }],
      },
      {},
    );

    const wheres = prisma.benchLoad.count.mock.calls.map(([a]) => a.where);

    // Powders relaxed: the shelf's cartridges stand, so the .308 bullet is
    // pinned to the .308 one and the .270 beside it is out.
    const keepingShelf = wheres.find((w) => w.OR && w.cartridgeKey);
    expect(keepingShelf.OR).toEqual([
      { weightGr: { gte: 145, lte: 155 }, cartridgeKey: { in: ['308win'] } },
    ]);

    // ⚠️ CARTRIDGES RELAXED MEANS ANY CARTRIDGE OF THAT CALIBRE, NOT ANY
    // CARTRIDGE. .300 H&H joins — it takes the same .308 bullet — and the .270
    // still does not, on this shelf or off it. Rebuilt against every sheet
    // rather than reused from the main query, which had resolved it against
    // the shelf and would answer "none anywhere" for a bullet with thousands.
    const anyCartridge = wheres.find((w) => w.OR && !w.cartridgeKey);
    expect(anyCartridge.OR).toEqual([
      { weightGr: { gte: 145, lte: 155 }, cartridgeKey: { in: ['308win', '300hh'] } },
    ]);

    // The widened lookup reads every sheet — `where: undefined`, not an empty
    // `in`, which would pin the bullet to nothing and answer 0 for every
    // bullet in the catalogue.
    expect(prisma.benchCipDimension.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  /**
   * 🚨 THE DIAGNOSIS IS A CLAIM ABOUT THE LIST BESIDE IT, SO IT USES THE LIST'S
   * WINDOW. "Your .30-06 and N550 have 41 loads together" counted over ± 5
   * beside a screen searched at Exact is a number the member cannot reach: they
   * clear their bullets as told and most of those 41 are still not there.
   */
  it('explains an empty screen over the window it actually searched', async () => {
    const prisma = emptyPrisma();
    await new BenchService(prisma as never).loads({ ...fullBench, toleranceGr: 15 }, {});

    const keepingBullets = prisma.benchLoad.count.mock.calls
      .map(([a]) => a.where)
      .filter((w) => w.OR);

    // Two of the three counts keep the bullet axis, and both over ± 15.
    expect(keepingBullets).toHaveLength(2);
    for (const where of keepingBullets) {
      expect(where.OR[0].weightGr).toEqual({ gte: 135, lte: 165 });
    }
  });

  /**
   * ⚠️ AN OLD BENCH STILL COSTS WHAT IT ALWAYS COST, ON THE EMPTY PATH TOO.
   * Benches saved before calibres were recorded carry none, nothing needs a
   * sheet, and explaining an empty screen must not be the thing that starts
   * reading them.
   */
  it('reads no sheet to explain an empty screen for a bench with no calibres', async () => {
    const prisma = emptyPrisma();
    const out = await new BenchService(prisma as never).loads(
      { ...fullBench, bullets: [{ maker: 'Hornady', weightGr: 140, category: 'TIP' }] },
      {},
    );

    expect(out.why).toEqual({ ignoringBullets: 70, ignoringPowders: 13, ignoringCartridges: 41 });
    expect(prisma.benchCipDimension.findMany).not.toHaveBeenCalled();
  });

  it('no count is capped either — take and skip belong nowhere on this module', async () => {
    const prisma = emptyPrisma();
    await new BenchService(prisma as never).loads(fullBench, {});

    for (const [args] of prisma.benchLoad.count.mock.calls) {
      expect(args.take).toBeUndefined();
      expect(args.skip).toBeUndefined();
    }
  });

  /**
   * The leak boundary, on the one payload that did not exist when it was
   * drawn. `why` is three LOAD counts — a fact about a combination, which is
   * ours to publish — and never a count of what those loads were derived from.
   */
  it('the diagnosis carries no manual, and no count of them', async () => {
    const out = await new BenchService(emptyPrisma() as never).loads(fullBench, {});

    expect(out.why).toBeDefined();
    assertNoLeak(out, 'loads/why');
    // By key rather than by value, for the reason the sibling test gives: a
    // bare '7' hides inside 70 as readily as inside 71.76.
    const json = JSON.stringify(out);
    expect(json).not.toContain('sourcesCount');
    expect(json).not.toContain('sources');
  });
});

/**
 * 🚨 A BENCH SAVED UNDER THE OLD MODEL HOLDS DUPLICATES UNDER THIS ONE.
 * "Hornady 150 SP .308" and "Sierra 150 HP .308" were two bullets when the
 * maker was half the identity; they are ONE now. Left as they are, the rail
 * draws two chips both reading `.308" 150 gr` — the member cannot tell which
 * × removes which, and switching one off changes nothing, because the other
 * matches exactly the same loads.
 */
describe('The Bench — one chip per bullet', () => {
  function benchHolding(bullets: unknown[]) {
    const base = makePrisma();
    return makePrisma({
      userBench: {
        ...base.userBench,
        findUnique: jest.fn().mockResolvedValue({
          userId: 'usr_1',
          powderIds: ['pwd_1'],
          cartridgeKeys: ['65creedmoor'],
          bullets,
          units: 'metric',
        }),
      },
    });
  }

  it('folds two stored bullets that are now one, keeping the first', async () => {
    const prisma = benchHolding([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
      { maker: 'Sierra', weightGr: 150, category: 'HP', calibreIn: 0.308 },
      { maker: 'Barnes', weightGr: 150, category: 'MONO', calibreIn: 0.308 },
    ]);

    const out = await new BenchService(prisma as never).getBench('user_2abcCLERKsub');

    // The first survives, decoration and all — it is the one at the position
    // the member is used to seeing, and nothing of theirs is rewritten.
    expect(out.bullets).toEqual([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
    ]);
  });

  /**
   * 🚨 THE CALIBRE STILL TELLS THEM APART. A 150 gr .277 and a 150 gr .308 are
   * different bullets; folding them would be the hazard the calibre work
   * exists to prevent, wearing a tidy-up's clothes.
   */
  it('keeps one weight in two calibres as two bullets', async () => {
    const prisma = benchHolding([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.277 },
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
    ]);

    const out = await new BenchService(prisma as never).getBench('user_2abcCLERKsub');

    expect(out.bullets.map((b) => b.calibreIn)).toEqual([0.277, 0.308]);
  });

  /**
   * ⚠️ AND A BULLET WITH NO CALIBRE IS NOT THE SAME BULLET AS ONE WITH. The
   * calibre-less entry matches ANY calibre, so folding it into the .308 would
   * quietly narrow a shelf the member never touched.
   */
  it('keeps a calibre-less bullet beside a calibred one of the same weight', async () => {
    const prisma = benchHolding([
      { maker: 'Hornady', weightGr: 150, category: 'SP' },
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
    ]);

    const out = await new BenchService(prisma as never).getBench('user_2abcCLERKsub');

    expect(out.bullets).toHaveLength(2);
  });

  it('leaves different weights alone', async () => {
    const prisma = benchHolding([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
      { maker: 'Sierra', weightGr: 168, category: 'HPBT', calibreIn: 0.308 },
    ]);

    const out = await new BenchService(prisma as never).getBench('user_2abcCLERKsub');

    expect(out.bullets.map((b) => b.weightGr)).toEqual([150, 168]);
  });
});

describe('The Bench — the clerk-sub / User.id trap', () => {
  it('resolves the Clerk sub to a User.id before touching UserBench', async () => {
    const prisma = makePrisma();
    const svc = new BenchService(prisma as never);
    await svc.getBench('user_2abcCLERKsub');

    // The sub goes to User.clerkId …
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkId: 'user_2abcCLERKsub' },
      select: { id: true },
    });
    // … and the cuid, never the sub, is what UserBench is keyed on.
    expect(prisma.userBench.findUnique).toHaveBeenCalledWith({ where: { userId: 'usr_1' } });
  });

  it('a log delete is scoped by userId as well as id', async () => {
    const prisma = makePrisma();
    const svc = new BenchService(prisma as never);
    await svc.deleteLog('user_2abcCLERKsub', 'log_9');
    // Without the userId in the where, one member could delete another's row
    // by guessing a cuid.
    expect(prisma.benchLogEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: 'log_9', userId: 'usr_1' },
    });
  });
});

/**
 * 🚨 THE BOUNDARY IS THE CONTROLLER, NOT THE SERVICE, AND EVERY TEST ABOVE
 * STOPS SHORT OF IT. What travels is the HTTP body: what the controller
 * returns, what a `@Res()` route writes, and — the one nobody thinks of — what
 * an exception filter renders when a route throws. `new NotFoundException('the
 * CIP sheet for this manual page is missing')` would sail past every assertion
 * in this file, because no service returns it.
 *
 * So these run the real controller over the real service, on every route, and
 * assert the same six words against the answer AND against the error.
 */
describe('The Bench — nothing leaks through the controller either', () => {
  const SUB = 'user_2abcCLERKsub';

  function wired(prisma = makePrisma()) {
    return { prisma, controller: new BenchController(new BenchService(prisma as never)) };
  }

  /** The body a caller would actually receive, thrown or returned. */
  async function body(run: () => Promise<unknown>): Promise<unknown> {
    try {
      return await run();
    } catch (err) {
      // What the exception filter serialises: Nest renders getResponse(), so
      // that — not the Error's own name — is what reaches the wire.
      return err instanceof HttpException
        ? { status: err.getStatus(), body: err.getResponse() }
        : { unknown: String(err) };
    }
  }

  it.each([
    ['GET /bench/me', (c: BenchController) => c.me(SUB)],
    ['GET /bench/loads', (c: BenchController) => c.loads(SUB, {})],
    ['GET /bench/powders', (c: BenchController) => c.powders(SUB, {})],
    ['GET /bench/bullets', (c: BenchController) => c.bullets()],
    ['GET /bench/cartridges', (c: BenchController) => c.cartridges()],
    ['GET /bench/cartridges/:key', (c: BenchController) => c.cartridge('65creedmoor', SUB, {})],
    ['GET /bench/log', (c: BenchController) => c.log(SUB)],
  ])('%s', async (where, call) => {
    const { controller } = wired();
    assertNoLeak(await body(() => Promise.resolve(call(controller))), where);
  });

  /**
   * ⚠️ THE 404 BODIES, WHICH NO OTHER TEST IN THIS FILE CAN SEE. An error
   * message is written by hand at the moment somebody is thinking about where
   * a figure came from, which is exactly when the forbidden words come out.
   */
  it.each([
    [
      'GET /bench/cartridges/:key — unknown',
      (c: BenchController) => c.cartridge('nosuchthing', SUB, {}),
    ],
    ['GET /bench/share/:token — expired', (c: BenchController) => c.readShare('gone')],
    [
      'PATCH /bench/log/:id — not the caller\u2019s',
      (c: BenchController) => c.patchLog(SUB, 'log_9', { notes: null }),
    ],
  ])('%s', async (where, call) => {
    const prisma = makePrisma({
      benchCartridge: { ...makePrisma().benchCartridge, findUnique: jest.fn().mockResolvedValue(null) },
      benchLogEntry: {
        ...makePrisma().benchLogEntry,
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const { controller } = wired(prisma);

    const out = await body(() => Promise.resolve(call(controller)));
    // Proves the route really did fail — a 200 here would make the assertion
    // below vacuous.
    expect(out).toMatchObject({ status: 404 });
    assertNoLeak(out, where);
  });

  /**
   * ⚠️ THE CSV IS A BODY TOO, AND IT IS THE ONE THAT IS NOT JSON. It goes out
   * through `@Res()`, so nothing above would ever look at it — and it is built
   * by hand from column headings a developer typed.
   */
  it('GET /bench/log.csv', async () => {
    const prisma = makePrisma({
      benchLogEntry: {
        ...makePrisma().benchLogEntry,
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'log_1',
            userId: 'usr_1',
            cartridgeKey: '65creedmoor',
            bulletLabel: 'Hornady ELD Match 140 gr',
            powderName: 'H4350',
            chargeGr: 40.2,
            coalMm: 71.12,
            primer: 'CCI 200',
            caseLabel: 'Lapua',
            loadId: null,
            velocityMs: null,
            groupMm: null,
            notes: 'chrono at 25 C',
            shotAt: new Date('2026-09-05T22:30:00.000Z'),
            createdAt: new Date('2026-09-06T05:00:00.000Z'),
          },
        ]),
      },
    });
    const { controller } = wired(prisma);

    const sent: string[] = [];
    await controller.logCsv(SUB, {
      setHeader: () => undefined,
      send: (v: string) => sent.push(v),
    } as never);

    expect(sent[0]).toContain('H4350');
    assertNoLeak(sent[0], 'log.csv');
  });

  /**
   * The share stores whatever the client hands it, so the check that matters
   * is that what comes BACK is the payload and a link — not, say, an echo of
   * the row with its internals.
   */
  it('POST /bench/share', async () => {
    const { controller } = wired();
    const out = await controller.share(SUB, {
      payload: { cartridge: '65creedmoor', weight: 'gte150' },
    });

    expect(out.token).toHaveLength(22);
    expect(out.url).toBe(`${process.env.FRONTEND_URL ?? 'https://alloutdoor.co.za'}/bench?s=${out.token}`);
    assertNoLeak(out, 'share');
  });

  /**
   * 🚨 THE SHEET'S OWN ANNOTATIONS, WHICH ARE THE HARDEST THING ON THIS
   * BOUNDARY: they have to travel, and some of them may not.
   */
  it('keeps the tolerances that are measurements and drops the ones that are citations', async () => {
    const { controller } = wired();
    const out = (await controller.cartridge('65creedmoor', SUB, {})) as {
      dims: { tolerances: Record<string, string>; footnotes: Record<string, string> | null };
    };

    // The measurements survive …
    expect(out.dims.tolerances).toEqual({ L1: '-0.20', P1: '-0.10' });
    // … the two that name where they came from do not, and neither takes the
    // others with it.
    expect(out.dims.footnotes).toEqual({ P1: '*' });
    assertNoLeak(out, 'cartridge/annotations');
  });

  it('drops the fields that describe the sheet rather than the cartridge', async () => {
    const { controller } = wired();
    const out = (await controller.cartridge('65creedmoor', SUB, {})) as {
      dims: Record<string, unknown>;
    };

    for (const audit of ['rawText', 'tab', 'sheetDate', 'revision', 'imageOnly']) {
      expect(Object.prototype.hasOwnProperty.call(out.dims, audit)).toBe(false);
    }
    // And the measurements are all still there.
    expect(out.dims.L6).toBe(71.76);
  });
});
