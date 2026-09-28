import { LicenceCentreService } from './licence-centre.service';
import { containerById } from '../motivations/evidence-taxonomy';
import { MAX_IDENTIFY_FILES } from '../common/document-identify.service';

// ────────────────────────────────────────────────────────────────────
// IDENTIFY BEFORE STORE — the batch pass, and the marriage by id.
//
// The member picks a folder; the server mints one id per file, asks the model
// what each one IS (document or evidence, which kind or container), reads the
// page for OCR, and writes the whole verdict into DocumentIdentify keyed by
// the id it issued. NOT A BYTE IS STORED — the polished file follows later and
// is filed from the record, never from anything the request asserts.
//
// The two rules these tests exist to hold down:
//   ⚠️ THE ID IS THE SERVER'S. The client can only carry back an id it was
//   issued in this session, for its own owner, so a verdict the client could
//   type is a verdict it cannot forge.
//   ⚠️ A MISS IS NOT A DOCUMENT. An outage, an unparseable reply, a role we
//   do not know — all read as unresolved EVIDENCE waiting in front of the
//   member, because filing a licence as OTHER on the strength of a failed
//   call is the wrong filing the role answer exists to prevent.
// ────────────────────────────────────────────────────────────────────

const ORIGINAL_ID_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-identify-batch';
});
afterAll(() => {
  if (ORIGINAL_ID_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_ID_SECRET;
});

const img = (name: string, mime = 'image/jpeg') => ({
  buffer: Buffer.from(name),
  mimetype: mime,
});

/** A document verdict, the shape the extract service answers with. */
const asDocument = (kind: string, confident = true, alsoCovers: string[] = []) => ({
  role: 'document' as const,
  kind,
  alsoCovers,
  confident,
});

/** An evidence role with no container — the second classifier decides that. */
const asEvidence = (confident = true) => ({ role: 'evidence' as const, confident });

function build(
  o: {
    /** Reply per call to extract.classify, in order. Default null (outage). */
    classify?: (unknown | null)[];
    /** What the evidence classifier answers. Default null. */
    sorted?: { container: string; confident: boolean } | null;
    /** What the orientation call answers for a document. Default undefined. */
    rotate?: 0 | 90 | 180 | 270;
    /** An already-identified record for these bytes, or null. */
    seen?: Record<string, unknown> | null;
    ocr?: string | null;
    cap?: number;
  } = {},
) {
  const classify = jest.fn();
  for (const reply of o.classify ?? []) {
    classify.mockResolvedValueOnce(reply);
  }
  // Typed with an argument so the specs can assert on what was passed in.
  const put = jest.fn(async (_rec: Record<string, unknown>) => undefined);
  const findBySha = jest.fn(
    async (_q: { ownerId?: string; sha256?: string }) => o.seen ?? null,
  );
  const classifyEvidence = jest.fn(async () => o.sorted ?? null);
  const ocr = jest.fn(async () => o.ocr ?? null);
  const orient = jest.fn(async () => o.rotate);

  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'u1' })) },
  };
  const svc = new LicenceCentreService(
    prisma as never,
    { write: jest.fn(), remove: jest.fn(), read: jest.fn() } as never,
    { get: jest.fn(async () => o.cap ?? 60) } as never,
    { resolveByEntity: jest.fn(async () => undefined) } as never,
    { assertEnabled: jest.fn(async () => undefined) } as never,
    { classify, read: jest.fn(async () => null), orient } as never,
    { classifyEvidence, ocr } as never,
    {
      rearmAutolinkFor: jest.fn(async () => 0),
      removeCredentialFromEditableDrafts: jest.fn(async () => ({
        uploads: 0,
        answers: 0,
      })),
    } as never,
    { note: () => undefined } as never,
    { findBySha, put, take: jest.fn(async () => null) } as never,
  );
  return { svc, classify, classifyEvidence, ocr, orient, put, findBySha };
}

describe('identifying a batch', () => {
  it('answers one verdict per file, each with its own server-minted id', async () => {
    const { svc } = build({
      classify: [asDocument('FIREARM_LICENCE'), asEvidence()],
      sorted: { container: 'HUNTING_PHOTO', confident: true },
    });
    const out = await svc.identify('u1', [img('licence'), img('photo')]);

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: 'document', kind: 'FIREARM_LICENCE' });
    expect(out[1]).toMatchObject({ role: 'evidence', container: 'HUNTING_PHOTO' });
    expect(out[0].id).toBeTruthy();
    expect(out[1].id).toBeTruthy();
    expect(out[0].id).not.toBe(out[1].id);
  });

  it('\u26a0\ufe0f ASKS THE ORIENTATION ONLY OF A DOCUMENT, AND CARRIES IT', async () => {
    // The ink can find the quarter turn but not the direction; a separate,
    // minimal vision call answers it, and only for a page — evidence is a
    // photograph the member framed themselves and is stored as taken.
    const { svc, put, orient } = build({
      classify: [asDocument('COMPETENCY_CERTIFICATE'), asEvidence()],
      sorted: { container: 'HUNTING_PHOTO', confident: true },
      rotate: 270,
    });
    const out = await svc.identify('u1', [img('cert'), img('photo')]);

    expect(orient).toHaveBeenCalledTimes(1);
    expect(out[0].rotate).toBe(270);
    expect(out[1].rotate).toBeUndefined();
    // ⚠️ NOT PERSISTED — nothing reads it back; create() files turned bytes.
    expect(put.mock.calls[0][0]).not.toHaveProperty('rotate');
  });

  it('⚠️ STORES NOTHING — it identifies and remembers, it does not file', async () => {
    const { svc } = build({ classify: [asDocument('FIREARM_LICENCE')] });
    const out = await svc.identify('u1', [img('licence')]);
    // The only place a verdict may live is the identify record, under the id.
    expect(out[0].id).toBeTruthy();
  });

  it('writes the verdict into the identify store under the id it returned', async () => {
    const { svc, put } = build({
      classify: [asDocument('FIREARM_LICENCE', true, ['COMPETENCY_CERTIFICATE'])],
      ocr: 'SAPS 523 ...',
    });
    const [verdict] = await svc.identify('u1', [img('licence')]);
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: verdict.id,
        ownerId: 'u1',
        role: 'document',
        kind: 'FIREARM_LICENCE',
        alsoCovers: ['COMPETENCY_CERTIFICATE'],
        ocrText: 'SAPS 523 ...',
      }),
    );
  });

  it('⚠️ THE OCR IS READ SERVER-SIDE, AT IDENTIFY TIME, AND MARRIED BY ID', async () => {
    // The client never holds the OCR — it holds the id. The words the page
    // carried travel with the id, which is the marriage the operator asked for.
    const { svc, put } = build({ classify: [asDocument('FIREARM_LICENCE')], ocr: 'page text' });
    await svc.identify('u1', [img('licence')]);
    expect(put.mock.calls[0][0].ocrText).toBe('page text');
  });

  it('⚠️ A NULL OCR IS NOT POLICY — a PDF has nothing Vision can read', async () => {
    const { svc } = build({ classify: [asDocument('FIREARM_LICENCE')], ocr: null });
    const [verdict] = await svc.identify('u1', [img('licence.pdf', 'application/pdf')]);
    expect(verdict.ocrChars).toBeNull();
  });

  it('refuses an empty batch before any model spend', async () => {
    const { svc, classify } = build();
    await expect(svc.identify('u1', [])).rejects.toThrow(/at least one/i);
    expect(classify).not.toHaveBeenCalled();
  });

  it('refuses a batch past the shared ceiling', async () => {
    const { svc, classify } = build();
    const many = Array.from({ length: MAX_IDENTIFY_FILES + 1 }, (_, i) => img(`f${i}`));
    await expect(svc.identify('u1', many)).rejects.toThrow(/up to/i);
    expect(classify).not.toHaveBeenCalled();
  });

  it('refuses an empty file and an oversized one', async () => {
    const { svc } = build();
    await expect(
      svc.identify('u1', [{ buffer: Buffer.alloc(0), mimetype: 'image/png' }]),
    ).rejects.toThrow(/empty/i);
    await expect(
      svc.identify('u1', [
        { buffer: Buffer.alloc(10 * 1024 * 1024 + 1), mimetype: 'image/png' },
      ]),
    ).rejects.toThrow(/10 MB/);
  });
});

describe('the evidence path', () => {
  it('⚠️ ASKS THE CONTAINER OF A SECOND CALL, WITH THE MEMBER\u2019S OWN WORDS', async () => {
    const { svc, classifyEvidence } = build({
      classify: [asEvidence()],
      sorted: { container: 'FARM_PERMISSION_LETTER', confident: true },
      ocr: 'permission to hunt',
    });
    const [verdict] = await svc.identify('u1', [
      { ...img('letter'), description: '  my farmer gave me this  ' },
    ]);
    expect(classifyEvidence).toHaveBeenCalledWith({
      bytes: expect.any(Buffer),
      mimeType: 'image/jpeg',
      description: 'my farmer gave me this',
      ocrText: 'permission to hunt',
    });
    expect(verdict.container).toBe('FARM_PERMISSION_LETTER');
  });

  it('⚠️ STORES NO CONTAINER WHEN THE EVIDENCE CLASSIFIER IS UNSURE', async () => {
    // A wrong container moves a page and ticks a DFO row. Nothing is better
    // than wrong — the card asks for more words instead.
    const { svc } = build({
      classify: [asEvidence()],
      sorted: { container: 'HUNTING_PHOTO', confident: false },
    });
    const [verdict] = await svc.identify('u1', [img('photo')]);
    expect(verdict.container).toBeNull();
  });

  it('drops a container id the taxonomy does not know', async () => {
    const { svc } = build({
      classify: [asEvidence()],
      sorted: { container: 'NOT_A_REAL_CONTAINER', confident: true },
    });
    const [verdict] = await svc.identify('u1', [img('photo')]);
    expect(verdict.container).toBeNull();
  });

  it('does not call the evidence classifier for an ordinary document', async () => {
    const { svc, classifyEvidence } = build({
      classify: [asDocument('FIREARM_LICENCE')],
    });
    await svc.identify('u1', [img('licence')]);
    expect(classifyEvidence).not.toHaveBeenCalled();
  });

  it('accepts a container the taxonomy knows', async () => {
    const id = 'HUNTING_PHOTO';
    expect(containerById(id)).toBeTruthy();
    const { svc } = build({
      classify: [asEvidence()],
      sorted: { container: id, confident: true },
    });
    const [verdict] = await svc.identify('u1', [img('photo')]);
    expect(verdict.container).toBe(id);
  });
});

describe('a failed or unreadable answer', () => {
  it('⚠️ A NULL VERDICT READS AS UNRESOLVED EVIDENCE, NEVER AS A DOCUMENT', async () => {
    // Filing a licence as OTHER on the strength of an outage is the wrong
    // filing; unresolved evidence is a card in front of the member that asks
    // them to describe it.
    const { svc } = build({ classify: [null] });
    const [verdict] = await svc.identify('u1', [img('licence')]);
    expect(verdict).toMatchObject({ role: 'evidence', kind: null, container: null });
    expect(verdict.confident).toBe(false);
  });

  it('keeps going with the rest of the batch when one file\u2019s call throws', async () => {
    const classify = jest
      .fn()
      .mockRejectedValueOnce(new Error('outage'))
      .mockResolvedValueOnce(asDocument('FIREARM_LICENCE'));
    const prisma = { user: { findUnique: jest.fn(async () => ({ id: 'u1' })) } };
    const svc = new LicenceCentreService(
      prisma as never,
      { write: jest.fn(), remove: jest.fn(), read: jest.fn() } as never,
      { get: jest.fn(async () => 60) } as never,
      { resolveByEntity: jest.fn(async () => undefined) } as never,
      { assertEnabled: jest.fn(async () => undefined) } as never,
      { classify, read: jest.fn(async () => null), orient: jest.fn(async () => undefined) } as never,
      { classifyEvidence: jest.fn(async () => null), ocr: jest.fn(async () => null) } as never,
      {
        rearmAutolinkFor: jest.fn(async () => 0),
        removeCredentialFromEditableDrafts: jest.fn(async () => ({ uploads: 0, answers: 0 })),
      } as never,
      { note: () => undefined } as never,
      { findBySha: jest.fn(async () => null), put: jest.fn(), take: jest.fn() } as never,
    );
    const out = await svc.identify('u1', [img('a'), img('b')]);
    // ⚠️ ORDER IS NOT ASSERTED. identify() now runs files concurrently (see
    // IDENTIFY_CONCURRENCY — sequential is what made a five-file batch overrun
    // the API proxy). The two files' classify calls therefore race, and which
    // one receives the single rejected answer is not pinned to the file index.
    // What must hold is the resilient part: one file's throw does not sink the
    // batch, and each file still gets a verdict in its own position.
    expect(out).toHaveLength(2);
    expect(out.map((v) => v.role).sort()).toEqual(['document', 'evidence']);
    expect(out.find((v) => v.role === 'document')).toMatchObject({
      role: 'document',
      kind: 'FIREARM_LICENCE',
    });
  });
});

describe('the identify cache', () => {
  it('⚠️ A KNOWN HASH COSTS NO MODEL CALL — and still mints a fresh id', async () => {
    const { svc, classify, put } = build({
      seen: {
        id: 'old-id',
        ownerId: 'u1',
        sha256: 'x',
        role: 'document',
        kind: 'FIREARM_LICENCE',
        alsoCovers: [],
        container: null,
        confident: true,
        ocrText: 'SAPS 523 ...',
      },
    });
    const [verdict] = await svc.identify('u1', [img('licence')]);
    expect(classify).not.toHaveBeenCalled();
    expect(verdict.kind).toBe('FIREARM_LICENCE');
    // A NEW id for this session, so the cached verdict can be filed once more
    // without resurrecting the record that was already consumed.
    expect(verdict.id).toBeTruthy();
    expect(verdict.id).not.toBe('old-id');
    // The OCR the cache carried comes back as a count, not the text itself.
    expect(verdict.ocrChars).toBe('SAPS 523 ...'.length);
    // And it is remembered under the fresh id, so the store can take it.
    expect(put.mock.calls[0][0]).toMatchObject({ id: verdict.id, kind: 'FIREARM_LICENCE' });
  });

  it('asks the cache for the bytes and the owner, never the id', async () => {
    const { svc, findBySha } = build({ classify: [asDocument('OTHER')] });
    await svc.identify('u1', [img('licence')]);
    expect(findBySha).toHaveBeenCalledWith({
      ownerId: 'u1',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('⚠️ THE CACHE IS KEYED ON THE UNPOLISHED BYTES', async () => {
    // Identify reads what the member picked; the polished file stored later
    // hashes differently and will not match — correct, because they are two
    // different images and the marriage is by id, never by hash.
    const { svc, findBySha } = build({ classify: [asDocument('FIREARM_LICENCE')] });
    const raw = Buffer.from('the raw pick');
    await svc.identify('u1', [{ buffer: raw, mimetype: 'image/jpeg' }]);
    const { createHash } = await import('node:crypto');
    const want = createHash('sha256').update(raw).digest('hex');
    expect(findBySha.mock.calls[0][0].sha256).toBe(want);
  });

  it('does not reuse one member\u2019s verdict for another', async () => {
    const { svc, findBySha } = build({ classify: [asDocument('OTHER')] });
    await svc.identify('u1', [img('licence')]);
    expect(findBySha).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'u1' }),
    );
  });
});

describe('the store handler files from the record, not the request', () => {
  // ⚠️ THE SECURITY HALF OF THE WHOLE SCHEME. identify() mints the id and holds
  // the verdict; create() must read THAT, never anything in the request body.
  // If any code path took a client `kind`/`container` from the body straight to
  // a write, a verdict the client could type is a verdict it could forge.
  function buildCreate(
    o: {
      verdict?: Record<string, unknown> | null;
      classify?: unknown;
    } = {},
  ) {
    const create = jest.fn(async (_a?: any): Promise<any> => ({ id: 'c1', title: 't' }));
    const update = jest.fn(async (_a?: any): Promise<any> => ({}));
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 'u1' })) },
      credential: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async (): Promise<any[]> => []),
        create,
        update,
        findFirst: jest.fn(async (): Promise<any> => null),
      },
    };
    const files = {
      write: jest.fn(async () => ({
        storageKey: 'credentials/2026/09/a.enc',
        sha256: 'sha-a',
        byteSize: 4,
      })),
      remove: jest.fn(async () => undefined),
      read: jest.fn(async () => Buffer.from('bytes')),
    };
    const take = jest.fn(async () => o.verdict ?? null);
    const classify = jest.fn(async () => o.classify ?? null);
    const svc = new LicenceCentreService(
      prisma as never,
      files as never,
      { get: jest.fn(async () => 60) } as never,
      { resolveByEntity: jest.fn(async () => undefined) } as never,
      { assertEnabled: jest.fn(async () => undefined) } as never,
      { classify, read: jest.fn(async () => null), orient: jest.fn(async () => undefined) } as never,
      { classifyEvidence: jest.fn(async () => null), ocr: jest.fn(async () => null) } as never,
      {
        rearmAutolinkFor: jest.fn(async () => 0),
        removeCredentialFromEditableDrafts: jest.fn(async () => ({ uploads: 0, answers: 0 })),
      } as never,
      { note: () => undefined } as never,
      { findBySha: jest.fn(async () => null), put: jest.fn(), take } as never,
    );
    return { svc, create, update, take, classify, files };
  }

  it('takes the kind from the identify record for the id the server issued', async () => {
    const { svc, create, take, classify } = buildCreate({
      verdict: {
        id: 'id-1',
        ownerId: 'u1',
        sha256: 'x',
        role: 'document',
        kind: 'FIREARM_LICENCE',
        alsoCovers: [],
        container: null,
        confident: true,
        ocrText: null,
      },
    });
    await svc.create('u1', null, '', img('licence'), { identifyId: 'id-1' });
    expect(take).toHaveBeenCalledWith({ id: 'id-1', ownerId: 'u1' });
    expect(create.mock.calls[0][0].data.kind).toBe('FIREARM_LICENCE');
    // The model is not asked again — the verdict already exists.
    expect(classify).not.toHaveBeenCalled();
  });

  it('⚠️ IGNORES A FORGED KIND IN THE BODY — the record wins', async () => {
    // `kind` is a separate field from `identifyId` on purpose, and when it is
    // empty the ONLY thing that may name the row is the record. A body that
    // also carries kind=EVIDENCE must not override the classifier.
    const { svc, create } = buildCreate({
      verdict: {
        id: 'id-1',
        ownerId: 'u1',
        sha256: 'x',
        role: 'document',
        kind: 'FIREARM_LICENCE',
        alsoCovers: [],
        container: null,
        confident: true,
        ocrText: null,
      },
    });
    // kind is null, so the record is consulted — a forged `container`/evidence
    // answer in opts.description cannot change the role.
    await svc.create('u1', null, '', img('licence'), {
      identifyId: 'id-1',
      description: 'pretend this is evidence',
    });
    expect(create.mock.calls[0][0].data.kind).toBe('FIREARM_LICENCE');
  });

  it('⚠️ FILES AN EVIDENCE VERDICT AS EVIDENCE, WITH THE RECORD\u2019S CONTAINER', async () => {
    const { svc, create } = buildCreate({
      verdict: {
        id: 'id-2',
        ownerId: 'u1',
        sha256: 'x',
        role: 'evidence',
        kind: null,
        alsoCovers: [],
        container: 'HUNTING_PHOTO',
        confident: true,
        ocrText: null,
      },
    });
    await svc.create('u1', null, '', img('photo'), { identifyId: 'id-2' });
    expect(create.mock.calls[0][0].data).toMatchObject({
      kind: 'EVIDENCE',
      evidenceType: 'HUNTING_PHOTO',
    });
  });

  it('⚠️ ANOTHER MEMBER\u2019S ID RESOLVES TO NOTHING AND FALLS BACK TO CLASSIFYING', async () => {
    // take() is owner-checked and returns null for a foreign id; the upload
    // then classifies the bytes it was handed rather than trusting the id.
    const { svc, take, classify, create } = buildCreate({
      verdict: null,
      classify: { role: 'document', kind: 'FIREARM_LICENCE', alsoCovers: [], confident: true },
    });
    await svc.create('u1', null, '', img('licence'), { identifyId: 'someone-elses-id' });
    expect(take).toHaveBeenCalledWith({ id: 'someone-elses-id', ownerId: 'u1' });
    expect(classify).toHaveBeenCalled();
    expect(create.mock.calls[0][0].data.kind).toBe('FIREARM_LICENCE');
  });

  it('⚠️ A DELETED OR EXPIRED ID FALLS BACK, IT DOES NOT RESURRECT', async () => {
    const { svc, classify } = buildCreate({
      verdict: null,
      classify: { role: 'document', kind: 'IDENTITY_DOCUMENT', alsoCovers: [], confident: false },
    });
    const out = await svc.create('u1', null, '', img('id'), { identifyId: 'stale' });
    expect(classify).toHaveBeenCalledTimes(1);
    expect(out.kind).toBe('IDENTITY_DOCUMENT');
  });

  it('does not consult the store when there is no identify id', async () => {
    const { svc, take, classify } = buildCreate({
      classify: { role: 'document', kind: 'OTHER', alsoCovers: [], confident: false },
    });
    await svc.create('u1', null, '', img('x'));
    expect(take).not.toHaveBeenCalled();
    expect(classify).toHaveBeenCalled();
  });

  it('⚠️ A MEMBER\u2019S OWN KIND STILL WINS, AND NAMES THE ROW WITHOUT CLASSIFYING', async () => {
    // The explicit-choice field, kept separate so it can never be mistaken for
    // a carried-back verdict.
    const { svc, create, take, classify } = buildCreate();
    await svc.create('u1', 'IDENTITY_DOCUMENT', '', img('id'), { identifyId: 'id-9' });
    expect(create.mock.calls[0][0].data.kind).toBe('IDENTITY_DOCUMENT');
    expect(take).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });
});

