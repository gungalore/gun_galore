import { BenchService } from './bench.service';

/**
 * THE BENCH — the spec card, the un-synced member, and the catalogue cache.
 *
 * Three things the finder's own spec does not cover: the figures the card
 * prints, what a signed-in caller with no local row sees, and what may be held
 * in memory between two requests.
 */

function cardRow() {
  return {
    key: '65creedmoor',
    name: '6,5 Creedmoor',
    slug: '6-5-creedmoor',
    type: '1 rimless',
    origin: 'USA',
    year: 2007,
    caseLengthMm: 48.77,
    maxLengthMm: 71.76,
    pmaxPsi: 63092,
    // The derived figure: round(63092 / 14.5038).
    pmaxBar: 4350,
    dims: { R1: 11.95, R: 1.37, E1: 10.5, L6: 71.76, pmaxBar: 4351 },
  };
}

function cardPrisma(cartridge: Record<string, unknown> = cardRow(), over: Record<string, unknown> = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'usr_1' }) },
    benchCartridge: {
      findUnique: jest.fn().mockResolvedValue(cartridge),
      findMany: jest.fn().mockResolvedValue([]),
    },
    benchCipDimension: { findMany: jest.fn().mockResolvedValue([]) },
    benchLoad: { count: jest.fn().mockResolvedValue(761), findMany: jest.fn() },
    ...over,
  };
}

describe('The Bench — Pmax is the figure that was stated, not our conversion of it', () => {
  /**
   * 🚨 `BenchCartridge.pmaxBar` IS `round(pmaxPsi / 14.5038)` — a number we
   * computed. The dimension sheet carries a bar figure of its own, and the
   * schema's own comment forbids showing a converted value in a reloading
   * context where the stated one exists. They differ by a bar or two, which is
   * harmless and still wrong to print as though it were the standard.
   */
  it('prefers the sheet’s own bar figure', async () => {
    const out = await new BenchService(cardPrisma() as never).cartridge('65creedmoor', null);

    expect(out.cartridge.pmaxBar).toBe(4351);
    expect(out.cartridge.pmaxBarDerived).toBe(false);
    // psi is untouched: it is the reference file's own figure either way.
    expect(out.cartridge.pmaxPsi).toBe(63092);
  });

  it('falls back to the conversion and says that is what it is', async () => {
    const prisma = cardPrisma({
      ...cardRow(),
      dims: { R1: 11.95, R: 1.37, E1: 10.5, L6: 71.76 },
    });

    const out = await new BenchService(prisma as never).cartridge('65creedmoor', null);

    expect(out.cartridge.pmaxBar).toBe(4350);
    // The client may soften how it renders it. It may not say where either
    // figure came from — that is the module's copy rule.
    expect(out.cartridge.pmaxBarDerived).toBe(true);
  });

  it('leaves a cartridge with no sheet at all with its converted figure', async () => {
    const prisma = cardPrisma({ ...cardRow(), dims: null });

    const out = await new BenchService(prisma as never).cartridge('65creedmoor', null);

    expect(out.cartridge.pmaxBar).toBe(4350);
    expect(out.dims).toBeNull();
  });
});

/**
 * ⚠️ THE .473 INCH HEAD FAMILY RUNS TO DOZENS. A card that lists every one
 * buries the sections under it — but nothing here is filtered in the browser,
 * so the cut has to be declared rather than silent, the same rule the results
 * list follows.
 */
describe('The Bench — the shell-holder chips are capped and counted', () => {
  function familyOf(n: number) {
    const near = Array.from({ length: n }, (_, i) => ({ cartridgeKey: `c${i}` }));
    const rows = near.map((c, i) => ({ key: c.cartridgeKey, name: `Cartridge ${i}` }));
    return cardPrisma(cardRow(), {
      benchCipDimension: { findMany: jest.fn().mockResolvedValue(near) },
      benchCartridge: {
        findUnique: jest.fn().mockResolvedValue(cardRow()),
        findMany: jest.fn().mockResolvedValue(rows),
      },
    });
  }

  it('shows a short family whole and counts nothing more', async () => {
    const out = await new BenchService(familyOf(5) as never).cartridge('65creedmoor', null);

    expect(out.shellHolderGroup).toHaveLength(5);
    expect(out.shellHolderMore).toBe(0);
  });

  it('caps a long one at twelve and says how many are behind it', async () => {
    const out = await new BenchService(familyOf(31) as never).cartridge('65creedmoor', null);

    expect(out.shellHolderGroup).toHaveLength(12);
    expect(out.shellHolderMore).toBe(19);
  });
});

/**
 * 🚨 A SIGNED-IN CALLER WITH NO `User` ROW IS AN EMPTY SHELF, NOT A 404.
 * ClerkGuard lazily provisions the row but refuses to create one for a Clerk
 * user with no email, so this really happens — and every read on the module
 * goes through getBench(), so a 404 would empty the results, the powder chips
 * AND the spec card at once for somebody whose only problem is that they have
 * not saved a shelf yet.
 */
describe('The Bench — a member we have not synced yet', () => {
  it('reads as an empty bench', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      userBench: { findUnique: jest.fn() },
    };

    const out = await new BenchService(prisma as never).getBench('user_notsyncedyet');

    expect(out).toEqual({ powders: [], bullets: [], cartridges: [], units: 'metric' });
    // And no shelf is looked up under a userId we do not have.
    expect(prisma.userBench.findUnique).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ THE WRITES STILL REFUSE. Without a User row the bench has nowhere to be
   * stored — the foreign key added by 20260906120000_bench_audit would refuse
   * it anyway — and silently accepting a save that stores nothing is worse
   * than an error.
   */
  it.each([
    [
      'a bench save',
      (s: BenchService) =>
        s.putBench('user_notsyncedyet', {
          powderIds: [],
          bullets: [],
          cartridgeKeys: [],
          units: 'metric',
        }),
    ],
    ['a log read', (s: BenchService) => s.log('user_notsyncedyet')],
  ])('refuses %s', async (_name, run) => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      userBench: { upsert: jest.fn() },
      benchLogEntry: { findMany: jest.fn() },
    };

    await expect(run(new BenchService(prisma as never))).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * ⚠️ ONLY WHAT IS THE SAME FOR EVERY VIEWER. The pickers' aggregates are facts
 * about the imported catalogue; nothing bench-relative may ever be held, or
 * one member's answer is served to the next — CLAUDE.md's viewer-varying rule.
 */
describe('The Bench — the catalogue aggregates are cached', () => {
  function pickerPrisma() {
    return {
      benchLoad: {
        groupBy: jest.fn((args: { by: string[] }) =>
          Promise.resolve(
            args.by.includes('weightGr')
              ? [{ cartridgeKey: '65creedmoor', weightGr: 140, _count: { _all: 6 } }]
              : [{ cartridgeKey: '65creedmoor', _count: { _all: 9 } }],
          ),
        ),
      },
      benchCipDimension: { findMany: jest.fn().mockResolvedValue([]) },
      benchCartridge: {
        findMany: jest.fn().mockResolvedValue([{ key: '65creedmoor', name: '6,5 Creedmoor' }]),
      },
      benchPowder: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pwd_1', name: 'H4350', maker: 'Hodgdon' }]),
      },
    };
  }

  it('asks once however many times the picker is opened', async () => {
    const prisma = pickerPrisma();
    const svc = new BenchService(prisma as never);

    const first = await svc.bullets();
    expect(await svc.bullets()).toEqual(first);
    await svc.cartridgeList();
    await svc.cartridgeList();
    await svc.powders(undefined, null);
    await svc.powders(undefined, null);

    // One group-by per question, not one per open.
    expect(prisma.benchLoad.groupBy).toHaveBeenCalledTimes(2);
    expect(prisma.benchPowder.findMany).toHaveBeenCalledTimes(1);
  });

  it('does not cache a search, which would key on whatever anybody types', async () => {
    const prisma = pickerPrisma();
    const svc = new BenchService(prisma as never);

    await svc.powders('var', null);
    await svc.powders('var', null);

    expect(prisma.benchPowder.findMany).toHaveBeenCalledTimes(2);
  });

  /**
   * ⚠️ A SECOND SERVICE GETS A COLD CACHE. Nest holds one instance, so the
   * cache is process-wide in production — but a module-level Map would let one
   * test's fixture answer another's, which is a whole class of ghost failure.
   */
  it('is per-instance, so a fresh service reads afresh', async () => {
    const prisma = pickerPrisma();
    await new BenchService(prisma as never).cartridgeList();
    await new BenchService(prisma as never).cartridgeList();

    expect(prisma.benchCartridge.findMany).toHaveBeenCalledTimes(2);
  });

  it('does not hold on to a failure', async () => {
    const prisma = pickerPrisma();
    prisma.benchCartridge.findMany.mockRejectedValueOnce(new Error('down'));
    const svc = new BenchService(prisma as never);

    await expect(svc.cartridgeList()).rejects.toThrow('down');
    // A cached rejection would outlive the outage that caused it.
    await expect(svc.cartridgeList()).resolves.toEqual([
      { key: '65creedmoor', name: '6,5 Creedmoor', loads: 9 },
    ]);
  });
});
