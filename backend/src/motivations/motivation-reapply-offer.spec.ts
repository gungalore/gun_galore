import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { MotivationPrefillService } from './motivation-prefill.service';
import { MotivationSharedService } from './motivation-shared.service';
import { MemberProfileAnswersService } from './member-profile-answers.service';
import { decryptJson, encryptJson } from '../common/blob-crypto';
import type { ProvenanceMap } from '../common/answer-provenance';

// ────────────────────────────────────────────────────────────────────
// THE OFFER RE-RUNS WHEN A DOCUMENT LANDS.
//
// Operator, 2026-09-14: "the your case on the motivation is supposed to pull in
// my associations when I upload it from the document library or straight while
// busy in the motivation. It should pull in at any time, even if the motivation
// has already been created."
//
// create() ran the offer once and the manual "fill from Document Centre"
// endpoints were deleted with the wizard, so an application that already
// existed never picked up a document uploaded afterwards — and a document
// photographed onto the sheet was never a vault row for the offer to see at
// all. These pin the re-run, and the two things it must never do: overwrite a
// MEMBER value, or touch an application that is no longer editable.
// ────────────────────────────────────────────────────────────────────

const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
process.env.ID_HASH_SECRET = 'test-secret-for-reapply-offer';
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

/** One vault row, in the shape credentialsFor selects and decrypts. */
function vaultRow(details: Record<string, string>, over: { id?: string } = {}) {
  return {
    id: over.id ?? 'cred-1',
    kind: 'DEDICATED_DISCIPLINE',
    title: 'My dedicated status',
    expiresOn: null,
    issuedOn: null,
    confirmedAt: null,
    dateSource: 'read',
    extractionOk: true,
    detailsEncrypted: encryptJson(details),
  };
}

function build(
  opts: {
    licenceType?: MotivationLicenceType;
    status?: MotivationStatus;
    answers?: Record<string, string>;
    provenance?: ProvenanceMap;
    credentials?: unknown[];
    uploads?: { id: string; kind: string; extraction: Record<string, string> }[];
  } = {},
) {
  const updates: { data: Record<string, unknown> }[] = [];
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    memberProfileAnswers: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({})),
    },
    motivation: {
      findFirst: jest.fn(async () => ({
        id: 'mo-1',
        licenceType:
          opts.licenceType ?? MotivationLicenceType.S16_DEDICATED_SPORT,
        status: opts.status ?? MotivationStatus.DRAFT,
        answersEncrypted: encryptJson(opts.answers ?? {}),
        answerProvenance: opts.provenance ?? {},
      })),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return {};
      }),
    },
    credential: { findMany: jest.fn(async () => opts.credentials ?? []) },
    motivationUpload: {
      findMany: jest.fn(async () =>
        (opts.uploads ?? []).map((u) => ({
          id: u.id,
          kind: u.kind,
          extractionEncrypted: encryptJson(u.extraction),
        })),
      ),
    },
  };

  const quota = { assertEnabled: jest.fn(async () => undefined) };
  const crimeStats = { nearestStation: jest.fn(async () => ({ station: null })) };
  const shared = new MotivationSharedService(
    prisma as never,
    new MemberProfileAnswersService(prisma as never),
  );
  const prefill = new MotivationPrefillService(
    prisma as never,
    quota as never,
    shared,
    crimeStats as never,
  );

  const written = () =>
    updates.length
      ? (decryptJson<Record<string, string>>(
          updates[updates.length - 1].data.answersEncrypted as string,
        ) ?? {})
      : (opts.answers ?? {});
  const provenanceWritten = () =>
    updates.length
      ? (updates[updates.length - 1].data.answerProvenance as ProvenanceMap)
      : {};

  return { prefill, updates, written, provenanceWritten };
}

const ASSOCIATION_UPLOAD = {
  id: 'up-1',
  kind: 'ASSOCIATION_CARD',
  extraction: {
    association_name: 'SA Hunters',
    association_number: 'SAH-001',
    association_joined: '2015-03-01',
  },
};

describe('re-running the offer when a document lands', () => {
  it('⚠️ FILLS THE ASSOCIATION BLOCK FROM A DOCUMENT UPLOADED TO THE APPLICATION', async () => {
    const t = build({ uploads: [ASSOCIATION_UPLOAD] });
    const r = await t.prefill.reapplyOffer('clerk-1', 'mo-1');
    expect(r.changed).toEqual(
      expect.arrayContaining(['association_name', 'association_number']),
    );
    expect(t.written().association_name).toBe('SA Hunters');
    expect(t.written().association_number).toBe('SAH-001');
  });

  it('fills from a vault document too', async () => {
    const t = build({
      credentials: [
        vaultRow({ association: 'NARFO', membership_number: 'N-9' }),
      ],
    });
    await t.prefill.reapplyOffer('clerk-1', 'mo-1');
    expect(t.written().association_name).toBe('NARFO');
    expect(t.written().association_number).toBe('N-9');
  });

  it('⚠️ NEVER OVERWRITES A MEMBER VALUE', async () => {
    // The one rule the whole prefill rests on: a box the member typed is
    // theirs, even when a document disagrees.
    const t = build({
      answers: { association_name: 'My own club' },
      provenance: {
        association_name: {
          source: 'MEMBER',
          at: '2026-09-01T00:00:00.000Z',
        },
      } as unknown as ProvenanceMap,
      uploads: [ASSOCIATION_UPLOAD],
    });
    const r = await t.prefill.reapplyOffer('clerk-1', 'mo-1');
    expect(r.changed).not.toContain('association_name');
    expect(t.written().association_name).toBe('My own club');
  });

  it('does nothing once the application is no longer editable', async () => {
    const t = build({
      status: MotivationStatus.COMPLETED,
      uploads: [ASSOCIATION_UPLOAD],
    });
    const r = await t.prefill.reapplyOffer('clerk-1', 'mo-1');
    expect(r.changed).toEqual([]);
    expect(t.updates).toHaveLength(0);
  });

  it('writes nothing when no document carries an association', async () => {
    const t = build({});
    const r = await t.prefill.reapplyOffer('clerk-1', 'mo-1');
    expect(r.changed).toEqual([]);
    expect(t.updates).toHaveLength(0);
  });
});
