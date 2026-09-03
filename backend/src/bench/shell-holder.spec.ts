import { BenchService } from './bench.service';

/**
 * THE SHELL-HOLDER GROUP.
 *
 * A shell holder grips the case RIM, so what decides whether one holder takes
 * two cartridges is the rim's diameter (R1), its thickness (R) and the
 * extractor groove (E1) — never the calibre. .308 Win and .243 Win take the
 * same holder and shoot bullets three tenths of an inch apart.
 *
 * ⚠️ THE CARD SAYS "SAME SHELL HOLDER AS THESE", NEVER A CATALOGUE NUMBER.
 * Numbered holders are each maker's own and disagree with one another, so a
 * number would be a claim we cannot stand behind. These tests pin the grouping
 * and the fact that nothing numbered escapes.
 */

/** Real C.I.P. figures, in millimetres, off the sheets we hold. */
const RIM = {
  win308: { R1: 12.01, R: 1.37, E1: 10.39 },
  win243: { R1: 12.01, R: 1.37, E1: 10.39 },
  creedmoor65: { R1: 11.99, R: 1.37, E1: 10.39 },
  spring3006: { R1: 12.01, R: 1.24, E1: 10.39 },
  rem223: { R1: 9.6, R: 1.14, E1: 8.43 },
};

function makePrisma(near: string[], withLoads: { key: string; name: string }[]) {
  return {
    benchCartridge: {
      findUnique: jest.fn().mockResolvedValue({
        key: '308winchester',
        name: '308 Win.',
        slug: '308-win',
        type: null,
        origin: null,
        year: null,
        caseLengthMm: null,
        maxLengthMm: null,
        pmaxPsi: null,
        pmaxBar: null,
        dims: { ...RIM.win308, rawText: 'C.I.P. sheet text that must not travel' },
      }),
      findMany: jest.fn().mockResolvedValue(withLoads),
    },
    benchCipDimension: {
      findMany: jest.fn().mockResolvedValue(near.map((k) => ({ cartridgeKey: k }))),
    },
    benchLoad: { count: jest.fn().mockResolvedValue(0) },
  };
}

describe('the shell-holder group', () => {
  it('asks for rim geometry within a twentieth of a millimetre, and never for the calibre', async () => {
    const prisma = makePrisma(['243win'], [{ key: '243win', name: '243 Win.' }]);
    await new BenchService(prisma as never).cartridge('308winchester', null);

    const where = prisma.benchCipDimension.findMany.mock.calls[0][0].where;
    // The three rim figures, each a ±0.05 window around .308 Win's own.
    // toBeCloseTo, not toEqual: 12.01 - 0.05 is 11.959999999999999 in binary
    // floating point, and the sheets are printed to two decimals — asserting
    // the exact bits would pin an artefact rather than the window.
    expect(where.R1.gte).toBeCloseTo(11.96, 6);
    expect(where.R1.lte).toBeCloseTo(12.06, 6);
    expect(where.R.gte).toBeCloseTo(1.32, 6);
    expect(where.R.lte).toBeCloseTo(1.42, 6);
    expect(where.E1.gte).toBeCloseTo(10.34, 6);
    expect(where.E1.lte).toBeCloseTo(10.44, 6);
    // A shell holder does not care what leaves the barrel.
    expect(where).not.toHaveProperty('G1');
    // And a cartridge is never its own neighbour.
    expect(where.cartridgeKey).toEqual({ not: '308winchester' });
  });

  it('offers only cartridges that actually have loads', async () => {
    // A chip for a cartridge with nothing behind it leads nowhere.
    const prisma = makePrisma(['243win', 'deadkey'], [{ key: '243win', name: '243 Win.' }]);
    const out = await new BenchService(prisma as never).cartridge('308winchester', null);

    expect(prisma.benchCartridge.findMany.mock.calls[0][0].where.loads).toEqual({ some: {} });
    expect(out.shellHolderGroup).toEqual([{ key: '243win', name: '243 Win.' }]);
  });

  it('says nothing rather than guessing when the sheet is missing a rim figure', async () => {
    const prisma = makePrisma([], []);
    prisma.benchCartridge.findUnique.mockResolvedValue({
      key: '308winchester',
      name: '308 Win.',
      slug: '308-win',
      type: null,
      origin: null,
      year: null,
      caseLengthMm: null,
      maxLengthMm: null,
      pmaxPsi: null,
      pmaxBar: null,
      // R is absent — two of three proves nothing about a holder.
      dims: { R1: 12.01, R: null, E1: 10.39 },
    });

    const out = await new BenchService(prisma as never).cartridge('308winchester', null);
    expect(out.shellHolderGroup).toEqual([]);
    expect(prisma.benchCipDimension.findMany).not.toHaveBeenCalled();
  });

  it('claims no manufacturer number, and carries no sheet text', async () => {
    const prisma = makePrisma(['243win'], [{ key: '243win', name: '243 Win.' }]);
    const out = await new BenchService(prisma as never).cartridge('308winchester', null);

    const json = JSON.stringify(out.shellHolderGroup).toLowerCase();
    for (const claim of ['rcbs', 'lee', 'hornady', 'holder #', 'no.', 'shell holder ']) {
      expect(json).not.toContain(claim);
    }
    // The audit text on the dims must not ride out either.
    expect(JSON.stringify(out)).not.toContain('must not travel');
  });

  it('does not return the calliper stations — the client derives those', async () => {
    // They are a pure function of the same dims, and a second copy over the
    // wire is one more thing to disagree with the drawing.
    const prisma = makePrisma([], []);
    const out = await new BenchService(prisma as never).cartridge('308winchester', null);
    expect(out).not.toHaveProperty('stations');
  });
});

describe('the rim windows this rests on', () => {
  const near = (a: { R1: number; R: number; E1: number }, b: typeof a, tol = 0.05) =>
    Math.abs(a.R1 - b.R1) <= tol && Math.abs(a.R - b.R) <= tol && Math.abs(a.E1 - b.E1) <= tol;

  it('holds .308 Win, .243 Win and 6,5 Creedmoor as one family', () => {
    // Different calibres entirely — .308", .243", .264" — one .473" head.
    expect(near(RIM.win308, RIM.win243)).toBe(true);
    expect(near(RIM.win308, RIM.creedmoor65)).toBe(true);
  });

  it('keeps .223 Rem well outside it', () => {
    expect(near(RIM.win308, RIM.rem223)).toBe(false);
  });

  it('excludes .30-06 on published rim thickness — narrow, and deliberately so', () => {
    // ⚠️ A PRESS WOULD PROBABLY HOLD BOTH. C.I.P. publishes 1.24 mm against
    // .308 Win's 1.37, which is wider than the spec's window, so .30-06 does
    // not appear in .308's group. Erring narrow is right for a hint: a missing
    // chip costs a member nothing, a wrong one sends them to the bench with
    // the wrong holder. Pinned so the exclusion is a decision, not a surprise.
    expect(near(RIM.win308, RIM.spring3006)).toBe(false);
    expect(Math.abs(RIM.win308.R - RIM.spring3006.R)).toBeCloseTo(0.13, 2);
  });
});
