import { BenchService } from './bench.service';

/**
 * THE BENCH — the permalink.
 *
 * A link to a finder state: the filters, plus a snapshot of the bench they
 * were read against.
 *
 * 🚨 THE SNAPSHOT IS WHY THE FILTERS ALONE WILL NOT DO. A link naming only
 * "6,5 Creedmoor, 150 gr +" opens against whatever shelf the OPENER has, which
 * on a members-only page is a different person's shelf every time — so the
 * link shows a different answer to everybody who follows it, including to the
 * person who made it once they change their bench.
 */

const SUB = 'user_2abcCLERKsub';

function makePrisma(over: Record<string, unknown> = {}) {
  const created: Record<string, unknown>[] = [];
  return {
    created,
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'usr_1' }) },
    benchShare: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve(data);
      }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ...over,
  };
}

const FILTERS = {
  cartridge: '65creedmoor',
  weight: 'gte150',
  tolerance: 5,
  off: ['pwd_h4350'],
  bench: {
    powderIds: ['pwd_n550'],
    cartridgeKeys: ['65creedmoor', '308win'],
    bullets: [{ weightGr: 150, calibreIn: 0.308 }],
  },
};

describe('The Bench — a share stores the state and hands back a link', () => {
  it('writes the payload untouched and answers with a token and a URL', async () => {
    const prisma = makePrisma();
    const out = await new BenchService(prisma as never).share(SUB, FILTERS);

    expect(prisma.created[0].payload).toEqual(FILTERS);
    // The client's own filter object, opaque to us: the finder's controls
    // change more often than this endpoint should.
    expect(out.url).toBe(
      `${process.env.FRONTEND_URL ?? 'https://alloutdoor.co.za'}/bench?s=${out.token}`,
    );
  });

  /**
   * 🚨 22 URL-SAFE CHARACTERS OF CRYPTO RANDOMNESS. A token derived from the
   * payload would let anybody who guessed a common bench read back somebody's
   * share, and a sequential one would let them walk the table.
   */
  it('mints an unguessable token, and a different one every time', async () => {
    const svc = new BenchService(makePrisma() as never);
    const a = await svc.share(SUB, FILTERS);
    const b = await svc.share(SUB, FILTERS);

    expect(a.token).toHaveLength(22);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Identical filters, different links — the token is not a hash of them.
    expect(a.token).not.toBe(b.token);
  });

  it('dates the link ninety days out', async () => {
    const prisma = makePrisma();
    await new BenchService(prisma as never).share(SUB, FILTERS);

    const days = (Number(prisma.created[0].expiresAt) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  /**
   * ⚠️ CAPPED BY SIZE, AND REFUSED RATHER THAN TRUNCATED. A link is a
   * shortcut; it is not a place to put a megabyte per click. Truncating would
   * be worse than refusing — the member would follow their own link to a
   * half-applied filter set they cannot see the rest of.
   */
  it('refuses a payload past eight kilobytes', async () => {
    const prisma = makePrisma();
    const huge = { note: 'x'.repeat(9000) };

    await expect(new BenchService(prisma as never).share(SUB, huge)).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.benchShare.create).not.toHaveBeenCalled();
  });

  it('accepts a payload just under it', async () => {
    const prisma = makePrisma();
    await expect(
      new BenchService(prisma as never).share(SUB, { note: 'x'.repeat(8_000) }),
    ).resolves.toMatchObject({ token: expect.any(String) });
  });
});

describe('The Bench — reading a share back', () => {
  it('returns the stored payload', async () => {
    const prisma = makePrisma();
    prisma.benchShare.findUnique.mockResolvedValue({
      token: 'tok_1',
      payload: FILTERS,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const out = await new BenchService(prisma as never).readShare('tok_1');
    expect(out.payload).toEqual(FILTERS);
  });

  /**
   * 🚨 EXPIRED IS A 404, NOT A PARTIAL ANSWER. Opening an aged-out link must
   * land the member on their own bench with "that link has expired" — never on
   * a filter set they did not choose.
   */
  it('404s an expired token', async () => {
    const prisma = makePrisma();
    prisma.benchShare.findUnique.mockResolvedValue({
      token: 'tok_old',
      payload: FILTERS,
      expiresAt: new Date(Date.now() - 1),
    });

    await expect(new BenchService(prisma as never).readShare('tok_old')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('404s a token that never existed', async () => {
    const prisma = makePrisma();
    await expect(new BenchService(prisma as never).readShare('nope')).rejects.toMatchObject({
      status: 404,
    });
  });
});
