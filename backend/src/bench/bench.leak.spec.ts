import { BenchService } from './bench.service';

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
        dims: {
          cartridgeKey: '65creedmoor',
          L3: 48.77,
          L6: 71.76,
          // the audit field, which must be stripped
          rawText: 'C.I.P. TDCC sheet — 6,5 Creedmoor, published 2019, page 3',
        },
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
        // ⚠️ bulletMaker IS TESTED FIRST AND MUST STAY FIRST. The bullet
        // groupBy now carries cartridgeKey too — the calibre lives on the
        // cartridge — so the cartridge-list branch below would swallow it if
        // the order were reversed, and bullets() would silently receive the
        // cartridge counts.
        if (by.includes('bulletMaker')) {
          // Deliberately out of order: Sierra's 9 must come back above
          // Hornady's 6, so the ordering is proven rather than inherited.
          return Promise.resolve([
            { bulletMaker: 'Hornady', weightGr: 140, bulletCategory: 'TIP', cartridgeKey: '65creedmoor', _count: { _all: 6 }, ...DIRT },
            { bulletMaker: 'Sierra', weightGr: 120, bulletCategory: 'HP', cartridgeKey: '65creedmoor', _count: { _all: 9 }, ...DIRT },
            // 🚨 ONE MAKER, ONE WEIGHT, ONE CATEGORY — THREE PROJECTILES.
            // .277 for the .270 Win, .308 for the .308 Win, and the .300 H&H's
            // .308 which is the same bullet as the .308 Win's.
            { bulletMaker: 'Hornady', weightGr: 150, bulletCategory: 'SP', cartridgeKey: '270win', _count: { _all: 4 }, ...DIRT },
            { bulletMaker: 'Hornady', weightGr: 150, bulletCategory: 'SP', cartridgeKey: '308win', _count: { _all: 5 }, ...DIRT },
            { bulletMaker: 'Hornady', weightGr: 150, bulletCategory: 'SP', cartridgeKey: '300hh', _count: { _all: 3 }, ...DIRT },
            // No sheet at all — five of the 177 cartridges have none. Still a
            // load a member can build, so still a row.
            { bulletMaker: 'Speer', weightGr: 180, bulletCategory: 'SP', cartridgeKey: 'nosheet', _count: { _all: 2 }, ...DIRT },
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
      deleteMany: jest.fn(),
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
  it('bullets are the distinct maker+weight+category+calibre rows, most loads first, and carry nothing else', async () => {
    const svc = new BenchService(makePrisma() as never);

    // toEqual on the whole array rather than a key-by-key check: an extra
    // field rides along unnoticed under a per-field assertion, and
    // `sourcesCount` is exactly the kind of field that would.
    expect(await svc.bullets()).toEqual([
      { maker: 'Sierra', weightGr: 120, category: 'HP', calibreIn: 0.264, loads: 9 },
      // .308 Win's 5 and .300 H&H's 3 are the same bullet, so they sum.
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308, loads: 8 },
      { maker: 'Hornady', weightGr: 140, category: 'TIP', calibreIn: 0.264, loads: 6 },
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.277, loads: 4 },
      // No sheet, so no calibre — and still offered, because the bullet is
      // still loadable.
      { maker: 'Speer', weightGr: 180, category: 'SP', calibreIn: null, loads: 2 },
    ]);
  });

  /**
   * 🚨 THE WHOLE POINT. A member with .270 Win and .308 Win on the bench and
   * one "Hornady 150gr SP" entry was shown loads for both and told they could
   * build them. A .277 bullet in a .308 case will not chamber; the other way
   * round it chambers and spikes pressure.
   */
  it('a .277 and a .308 of one maker, weight and category are two rows and never one', async () => {
    const rows = await new BenchService(makePrisma() as never).bullets();
    const sp150 = rows.filter(
      (r) => r.maker === 'Hornady' && r.weightGr === 150 && r.category === 'SP',
    );

    expect(sp150).toHaveLength(2);
    // Two calibres, and neither of them a blend of the two.
    expect(new Set(sp150.map((r) => r.calibreIn))).toEqual(new Set([0.277, 0.308]));

    // ⚠️ NO ROW MAY EVER HOLD TWO CALIBRES. Asserted across the whole list
    // rather than on this pair alone: the failure mode is a fold that reaches
    // one row too far, and it would show up on whichever pair happens to be
    // adjacent.
    const seen = new Set<string>();
    for (const r of rows) {
      const identity = `${r.maker}|${r.weightGr}|${r.category}|${r.calibreIn}`;
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
    assertNoLeak(rows, 'bullets/calibre');
  });

  it('an unnamed bullet maker is never offered', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).bullets();
    // A blank maker draws a row nothing a member types can match.
    expect(prisma.benchLoad.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bulletMaker: { not: '' } } }),
    );
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
    // ⚠️ AND THE RESULTS THEMSELVES. The screen filters them by weight and by
    // which bench entries are switched off, all in the browser, so a cap here
    // would hide loads a member can build from a shelf they are looking at.
    await svc.loads(
      {
        powderIds: ['pwd_1'],
        cartridgeKeys: ['65creedmoor'],
        bullets: [{ maker: 'Hornady', weightGr: 140, category: 'TIP' }],
      },
      {},
    );

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
      { ...shelf, bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 }] },
      {},
    );

    expect(bulletClauses(prisma)).toEqual([
      {
        bulletMaker: 'Hornady',
        weightGr: 150,
        bulletCategory: 'SP',
        // .308 Win and .300 H&H publish maxima a thou apart and take the same
        // bullet, so both are in. .270 Win is three thou away and is not.
        cartridgeKey: { in: ['308win', '300hh'] },
      },
    ]);
  });

  it('pins a .277 bullet to the .270, which is the pair that started this', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).loads(
      { ...shelf, bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.277 }] },
      {},
    );

    expect(bulletClauses(prisma)[0]).toMatchObject({ cartridgeKey: { in: ['270win'] } });
  });

  it('matches nothing when no cartridge on the shelf takes that bullet', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).loads(
      // 8x57 IS is .323. Nothing on this shelf is.
      { ...shelf, bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.323 }] },
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
      { ...shelf, bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 }] },
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
      // No cartridgeKey on the branch at all — the clause it had before.
      { bulletMaker: 'Hornady', weightGr: 140, bulletCategory: 'TIP' },
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
          { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.277 },
        ],
      },
      {},
    );

    // One shelf, two eras, and the branches are independent — a mixed bench is
    // the normal case the day this ships.
    expect(bulletClauses(prisma)).toEqual([
      { bulletMaker: 'Hornady', weightGr: 140, bulletCategory: 'TIP' },
      {
        bulletMaker: 'Hornady',
        weightGr: 150,
        bulletCategory: 'SP',
        cartridgeKey: { in: ['270win'] },
      },
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
    bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 }],
  };

  it('counts a powder against the calibre the results will honour', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).powders(undefined, shelfWith308);

    const groupBy = prisma.benchLoad.groupBy.mock.calls
      .map(([args]) => args as { by: string[]; where?: { OR?: unknown[] } })
      .find((a) => a.by.includes('powderId'));

    // The .270 is on this shelf and must not be counted: the bullet is a .308.
    expect(groupBy?.where?.OR).toEqual([
      {
        bulletMaker: 'Hornady',
        weightGr: 150,
        bulletCategory: 'SP',
        cartridgeKey: { in: ['308win', '300hh'] },
      },
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
    bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 }],
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
        bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 }],
      },
      {},
    );

    const wheres = prisma.benchLoad.count.mock.calls.map(([a]) => a.where);

    // Powders relaxed: the shelf's cartridges stand, so the .308 bullet is
    // pinned to the .308 one and the .270 beside it is out.
    const keepingShelf = wheres.find((w) => w.OR && w.cartridgeKey);
    expect(keepingShelf.OR).toEqual([
      {
        bulletMaker: 'Hornady',
        weightGr: 150,
        bulletCategory: 'SP',
        cartridgeKey: { in: ['308win'] },
      },
    ]);

    // ⚠️ CARTRIDGES RELAXED MEANS ANY CARTRIDGE OF THAT CALIBRE, NOT ANY
    // CARTRIDGE. .300 H&H joins — it takes the same .308 bullet — and the .270
    // still does not, on this shelf or off it. Rebuilt against every sheet
    // rather than reused from the main query, which had resolved it against
    // the shelf and would answer "none anywhere" for a bullet with thousands.
    const anyCartridge = wheres.find((w) => w.OR && !w.cartridgeKey);
    expect(anyCartridge.OR).toEqual([
      {
        bulletMaker: 'Hornady',
        weightGr: 150,
        bulletCategory: 'SP',
        cartridgeKey: { in: ['308win', '300hh'] },
      },
    ]);

    // The widened lookup reads every sheet — `where: undefined`, not an empty
    // `in`, which would pin the bullet to nothing and answer 0 for every
    // bullet in the catalogue.
    expect(prisma.benchCipDimension.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
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
