import { CredentialKind, MotivationUploadKind } from '@prisma/client';
import { ScanHandoffController } from './scan-handoff.controller';
import { NO_VISION_KINDS } from '../licence-centre/credential-kinds';
import type { PrismaService } from '../prisma/prisma.service';
import type { ActionTokensService } from './action-tokens.service';

// WHEN THE DESKTOP MAY STOP SAYING "WAITING".
//
// ⚠️ THE DIALOG SAT FOR 45 SECONDS ON A PHOTOGRAPH THAT HAD ALREADY ARRIVED.
// A row counts as landed once its vision read has settled, with a 45-second
// backstop for the reads that come back empty. Then the Centre gained kinds
// that get NO vision call at all — there is nothing printed on a photograph of
// a gun safe — so extractionOk is false from the moment the row is written and
// the backstop, meant for the rare unreadable document, became the ordinary
// path for every safe photograph.
//
// These tests drive the real predicate the controller builds, against rows,
// rather than asserting the shape of an object.

type Row = { kind: string; extractionOk: boolean; createdAt: Date };

/** The slice of Prisma's where-grammar this controller actually uses. */
function matches(where: Record<string, unknown>, row: Row): boolean {
  const createdAt = where.createdAt as { gte?: Date } | undefined;
  if (createdAt?.gte && row.createdAt < createdAt.gte) return false;
  const or = where.OR as Record<string, unknown>[] | undefined;
  if (!or) return true;
  return or.some((clause) => {
    if ('extractionOk' in clause)
      return row.extractionOk === clause.extractionOk;
    if ('kind' in clause) {
      const list = (clause.kind as { in: string[] }).in;
      return list.includes(row.kind);
    }
    if ('createdAt' in clause) {
      const c = clause.createdAt as { lte?: Date };
      return Boolean(c.lte && row.createdAt <= c.lte);
    }
    return false;
  });
}

const MINTED = new Date('2026-08-22T10:00:00Z');

function makeController(
  dest: 'licence-centre' | 'motivation' | 'kyc',
  rows: Row[],
  /** Extra token metadata — the KYC destination's arrival stamp lives here. */
  extraMeta: Record<string, unknown> = {},
) {
  const count = jest.fn((args: { where: Record<string, unknown> }) =>
    Promise.resolve(rows.filter((r) => matches(args.where, r)).length),
  );
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) },
    actionToken: {
      findFirst: jest.fn().mockResolvedValue({
        createdAt: MINTED,
        // Far enough out that the session is never graded 'expired'.
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
        metadataJson: JSON.stringify({
          ...(dest === 'motivation'
            ? { dest: 'motivation', motivationId: 'm1' }
            : { dest }),
          ...extraMeta,
        }),
      }),
    },
    credential: { count },
    motivationUpload: { count },
  };
  const controller = new ScanHandoffController(
    prisma as unknown as PrismaService,
    {} as unknown as ActionTokensService,
  );
  return { controller, count };
}

/** `secondsAgo` before now, so the 45-second backstop is measured honestly. */
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

describe('a phone scan that has landed', () => {
  it('counts a safe photograph the moment it exists', async () => {
    const { controller } = makeController('licence-centre', [
      {
        kind: CredentialKind.SAFE_PHOTOGRAPHS,
        extractionOk: false,
        createdAt: ago(1),
      },
    ]);
    const res = await controller.status('clerk_1', 'h1');
    expect(res.added).toBe(1);
    expect(res.state).toBe('uploaded');
  });

  it('counts every no-vision kind, not just the first of them', async () => {
    const { controller } = makeController(
      'licence-centre',
      NO_VISION_KINDS.map((kind) => ({
        kind,
        extractionOk: false,
        createdAt: ago(1),
      })),
    );
    const res = await controller.status('clerk_1', 'h1');
    expect(res.added).toBe(NO_VISION_KINDS.length);
  });

  it('still WAITS on a document whose read has not come back', async () => {
    // ⚠️ THE RACE THIS WHOLE PREDICATE EXISTS FOR. Counting a licence on
    // insert closed the desktop dialog mid-read, and the operator was shown a
    // competency certificate with no issue date five seconds before the date
    // landed in a row his screen had already copied.
    const { controller } = makeController('licence-centre', [
      {
        kind: CredentialKind.FIREARM_LICENCE,
        extractionOk: false,
        createdAt: ago(1),
      },
    ]);
    const res = await controller.status('clerk_1', 'h1');
    expect(res.added).toBe(0);
    expect(res.state).toBe('waiting');
  });

  it('keeps the 45-second backstop for a document that reads as nothing', async () => {
    const { controller } = makeController('licence-centre', [
      {
        kind: CredentialKind.FIREARM_LICENCE,
        extractionOk: false,
        createdAt: ago(60),
      },
    ]);
    expect((await controller.status('clerk_1', 'h1')).added).toBe(1);
  });

  it('counts a document whose read succeeded', async () => {
    const { controller } = makeController('licence-centre', [
      {
        kind: CredentialKind.FIREARM_LICENCE,
        extractionOk: true,
        createdAt: ago(1),
      },
    ]);
    expect((await controller.status('clerk_1', 'h1')).added).toBe(1);
  });

  it('ignores anything filed before the link was made', async () => {
    const { controller } = makeController('licence-centre', [
      {
        kind: CredentialKind.SAFE_PHOTOGRAPHS,
        extractionOk: false,
        createdAt: new Date(MINTED.getTime() - 1000),
      },
    ]);
    expect((await controller.status('clerk_1', 'h1')).added).toBe(0);
  });

  it('treats a safe photograph on a motivation the same way', async () => {
    // The wizard skips its vision read on the same photographs, so the same
    // stall was reachable from the other destination.
    const { controller } = makeController('motivation', [
      {
        kind: MotivationUploadKind.SAFE_PHOTOGRAPHS,
        extractionOk: false,
        createdAt: ago(1),
      },
    ]);
    expect((await controller.status('clerk_1', 'h1')).added).toBe(1);
  });
});

describe('an ID document handed off to the phone', () => {
  // ⚠️ THE SETTLED POLL COUNTS ROWS, AND KYC FILES NONE. An ID document is two
  // columns on the member, overwritten in place. Left to the row count the
  // desktop dialog would sit on "waiting" for the whole 15 minutes after a
  // photograph that arrived in five seconds, so the upload stamps the token
  // and the poll reads the stamp.

  it('waits while the phone has sent nothing', async () => {
    const { controller, count } = makeController('kyc', []);
    const res = await controller.status('clerk_1', 'h1');
    expect(res.added).toBe(0);
    expect(res.state).toBe('waiting');
    // No row query at all — there is no row to ask about.
    expect(count).not.toHaveBeenCalled();
  });

  it('reads the arrival stamp the upload leaves on the token', async () => {
    const { controller } = makeController('kyc', [], {
      uploadedAt: new Date().toISOString(),
    });
    const res = await controller.status('clerk_1', 'h1');
    expect(res.added).toBe(1);
    expect(res.state).toBe('uploaded');
  });

  it('does not mistake an opened link for a delivered document', async () => {
    // The phone stamps openedAt the moment it lands, before a single
    // photograph. Reading that as arrival would skip the member past the step
    // while they were still lining the card up.
    const { controller } = makeController('kyc', [], {
      openedAt: new Date().toISOString(),
    });
    const res = await controller.status('clerk_1', 'h1');
    expect(res.added).toBe(0);
    expect(res.state).toBe('connected');
  });

  it('never counts a credential the member filed in the same minute', async () => {
    // ⚠️ THE BUG THE STAMP EXISTS TO AVOID. A KYC session must not fall
    // through to the credential count: a member with the Document Centre open
    // in another tab would have their ID step marked done by an unrelated
    // licence photograph.
    const { controller } = makeController('kyc', [
      {
        kind: CredentialKind.FIREARM_LICENCE,
        extractionOk: true,
        createdAt: ago(1),
      },
    ]);
    expect((await controller.status('clerk_1', 'h1')).added).toBe(0);
  });
});

describe('the two no-vision lists', () => {
  it('name the same documents on both sides of the handoff', () => {
    // The motivation list is derived from NO_VISION_KINDS at load, so this is
    // a check that the enum names really do still line up — the schema says
    // they are "NAMED IDENTICALLY", and a rename on one side would otherwise
    // shrink the list silently rather than fail.
    for (const kind of NO_VISION_KINDS) {
      expect(Object.keys(MotivationUploadKind)).toContain(kind);
    }
  });
});
