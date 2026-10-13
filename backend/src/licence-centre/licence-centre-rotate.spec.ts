import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { LicenceCentreService } from './licence-centre.service';

// ────────────────────────────────────────────────────────────────────
// TURNING A DOCUMENT IN THE VAULT, FOR GOOD.
//
// ⚠️ THE POINT OF THE WHOLE FEATURE IS THAT A PERSON SAID "THAT IS ON ITS
// SIDE". So the tests are about the file actually changing: a new key the row
// points at, the old file gone, and the copies already sitting in a pack turned
// too (they own their own bytes — see addFromLibrary).
// ────────────────────────────────────────────────────────────────────

let jpeg: Buffer;
beforeAll(async () => {
  // A directional gradient, not a flat fill: a uniform image rotates to the
  // same bytes either way, so a left/right swap would be invisible.
  const raw = Buffer.alloc(60 * 40 * 3);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 60; x++) {
      const i = (y * 60 + x) * 3;
      raw[i] = x * 4;
      raw[i + 1] = y * 6;
      raw[i + 2] = 0;
    }
  }
  jpeg = await sharp(raw, { raw: { width: 60, height: 40, channels: 3 } })
    .jpeg()
    .toBuffer();
});

const OLD_KEY = 'credentials/2026/10/old.enc';

function build(opts: {
  row?: Record<string, unknown> | null;
  copies?: { id: string; storageKey: string }[];
  update?: jest.Mock;
} = {}) {
  const removed: string[] = [];
  const writes: { ns: string; bytes: Buffer }[] = [];
  const note = jest.fn();
  const update = opts.update ?? jest.fn(async () => ({}));

  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'u1' })) },
    credential: {
      findFirst: jest.fn(async () => {
        if (opts.row === null) return null;
        return (
          opts.row ?? {
            id: 'c1',
            storageKey: OLD_KEY,
            mimeType: 'image/jpeg',
            purgedAt: null,
          }
        );
      }),
      update,
    },
    motivationUpload: {
      findMany: jest.fn(async () => opts.copies ?? []),
      update: jest.fn(
        async (_a: { where: unknown; data: Record<string, unknown> }) => ({}),
      ),
    },
  };
  const files = {
    read: jest.fn(async () => jpeg),
    write: jest.fn(async (ns: string, bytes: Buffer) => {
      writes.push({ ns, bytes });
      return {
        storageKey: `${ns}/2026/10/${writes.length}.enc`,
        sha256: `sha-${writes.length}`,
        byteSize: bytes.length,
      };
    }),
    remove: jest.fn(async (key: string) => {
      removed.push(key);
    }),
  };

  const svc = new LicenceCentreService(
    prisma as never,
    files as never,
    { get: jest.fn(async () => 60) } as never,
    { resolveByEntity: jest.fn(async () => undefined) } as never,
    { assertEnabled: jest.fn(async () => undefined) } as never,
    { classify: jest.fn(), read: jest.fn(), orient: jest.fn() } as never,
    { classifyEvidence: jest.fn(async () => null) } as never,
    {
      rearmAutolinkFor: jest.fn(async () => 0),
      removeCredentialFromEditableDrafts: jest.fn(async () => ({
        uploads: 0,
        answers: 0,
      })),
    } as never,
    { note } as never,
    {
      findBySha: jest.fn(async () => null),
      put: jest.fn(async () => undefined),
      take: jest.fn(async () => null),
    } as never,
  );

  return { svc, prisma, files, removed, writes, note, update };
}

describe('rotating a document', () => {
  it('rewrites the row onto a new key and removes the old file', async () => {
    const { svc, update, removed, writes } = build();

    await expect(svc.rotate('u1', 'c1', 'right')).resolves.toEqual({
      rotated: true,
    });

    expect(writes[0].ns).toBe('credentials');
    const patch = update.mock.calls[0][0];
    expect(patch.where).toEqual({ id: 'c1' });
    expect(patch.data.storageKey).not.toBe(OLD_KEY);
    expect(patch.data.mimeType).toBe('image/jpeg');
    expect(patch.data.sha256).toBe('sha-1');
    expect(patch.data.byteSize).toBeGreaterThan(0);
    expect(removed).toContain(OLD_KEY);
  });

  it('turns the copies already attached to an application', async () => {
    const { svc, prisma, removed, writes } = build({
      copies: [{ id: 'up1', storageKey: 'motivations/2026/10/up.enc' }],
    });

    await svc.rotate('u1', 'c1', 'right');

    expect(writes.some((w) => w.ns === 'motivations')).toBe(true);
    const upPatch = prisma.motivationUpload.update.mock.calls[0][0];
    expect(upPatch.where).toEqual({ id: 'up1' });
    expect(upPatch.data.storageKey).toBe('motivations/2026/10/2.enc');
    expect(upPatch.data.sha256).toBe('sha-2');
    expect(removed).toContain('motivations/2026/10/up.enc');
  });

  it('turns left and right to different pixels', async () => {
    const right = build();
    await right.svc.rotate('u1', 'c1', 'right');
    const left = build();
    await left.svc.rotate('u1', 'c1', 'left');

    expect(right.writes[0].bytes.equals(left.writes[0].bytes)).toBe(false);
  });

  it('logs the turn on the ledger', async () => {
    const { svc, note } = build();
    await svc.rotate('u1', 'c1', 'right');
    expect(note).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'rotated', outcome: 'corrected' }),
    );
  });

  it('404s a document the member does not hold', async () => {
    const { svc } = build({ row: null });
    await expect(svc.rotate('u1', 'nope', 'right')).rejects.toThrow(
      /not found/i,
    );
  });

  it('410s a purged or missing file', async () => {
    const purged = build({
      row: { id: 'c1', storageKey: OLD_KEY, mimeType: 'image/jpeg', purgedAt: new Date() },
    });
    await expect(purged.svc.rotate('u1', 'c1', 'right')).rejects.toThrow(
      /deleted/i,
    );

    const gone = build({
      row: { id: 'c1', storageKey: null, mimeType: 'image/jpeg', purgedAt: null },
    });
    await expect(gone.svc.rotate('u1', 'c1', 'right')).rejects.toThrow(
      /deleted/i,
    );
  });

  it('⚠️ a hash collision is a member answer, not a 500, and keeps the old file', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const update = jest.fn(async () => {
      throw conflict;
    });
    const { svc, removed } = build({ update });

    await expect(svc.rotate('u1', 'c1', 'right')).rejects.toThrow(
      /already have another copy/i,
    );
    // The freshly written file is cleaned up; the stored one is untouched.
    expect(removed).toEqual(['credentials/2026/10/1.enc']);
  });

  it('⚠️ an undecodable file refuses rather than storing junk', async () => {
    const { svc, files, update } = build();
    files.read.mockResolvedValueOnce(Buffer.from('not an image'));
    await expect(svc.rotate('u1', 'c1', 'right')).rejects.toThrow(
      /could not rotate/i,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
