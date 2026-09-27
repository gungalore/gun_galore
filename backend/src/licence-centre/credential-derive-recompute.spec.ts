import { recomputeDerivedCompetencies } from './credential-derive-recompute';

// ────────────────────────────────────────────────────────────────────
// A COMPETENCY'S DATE MOVES WITH THE LICENCE SET, SO SOMETHING MUST MOVE IT.
//
// The bug this file exists for: the operator emptied their vault and
// re-uploaded in three batches — competencies first, then licences. Every
// competency landed while there was nothing to derive from, so only the
// never-armed fallback was available and its dateSource stayed NULL. When the
// licences arrived the recompute fired and could not see a single competency,
// because it selected `dateSource: 'derived'` — and a never-dated row is not
// 'derived'. Five certificates sat undated until the member went back and
// confirmed each one by hand.
// ────────────────────────────────────────────────────────────────────

type Cert = {
  id: string;
  expiresOn: Date | null;
  issuedOn: Date | null;
  detailsEncrypted: string;
  extractedFields: string[];
  dateSourceNote: string | null;
};
type Licence = {
  firearmCategory: string | null;
  firearmSelfLoading: boolean | null;
  expiresOn: Date | null;
  title: string;
};

/** The `covers` line for a certificate, from its id — the reader we hand in. */
const coversFor: Record<string, string> = {
  hand: 'HANDGUN',
  rifle: 'S/L-RIFLE/CARB/SHOTGUN',
};

function build(opts: { certs?: Cert[]; licences?: Licence[] } = {}) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  // ⚠️ THE CERT QUERY IS DISTINGUISHED BY ITS `where`, NOT BY CALL ORDER. The
  // two findMany calls run in a Promise.all, so relying on order is a race the
  // spec would win only by luck — and the bug being pinned is precisely a
  // WHERE clause, so the where is what the double must answer.
  const prisma = {
    credential: {
      findMany: jest.fn(async (args: any): Promise<any[]> => {
        const kind = args?.where?.kind;
        if (kind === 'COMPETENCY_CERTIFICATE') return opts.certs ?? [];
        return opts.licences ?? [];
      }),
      update: jest.fn(async (args: any) => {
        updates.push({ id: args.where.id as string, data: args.data });
        return {};
      }),
    },
  };
  return { prisma, updates };
}

const readCovers = (blob: string | null) => coversFor[blob ?? ''] ?? '';

function cert(over: Partial<Cert> & { id: string; covers: string }): Cert {
  return {
    id: over.id,
    expiresOn: over.expiresOn ?? null,
    issuedOn: over.issuedOn ?? new Date('2021-01-01T00:00:00Z'),
    detailsEncrypted: over.detailsEncrypted ?? over.covers,
    extractedFields: over.extractedFields ?? [],
    dateSourceNote: over.dateSourceNote ?? null,
  };
}

const HANDGUN_LICENCE: Licence = {
  firearmCategory: 'handgun',
  firearmSelfLoading: null,
  expiresOn: new Date('2035-08-19T00:00:00Z'),
  title: 'My Glock',
};

describe('re-dating competencies when a licence lands', () => {
  it('⚠️ DATES A COMPETENCY THAT WAS NEVER DATED AT ALL', async () => {
    // The operator's exact case. dateSource NULL is not 'derived', so the old
    // predicate skipped this row entirely and it stayed undated for ever.
    const { prisma, updates } = build({
      certs: [cert({ id: 'c1', covers: 'hand' })],
      licences: [HANDGUN_LICENCE],
    });
    const changed = await recomputeDerivedCompetencies(
      prisma as never,
      'u1',
      readCovers,
    );
    expect(changed).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.expiresOn).toEqual(
      new Date('2035-08-19T00:00:00Z'),
    );
    expect(updates[0].data.dateSource).toBe('derived');
  });

  it('still re-dates a row WE dated previously', async () => {
    const { prisma, updates } = build({
      certs: [
        cert({
          id: 'c1',
          covers: 'hand',
          expiresOn: new Date('2030-01-01T00:00:00Z'),
          dateSourceNote: 'old note',
        }),
      ],
      licences: [HANDGUN_LICENCE],
    });
    await recomputeDerivedCompetencies(prisma as never, 'u1', readCovers);
    expect(updates[0].data.expiresOn).toEqual(
      new Date('2035-08-19T00:00:00Z'),
    );
  });

  it('⚠️ ASKS THE DATABASE FOR BOTH, NOT ONLY THE DERIVED ONES', async () => {
    // Pinned on the QUERY, because the write path is identical either way and
    // a regression here is invisible in the updates.
    const { prisma } = build({ certs: [], licences: [] });
    await recomputeDerivedCompetencies(prisma as never, 'u1', readCovers);
    const certQuery = (prisma.credential.findMany as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a?.where?.kind === 'COMPETENCY_CERTIFICATE');
    expect(certQuery.where.OR).toEqual([
      { dateSource: 'derived' },
      { dateSource: null },
    ]);
    // ⚠️ AND A CONFIRMED ROW IS STILL EXCLUDED. The widening is only safe
    // because the member's own settled date cannot pass this filter.
    expect(certQuery.where.confirmedAt).toBeNull();
  });

  it('hands the date back when the basis disappears', async () => {
    const { prisma, updates } = build({
      certs: [
        cert({
          id: 'c1',
          covers: 'hand',
          expiresOn: new Date('2030-01-01T00:00:00Z'),
        }),
      ],
      licences: [],
    });
    await recomputeDerivedCompetencies(prisma as never, 'u1', readCovers);
    expect(updates[0].data.expiresOn).toBeNull();
    expect(updates[0].data.dateSource).toBeNull();
  });

  it('never throws when the database is down', async () => {
    const { prisma } = build();
    prisma.credential.findMany.mockRejectedValue(new Error('database on fire'));
    await expect(
      recomputeDerivedCompetencies(prisma as never, 'u1', readCovers),
    ).resolves.toBe(0);
  });
});
