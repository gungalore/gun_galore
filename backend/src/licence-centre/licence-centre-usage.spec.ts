import { LicenceCentreService } from './licence-centre.service';

// ────────────────────────────────────────────────────────────────────
// WHERE A STORED DOCUMENT ALREADY IS.
//
// Operator, 2026-08-25: "build it on fingerprints."
//
// There is no column linking a Document Centre credential to the applications
// it was attached to, and there does not need to be: attaching one COPIES its
// bytes into a MotivationUpload, and both rows carry sha256 of the same
// plaintext — a column the schema already keeps to spot a document uploaded
// twice and to prove which file a reading came from.
//
// ⚠️ WHICH MAKES SCOPING THE WHOLE SAFETY STORY. A sha256 is a fact about
// BYTES, not about a person. Two members who upload the identical blank SAPS
// form, or the same association's standard letter, share one — so a match on
// the hash alone would tell each of them their document is sitting in a
// stranger's licence application, and name it. Every query here is bounded by
// the member's own user id, and the test below is the one that must never be
// deleted.
// ────────────────────────────────────────────────────────────────────

const SHARED = 'sha-of-a-blank-form-two-people-both-uploaded';

function build(o: {
  credentials?: { id: string; kind: string; sha256: string }[];
  /** What the DB returns for the upload query — the mock asserts the where. */
  uploads?: { sha256: string; kind: string; motivationId: string }[];
  motivations?: {
    id: string;
    referenceNumber: string;
    licenceType: string;
    status: string;
    uploads: { kind: string }[];
  }[];
}) {
  const seen: { uploadWhere?: unknown; motivationWhere?: unknown } = {};
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    credential: { findMany: jest.fn(async () => o.credentials ?? []) },
    motivationUpload: {
      findMany: jest.fn(async ({ where }: { where: unknown }) => {
        seen.uploadWhere = where;
        return o.uploads ?? [];
      }),
    },
    motivation: {
      findMany: jest.fn(async ({ where }: { where: unknown }) => {
        seen.motivationWhere = where;
        return o.motivations ?? [];
      }),
    },
  };
  /**
   * ⚠️ THE DEPENDENCIES ARE private ON THE CLASS, so
   * `LicenceCentreService & { prisma: unknown }` REDUCES TO never:
   * TypeScript will not let an object type re-declare a name the class keeps
   * private, and every svc.* read below then errors against a type that
   * cannot exist. Nine red lines, and the suite passed the whole time — the
   * harness works at runtime and only the types were nonsense.
   *
   * So it casts through unknown to a shape naming only what these tests
   * touch, and borrows usage’s real signature rather than restating it, so a
   * change to that method still breaks these tests instead of drifting past
   * them.
   */
  const svc = Object.create(LicenceCentreService.prototype) as unknown as {
    prisma: unknown;
    quota: unknown;
    requireUser: (c: string) => Promise<{ id: string }>;
    usage: LicenceCentreService['usage'];
  };
  svc.prisma = prisma;
  svc.quota = { assertEnabled: jest.fn(async () => undefined) };
  svc.requireUser = async () => ({ id: 'user-1' });
  return { svc, prisma, seen };
}

describe('which applications a document is already in', () => {
  it('⚠️ NEVER matches a document in somebody ELSE’s application', async () => {
    // The failure this exists for: two members upload the same blank form, so
    // the bytes — and therefore the fingerprint — are identical. Without the
    // userId bound on BOTH queries, each would be told their document sits in
    // the other's licence application, and shown its reference number.
    const { svc, seen } = build({
      credentials: [{ id: 'cred-1', kind: 'IDENTITY_DOCUMENT', sha256: SHARED }],
      uploads: [],
    });
    await svc.usage('clerk_1');

    // The upload query is bounded by the owning motivation's member…
    expect(seen.uploadWhere).toMatchObject({
      motivation: { userId: 'user-1' },
    });
  });

  it('bounds the motivation lookup by the member too', async () => {
    // Belt and braces: even a hit that arrived from the query above is only
    // rendered if its motivation also belongs to this member.
    const { svc, seen } = build({
      credentials: [{ id: 'cred-1', kind: 'IDENTITY_DOCUMENT', sha256: 'a' }],
      uploads: [{ sha256: 'a', kind: 'IDENTITY_DOCUMENT', motivationId: 'mo-1' }],
      motivations: [
        {
          id: 'mo-1',
          referenceNumber: 'MO000123',
          licenceType: 'S16_DEDICATED_HUNTER',
          status: 'DRAFT',
          uploads: [{ kind: 'IDENTITY_DOCUMENT' }],
        },
      ],
    });
    await svc.usage('clerk_1');
    expect(seen.motivationWhere).toMatchObject({ userId: 'user-1' });
  });

  it('reports the application and its annexure letter', async () => {
    const { svc } = build({
      credentials: [{ id: 'cred-1', kind: 'COMPETENCY_CERTIFICATE', sha256: 'a' }],
      uploads: [
        { sha256: 'a', kind: 'COMPETENCY_CERTIFICATE', motivationId: 'mo-1' },
      ],
      motivations: [
        {
          id: 'mo-1',
          referenceNumber: 'MO000123',
          licenceType: 'S16_DEDICATED_HUNTER',
          status: 'DRAFT',
          // ⚠️ THE WHOLE PACK, NOT THE MATCHED ROW. buildAnnexures letters a
          // motivation's uploads in order, so the letter this document carries
          // depends on everything else attached to that application. Reading
          // only the match would letter it A every time.
          uploads: [
            { kind: 'IDENTITY_DOCUMENT' },
            { kind: 'COMPETENCY_CERTIFICATE' },
          ],
        },
      ],
    });
    const out = await svc.usage('clerk_1');
    expect(out['cred-1']).toHaveLength(1);
    expect(out['cred-1'][0].referenceNumber).toBe('MO000123');
    // Second in the pack, so not the first letter.
    expect(out['cred-1'][0].annexure).not.toBe('A');
    expect(out['cred-1'][0].annexure).toBeTruthy();
  });

  it('lists an application ONCE even when it holds several copies', async () => {
    // Four photographs of one safe are four upload rows sharing one annexure
    // letter. "Used in MO000123 · MO000123 · MO000123 · MO000123" is noise.
    const { svc } = build({
      credentials: [{ id: 'cred-1', kind: 'SAFE_PHOTOGRAPHS', sha256: 'a' }],
      uploads: [
        { sha256: 'a', kind: 'SAFE_PHOTOGRAPHS', motivationId: 'mo-1' },
        { sha256: 'a', kind: 'SAFE_PHOTOGRAPHS', motivationId: 'mo-1' },
      ],
      motivations: [
        {
          id: 'mo-1',
          referenceNumber: 'MO000123',
          licenceType: 'S16_DEDICATED_HUNTER',
          status: 'DRAFT',
          uploads: [{ kind: 'SAFE_PHOTOGRAPHS' }],
        },
      ],
    });
    const out = await svc.usage('clerk_1');
    expect(out['cred-1']).toHaveLength(1);
  });

  it('says nothing at all about a document in no application', async () => {
    // Which is most of them, and the panel renders no heading for an empty
    // list — an empty "Used in" is worse than no "Used in".
    const { svc } = build({
      credentials: [{ id: 'cred-1', kind: 'IDENTITY_DOCUMENT', sha256: 'a' }],
      uploads: [],
    });
    expect(await svc.usage('clerk_1')).toEqual({});
  });

  it('does not query at all for a member holding nothing', async () => {
    const { svc, prisma } = build({ credentials: [] });
    expect(await svc.usage('clerk_1')).toEqual({});
    expect(prisma.motivationUpload.findMany).not.toHaveBeenCalled();
  });
});
