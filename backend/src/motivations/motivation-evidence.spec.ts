import {
  CredentialKind,
  MotivationLicenceType,
  MotivationUploadKind,
} from '@prisma/client';
import { MotivationDocumentsService } from './motivation-documents.service';
import { MotivationSharedService } from './motivation-shared.service';
import { MemberProfileAnswersService } from './member-profile-answers.service';
import { encryptText, decryptText } from '../common/blob-crypto';
import {
  EVIDENCE_ANNEXURE_MAX,
  EVIDENCE_BODY_MAX,
} from './evidence-taxonomy';

// ────────────────────────────────────────────────────────────────────
// EVIDENCE INSIDE A MOTIVATION — what a pick copies, and what it costs.
//
// An evidence item is a vault Credential whose master copy was classified on
// the way in. Picking it into an application is the ordinary library copy —
// the same bytes, the same sha256 unique index — and what is NEW here is
// what rides with it:
//
//   • the CONTAINER, because it decides annexure-vs-body and, through
//     `satisfies`, ticks a DFO row;
//   • the DESCRIPTION, because it captions the picture in the body;
//   • and the two SEPARATE CAPS, because evidence must not be a side door
//     past the sixteen document slots the paperwork needs.
//
// ⚠️ THE ONE THAT WOULD BE MISSED IN REVIEW is the cap split. Evidence
// counting against MAX_UPLOADS would let four hunting photographs crowd out
// four of the sixteen documents SAPS actually processes, and it would only
// ever show in the field, on a member who had done nothing wrong.
// ────────────────────────────────────────────────────────────────────

const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-motivation-evidence';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

const K = MotivationUploadKind;
const C = CredentialKind;

/** A vault Credential, shaped the way attachOne's source fetch reads it. */
function credential(o: {
  id: string;
  kind?: CredentialKind;
  evidenceType?: string | null;
  evidenceConfidence?: string | null;
  description?: string | null;
}) {
  return {
    id: o.id,
    userId: 'user-1',
    kind: o.kind ?? C.EVIDENCE,
    storageKey: `credentials/${o.id}.enc`,
    mimeType: 'image/jpeg',
    purgedAt: null,
    detailsEncrypted: null,
    extractionOk: true,
    expiresOn: null,
    duplicateOfId: null,
    otherSideId: null,
    evidenceType: o.evidenceType ?? null,
    evidenceConfidence: o.evidenceConfidence ?? null,
    evidenceDescriptionEncrypted: o.description
      ? encryptText(o.description)
      : null,
  };
}

/** A MotivationUpload already filed against the application, for cap tests. */
function filed(o: {
  id: string;
  kind: MotivationUploadKind;
  evidenceType?: string | null;
}) {
  return {
    id: o.id,
    motivationId: 'mo-1',
    kind: o.kind,
    evidenceType: o.evidenceType ?? null,
    evidenceConfidence: 'high',
    evidenceDescriptionEncrypted: null as string | null,
    coversKinds: [] as MotivationUploadKind[],
    mimeType: 'image/jpeg',
    byteSize: 5,
    createdAt: new Date('2026-09-20T00:00:00Z'),
    purgedAt: null,
    storageKey: `motivations/${o.id}`,
    extractionOk: true,
    extractedFields: [] as string[],
    extractionEncrypted: null,
    sourceCredential: { expiresOn: null },
    sourceRemovedAt: null,
  };
}

function build(o: {
  creds?: ReturnType<typeof credential>[];
  uploads?: ReturnType<typeof filed>[];
}) {
  const created: Record<string, any>[] = [];
  const creds = o.creds ?? [];
  const uploads = o.uploads ?? [];

  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    motivation: {
      findFirst: jest.fn(async (a: any) => {
        // listUploads asks for the whole uploads relation; openForAttach asks
        // for the editable row alone. Two callers, two shapes.
        if (a?.select?.uploads) {
          return {
            id: 'mo-1',
            licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
            answersEncrypted: null,
            uploads,
          };
        }
        return {
          id: 'mo-1',
          status: 'DRAFT',
          licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
          answersEncrypted: null,
        };
      }),
    },
    credential: {
      findFirst: jest.fn(async (a: any) => {
        const select = a?.select ?? {};
        // otherSideOf's first probe: is this a paired page at all?
        if ('otherSideId' in select && Object.keys(select).length === 1) {
          return { otherSideId: null };
        }
        const c = creds.find(
          (x) =>
            x.id === a?.where?.id &&
            (a?.where?.userId === undefined || x.userId === a.where.userId),
        );
        if (!c) return null;
        // placementOf asks for kind + evidenceType only; the attach source
        // fetch adds storageKey. Distinguish on the presence of storageKey.
        if ('evidenceType' in select && !('storageKey' in select)) {
          return { kind: c.kind, evidenceType: c.evidenceType };
        }
        return c;
      }),
      findMany: jest.fn(async (a: any) => {
        // proficiencyFor's vault half.
        if (a?.where?.kind === 'PROFICIENCY') return [];
        return creds.map((c) => ({ sha256: `sha-${c.id}` }));
      }),
    },
    motivationUpload: {
      findMany: jest.fn(async (a: any) => {
        // proficiencyFor's upload half.
        if (a?.select?.ocrTextEncrypted) return [];
        // capacityFor — kind and evidenceType only, for the rows on THIS pack.
        return uploads
          .filter((u) => u.motivationId === a?.where?.motivationId)
          .map((u) => ({ kind: u.kind, evidenceType: u.evidenceType }));
      }),
      findFirst: jest.fn(async (a: any) => {
        // The "already on this pack" pre-flight, by hash.
        if (a?.where?.sha256 !== undefined) return null;
        return uploads.find((u) => u.id === a?.where?.id) ?? null;
      }),
      create: jest.fn(async (a: any) => {
        created.push(a.data);
        return {
          id: `up-${created.length}`,
          kind: a.data.kind,
          byteSize: a.data.byteSize,
          createdAt: new Date(),
        };
      }),
    },
  };

  const files = {
    read: jest.fn(async () => Buffer.from('bytes')),
    write: jest.fn(async (_ns: string, bytes: Buffer) => ({
      storageKey: `motivations/${bytes.toString()}`,
      sha256: `sha-${bytes.toString()}`,
      byteSize: bytes.length,
    })),
    remove: jest.fn(async () => undefined),
  };

  const shared = new MotivationSharedService(
    prisma as never,
    new MemberProfileAnswersService(prisma as never),
  );

  const svc = new MotivationDocumentsService(
    prisma as never,
    { assertEnabled: jest.fn(async () => undefined) } as never,
    files as never,
    { extract: jest.fn(async () => []), ocr: jest.fn(async () => null) } as never,
    { adoptUpload: jest.fn(async () => false) } as never,
    {
      mayOfferAcross: jest.fn(async () => true),
      mayKeepFor: jest.fn(async () => true),
    } as never,
    shared,
    { note: () => undefined } as never,
    { key: () => 'k', get: async () => null, put: async () => undefined, forget: async () => 0, purgeExpired: async () => 0 } as never,
    { pagesFor: async () => [], forget: async () => 0, purgeExpired: async () => 0 } as never,
    // The identify store, injected but unused here.
    {
      findBySha: jest.fn(async () => null),
      put: jest.fn(async () => undefined),
      take: jest.fn(async () => null),
      get: jest.fn(async () => null),
      purgeExpired: jest.fn(async () => 0),
    } as never,
    { reapplyOffer: jest.fn(async () => []) } as never,
  );

  return { svc, created, prisma };
}

describe('picking an evidence item into an application', () => {
  it('carries the container, so the copy prints the way the master does', async () => {
    const { svc, created } = build({
      creds: [
        credential({
          id: 'c-annex',
          evidenceType: 'FARM_PERMISSION_LETTER',
          evidenceConfidence: 'high',
          description: 'my farmer says I may hunt',
        }),
      ],
    });
    await svc.addFromLibrary('user-1', 'mo-1', 'credential', 'c-annex', true);
    expect(created[0]).toMatchObject({
      kind: K.EVIDENCE,
      evidenceType: 'FARM_PERMISSION_LETTER',
      evidenceConfidence: 'high',
    });
    // The words ride along ENCRYPTED, exactly as they sit in the vault.
    expect(decryptText(created[0].evidenceDescriptionEncrypted)).toBe(
      'my farmer says I may hunt',
    );
  });

  it('⚠️ TICKS THE DFO ROW ITS CONTAINER ANSWERS, WITHOUT A SECOND LETTER', async () => {
    // A written permission to hunt IS the applicant's proof of where the
    // firearm will be used, and the container says so. `satisfies` becomes
    // coversKinds, which ticks the row in documentStatus — it does NOT mint a
    // second annexure letter for one page.
    const { svc, created } = build({
      creds: [
        credential({
          id: 'c-annex',
          evidenceType: 'FARM_PERMISSION_LETTER',
          evidenceConfidence: 'high',
        }),
      ],
    });
    await svc.addFromLibrary('user-1', 'mo-1', 'credential', 'c-annex', true);
    expect(created[0].coversKinds).toContain(K.FIREARM_SOURCE_PROOF);
  });

  it('ticks nothing for an activity photograph, which answers no row', async () => {
    const { svc, created } = build({
      creds: [
        credential({
          id: 'c-photo',
          evidenceType: 'HUNTING_PHOTO',
          evidenceConfidence: 'high',
        }),
      ],
    });
    await svc.addFromLibrary('user-1', 'mo-1', 'credential', 'c-photo', true);
    expect(created[0].coversKinds).toEqual([]);
  });

  it('⚠️ A LOW-CONFIDENCE ITEM CARRIES NO CONTAINER AND TICKS NOTHING', async () => {
    // The vault stored no container because a wrong one is worse than none —
    // see createEvidence. The copy must not invent one, and it must not tick
    // a row on a guess. It is a body photograph until somebody says otherwise.
    const { svc, created } = build({
      creds: [
        credential({
          id: 'c-lost',
          evidenceType: null,
          evidenceConfidence: 'low',
          description: 'not sure',
        }),
      ],
    });
    await svc.addFromLibrary('user-1', 'mo-1', 'credential', 'c-lost', true);
    expect(created[0].evidenceType).toBeNull();
    expect(created[0].coversKinds).toEqual([]);
  });
});

describe('the evidence caps are separate from the document cap', () => {
  const atBody = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      filed({ id: `b${i}`, kind: K.EVIDENCE, evidenceType: 'HUNTING_PHOTO' }),
    );

  it(`⚠️ REFUSES A THIRD ANNEXURE EVIDENCE ITEM (${EVIDENCE_ANNEXURE_MAX} maximum)`, async () => {
    const { svc, created } = build({
      uploads: [
        filed({ id: 'a1', kind: K.EVIDENCE, evidenceType: 'FARM_PERMISSION_LETTER' }),
        filed({ id: 'a2', kind: K.EVIDENCE, evidenceType: 'HUNTING_INVITATION' }),
      ],
      creds: [
        credential({
          id: 'c-annex',
          evidenceType: 'AFFIDAVIT',
          evidenceConfidence: 'high',
        }),
      ],
    });
    await expect(
      svc.addFromLibrary('user-1', 'mo-1', 'credential', 'c-annex', true),
    ).rejects.toThrow(new RegExp(`${EVIDENCE_ANNEXURE_MAX} evidence documents`));
    expect(created).toHaveLength(0);
  });

  it(`⚠️ REFUSES A FIFTH ACTIVITY PHOTOGRAPH (${EVIDENCE_BODY_MAX} maximum)`, async () => {
    const { svc, created } = build({
      uploads: atBody(EVIDENCE_BODY_MAX),
      creds: [
        credential({
          id: 'c-photo',
          evidenceType: 'RANGE_PHOTO',
          evidenceConfidence: 'high',
        }),
      ],
    });
    await expect(
      svc.addFromLibrary('user-1', 'mo-1', 'credential', 'c-photo', true),
    ).rejects.toThrow(new RegExp(`${EVIDENCE_BODY_MAX} activity photographs`));
    expect(created).toHaveLength(0);
  });

  it('lets the two caps be full at once — they are different limits', async () => {
    const { svc, created } = build({
      uploads: [
        filed({ id: 'a1', kind: K.EVIDENCE, evidenceType: 'FARM_PERMISSION_LETTER' }),
        filed({ id: 'a2', kind: K.EVIDENCE, evidenceType: 'HUNTING_INVITATION' }),
        ...atBody(EVIDENCE_BODY_MAX),
      ],
      creds: [
        credential({ id: 'c-new', kind: C.EVIDENCE, evidenceType: 'HUNTING_PHOTO' }),
      ],
    });
    // The body tier is full, so this one is refused for the BODY reason and
    // not the annexure reason — the two counters are independent.
    await expect(
      svc.addFromLibrary('user-1', 'mo-1', 'credential', 'c-new', true),
    ).rejects.toThrow(/activity photographs/);
    expect(created).toHaveLength(0);
  });

  it('⚠️ A DOCUMENT CAN STILL BE ADDED ALONGSIDE A FULL EVIDENCE ALLOWANCE', async () => {
    // THE CASE THAT MATTERS. Two annexure letters and four photographs must
    // not consume six of the sixteen document slots, or a member with a
    // complete paper pack plus six photographs is refused the sixteenth
    // document by a cap that was never about photographs.
    const { svc, created } = build({
      uploads: [
        filed({ id: 'a1', kind: K.EVIDENCE, evidenceType: 'FARM_PERMISSION_LETTER' }),
        filed({ id: 'a2', kind: K.EVIDENCE, evidenceType: 'AFFIDAVIT' }),
        ...atBody(EVIDENCE_BODY_MAX),
        ...Array.from({ length: 14 }, (_, i) =>
          filed({ id: `d${i}`, kind: K.IDENTITY_DOCUMENT }),
        ),
      ],
      creds: [
        credential({
          id: 'c-doc',
          kind: C.COMPETENCY_CERTIFICATE,
          evidenceType: null,
        }),
      ],
    });
    await svc.addFromLibrary('user-1', 'mo-1', 'credential', 'c-doc', true);
    // 14 documents + 1 = 15 of 16; the six evidence items cost nothing.
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe(K.COMPETENCY_CERTIFICATE);
  });

  it('⚠️ AND THE DOCUMENT CEILING STILL APPLIES TO DOCUMENTS', async () => {
    const { svc } = build({
      uploads: Array.from({ length: 16 }, (_, i) =>
        filed({ id: `d${i}`, kind: K.IDENTITY_DOCUMENT }),
      ),
      creds: [
        credential({
          id: 'c-doc',
          kind: C.COMPETENCY_CERTIFICATE,
        }),
      ],
    });
    await expect(
      svc.addFromLibrary('user-1', 'mo-1', 'credential', 'c-doc', true),
    ).rejects.toThrow(/16 documents/);
  });
});

describe('an evidence row on the member\u2019s own page', () => {
  it('reports the container, its placement, and the words to correct', async () => {
    const row = filed({
      id: 'u1',
      kind: K.EVIDENCE,
      evidenceType: 'FARM_PERMISSION_LETTER',
    });
    row.evidenceDescriptionEncrypted = encryptText('my farmer says I may hunt');
    const { svc } = build({ uploads: [row] });
    const out = await svc.listUploads('user-1', 'mo-1');
    const file = out.files.find((f) => f.id === 'u1')!;
    expect(file.evidence).toMatchObject({
      container: 'FARM_PERMISSION_LETTER',
      placement: 'annexure',
      confident: true,
      description: 'my farmer says I may hunt',
    });
    expect(file.evidence!.ask).toBeNull();
  });

  it('⚠️ AN UNPLACEABLE ITEM READS AS "TELL US MORE", NOT AS BROKEN', async () => {
    // container: null is the ONE flag, whatever the cause — a model that
    // could not decide, or a container id retired since. Either way the
    // member's next step is the same, and the row must not look like an error.
    const { svc } = build({
      uploads: [filed({ id: 'u1', kind: K.EVIDENCE, evidenceType: null })],
    });
    const out = await svc.listUploads('user-1', 'mo-1');
    const file = out.files.find((f) => f.id === 'u1')!;
    expect(file.evidence).toMatchObject({ container: null, placement: null });
    expect(file.evidence!.ask).toBeTruthy();
  });

  it('⚠️ NEVER MARKS AN EVIDENCE ROW SUSPECT FOR AN UNREAD PAGE', async () => {
    // `suspect` is the amber "we could not read anything off it". Evidence is
    // never read for fields — by design, see credential-kinds.ts — so a
    // photograph must not be flagged for having yielded nothing.
    const row = filed({ id: 'u1', kind: K.EVIDENCE, evidenceType: 'HUNTING_PHOTO' });
    row.extractionOk = false;
    const { svc } = build({ uploads: [row] });
    const out = await svc.listUploads('user-1', 'mo-1');
    expect(out.files.find((f) => f.id === 'u1')!.suspect).toBe(false);
  });

  it('leaves evidence out of the document menu entirely', async () => {
    const { svc } = build({ uploads: [] });
    const out = await svc.listUploads('user-1', 'mo-1');
    expect(out.kinds.map((k) => k.kind)).not.toContain(K.EVIDENCE);
  });
});
