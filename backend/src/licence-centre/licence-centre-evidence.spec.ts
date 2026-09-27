import { LicenceCentreService } from './licence-centre.service';
import { EVIDENCE_VAULT_MAX, containerById } from '../motivations/evidence-taxonomy';
import { decryptText, tryDecryptText } from '../common/blob-crypto';

// ────────────────────────────────────────────────────────────────────
// EVIDENCE IN THE VAULT — the upload, and the description loop.
//
// An evidence item's master copy is a Credential like any other document, so
// the vault's rules apply to it: the same enable flag, the same bytes-first
// write, the same duplicate constraint. What is NEW is a model call on the way
// in, and the rule that governs it — a low-confidence answer stores NO
// container, because a wrong container decides whether the thing takes an
// annexure letter or prints in the body, and ticks a DFO row on the way.
// ────────────────────────────────────────────────────────────────────

// The description is encrypted at rest, so every test that round-trips one
// needs the key — see blob-crypto.ts, which reads ID_HASH_SECRET.
const ORIGINAL_ID_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-licence-centre-evidence';
});
afterAll(() => {
  if (ORIGINAL_ID_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_ID_SECRET;
});

const file = { buffer: Buffer.from('bytes'), mimetype: 'image/jpeg' };

/** A guess the extract service would return: a container, and whether it is sure. */
const guessOf = (container: string, confident: boolean) => ({ container, confident });

function build(
  o: {
    guess?: ReturnType<typeof guessOf> | null;
    heldDocuments?: number;
    heldEvidence?: number;
    cap?: number;
    readRow?: Record<string, unknown> | null;
    readThrows?: boolean;
    writeThrows?: boolean;
    createThrows?: unknown;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const create = jest.fn(async (a: any) => {
    if (o.createThrows) throw o.createThrows;
    created.push(a.data);
    return { id: 'c1' };
  });
  const update = jest.fn(async (a: any) => {
    updated.push(a.data);
    return { id: 'c1', title: a.data.title };
  });
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'u1' })) },
    credential: {
      count: jest.fn(async (a?: any) =>
        a?.where?.kind === 'EVIDENCE' ? (o.heldEvidence ?? 0) : (o.heldDocuments ?? 0),
      ),
      create,
      update,
      findFirst: jest.fn(async () => o.readRow ?? null),
    },
  };
  const files = {
    write: jest.fn(async () => {
      if (o.writeThrows) throw new Error('disk full');
      return {
        storageKey: 'credentials/2026/09/e.enc',
        sha256: 'sha-e',
        byteSize: 5,
      };
    }),
    remove: jest.fn(async () => undefined),
    read: jest.fn(async () => {
      if (o.readThrows) throw new Error('gone');
      return Buffer.from('bytes');
    }),
  };
  const classifyEvidence = jest.fn(async () => o.guess ?? null);
  const svc = new LicenceCentreService(
    prisma as never,
    files as never,
    { get: jest.fn(async () => o.cap ?? 60) } as never,
    { resolveByEntity: jest.fn(async () => undefined) } as never,
    { assertEnabled: jest.fn(async () => undefined) } as never,
    { classify: jest.fn(async () => null), read: jest.fn(async () => null) } as never,
    { classifyEvidence } as never,
    {
      rearmAutolinkFor: jest.fn(async () => 0),
      removeCredentialFromEditableDrafts: jest.fn(async () => ({
        uploads: 0,
        answers: 0,
      })),
    } as never,
    { note: () => undefined } as never,
    { findBySha: jest.fn(async () => null), put: jest.fn(async () => undefined), take: jest.fn(async () => null) } as never,
  );
  return { svc, create, update, files, classifyEvidence, created, updated };
}

describe('uploading evidence into the vault', () => {
  it('stores the container the model was sure of, and its label as the title', async () => {
    const { svc, created } = build({ guess: guessOf('HUNTING_PHOTO', true) });
    const out = await svc.createEvidence('u1', 'me and my son on a hunt', file);
    expect(created[0]).toMatchObject({
      kind: 'EVIDENCE',
      evidenceType: 'HUNTING_PHOTO',
      evidenceConfidence: 'high',
      title: containerById('HUNTING_PHOTO')!.label,
    });
    expect(out).toMatchObject({
      kind: 'EVIDENCE',
      evidence: { container: 'HUNTING_PHOTO', placement: 'body', confident: true },
    });
  });

  it('⚠️ STORES NO CONTAINER WHEN THE MODEL IS UNSURE, and asks for more words', async () => {
    // A low-confidence answer IS an answer, but a wrong container decides
    // annexure-vs-body and ticks a DFO row. Nothing is better than wrong.
    const { svc, created } = build({ guess: guessOf('HUNTING_PHOTO', false) });
    const out = await svc.createEvidence('u1', 'not sure', file);
    expect(created[0]).toMatchObject({
      evidenceType: null,
      evidenceConfidence: 'low',
      title: 'Evidence',
    });
    expect(out.evidence).toMatchObject({ container: null, confident: false });
    expect(out.evidence.ask).toBeTruthy();
  });

  it('stores nothing but the file when the call could not decide at all', async () => {
    const { svc, created } = build({ guess: null });
    const out = await svc.createEvidence('u1', '', file);
    expect(created[0]).toMatchObject({
      evidenceType: null,
      evidenceConfidence: null,
    });
    expect(out.evidence.container).toBeNull();
  });

  it('⚠️ ENCRYPTS THE DESCRIPTION AND NEVER STORES THE WORDS IN THE CLEAR', async () => {
    const { svc, created } = build({ guess: guessOf('HUNTING_PHOTO', true) });
    await svc.createEvidence('u1', 'me and my son on a hunt in Limpopo', file);
    const stored = created[0].evidenceDescriptionEncrypted as string;
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('Limpopo');
    expect(decryptText(stored)).toBe('me and my son on a hunt in Limpopo');
  });

  it('sends the words to the classifier, and null when there are none', async () => {
    const { svc, classifyEvidence } = build({ guess: guessOf('HUNTING_PHOTO', true) });
    await svc.createEvidence('u1', '  a hunt  ', file);
    expect(classifyEvidence).toHaveBeenCalledWith({
      bytes: file.buffer,
      mimeType: 'image/jpeg',
      description: 'a hunt',
    });
  });

  it('settles the row by nature, so it is never asked for a renewal date', async () => {
    const { svc, created } = build({ guess: guessOf('HUNTING_PHOTO', true) });
    await svc.createEvidence('u1', 'a hunt', file);
    expect(created[0]).toMatchObject({ neverExpires: true, dateSource: 'none' });
  });

  it('refuses an empty file and an oversized one before any model spend', async () => {
    const { svc, classifyEvidence } = build();
    await expect(
      svc.createEvidence('u1', 'x', { buffer: Buffer.alloc(0), mimetype: 'image/png' }),
    ).rejects.toThrow(/empty/i);
    await expect(
      svc.createEvidence('u1', 'x', {
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
        mimetype: 'image/png',
      }),
    ).rejects.toThrow(/10 MB/);
    expect(classifyEvidence).not.toHaveBeenCalled();
  });

  it('takes the file back off the disk if the row cannot be written', async () => {
    const { svc, files } = build({ guess: guessOf('HUNTING_PHOTO', true), createThrows: new Error('db') });
    await expect(svc.createEvidence('u1', 'a hunt', file)).rejects.toThrow();
    expect(files.remove).toHaveBeenCalledWith('credentials/2026/09/e.enc');
  });

  it('⚠️ THE DOCUMENT CAP STILL GOVERNS THE WHOLE VAULT', async () => {
    // Evidence must not be a side door past the cap the member purchased.
    const { svc } = build({ heldDocuments: 60, cap: 60 });
    await expect(svc.createEvidence('u1', 'x', file)).rejects.toThrow(/60 documents/);
  });

  it('holds evidence to its own thirty-item sub-cap', async () => {
    const { svc, classifyEvidence } = build({
      heldEvidence: EVIDENCE_VAULT_MAX,
      heldDocuments: 5,
    });
    await expect(svc.createEvidence('u1', 'x', file)).rejects.toThrow(
      new RegExp(`${EVIDENCE_VAULT_MAX} evidence`),
    );
    expect(classifyEvidence).not.toHaveBeenCalled();
  });
});

describe('describing an item again', () => {
  const row = {
    id: 'c1',
    storageKey: 'credentials/2026/09/e.enc',
    mimeType: 'image/jpeg',
    title: 'Evidence',
    purgedAt: null,
  };

  it('re-reads the stored bytes and writes the better answer', async () => {
    const { svc, update, files, created } = build({
      readRow: row,
      guess: guessOf('FARM_PERMISSION_LETTER', true),
    });
    const out = await svc.redescribeEvidence('u1', 'c1', 'my farmer gave me this');
    expect(files.read).toHaveBeenCalledWith('credentials/2026/09/e.enc');
    expect(update.mock.calls[0][0].data).toMatchObject({
      evidenceType: 'FARM_PERMISSION_LETTER',
      evidenceConfidence: 'high',
      title: containerById('FARM_PERMISSION_LETTER')!.label,
    });
    expect(out.evidence).toMatchObject({
      container: 'FARM_PERMISSION_LETTER',
      placement: 'annexure',
      confident: true,
    });
    // The words are encrypted again, not stored raw.
    expect(decryptText(update.mock.calls[0][0].data.evidenceDescriptionEncrypted)).toBe(
      'my farmer gave me this',
    );
    expect(created).toHaveLength(0);
  });

  it('⚠️ KEEPS A NAME THE MEMBER TYPED, and follows only its own label', async () => {
    const { svc, update } = build({
      readRow: { ...row, title: "Dad's .303 hunt, 2019" },
      guess: guessOf('HUNTING_PHOTO', true),
    });
    await svc.redescribeEvidence('u1', 'c1', 'a hunt');
    expect(update.mock.calls[0][0].data.title).toBe("Dad's .303 hunt, 2019");
  });

  it('follows the new answer when the old title was the container we guessed', async () => {
    const { svc, update } = build({
      readRow: { ...row, title: containerById('HUNTING_PHOTO')!.label },
      guess: guessOf('RANGE_PHOTO', true),
    });
    await svc.redescribeEvidence('u1', 'c1', 'at the range');
    expect(update.mock.calls[0][0].data.title).toBe(containerById('RANGE_PHOTO')!.label);
  });

  it('refuses an item that is not the member\u2019s own', async () => {
    const { svc } = build({ readRow: null });
    await expect(svc.redescribeEvidence('u1', 'c9', 'x')).rejects.toThrow(/not found/i);
  });

  it('⚠️ SAYS SO WHEN THE BYTES ARE GONE rather than looking broken', async () => {
    const { svc } = build({ readRow: { ...row, storageKey: null } });
    await expect(svc.redescribeEvidence('u1', 'c1', 'x')).rejects.toThrow(
      /no longer stored/i,
    );
  });

  it('refuses an empty description', async () => {
    const { svc } = build({ readRow: row });
    await expect(svc.redescribeEvidence('u1', 'c1', '   ')).rejects.toThrow(
      /Tell us a little/,
    );
  });

  it('reads low confidence as no container on the retry too', async () => {
    const { svc, update } = build({
      readRow: row,
      guess: guessOf('HUNTING_PHOTO', false),
    });
    const out = await svc.redescribeEvidence('u1', 'c1', 'still not sure');
    expect(update.mock.calls[0][0].data.evidenceType).toBeNull();
    expect(out.evidence.container).toBeNull();
  });
});

describe('reading an evidence row back', () => {
  // A bad blob must cost the prefill, never the row: this is the fail-soft
  // decrypt the list path uses.
  it('returns null for a damaged description rather than throwing', () => {
    expect(tryDecryptText('not-a-blob')).toBeNull();
    expect(tryDecryptText(null)).toBeNull();
  });
});
