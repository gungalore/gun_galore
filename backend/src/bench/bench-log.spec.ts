import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BenchService } from './bench.service';
import { AddLogDto, PatchLogDto, parseShotAt } from './bench.dto';
import { coalFlags, logFlags } from './bench.types';

/**
 * THE BENCH — the load log.
 *
 * 🚨 THIS IS THE ONE LIST ON THE MODULE THAT IS THE MEMBER'S OWN RECORD. Every
 * other screen can be re-derived from the catalogue; this cannot. It went live
 * printing `0 m/s`, `0 mm` and `0.00 mm` on every entry ever saved — the
 * sheet always posts velocity and group as null, and the server tested
 * `=== undefined` and then ran `Number(null)`, which is 0. Their CSV said the
 * same. Nothing errored, nothing was logged, and a reloader reading it back
 * would see a chronograph reading they never took.
 */

const SUB = 'user_2abcCLERKsub';

/** A row as the table stores it. */
function entry(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'log_1',
    userId: 'usr_1',
    cartridgeKey: '65creedmoor',
    bulletLabel: 'Hornady ELD Match 140 gr',
    powderName: 'H4350',
    chargeGr: 40.2,
    coalMm: 71.12,
    primer: 'CCI 200',
    caseLabel: 'Lapua',
    loadId: null as string | null,
    velocityMs: null as number | null,
    groupMm: null as number | null,
    notes: null as string | null,
    shotAt: new Date('2026-09-01T09:00:00.000Z'),
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    ...over,
  };
}

function makePrisma(rows: ReturnType<typeof entry>[] = [], over: Record<string, unknown> = {}) {
  // A tiny store, because addLog() reads the row back through log() so the
  // caller gets the list's own shape — flags and all. A findMany that ignored
  // the create would make every write test throw "Unknown log entry".
  const stored = [...rows];
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'usr_1' }) },
    benchLogEntry: {
      findMany: jest.fn((_args: { where?: unknown; orderBy?: unknown }) =>
        Promise.resolve([...stored]),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...entry(),
          id: 'log_new',
          createdAt: new Date(),
          shotAt: new Date(),
          ...data,
        };
        stored.push(row as ReturnType<typeof entry>);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
    },
    benchCartridge: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { key: '65creedmoor', name: '6,5 Creedmoor', maxLengthMm: 71.76 },
        ]),
      findUnique: jest.fn().mockResolvedValue({ key: '65creedmoor' }),
    },
    benchLoad: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'load_1', startGr: 35.6, maxGr: 41.5 }]),
      findUnique: jest.fn().mockResolvedValue({ id: 'load_1' }),
    },
    ...over,
  };
}

/** The global ValidationPipe's own settings — see main.ts. */
async function validateBody(cls: typeof AddLogDto | typeof PatchLogDto, body: unknown) {
  const dto = plainToInstance(cls, body, { enableImplicitConversion: true });
  const errors = await validate(dto as object, { whitelist: true });
  return { dto: dto as Record<string, unknown>, failed: errors.map((e) => e.property).sort() };
}

describe('The Bench — a missing measurement is null, never zero', () => {
  it('stores the nulls the sheet actually posts', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).addLog(SUB, {
      cartridgeKey: '65creedmoor',
      bulletLabel: 'Hornady ELD Match 140 gr',
      powderName: 'H4350',
      chargeGr: 40.2,
      // Exactly what LogSheet.submit() sends: the range figures are not known
      // at the bench, and the sheet's own footer says so.
      coalMm: null,
      velocityMs: null,
      groupMm: null,
      notes: null,
    });

    const { data } = prisma.benchLogEntry.create.mock.calls[0][0];
    // ⚠️ null, NOT 0. `Number(null)` is 0, and 0 m/s is a reading — it is the
    // reading "this load did not move the bullet".
    expect(data).toMatchObject({ coalMm: null, velocityMs: null, groupMm: null, notes: null });
  });

  /**
   * ⚠️ THE SAME SHAPE THE LIST RETURNS. An entry inserted optimistically from
   * a bare create response would be the one row on the screen with no flags —
   * and the sheet had just warned about the charge while they typed it.
   */
  it('answers with the row in the list’s own shape, flags and window included', async () => {
    const prisma = makePrisma();
    const out = await new BenchService(prisma as never).addLog(SUB, {
      cartridgeKey: '65creedmoor',
      bulletLabel: 'x',
      powderName: 'H4350',
      chargeGr: 43.0,
      loadId: 'load_1',
    });

    expect(out).toMatchObject({
      cartridgeName: '6,5 Creedmoor',
      startGr: 35.6,
      maxGr: 41.5,
      flags: ['ABOVE_MAX'],
    });
    expect(Object.prototype.hasOwnProperty.call(out, 'userId')).toBe(false);
  });

  it('keeps a real zero, because a zero group is a thing a member can shoot', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).addLog(SUB, {
      cartridgeKey: '65creedmoor',
      bulletLabel: 'x',
      powderName: 'H4350',
      chargeGr: 40.2,
      groupMm: 0,
    });

    expect(prisma.benchLogEntry.create.mock.calls[0][0].data.groupMm).toBe(0);
  });

  it('treats a blank primer or note as absent rather than as an empty string', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).addLog(SUB, {
      cartridgeKey: '65creedmoor',
      bulletLabel: 'x',
      powderName: 'H4350',
      chargeGr: 40.2,
      primer: '   ',
      notes: '',
    });

    expect(prisma.benchLogEntry.create.mock.calls[0][0].data).toMatchObject({
      primer: null,
      notes: null,
    });
  });
});

/**
 * 🚨 THE ONE FIGURE THAT CANNOT BE ABSENT. `POST /bench/log` took
 * `Record<string, unknown>`, which the global ValidationPipe skips entirely —
 * so `chargeGr: "abc"` became NaN and died inside Prisma as a 500, and 0 gr
 * was stored as a load somebody fired.
 */
describe('The Bench — the log sheet is validated at the door', () => {
  const good = {
    cartridgeKey: '65creedmoor',
    bulletLabel: 'Hornady ELD Match 140 gr',
    powderName: 'H4350',
    chargeGr: 40.2,
  };

  it('accepts the body the sheet sends', async () => {
    const { failed } = await validateBody(AddLogDto, {
      ...good,
      coalMm: 71.12,
      primer: 'CCI 200',
      caseLabel: 'Lapua',
      loadId: 'load_1',
      velocityMs: null,
      groupMm: null,
      notes: null,
      shotAt: '2026-09-06',
    });
    expect(failed).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -3],
    ['not a number', 'abc'],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['absurd', 2001],
    ['null', null],
  ])('rejects a %s charge', async (_name, chargeGr) => {
    const { failed } = await validateBody(AddLogDto, { ...good, chargeGr });
    expect(failed).toContain('chargeGr');
  });

  it('reads a charge typed as a string, the way the pipe converts it', async () => {
    // enableImplicitConversion is on globally, so "35.6" arriving from a form
    // is a number by the time the constraint runs. Pinned because the
    // rejection tests above would otherwise look like they reject any string.
    const { failed, dto } = await validateBody(AddLogDto, { ...good, chargeGr: '35.6' });
    expect(failed).toEqual([]);
    expect(dto.chargeGr).toBe(35.6);
  });

  it('bounds the free text rather than trusting the body limit', async () => {
    const { failed } = await validateBody(AddLogDto, {
      ...good,
      notes: 'x'.repeat(2001),
      bulletLabel: 'y'.repeat(121),
    });
    expect(failed).toEqual(['bulletLabel', 'notes']);
  });

  it('strips a field nobody declared instead of storing it', async () => {
    const { dto } = await validateBody(AddLogDto, { ...good, userId: 'usr_someone_else' });
    // whitelist: true. Without a DTO at all this reached the service, which is
    // how `userId` in a body would once have been worth trying.
    expect(dto.userId).toBeUndefined();
  });

  it.each([
    ['a bare calendar date', '2026-09-06'],
    ['a full ISO instant', '2026-09-06T14:30:00.000Z'],
  ])('accepts %s', async (_name, shotAt) => {
    const { failed } = await validateBody(AddLogDto, { ...good, shotAt });
    expect(failed).toEqual([]);
  });

  it.each([
    ['a nonsense calendar date', '2026-13-45'],
    ['a year in the far future', '2099-01-01'],
    ['a year before this site existed', '1999-01-01'],
    ['free text', 'last Saturday'],
    ['a number', 20260906],
  ])('rejects %s', async (_name, shotAt) => {
    const { failed } = await validateBody(AddLogDto, { ...good, shotAt });
    expect(failed).toContain('shotAt');
  });

  /**
   * ⚠️ TOMORROW IS ALLOWED AND THE DAY AFTER IS NOT. Every member of this site
   * is two hours ahead of UTC, so for two hours of every day "today" in
   * Johannesburg is already tomorrow in the instant we compare against.
   */
  it('allows a day ahead and stops at two', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(parseShotAt(new Date(Date.now() + day / 2).toISOString())).not.toBeNull();
    expect(parseShotAt(new Date(Date.now() + 2 * day).toISOString())).toBeNull();
  });

  it('patches only the three figures learned at the range', async () => {
    const { dto, failed } = await validateBody(PatchLogDto, {
      velocityMs: 812,
      groupMm: 24.5,
      notes: 'third shot pulled',
      // The components are what they LOADED; changing those rewrites the
      // record of a round that was fired.
      chargeGr: 99,
      cartridgeKey: '308win',
    });
    expect(failed).toEqual([]);
    expect(dto.chargeGr).toBeUndefined();
    expect(dto.cartridgeKey).toBeUndefined();
  });
});

describe('The Bench — a log entry points at something that exists', () => {
  const good = {
    cartridgeKey: '65creedmoor',
    bulletLabel: 'x',
    powderName: 'H4350',
    chargeGr: 40.2,
  };

  it('refuses an unknown cartridge rather than storing an entry with no name', async () => {
    const prisma = makePrisma();
    prisma.benchCartridge.findUnique.mockResolvedValue(null);

    await expect(
      new BenchService(prisma as never).addLog(SUB, { ...good, cartridgeKey: 'nosuchthing' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.benchLogEntry.create).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ A DANGLING loadId IS WORSE THAN A MISSING ONE. The list judges the
   * charge against the load's start–max window; a pointer at nothing produces
   * an entry with no window and therefore no ABOVE MAX flag, which reads
   * exactly like a charge that is fine.
   */
  it('refuses an unknown load', async () => {
    const prisma = makePrisma();
    prisma.benchLoad.findUnique.mockResolvedValue(null);

    await expect(
      new BenchService(prisma as never).addLog(SUB, { ...good, loadId: 'load_gone' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('The Bench — the log reads back in the order it was fired', () => {
  it('orders by the date the member set, then by when they typed it', async () => {
    const prisma = makePrisma([]);
    await new BenchService(prisma as never).log(SUB);

    // 🚨 shotAt FIRST. The sheet offers a date and honours it, so an entry
    // back-dated to last weekend sorted to the TOP of the list above
    // everything shot since.
    expect(prisma.benchLogEntry.findMany.mock.calls[0][0].orderBy).toEqual([
      { shotAt: 'desc' },
      { createdAt: 'desc' },
    ]);
  });

  it('reads only the caller’s own rows, keyed on the User.id and never the Clerk sub', async () => {
    const prisma = makePrisma([]);
    await new BenchService(prisma as never).log(SUB);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkId: SUB },
      select: { id: true },
    });
    expect(prisma.benchLogEntry.findMany.mock.calls[0][0].where).toEqual({ userId: 'usr_1' });
  });

  it('never hands the userId back out', async () => {
    const prisma = makePrisma([entry()]);
    const [row] = await new BenchService(prisma as never).log(SUB);
    expect(Object.prototype.hasOwnProperty.call(row, 'userId')).toBe(false);
  });

  it('resolves the cartridge name, because a key is not a thing to show someone', async () => {
    const prisma = makePrisma([entry()]);
    const [row] = await new BenchService(prisma as never).log(SUB);
    expect(row.cartridgeName).toBe('6,5 Creedmoor');
  });

  it('carries the load’s window and the flags the sheet warned with', async () => {
    const prisma = makePrisma([entry({ loadId: 'load_1', chargeGr: 43.0 })]);
    const [row] = await new BenchService(prisma as never).log(SUB);

    expect({ startGr: row.startGr, maxGr: row.maxGr }).toEqual({ startGr: 35.6, maxGr: 41.5 });
    expect(row.flags).toContain('ABOVE_MAX');
  });

  /**
   * ⚠️ A NULL WINDOW, NOT A ZERO ONE. A re-import can consolidate a group
   * away; `startGr: 0` would then put every entry above its own start charge
   * and flag nothing at all.
   */
  it('leaves the window null when the load is gone, and raises no charge flag', async () => {
    const prisma = makePrisma([entry({ loadId: 'load_gone', chargeGr: 43.0 })]);
    prisma.benchLoad.findMany.mockResolvedValue([]);

    const [row] = await new BenchService(prisma as never).log(SUB);

    expect({ startGr: row.startGr, maxGr: row.maxGr }).toEqual({ startGr: null, maxGr: null });
    expect(row.flags).not.toContain('ABOVE_MAX');
    expect(row.flags).not.toContain('BELOW_START');
  });

  it('asks for no load at all when nothing in the log names one', async () => {
    const prisma = makePrisma([entry()]);
    await new BenchService(prisma as never).log(SUB);
    expect(prisma.benchLoad.findMany).not.toHaveBeenCalled();
  });
});

/**
 * The two flag functions, table-driven, because they are the comparison
 * standing between a reloader and a round that will not chamber or will not
 * fit — and they are pure.
 */
describe('The Bench — the flags', () => {
  const L6 = 71.76;

  type CoalRow = { coalMm: number | null; coalLoMm?: number | null; coalHiMm?: number | null };

  it.each<[string, CoalRow, string[]]>([
    ['a COAL well under the maximum', { coalMm: 68.0 }, []],
    ['a COAL over it', { coalMm: 72.0 }, ['COAL_OVER_MAX']],
    ['a COAL exactly on it', { coalMm: L6 }, ['COAL_NEAR_MAX']],
    ['a COAL half a millimetre under', { coalMm: 71.26 }, ['COAL_NEAR_MAX']],
    ['a COAL a hair past that', { coalMm: 71.25 }, []],
    ['no COAL at all', { coalMm: null }, []],
    // The upper end of a spanning group is what has to fit, so it is judged on
    // coalHiMm rather than on the representative figure.
    [
      'a range whose top is over',
      { coalMm: 70.0, coalLoMm: 69.5, coalHiMm: 72.4 },
      ['COAL_RANGE', 'COAL_OVER_MAX'],
    ],
    ['a range comfortably inside', { coalMm: 69.0, coalLoMm: 68.5, coalHiMm: 69.5 }, ['COAL_RANGE']],
  ])('%s', (_name, row, expected) => {
    expect(coalFlags({ coalLoMm: null, coalHiMm: null, ...row }, L6)).toEqual(expected);
  });

  it('says nothing when the cartridge has no published ceiling', () => {
    // Five of the 177 have no sheet. Silence is the honest answer; a flag
    // would be a comparison against a figure we do not have.
    expect(coalFlags({ coalMm: 99, coalLoMm: null, coalHiMm: null }, null)).toEqual([]);
  });

  it.each([
    ['above the max', 43.0, ['ABOVE_MAX']],
    ['below the start', 30.0, ['BELOW_START']],
    ['exactly on the max', 41.5, []],
    ['exactly on the start', 35.6, []],
    ['inside the window', 38.0, []],
  ])('a charge %s', (_name, chargeGr, expected) => {
    expect(logFlags({ chargeGr, coalMm: null }, { startGr: 35.6, maxGr: 41.5 }, L6)).toEqual(
      expected,
    );
  });

  it('raises no charge flag without a window, however wild the charge', () => {
    expect(logFlags({ chargeGr: 900, coalMm: null }, null, L6)).toEqual([]);
  });
});

/**
 * 🚨 THE FILE THE MEMBER DOWNLOADS TO KEEP. Two things about it are not
 * cosmetic: the date has to be the date they were standing on the range, and
 * nothing in it may run when they open it.
 */
describe('The Bench — the CSV', () => {
  async function csvFor(rows: ReturnType<typeof entry>[]) {
    const { csv } = await new BenchService(makePrisma(rows) as never).logCsv(SUB);
    return csv;
  }

  it('files a load by the date it was fired in South Africa, not in UTC', async () => {
    // 22:30 UTC on the 5th is 00:30 on the 6th in Johannesburg. Every member
    // of this site is two hours ahead, so a Saturday-night range trip filed
    // itself under the Friday in the file while the screen said Saturday.
    const csv = await csvFor([entry({ shotAt: new Date('2026-09-05T22:30:00.000Z') })]);
    expect(csv).toContain('2026-09-06');
    expect(csv).not.toContain('2026-09-05');
  });

  it('quotes a note that would otherwise shift every column after it', async () => {
    const csv = await csvFor([entry({ notes: 'windy, 3 o’clock; "gusting"' })]);
    expect(csv).toContain('"windy, 3 o’clock; ""gusting"""');
  });

  /**
   * 🚨 A CELL THAT STARTS WITH `=` IS A FORMULA, QUOTED OR NOT. Excel, Sheets
   * and LibreOffice all evaluate it on open — and `notes`, `primer` and
   * `caseLabel` are text a member typed. Neutralised with the leading
   * apostrophe every spreadsheet strips on display.
   */
  it.each([
    // Quoted as well as prefixed — the parentheses carry a comma — so the
    // expectation is on the leading apostrophe rather than on the whole cell.
    ['=HYPERLINK', '=HYPERLINK("http://x" "click")'],
    // A phone number, which parses as a number and is still a formula: a
    // spreadsheet renders it as 27821234567 and the leading + is gone.
    ['a leading plus', '+27821234567'],
    ['an @ function', '@SUM(A1:A9)'],
    // A leading minus that is NOT simply a negative number.
    ['arithmetic behind a minus', '-1+1'],
  ])('neutralises %s rather than letting a spreadsheet run it', async (_name, notes) => {
    const csv = await csvFor([entry({ notes })]);
    expect(csv).toContain(`'${notes.slice(0, 6)}`);
  });

  it('leaves a negative number alone, because that is a number to a spreadsheet', async () => {
    // The same helper serves the money exports, where every refund is a
    // negative and a prefixed cell stops the column summing.
    const csv = await csvFor([entry({ groupMm: -1.5, notes: '-12.50' })]);
    expect(csv).toContain(',-1.5,');
    expect(csv).toContain(',-12.50');
    expect(csv).not.toContain("'-12.50");
  });
});
