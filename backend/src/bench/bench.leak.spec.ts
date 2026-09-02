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
      findMany: jest.fn().mockResolvedValue([{ id: 'pwd_1', name: 'H4350', maker: 'Hodgdon' }]),
    },
    benchCartridge: {
      findMany: jest.fn().mockResolvedValue([{ key: '65creedmoor', name: '6,5 Creedmoor' }]),
      findUnique: jest.fn().mockResolvedValue({
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
      groupBy: jest.fn().mockResolvedValue([{ powderId: 'pwd_1', _count: { _all: 4 } }]),
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
