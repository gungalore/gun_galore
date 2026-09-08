import { MotivationUploadKind } from '@prisma/client';
import {
  LibraryCredentialRow,
  LibraryUploadRow,
  buildLibrary,
  leadsPair,
} from './motivation-library';
import { MotivationDocumentsService } from './motivation-documents.service';
import { MotivationSharedService } from './motivation-shared.service';
import { MemberProfileAnswersService } from './member-profile-answers.service';
import { encryptJson, decryptJson } from '../common/blob-crypto';

// ────────────────────────────────────────────────────────────────────
// A TWO-PAGE DOCUMENT IS ONE LINE, AND PICKING IT ATTACHES BOTH PAGES.
//
// Operator, 2026-09-07, driving a section 13 on production: "the proficiencies
// are still double in that dropdown". A two-page proficiency is TWO Credential
// rows — the provider's certificate (front) and the PFTC statement of results
// (back), linked by otherSideId — carrying the same derived title and the same
// day. The only de-duplication the library had was sha256, and two photographs
// of two different pages never share one; both also map to
// PROFICIENCY_CERTIFICATE, so both survived the slot filter as well. Four
// documents rendered as eight options.
//
// ⚠️ AND THE HALF THAT MATTERS MORE THAN THE DOUBLE. Folding the picker without
// carrying the other page across would trade a cosmetic bug for a certificate
// filed with no statement of results behind it, in front of a DFO, over the
// applicant's signature. Both halves are pinned here.
//
// ⚠️ EVERY FOLD TEST BELOW PASSES UPLOADS, AND THAT IS THE POINT. The first
// version of this file passed `[]` for uploads in all five fold tests, and the
// library is a UNION OF TWO STORES — so seventeen green tests stood over a fold
// that was only correct while the second store was empty. Run against the real
// buildLibrary on 2026-09-07, with the vault pair plus one upload copy of the
// back page, the picker offered `["upload:u2"]` and picking it attached a
// statement of results with NO certificate behind it. With the pair attached
// here and the front then deleted, it offered NOTHING and the member could not
// repair the pack. Both are reproduced below, by name.
// ────────────────────────────────────────────────────────────────────

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const label = (k: string) =>
  ({
    PROFICIENCY_CERTIFICATE: 'Your proficiency certificate',
    COMPETENCY_CERTIFICATE: 'Your SAPS competency certificate',
  })[k] ?? k;

const page = (
  o: Partial<LibraryCredentialRow> & { id: string },
): LibraryCredentialRow => ({
  kind: 'PROFICIENCY',
  title: 'Proficiency — Handgun',
  createdAt: day('2026-09-07'),
  storageKey: `credentials/2026/09/${o.id}.enc`,
  purgedAt: null,
  // ⚠️ DIFFERENT HASHES, DELIBERATELY. Two photographs of two different pages
  // cannot share one, which is exactly why the sha256 fold could never see
  // this pair — the test would be meaningless with equal hashes.
  sha256: `sha-${o.id}`,
  ...o,
});

/** Both halves of one proficiency, pointing at each other as the vault sets them. */
const pair = (
  front: Partial<LibraryCredentialRow> = {},
  back: Partial<LibraryCredentialRow> = {},
) => [
  page({ id: 'front', otherSideId: 'back', documentSide: 'front', ...front }),
  page({ id: 'back', otherSideId: 'front', documentSide: 'back', ...back }),
];

/** A copy of one page, filed against an application. */
const copy = (
  o: Partial<LibraryUploadRow> & { id: string; sha256: string },
): LibraryUploadRow => ({
  motivationId: 'older',
  kind: MotivationUploadKind.PROFICIENCY_CERTIFICATE,
  createdAt: day('2026-09-01'),
  storageKey: `motivations/${o.id}`,
  purgedAt: null,
  ...o,
});

const listed = (items: { source: string; sourceId: string }[]) =>
  items.map((i) => `${i.source}:${i.sourceId}`);

describe('the reuse picker shows one line per document', () => {
  it('⚠️ FOLDS A TWO-PAGE PROFICIENCY INTO ONE ENTRY, led by the statement of results', () => {
    const items = buildLibrary(pair(), [], 'current', label);
    expect(items).toHaveLength(1);
    // The back leads: it is the page carrying the unit standards, and it is
    // the page the Document Centre's own list shows.
    expect(items[0].sourceId).toBe('back');
  });

  it('⚠️ OFFERS THE DOCUMENT WHEN A COPY OF THE LEAD SITS ON AN EARLIER APPLICATION', () => {
    // THE FIRST CRITICAL. The fold dropped the follower, and the sha256 dedupe
    // then dropped the LEAD — because an upload copy of the same bytes had
    // already claimed that hash — so the document was offered NOWHERE, and the
    // one line left was an upload copy, which cannot carry its other page.
    const items = buildLibrary(
      pair(),
      [copy({ id: 'u2', sha256: 'sha-back' })],
      'current',
      label,
    );
    // Exactly once. And from the VAULT, because a vault entry is the only one
    // that knows where its other page is.
    expect(listed(items)).toEqual(['credential:back']);
  });

  it('⚠️ OFFERS THE DOCUMENT AGAIN WHEN THE MEMBER HAS DELETED ONE OF ITS PAGES', () => {
    // THE SECOND CRITICAL. `alreadyHere` was the LEAD's hash alone, and the
    // picker hides an alreadyHere row outright — so a pack holding the
    // statement of results and missing the certificate read as "you already
    // have this", and no screen offered a way to put the missing page back.
    const items = buildLibrary(
      pair(),
      [copy({ id: 'u3', motivationId: 'current', sha256: 'sha-back' })],
      'current',
      label,
    );
    expect(listed(items)).toEqual(['credential:back']);
    expect(items[0].alreadyHere).toBe(false);
  });

  it('marks a folded document attached only when BOTH pages are on the pack', () => {
    const items = buildLibrary(
      pair(),
      [
        copy({ id: 'u4', motivationId: 'current', sha256: 'sha-back' }),
        copy({ id: 'u5', motivationId: 'current', sha256: 'sha-front' }),
      ],
      'current',
      label,
    );
    expect(listed(items)).toEqual(['credential:back']);
    expect(items[0].alreadyHere).toBe(true);
  });

  it('⚠️ FOLDS TWO UPLOAD COPIES OF ONE DOCUMENT, which is the path most members are on', () => {
    // The operator's actual complaint. Both pages were copied onto an earlier
    // application, so both reached the picker from the UPLOAD store — same
    // slot, same label, same day, two selectable lines. The vault half of the
    // fold never saw them, and `library()` did not even select the column that
    // ties a copy back to the row holding its pairing.
    const items = buildLibrary(
      pair(),
      [
        copy({ id: 'uf', sha256: 'sha-front', sourceCredentialId: 'front' }),
        copy({ id: 'ub', sha256: 'sha-back', sourceCredentialId: 'back' }),
      ],
      'current',
      label,
    );
    expect(listed(items)).toEqual(['credential:back']);
  });

  it('folds an upload copy that never recorded where it came from, on content alone', () => {
    // An upload ADOPTED into the vault carries no sourceCredentialId — the
    // copy went the other way — so the bytes are the only join there is.
    const items = buildLibrary(
      pair(),
      [
        copy({ id: 'uf', sha256: 'sha-front' }),
        copy({ id: 'ub', sha256: 'sha-back' }),
      ],
      'current',
      label,
    );
    expect(listed(items)).toEqual(['credential:back']);
  });

  it('⚠️ LISTS TWO COPIES WHOSE VAULT ROWS ARE GONE, because nothing knows better', () => {
    // Deleting the pages from the Centre takes `otherSideId` with them and
    // nulls `sourceCredentialId` (schema.prisma, onDelete: SetNull), so no
    // column anywhere records that these two files are one document. Two lines
    // is the honest answer; folding on a guess would hide a page.
    const items = buildLibrary(
      [],
      [
        copy({ id: 'uf', sha256: 'sha-front' }),
        copy({ id: 'ub', sha256: 'sha-back' }),
      ],
      'current',
      label,
    );
    expect(listed(items)).toEqual(['upload:uf', 'upload:ub']);
  });

  it('⚠️ KEEPS A LONE PAGE, because a partner that is absent is not a duplicate', () => {
    // The statement of results was never uploaded. A certificate on its own is
    // still a document the member can attach, and disappearing with a page
    // that does not exist would be worse than the double.
    const items = buildLibrary(
      [page({ id: 'front', otherSideId: 'back', documentSide: 'front' })],
      [copy({ id: 'u1', sha256: 'sha-other-thing' })],
      'current',
      label,
    );
    expect(listed(items)).toEqual(['upload:u1', 'credential:front']);
  });

  it('⚠️ KEEPS A PAGE WHOSE PARTNER HAS BEEN PURGED', () => {
    // The partner row survives its bytes, and a page with no bytes is never
    // offered — so it cannot stand for the pair either.
    const [front, back] = pair({}, { storageKey: null, purgedAt: day('2026-09-01') });
    const items = buildLibrary([front, back], [], 'current', label);
    expect(listed(items)).toEqual(['credential:front']);
  });

  it('⚠️ LOSES NEITHER PAGE WHEN THE READER NEVER SAID WHICH SIDE IS WHICH', () => {
    // The fault the old backend-local rule had: it read only its OWN side, so
    // an unlabelled page paired with a front fell through to `id < other` —
    // and where that came out false the front had already stood down, leaving
    // NO page standing for the pair. The proficiency vanished entirely.
    const items = buildLibrary(
      [
        page({ id: 'zzz', otherSideId: 'aaa', documentSide: null }),
        page({ id: 'aaa', otherSideId: 'zzz', documentSide: 'front' }),
      ],
      [copy({ id: 'u9', sha256: 'sha-zzz' })],
      'current',
      label,
    );
    expect(listed(items)).toEqual(['credential:zzz']);
  });

  it('leaves an unpaired document exactly as it was, copy and all', () => {
    // The cross-store sha256 dedupe is untouched: one document, one line, and
    // the copy already in front of the member is the one that is listed.
    const items = buildLibrary(
      [
        page({ id: 'c1', kind: 'COMPETENCY_CERTIFICATE', title: 'Competency 2024' }),
        page({ id: 'c2', kind: 'COMPETENCY_CERTIFICATE', title: 'Competency 2019' }),
      ],
      [copy({ id: 'u1', sha256: 'sha-c1', kind: MotivationUploadKind.COMPETENCY_CERTIFICATE })],
      'current',
      label,
    );
    expect(listed(items)).toEqual(['upload:u1', 'credential:c2']);
  });

  it('⚠️ NEVER OFFERS A DOCUMENT ZERO TIMES, over every arrangement of the two stores', () => {
    // The invariant the two criticals broke, asserted directly rather than
    // case by case: whatever copies exist and wherever they live, a proficiency
    // the member holds is on the list exactly once.
    const wheres: (Partial<LibraryUploadRow> & { id: string; sha256: string })[][] = [
      [],
      [copy({ id: 'a', sha256: 'sha-back' })],
      [copy({ id: 'a', sha256: 'sha-front' })],
      [copy({ id: 'a', sha256: 'sha-back', motivationId: 'current' })],
      [copy({ id: 'a', sha256: 'sha-front', motivationId: 'current' })],
      [copy({ id: 'a', sha256: 'sha-front' }), copy({ id: 'b', sha256: 'sha-back' })],
      [
        copy({ id: 'a', sha256: 'sha-front', motivationId: 'current' }),
        copy({ id: 'b', sha256: 'sha-back' }),
      ],
    ];
    for (const uploads of wheres) {
      const items = buildLibrary(pair(), uploads as LibraryUploadRow[], 'current', label);
      const proficiency = items.filter(
        (i) => i.kind === MotivationUploadKind.PROFICIENCY_CERTIFICATE,
      );
      expect(proficiency).toHaveLength(1);
    }
  });
});

describe('which page stands for the pair', () => {
  const at = (id: string, side: 'front' | 'back' | null, when = '2026-09-07') => ({
    id,
    createdAt: day(when),
    documentSide: side,
  });

  it('the statement of results leads, whichever way round it is asked', () => {
    expect(leadsPair(at('a', 'back'), at('b', 'front'))).toBe(true);
    expect(leadsPair(at('b', 'front'), at('a', 'back'))).toBe(false);
  });

  it('a page the reader could not label loses to a statement and beats a certificate', () => {
    expect(leadsPair(at('a', null), at('b', 'back'))).toBe(false);
    expect(leadsPair(at('a', null), at('b', 'front'))).toBe(true);
  });

  it('⚠️ EXACTLY ONE PAGE LEADS, even if both claim the same side', () => {
    // Cannot happen today — findOtherSide only ever pairs opposite sides — but
    // a re-read can change a side after the fact, and two "leading" pages is
    // the doubling this whole change exists to remove.
    const a = at('a', 'back', '2026-09-01');
    const b = at('b', 'back', '2026-09-05');
    expect(leadsPair(a, b)).toBe(true);
    expect(leadsPair(b, a)).toBe(false);
  });

  it('the older page leads where neither was labelled, the id breaking a tie', () => {
    expect(leadsPair(at('b', null, '2026-09-01'), at('a', null, '2026-09-05'))).toBe(true);
    expect(leadsPair(at('a', null), at('b', null))).toBe(true);
    expect(leadsPair(at('b', null), at('a', null))).toBe(false);
  });
});

// ── picking the folded entry ────────────────────────────────────────

const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-motivation-library-pairs';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

type FakeCredential = {
  id: string;
  kind: string;
  storageKey: string | null;
  sha256: string;
  mimeType: string;
  purgedAt: Date | null;
  detailsEncrypted: string | null;
  extractionOk: boolean;
  otherSideId: string | null;
};

type FakeUpload = {
  id: string;
  motivationId: string;
  kind: MotivationUploadKind;
  sha256: string;
  storageKey: string | null;
  purgedAt: Date | null;
  mimeType: string;
  extractionOk: boolean;
  extractedFields: string[];
  extractionEncrypted: string | null;
  sourceCredentialId: string | null;
};

/**
 * ⚠️ THE COPY'S HASH IS THE SOURCE'S HASH, AND THE CEILING CHECK DEPENDS ON IT.
 * Credential.sha256 and MotivationUpload.sha256 are both taken over the
 * PLAINTEXT bytes, so a copy of a vault page lands on the pack under the hash
 * the vault row already carries. The fake storage below reproduces that.
 */
const hashOf = (storageKey: string) => `sha-${storageKey}`;

function build(
  rows: FakeCredential[],
  opts: {
    readFails?: string[];
    /** Documents already on the application being filled in. */
    pack?: FakeUpload[];
    /** Uploads elsewhere in the member's account, for an upload-sourced pick. */
    elsewhere?: FakeUpload[];
    /** Stand-in for the prefill service's competency re-derivation. */
    competency?: {
      values: Record<string, string>;
      provenance: Record<string, unknown>;
    } | null;
    /**
     * What autolink's own GATED candidate query returns.
     *
     * ⚠️ THIS IS THE SETTLED-DATE GATE, MODELLED WHERE IT ACTUALLY LIVES. The
     * predicate is a WHERE clause — `confirmedAt` OR `dateSource` — so the
     * honest way to test that the ride-along respects it is to return the rows
     * that clause would return and assert nothing outside them is attached.
     */
    candidates?: Record<string, unknown>[];
    autolinkedAt?: Date | null;
  } = {},
) {
  const pack: FakeUpload[] = [...(opts.pack ?? [])];
  const all = () => [...pack, ...(opts.elsewhere ?? [])];
  const created: {
    kind: string;
    sha256: string;
    sourceCredentialId: string | null;
  }[] = [];
  let saved: Record<string, string> | null = null;

  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    motivation: {
      findFirst: jest.fn(async (a: any) =>
        // autolink() asks for a wider row than openForAttach does; both are
        // the same application.
        a?.select?.autolinkedAt !== undefined
          ? {
              id: 'mo-1',
              licenceType: 'S15_OCCASIONAL_HUNTER',
              status: 'DRAFT',
              autolinkedAt: opts.autolinkedAt ?? null,
              autolinkSkippedIds: [] as string[],
              answersEncrypted: null,
            }
          : {
              id: 'mo-1',
              status: 'DRAFT',
              licenceType: 'S13_SELF_DEFENCE',
              answersEncrypted: null,
              answerProvenance: null,
            },
      ),
      update: jest.fn(async ({ data }: any) => {
        // autolink stamps `autolinkedAt` and writes no answers at all.
        if (data.answersEncrypted) {
          saved = decryptJson<Record<string, string>>(data.answersEncrypted) ?? {};
        }
        return { id: 'mo-1' };
      }),
    },
    credential: {
      findFirst: jest.fn(async ({ where }: any) => {
        const row = rows.find(
          (r) =>
            (where.id === undefined || r.id === where.id) &&
            (where.sha256 === undefined || r.sha256 === where.sha256) &&
            (where.otherSideId === undefined || r.otherSideId !== null),
        );
        if (!row) return null;
        // The ownership clause and the "still has bytes" clause both live in
        // the WHERE, so the fake honours them rather than the caller.
        if (where.storageKey && row.storageKey === null) return null;
        if (where.purgedAt === null && row.purgedAt) return null;
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        // roomForPair asks for two named rows; autolink asks its gated
        // candidate query. Two callers, two shapes.
        where.id?.in
          ? rows.filter((r) => where.id.in.includes(r.id))
          : (opts.candidates ?? []),
      ),
    },
    motivationUpload: {
      count: jest.fn(async () => pack.length),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.sha256 !== undefined) {
          const hit = pack.find((u) => u.sha256 === where.sha256);
          return hit
            ? { id: hit.id, kind: hit.kind, byteSize: 1, createdAt: new Date() }
            : null;
        }
        return all().find((u) => u.id === where.id) ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        where.sha256?.in
          ? pack.filter((u) => where.sha256.in.includes(u.sha256))
          : pack.map((u) => ({
              kind: u.kind,
              sha256: u.sha256,
              sourceCredentialId: u.sourceCredentialId,
            })),
      ),
      create: jest.fn(async ({ data }: any) => {
        created.push({
          kind: data.kind,
          sha256: data.sha256,
          sourceCredentialId: data.sourceCredentialId ?? null,
        });
        pack.push({
          id: `up-${created.length}`,
          motivationId: 'mo-1',
          kind: data.kind,
          sha256: data.sha256,
          storageKey: data.storageKey,
          purgedAt: null,
          mimeType: data.mimeType,
          extractionOk: data.extractionOk,
          extractedFields: data.extractedFields,
          extractionEncrypted: data.extractionEncrypted,
          sourceCredentialId: data.sourceCredentialId ?? null,
        });
        return { id: `up-${created.length}`, kind: data.kind, byteSize: data.byteSize };
      }),
    },
  };
  const files = {
    // The bytes stand for the page, so the copy's hash differs per page —
    // otherwise the second attach would look like the same file twice.
    read: jest.fn(async (key: string) => {
      if (opts.readFails?.some((k) => key.includes(k))) {
        throw new Error('storage is down');
      }
      return Buffer.from(key);
    }),
    write: jest.fn(async (_ns: string, bytes: Buffer) => ({
      storageKey: `motivations/${bytes.toString()}`,
      sha256: hashOf(bytes.toString()),
      byteSize: bytes.length,
    })),
    remove: jest.fn(async () => undefined),
  };
  const extract = { extract: jest.fn(async (_a: any) => [] as any[]) };
  const prefill = {
    competencyOffer: jest.fn(async () => opts.competency ?? null),
  };
  const shared = new MotivationSharedService(prisma as never, new MemberProfileAnswersService(prisma as never));
  const service = new MotivationDocumentsService(
    prisma as never,
    { assertEnabled: jest.fn(async () => undefined) } as never,
    files as never,
    extract as never,
    { adoptUpload: jest.fn(async () => false) } as never,
    { mayOfferAcross: jest.fn(async () => true), mayKeepFor: jest.fn(async () => true) } as never,
    shared,
    { note: () => undefined } as never,
    prefill as never,
  );
  return { service, prisma, files, created, prefill, answers: () => saved };
}

const credential = (o: Partial<FakeCredential> & { id: string }): FakeCredential => ({
  kind: 'PROFICIENCY',
  storageKey: `credentials/${o.id}`,
  sha256: hashOf(`credentials/${o.id}`),
  mimeType: 'image/jpeg',
  purgedAt: null,
  detailsEncrypted: null,
  extractionOk: true,
  otherSideId: null,
  ...o,
});

const attached = (o: Partial<FakeUpload> & { id: string; sha256: string }): FakeUpload => ({
  motivationId: 'mo-1',
  kind: MotivationUploadKind.PROFICIENCY_CERTIFICATE,
  storageKey: `motivations/${o.id}`,
  purgedAt: null,
  mimeType: 'image/jpeg',
  extractionOk: false,
  extractedFields: [],
  extractionEncrypted: null,
  sourceCredentialId: null,
  ...o,
});

const bothSides = () => [
  credential({ id: 'back', otherSideId: 'front' }),
  credential({ id: 'front', otherSideId: 'back' }),
];

describe('picking a folded document attaches both of its pages', () => {
  it('⚠️ CARRIES THE PAGE THE MEMBER CANNOT SEE', async () => {
    // The whole risk of the fold. The picker now offers ONE line for a
    // two-page proficiency; if only that page were attached, the member would
    // hand a DFO a certificate with no statement of results behind it and
    // nothing on the screen would have told them.
    const { service, created } = build(bothSides());
    const res = await service.addFromLibrary('clerk-1', 'mo-1', 'credential', 'back');
    expect(created.map((c) => c.sourceCredentialId)).toEqual(['back', 'front']);
    expect(res.alsoAttached).toHaveLength(1);
    expect(res.alsoFailed).toBeNull();
    expect(res.kind).toBe(MotivationUploadKind.PROFICIENCY_CERTIFICATE);
  });

  it('attaches one page for a document that has no other side', async () => {
    const { service, created } = build([credential({ id: 'solo' })]);
    const res = await service.addFromLibrary('clerk-1', 'mo-1', 'credential', 'solo');
    expect(created).toHaveLength(1);
    expect(res.alsoAttached).toEqual([]);
  });

  it('⚠️ CARRIES THE OTHER PAGE BEHIND AN UPLOAD COPY TOO', async () => {
    // The route is directly callable and a stale client holds yesterday's
    // list, so the upload half is a boundary and not a convenience. The copy
    // records where it came from; the vault holds the pairing.
    const { service, created } = build(bothSides(), {
      elsewhere: [
        attached({
          id: 'u1',
          motivationId: 'older',
          sha256: hashOf('credentials/back'),
          sourceCredentialId: 'back',
        }),
      ],
    });
    const res = await service.addFromLibrary('clerk-1', 'mo-1', 'upload', 'u1');
    expect(res.alsoAttached).toHaveLength(1);
    expect(created.map((c) => c.sourceCredentialId)).toEqual([null, 'front']);
  });

  it('finds the pairing behind a copy that never recorded its source, on content', async () => {
    const { service, created } = build(bothSides(), {
      elsewhere: [
        attached({
          id: 'u1',
          motivationId: 'older',
          sha256: hashOf('credentials/back'),
        }),
      ],
    });
    await service.addFromLibrary('clerk-1', 'mo-1', 'upload', 'u1');
    expect(created.map((c) => c.sourceCredentialId)).toEqual([null, 'front']);
  });

  it('asks the vault nothing for a copy of a document that was never paired', async () => {
    // Behaviour, not a query count: a one-page document attaches as one page,
    // and no second row appears from anywhere.
    const { service, created } = build([], {
      elsewhere: [
        attached({
          id: 'u1',
          motivationId: 'older',
          kind: MotivationUploadKind.IDENTITY_DOCUMENT,
          sha256: 'sha-id-copy',
        }),
      ],
    });
    const res = await service.addFromLibrary('clerk-1', 'mo-1', 'upload', 'u1');
    expect(created).toHaveLength(1);
    expect(res.alsoAttached).toEqual([]);
    expect(res.alsoFailed).toBeNull();
  });

  it('⚠️ A FAILED SECOND PAGE COSTS ONE PAGE, NEVER THE PICK — AND SAYS SO', () => {
    // The member asked for the document in front of them. A purged partner or
    // a dead disk is a reason to hand back what did attach, not to refuse the
    // choice they made. What must not happen is silence: `alsoFailed` is the
    // only place the truth exists once the pair is one line on screen.
    const { service, created } = build(bothSides(), { readFails: ['front'] });
    return service
      .addFromLibrary('clerk-1', 'mo-1', 'credential', 'back')
      .then((res) => {
        expect(created.map((c) => c.sourceCredentialId)).toEqual(['back']);
        expect(res.alsoAttached).toEqual([]);
        expect(res.alsoFailed?.reason).toBe('error');
        expect(res.alsoFailed?.message).toMatch(/second page/i);
      });
  });

  it('⚠️ NEVER HANDS BACK A PAGE WHOSE PARTNER WAS PURGED', async () => {
    // otherSideId outlives the bytes it points at. Copying nothing would fail
    // at the read; the partner is simply not attachable and the pick stands.
    const { service, created } = build([
      credential({ id: 'back', otherSideId: 'front' }),
      credential({ id: 'front', otherSideId: 'back', storageKey: null, purgedAt: new Date() }),
    ]);
    const res = await service.addFromLibrary('clerk-1', 'mo-1', 'credential', 'back');
    expect(created).toHaveLength(1);
    expect(res.alsoAttached).toEqual([]);
    expect(res.alsoFailed).toBeNull();
  });
});

describe('the ceiling, when the document is two pages', () => {
  /** Sixteen documents is the cap; this fills it to `n`. */
  const fill = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      attached({ id: `p${i}`, sha256: `sha-filler-${i}`, kind: MotivationUploadKind.OTHER }),
    );

  it('⚠️ REFUSES BOTH PAGES RATHER THAN ATTACHING ONE OF THEM SILENTLY', async () => {
    // At fifteen of sixteen the member picked a folded proficiency, got the
    // certificate, got no error — and with the picker hiding a folded entry it
    // believes is already attached, no way to add the page that was refused.
    const { service, created } = build(bothSides(), { pack: fill(15) });
    await expect(
      service.addFromLibrary('clerk-1', 'mo-1', 'credential', 'back'),
    ).rejects.toThrow(/16 documents/);
    expect(created).toHaveLength(0);
  });

  it('still attaches both pages with exactly enough room', async () => {
    const { service, created } = build(bothSides(), { pack: fill(14) });
    await service.addFromLibrary('clerk-1', 'mo-1', 'credential', 'back');
    expect(created).toHaveLength(2);
  });

  it('⚠️ A PAGE ALREADY ON THE PACK COSTS NO SLOT, so a deleted one can be re-added at the cap', () => {
    // The repair path the fold made necessary. Fifteen documents, one of them
    // the statement of results; the certificate the member deleted still goes
    // back on, because only one of the two pages is new.
    const { service, created } = build(bothSides(), {
      pack: [
        ...fill(14),
        attached({ id: 'here', sha256: hashOf('credentials/back'), sourceCredentialId: 'back' }),
      ],
    });
    return service
      .addFromLibrary('clerk-1', 'mo-1', 'credential', 'back')
      .then((res) => {
        expect(res.alreadyHad).toBe(true);
        expect(created.map((c) => c.sourceCredentialId)).toEqual(['front']);
      });
  });
});

// ── what a card printing "NONE" may become ──────────────────────────
//
// ⚠️ THE CARD KEEPS ITS WORDING; THE ANSWER DOES NOT GET ONE. A SA licence
// card prints NONE in a row that does not apply to that firearm — the
// operator's own Glock card reads "Model NONE" — and every guard between a
// reading and an answer tested only for emptiness, so the word travelled into
// a SAPS 271 the applicant signs ("Firearm 6 — frame serial NONE", seen live
// on 2026-09-07). These are the boundaries in THIS file. The vault and the
// printed seller-consent declaration still reproduce the card verbatim, which
// is a different question and deliberately unchanged. See card-placeholder.ts.

describe('a vault reading offered as an answer', () => {
  const withReading = (details: Record<string, string>) =>
    build([
      credential({
        id: 'comp',
        kind: 'COMPETENCY_CERTIFICATE',
        detailsEncrypted: encryptJson(details),
      }),
    ]);

  it('carries a real competency number across, as it always has', async () => {
    const { service } = withReading({ competency_number: '4567/2019' });
    const res = await service.addFromLibrary('clerk-1', 'mo-1', 'credential', 'comp');
    expect(res.suggestions.map((s) => s.value)).toEqual(['4567/2019']);
  });

  it('⚠️ NEVER OFFERS THE CARD’S OWN "NOTHING HERE" AS A VALUE', async () => {
    const { service } = withReading({ competency_number: 'NONE' });
    const res = await service.addFromLibrary('clerk-1', 'mo-1', 'credential', 'comp');
    expect(res.suggestions).toEqual([]);
  });
});

describe('a stored reading handed back with the attachment', () => {
  it('⚠️ FILTERS PLACEHOLDERS ON THE WAY OUT OF attachOne TOO', async () => {
    // The fourth unguarded answer boundary, and the one the wizard writes in
    // silently: `setAnswer(sg.key, sg.value, { onlyIfEmpty: true })`. For an
    // upload source this is `extractionEncrypted` exactly as it was stored,
    // possibly long before card-placeholder.ts existed.
    const { service } = build([], {
      elsewhere: [
        attached({
          id: 'u1',
          motivationId: 'older',
          kind: MotivationUploadKind.CURRENT_LICENCE,
          sha256: 'sha-old-licence',
          extractionOk: true,
          extractedFields: [
            'existing_firearm_1_make',
            'existing_firearm_1_frame_serial',
          ],
          extractionEncrypted: encryptJson({
            existing_firearm_1_make: 'CZ',
            existing_firearm_1_frame_serial: 'NONE',
            existing_firearm_1_model: '-',
          }),
        }),
      ],
    });
    const res = await service.addFromLibrary('clerk-1', 'mo-1', 'upload', 'u1');
    expect(res.suggestions.map((s) => s.key)).toEqual(['existing_firearm_1_make']);
  });
});

describe('a stored reading read back for the desktop', () => {
  it('⚠️ FILTERS PLACEHOLDERS AT THE OFFER, not only where they were written', async () => {
    // Documents read before card-placeholder.ts existed still carry NONE in
    // their stored blob, and this route hands that blob straight to the
    // prefill panel — so the guard has to stand here too.
    const { service, prisma } = build([]);
    prisma.motivationUpload.findFirst = jest.fn(async () => ({
      id: 'up-1',
      extractionOk: true,
      extractionEncrypted: encryptJson({
        existing_firearm_1_make: 'CZ',
        existing_firearm_1_frame_serial: 'NONE',
        existing_firearm_1_model: '-',
      }),
    })) as never;
    const res = await service.readingFor('clerk-1', 'mo-1', 'up-1');
    expect(res.suggestions.map((s) => s.key)).toEqual(['existing_firearm_1_make']);
  });
});

// ── the competency, when a DOCUMENT names the firearm ────────────────

describe('confirming a reading that names the firearm', () => {
  const derivation = {
    values: {
      competency_number: '9999/2021',
      competency_for: 'Handgun',
      competency_issued: '',
      competency_expiry: '',
    },
    provenance: {
      competency_number: { source: 'VAULT', from: 'your competency certificate', at: '2026-09-07' },
      competency_for: { source: 'VAULT', from: 'your competency certificate', at: '2026-09-07' },
    },
  };

  it('⚠️ RE-DERIVES THE COMPETENCY, because this is a door onto the firearm too', async () => {
    // requiredEndorsement reads firearm_type and firearm_action, and this
    // method writes both — off a dealer-prefilled SAPS 271 or an association
    // endorsement. Only saveAnswers re-derived, so a firearm that arrived by
    // DOCUMENT left the certificate chosen before anything knew what it was.
    const { service, prefill, answers } = build([], { competency: derivation });
    await service.applyExtraction('clerk-1', 'mo-1', { firearm_type: 'Handgun' });
    expect(prefill.competencyOffer).toHaveBeenCalled();
    expect(answers()?.competency_number).toBe('9999/2021');
  });

  it('clears a certificate the new firearm rules out, rather than leaving a wrong number', async () => {
    const { service, answers } = build([], {
      competency: { values: { competency_number: '' }, provenance: {} },
    });
    await service.applyExtraction('clerk-1', 'mo-1', { firearm_action: 'Bolt action' });
    expect(answers()?.competency_number).toBe('');
  });

  it('asks nothing when the document named no firearm', async () => {
    const { service, prefill } = build([], { competency: derivation });
    await service.applyExtraction('clerk-1', 'mo-1', {
      residential_address: '12 Fake Street, Somerset West',
    });
    expect(prefill.competencyOffer).not.toHaveBeenCalled();
  });
});

// ── the ride-along, inside an auto-link run ─────────────────────────

describe('auto-link carries the other page, under its own rules', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    id: 'back',
    kind: 'PROFICIENCY',
    coversKinds: [],
    disciplineType: null,
    title: 'Proficiency — Handgun',
    expiresOn: null,
    createdAt: day('2026-09-07'),
    detailsEncrypted: null,
    extractionOk: false,
    otherSideId: 'front',
    ...over,
  });

  /**
   * ⚠️ THE PAIR RULE NEEDS A COMPETENCY IN THE ROOM. Since 2026-09-08 a
   * proficiency will not attach unless a competency attaches beside it —
   * operator: "One cant be without the other" — and these cases are about the
   * front/back RIDE-ALONG, not about that rule. Without a partner they would
   * be testing the pair rule by accident and asserting the wrong thing.
   *
   * Its covers line is unreadable, which is deliberately not a mismatch: the
   * same forgiving rule competencyCovers already applies, so it pairs with the
   * handgun proficiency without constraining the category.
   */
  const competency = () =>
    candidate({
      id: 'comp',
      kind: 'COMPETENCY_CERTIFICATE',
      title: 'Competency 2024',
      otherSideId: null,
    });

  it('attaches both pages when both cleared the settled-date gate', async () => {
    const { service, created } = build(bothSides(), {
      candidates: [
        candidate(),
        candidate({ id: 'front', otherSideId: 'back' }),
        competency(),
      ],
    });
    const out = await service.autolink('clerk-1', 'mo-1');
    // Both PAGES rode along, which is what this case is about. The competency
    // beside them is the pair rule's doing and is asserted where it belongs.
    expect(created.map((c) => c.sourceCredentialId)).toEqual(
      expect.arrayContaining(['back', 'front']),
    );
    // ⚠️ ONE DOCUMENT, TWO PAGES — NOT TWO DOCUMENTS. This used to assert the
    // opposite, and the banner it feeds duly read "We added 4 documents ...
    // Proficiency - Handgun, Proficiency - Handgun (other side)" on the
    // operator's live section 16 on 2026-09-07. Both pages still attach; the
    // member is told about the document they handed over, once.
    const attached = out.attached as { title: string; pages?: number }[];
    const prof = attached.find((a) => a.title === 'Proficiency — Handgun');
    expect(prof).toBeDefined();
    expect(prof!.pages).toBe(2);
  });

  it('⚠️ LEAVES A PARTNER THAT NEVER CLEARED THE GATE, rather than attaching it unasked', async () => {
    // The freshness rule needs a date somebody stands behind — "answering it
    // anyway is how a stale document gets attached silently", says the comment
    // above the candidate query. The ride-along looked its partner up from the
    // whole vault and walked straight past that. The front is a real row with
    // real bytes here; what it does not have is a settled date, so it is not
    // in the gated set and does not ride along.
    const { service, created } = build(bothSides(), {
      candidates: [candidate(), competency()],
    });
    await service.autolink('clerk-1', 'mo-1');
    const ids = created.map((c) => c.sourceCredentialId);
    expect(ids).toContain('back');
    expect(ids).not.toContain('front');
  });

  it('⚠️ THE PICKER IS NOT GATED, because there the member is doing the asking', async () => {
    // Same two rows, same missing date, opposite answer: a hand-pick has the
    // document in front of the member and the caution note beside it. This is
    // the same distinction `refuse` already draws.
    const { service, created } = build(bothSides());
    await service.addFromLibrary('clerk-1', 'mo-1', 'credential', 'back');
    expect(created.map((c) => c.sourceCredentialId)).toEqual(['back', 'front']);
  });
});
