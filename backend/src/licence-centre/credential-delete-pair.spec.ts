import { CredentialKind } from '@prisma/client';
import { LicenceCentreService } from './licence-centre.service';

// ────────────────────────────────────────────────────────────────────
// A TWO-SIDED DOCUMENT DELETES AS ONE DOCUMENT.
//
// A proficiency is two scans of ONE certificate — the provider's front and the
// PFTC statement of results — pointing at each other through `otherSideId`,
// and `documentsOf()` folds them into a single row on the member's screen.
//
// ⚠️ DELETING ONE SIDE LEFT THE OTHER STANDING, and the list then promoted it
// to lead: same title, same thumbnail, same place. Operator, 2026-09-09: "safe
// pictures and proficiencies wont delete." They deleted one — the vault event
// carries `wasPaired: true` — saw nothing change, and stopped. Seven
// proficiency rows were left on the box, every one of them paired.
//
// ⚠️ AND THE SURVIVOR KEPT A POINTER TO A DEAD ROW. `otherSideId` is a plain
// string, not a relation, so nothing cleared it.
// ────────────────────────────────────────────────────────────────────

function build(row: Record<string, unknown>, other?: Record<string, unknown>) {
  const deleted: string[] = [];
  const findFirst = jest.fn(async (a: any): Promise<any> => {
    const id = a?.where?.id;
    if (id === row.id) return row;
    if (other && id === other.id) return other;
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
        async (_a?: { where: unknown; data: { otherSideId: string | null } }) =>
          ({ count: 0 }),
      ),
      count: jest.fn(async () => 0),
      update: jest.fn(async () => ({})),
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
    { rearmAutolinkFor: jest.fn(async () => 0) } as never,
    { note: () => undefined } as never,
  );
  return { svc, prisma, files, deleted };
}

const front = {
  id: 'p-front',
  storageKey: 'credentials/a.enc',
  kind: CredentialKind.PROFICIENCY,
  coversKinds: [],
  attention: [],
  otherSideId: 'p-back',
};
const back = {
  id: 'p-back',
  storageKey: 'credentials/b.enc',
  kind: CredentialKind.PROFICIENCY,
};

describe('deleting a proficiency', () => {
  it('⚠️ TAKES BOTH PAGES, so the document actually leaves the screen', async () => {
    const { svc, deleted } = build(front, back);
    await svc.remove('user_1', 'p-front');
    expect(deleted).toEqual(['p-front', 'p-back']);
  });

  it('erases the other page’s bytes too, not just its row', async () => {
    const { svc, files } = build(front, back);
    await svc.remove('user_1', 'p-front');
    const keys = files.remove.mock.calls.map((c) => c[0] as string);
    expect(keys).toEqual(['credentials/a.enc', 'credentials/b.enc']);
  });

  it('clears a pointer left aiming at the row that just went', async () => {
    const { svc, prisma } = build(front, back);
    await svc.remove('user_1', 'p-front');
    const cleared = prisma.credential.updateMany.mock.calls.find(
      (c) => c[0]?.data?.otherSideId === null,
    );
    expect(cleared?.[0]?.where).toEqual({
      userId: 'u1',
      otherSideId: 'p-front',
    });
  });

  it('⚠️ KEEPS THE ERASURE WHEN ONLY THE SECOND PAGE FAILS', async () => {
    // The first side is already gone and the member has had most of what they
    // asked for. POPIA is the stronger obligation than tidiness.
    const { svc, deleted, files } = build(front, back);
    files.remove
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw new Error('disk gone');
      });
    await expect(svc.remove('user_1', 'p-front')).resolves.toBeDefined();
    expect(deleted).toEqual(['p-front']);
  });

  it('a one-sided document still deletes exactly itself', async () => {
    const solo = { ...front, id: 'solo', otherSideId: null };
    const { svc, deleted } = build(solo);
    await svc.remove('user_1', 'solo');
    expect(deleted).toEqual(['solo']);
  });
});
