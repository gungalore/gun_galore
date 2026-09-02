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
        if (by.includes('bulletMaker')) {
          // Deliberately out of order: Sierra's 9 must come back above
          // Hornady's 6, so the ordering is proven rather than inherited.
          return Promise.resolve([
            { bulletMaker: 'Hornady', weightGr: 140, bulletCategory: 'TIP', _count: { _all: 6 }, ...DIRT },
            { bulletMaker: 'Sierra', weightGr: 120, bulletCategory: 'HP', _count: { _all: 9 }, ...DIRT },
          ]);
        }
        if (by.includes('cartridgeKey')) {
          return Promise.resolve([{ cartridgeKey: '65creedmoor', _count: { _all: 9 }, ...DIRT }]);
        }
        return Promise.resolve([{ powderId: 'pwd_1', _count: { _all: 4 } }]);
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
  it('bullets are the distinct triples, most loads first, and carry nothing else', async () => {
    const svc = new BenchService(makePrisma() as never);

    // toEqual on the whole array rather than a key-by-key check: an extra
    // field rides along unnoticed under a per-field assertion, and
    // `sourcesCount` is exactly the kind of field that would.
    expect(await svc.bullets()).toEqual([
      { maker: 'Sierra', weightGr: 120, category: 'HP', loads: 9 },
      { maker: 'Hornady', weightGr: 140, category: 'TIP', loads: 6 },
    ]);
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

    // The regression this guards is live history: the powder list was capped
    // at 300 with 305 imported, the picker filters in the browser, and five
    // powders became unreachable however they were spelled. ~1139 bullets and
    // ~165 cartridges make that mistake far cheaper to repeat here.
    const calls = [
      ...prisma.benchLoad.groupBy.mock.calls,
      ...prisma.benchCartridge.findMany.mock.calls,
      ...prisma.benchPowder.findMany.mock.calls,
      ...prisma.benchLogEntry.findMany.mock.calls,
    ];
    expect(calls.length).toBeGreaterThan(0);
    for (const [args] of calls) {
      expect(args.take).toBeUndefined();
      expect(args.skip).toBeUndefined();
    }
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
