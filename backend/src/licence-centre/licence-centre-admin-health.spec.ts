// AdminService is not in this chain, but LicenceCentreService reaches
// MotivationsService, which is a large import graph. Nothing here calls into
// it — the constructor only assigns — so the collaborators are stubs.
import { CredentialKind } from '@prisma/client';
import { LicenceCentreService } from './licence-centre.service';
import { NO_VISION_KINDS } from './credential-kinds';
import type { PrismaService } from '../prisma/prisma.service';

// WHAT THE OPERATOR'S HEALTH PANEL IS ALLOWED TO CALL A PROBLEM.
//
// ⚠️ "unconfirmed" USED TO MEAN "confirmedAt IS NULL", and that stopped being
// a problem the day the Centre started holding documents with no date on them.
// A photograph of a gun safe is filed with "Never expires" already ticked and
// no vision call is spent on it, so it is unconfirmed for ever and correctly
// so. Counted, it would push this number up with every safe photograph in the
// system and leave an operator watching noise instead of the documents that
// really are waiting on somebody to check a date.

type CountArgs = { where?: Record<string, unknown> } | undefined;

function makeService(groups: { kind: CredentialKind; count: number }[]) {
  const calls: CountArgs[] = [];
  const prisma = {
    credential: {
      groupBy: jest
        .fn()
        .mockResolvedValue(
          groups.map((g) => ({ kind: g.kind, _count: { _all: g.count } })),
        ),
      count: jest.fn((args: CountArgs) => {
        calls.push(args);
        return Promise.resolve(0);
      }),
    },
  };
  const stub = null as never;
  const service = new LicenceCentreService(
    prisma as unknown as PrismaService,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
  );
  return { service, calls };
}

/** The one count whose where-clause is about documents nobody has confirmed. */
function unconfirmedWhere(calls: CountArgs[]): Record<string, unknown> {
  const found = calls.find((c) => c?.where && 'confirmedAt' in c.where);
  expect(found).toBeDefined();
  return found!.where!;
}

describe('the unconfirmed metric', () => {
  it('asks only for rows that still track an expiry', async () => {
    const { service, calls } = makeService([]);
    await service.adminHealth();
    const where = unconfirmedWhere(calls);
    expect(where.confirmedAt).toBeNull();
    // The member's own tick is the real test: it is the answer to the expiry
    // question, whatever kind the document is.
    expect(where.neverExpires).toBe(false);
  });

  it('excludes the photographs, which have no date in any sense', async () => {
    const { service, calls } = makeService([]);
    await service.adminHealth();
    const where = unconfirmedWhere(calls);
    const notIn = (where.kind as { notIn: CredentialKind[] }).notIn;
    expect([...notIn].sort()).toEqual([...NO_VISION_KINDS].sort());
  });

  it('does NOT excuse an ID copy, because a passport is one', async () => {
    // ⚠️ THE CASE THAT BROKE THE FIRST DESIGN. Excluding by "kinds that never
    // expire" would have dropped every identity document, and a passport is an
    // identity document with a date on it that somebody has to confirm.
    const { service, calls } = makeService([]);
    await service.adminHealth();
    const notIn = (unconfirmedWhere(calls).kind as { notIn: CredentialKind[] })
      .notIn;
    expect(notIn).not.toContain(CredentialKind.IDENTITY_DOCUMENT);
    expect(notIn).not.toContain(CredentialKind.SHOOTING_ACTIVITY_LOG);
  });
});

describe('the per-kind breakdown', () => {
  it('carries every kind, including the ones nobody has filed yet', async () => {
    // ⚠️ groupBy RETURNS ONLY KINDS THAT HAVE ROWS. The eight kinds the Centre
    // gained from the application paperwork would each be missing from this
    // panel until a first member filed one, and a missing line reads exactly
    // like a deployment that never happened.
    const { service } = makeService([
      { kind: CredentialKind.FIREARM_LICENCE, count: 3 },
    ]);
    const health = await service.adminHealth();
    const byKind = new Map(health.byKind.map((r) => [r.kind, r.count]));
    for (const kind of Object.values(CredentialKind)) {
      expect(byKind.has(kind)).toBe(true);
    }
    for (const kind of [
      CredentialKind.IDENTITY_DOCUMENT,
      CredentialKind.ADDRESS_CONFIRMATION,
      CredentialKind.EMPLOYMENT_CONFIRMATION,
      CredentialKind.SAFE_PHOTO_CLOSED,
      CredentialKind.SAFE_PHOTO_AJAR,
      CredentialKind.SAFE_PHOTO_BOLTS,
      CredentialKind.SAFE_INSTALLATION,
      CredentialKind.SHOOTING_ACTIVITY_LOG,
    ]) {
      expect(byKind.get(kind)).toBe(0);
    }
  });

  it('still reports the counts groupBy did return', async () => {
    const { service } = makeService([
      { kind: CredentialKind.FIREARM_LICENCE, count: 3 },
      { kind: CredentialKind.COMPETENCY_CERTIFICATE, count: 1 },
    ]);
    const health = await service.adminHealth();
    const byKind = new Map(health.byKind.map((r) => [r.kind, r.count]));
    expect(byKind.get(CredentialKind.FIREARM_LICENCE)).toBe(3);
    expect(byKind.get(CredentialKind.COMPETENCY_CERTIFICATE)).toBe(1);
  });

  it('keeps the retired kinds visible, so a stray row cannot hide', async () => {
    // At zero they are what correct looks like. A non-zero one means rows
    // escaped the migration to DEDICATED_DISCIPLINE and now sit outside every
    // query that looks for it.
    const { service } = makeService([
      { kind: CredentialKind.DEDICATED_HUNTER, count: 2 },
    ]);
    const health = await service.adminHealth();
    const byKind = new Map(health.byKind.map((r) => [r.kind, r.count]));
    expect(byKind.get(CredentialKind.DEDICATED_HUNTER)).toBe(2);
  });
});
