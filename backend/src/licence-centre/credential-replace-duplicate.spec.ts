import { CredentialKind } from '@prisma/client';
import { LicenceCentreService } from './licence-centre.service';
import { duplicateNote } from './credential-duplicates';

// ────────────────────────────────────────────────────────────────────
// WHICH VERSION OF A DOCUMENT DO WE KEEP?
//
// The duplicate flag says "looks like a copy of X" and leaves the member two
// ways out: keep the extra file, or make it the one the vault shows. This is
// the second — the copy becomes the row, the original it stood in for is
// erased.
//
// ⚠️ THE PROMOTION IS THREE FACTS AND ALL THREE MUST HOLD. `duplicateOfId`
// comes off, or the survivor points at a row that no longer exists and folds
// under nothing. The 'duplicate' attention code comes off, or it still counts
// in the chip. The note comes off (by its opening words), or the row keeps
// saying "looks like a copy of" the document that was just deleted on its
// behalf.
//
// ⚠️ AND THE ORIGINAL IS ERASED THROUGH THE SAME DOOR AS A MEMBER DELETE. It
// stamps the packs, resolves the notification, re-dates the competencies and
// re-arms the auto-link; a promotion that skipped any of that would leave the
// packs pointing at a dead id.
// ────────────────────────────────────────────────────────────────────

const ORIGINAL_NOTE = duplicateNote({
  title: 'Old howa licence',
  createdAt: new Date('2026-01-05'),
});

function build(
  row: Record<string, unknown> | null,
  original?: Record<string, unknown>,
) {
  const deleted: string[] = [];
  const updated: { where: { id: string }; data: Record<string, unknown> }[] = [];
  const findFirst = jest.fn(async (a: any): Promise<any> => {
    const id = a?.where?.id;
    if (row && id === row.id) return row;
    if (original && id === original.id) return original;
    return null;
  });
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'u1' })) },
    credential: {
      findFirst,
      findMany: jest.fn(async (): Promise<any[]> => []),
      delete: jest.fn(async (a: any) => {
        deleted.push(a.where.id);
        return {};
      }),
      updateMany: jest.fn(
        async (_a?: { where: unknown; data: Record<string, unknown> }) => ({
          count: 0,
        }),
      ),
      count: jest.fn(async () => 0),
      update: jest.fn(
        async (a: { where: { id: string }; data: Record<string, unknown> }) => {
          updated.push(a);
          return {};
        },
      ),
    },
    motivationUpload: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const files = {
    remove: jest.fn(async (_key?: string): Promise<void> => undefined),
  };
  const svc = new LicenceCentreService(
    prisma as never,
    files as never,
    { get: jest.fn(async () => 60) } as never,
    { resolveByEntity: jest.fn(async () => undefined) } as never,
    { assertEnabled: jest.fn(async () => undefined) } as never,
    { classify: jest.fn(), read: jest.fn() } as never,
    { classifyEvidence: jest.fn(async () => null) } as never,
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
  return { svc, prisma, files, deleted, updated };
}

const other = {
  id: 'orig',
  storageKey: 'credentials/orig.enc',
  kind: CredentialKind.FIREARM_LICENCE,
  coversKinds: [],
  attention: [],
  otherSideId: null,
};

const copy = {
  id: 'copy-1',
  storageKey: 'credentials/copy.enc',
  kind: CredentialKind.FIREARM_LICENCE,
  coversKinds: [],
  attention: ['duplicate'],
  otherSideId: null,
  duplicateOfId: 'orig',
  readNotes: [ORIGINAL_NOTE],
  title: 'Howa licence (new photo)',
};

describe('promoting a copy over the original', () => {
  it('⚠️ ERASES THE ORIGINAL — row and bytes', async () => {
    const { svc, deleted, files } = build(copy, other);
    await svc.replaceWith('user_1', 'copy-1');
    expect(deleted).toEqual(['orig']);
    expect(files.remove.mock.calls.map((c) => c[0] as string)).toEqual([
      'credentials/orig.enc',
    ]);
  });

  it('⚠️ KEEPS THE COPY — the member chose this file', async () => {
    const { svc, deleted } = build(copy, other);
    await svc.replaceWith('user_1', 'copy-1');
    expect(deleted).not.toContain('copy-1');
  });

  it('⚠️ CLEARS THE POINTER, THE ATTENTION CODE AND THE NOTE, ALL THREE', async () => {
    const { svc, updated } = build(copy, other);
    await svc.replaceWith('user_1', 'copy-1');
    const patch = updated.find((u) => u.where.id === 'copy-1');
    expect(patch?.data).toEqual({
      duplicateOfId: null,
      attention: [],
      readNotes: [],
    });
  });

  it('takes off a note written under earlier wording too', async () => {
    const stale = {
      ...copy,
      readNotes: ['Looks like a copy of "Something else"', 'A note we should keep'],
    };
    const { svc, updated } = build(stale, other);
    await svc.replaceWith('user_1', 'copy-1');
    const patch = updated.find((u) => u.where.id === 'copy-1');
    expect(patch?.data.readNotes).toEqual(['A note we should keep']);
  });

  it('reports which version went', async () => {
    const { svc } = build(copy, other);
    await expect(svc.replaceWith('user_1', 'copy-1')).resolves.toEqual({
      replaced: true,
      originalId: 'orig',
    });
  });

  it('⚠️ SURVIVES AN ORIGINAL THAT IS ALREADY GONE', async () => {
    // Flagged, then the original was deleted. The copy stands on its own and
    // only needs its pointer clearing — deleting nothing is success, not 500.
    const { svc, deleted, updated } = build(copy, undefined);
    await expect(svc.replaceWith('user_1', 'copy-1')).resolves.toEqual({
      replaced: false,
      originalId: null,
    });
    expect(deleted).toEqual([]);
    expect(updated.find((u) => u.where.id === 'copy-1')?.data.duplicateOfId).toBeNull();
  });

  it('⚠️ REFUSES A ROW THAT IS NOT A COPY', async () => {
    const { svc } = build(other, other);
    await expect(svc.replaceWith('user_1', 'orig')).rejects.toThrow(
      /not a copy/i,
    );
  });

  it('404s a document the member does not hold', async () => {
    const { svc } = build(null);
    await expect(svc.replaceWith('user_1', 'nope')).rejects.toThrow(
      /not found/i,
    );
  });
});
