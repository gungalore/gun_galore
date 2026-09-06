import { BenchService } from './bench.service';

/**
 * THE BENCH — the results list itself: how much of it comes back, and in what
 * order.
 *
 * 🚨 THIS LIST IS THE ONE THING ON THE MODULE THAT MAY BE CUT, AND ONLY
 * BECAUSE IT SAYS SO. Every other list is filtered in the browser, so a silent
 * cap makes a real powder unfindable — bench.leak.spec.ts holds that line. The
 * results are different: every control re-queries, and an unbounded findMany
 * with a nested cartridge per row will drag five figures of rows across the
 * wire for one loose shelf. So it takes a cap AND tells the client it did.
 */

const CAP = 600;

const SHELF = {
  powderIds: ['pwd_1'],
  cartridgeKeys: ['65creedmoor'],
  bullets: [{ weightGr: 140 }],
};

function row(i: number) {
  return {
    id: `load_${String(i).padStart(4, '0')}`,
    cartridgeKey: '65creedmoor',
    bulletMaker: 'Hornady',
    bulletType: 'ELD Match',
    weightGr: 140,
    startGr: 35.6,
    startFps: 2400,
    maxGr: 41.5,
    maxFps: 2700,
    coalMm: 71.12,
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
  };
}

/** A double that honours `take`, because `take` is what is under test. */
function makePrisma(total: number) {
  const all = Array.from({ length: total }, (_, i) => row(i));
  return {
    benchLoad: {
      findMany: jest.fn((args: { take?: number; orderBy?: unknown }) =>
        Promise.resolve(args.take ? all.slice(0, args.take) : all),
      ),
      count: jest.fn().mockResolvedValue(0),
    },
    benchCipDimension: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('The Bench — the results list is capped, and says so', () => {
  it('says nothing about truncation on an answer that fits', async () => {
    const out = await new BenchService(makePrisma(12) as never).loads(SHELF, {});

    expect(out.count).toBe(12);
    // ⚠️ ABSENT, NOT PRESENT-AND-FALSE. A key that exists still passes
    // `'truncated' in result`, and "the list was cut" must not be true of a
    // screen showing everything.
    expect(Object.prototype.hasOwnProperty.call(out, 'truncated')).toBe(false);
  });

  it('cuts at the cap and flags it', async () => {
    const out = await new BenchService(makePrisma(5_000) as never).loads(SHELF, {});

    expect(out.count).toBe(CAP);
    expect(out.truncated).toBe(true);
    // `count` is what came BACK, not what matched: a count of the whole match
    // costs a second query to tell the member a number they cannot act on.
    expect(out.groups[0].weights[0].rows).toHaveLength(CAP);
  });

  /**
   * ⚠️ ONE MORE THAN THE CAP IS ASKED FOR, WHICH IS THE ONLY WAY TO TELL
   * "exactly 600" FROM "thousands". Asking for exactly 600 and flagging on a
   * full page would call a 600-row answer truncated when it is complete.
   */
  it('asks for one row past the cap and does not report a full page as cut', async () => {
    const prisma = makePrisma(CAP);
    const out = await new BenchService(prisma as never).loads(SHELF, {});

    expect(prisma.benchLoad.findMany.mock.calls[0][0].take).toBe(CAP + 1);
    expect(out.count).toBe(CAP);
    expect(Object.prototype.hasOwnProperty.call(out, 'truncated')).toBe(false);
  });

  /**
   * 🚨 A CAP MAKES THE DATABASE ORDER LOAD-BEARING. Ordered by weight alone,
   * WHICH 600 of several thousand rows come back is decided by whatever order
   * Postgres happens to produce — so the same search cuts a different set on
   * every refresh, and a row the member saw a moment ago is gone.
   */
  it('orders the query totally, not just by weight', async () => {
    const prisma = makePrisma(10);
    await new BenchService(prisma as never).loads(SHELF, {});

    expect(prisma.benchLoad.findMany.mock.calls[0][0].orderBy).toEqual([
      { weightGr: 'asc' },
      { cartridgeKey: 'asc' },
      { id: 'asc' },
    ]);
  });
});

/**
 * ⚠️ AND THE ORDER THE MEMBER SEES IS TOTAL TOO. One powder at one weight in
 * one cartridge is several rows — a Hornady, a Sierra, a Barnes — so sorting
 * on the powder name alone leaves them in whatever order the query produced,
 * and they visibly swap places between one search and the next in a list
 * somebody is scanning by eye.
 */
describe('The Bench — rows sort the same way twice', () => {
  function shuffledPrisma() {
    const rows = [
      { ...row(1), id: 'z', powder: { name: 'H4350' }, bulletMaker: 'Sierra' },
      { ...row(2), id: 'a', powder: { name: 'H4350' }, bulletMaker: 'Sierra' },
      { ...row(3), id: 'm', powder: { name: 'H4350' }, bulletMaker: 'Barnes' },
      { ...row(4), id: 'q', powder: { name: 'Varget' }, bulletMaker: 'Hornady' },
    ];
    return {
      benchLoad: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(0),
      },
      benchCipDimension: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }

  it('breaks a tied powder name on the maker, then on the id', async () => {
    const out = await new BenchService(shuffledPrisma() as never).loads(SHELF, {});
    const rows = out.groups[0].weights[0].rows;

    expect(rows.map((r) => `${r.powder}/${r.bulletMaker}/${r.id}`)).toEqual([
      'H4350/Barnes/m',
      'H4350/Sierra/a',
      'H4350/Sierra/z',
      'Varget/Hornady/q',
    ]);
  });
});
