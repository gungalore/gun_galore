import { FeedService } from './feed.service';

const viewer = {
  id: 'viewer-id',
  email: 'member@example.test',
  isBanned: false,
  accountClosedAt: null,
  feedMutedPostTypes: [],
  feedMutedAuthorIds: [],
  feedMutedTags: [],
  feedShowAvatar: true,
  feedShowGraphic: true,
  avatarUrl: null,
  username: 'member',
};

interface FindManyArgs {
  where: { id: { in: string[] }; status: string };
  select: Record<string, boolean>;
}

function makeService(prisma: Record<string, unknown>): FeedService {
  return new FeedService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('FeedService.postCounts', () => {
  it('returns counts for the given ids', async () => {
    const calls: FindManyArgs[] = [];
    const rows = [
      { id: 'p1', likeCount: 3, commentCount: 1 },
      { id: 'p2', likeCount: 0, commentCount: 5 },
    ];
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(viewer) },
      post: {
        findMany: jest.fn((args: FindManyArgs) => {
          calls.push(args);
          return Promise.resolve(rows);
        }),
      },
    };
    const service = makeService(prisma);

    const res = await service.postCounts('viewer-id', ['p1', 'p2']);

    expect(res).toEqual({ counts: rows });
    expect(calls[0]?.where.status).toBe('PUBLISHED');
    expect(calls[0]?.where.id.in).toEqual(['p1', 'p2']);
  });

  it('dedupes, trims and caps the id list', async () => {
    const calls: FindManyArgs[] = [];
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(viewer) },
      post: {
        findMany: jest.fn((args: FindManyArgs) => {
          calls.push(args);
          return Promise.resolve([]);
        }),
      },
    };
    const service = makeService(prisma);
    const ids = Array.from({ length: 150 }, (_, i) => `p${i}`);

    await service.postCounts('viewer-id', [' p1 ', 'p1', '', ...ids]);

    expect(calls[0]?.where.id.in).toHaveLength(100);
    expect(calls[0]?.where.id.in[0]).toBe('p1');
  });

  it('skips the query entirely when no ids are given', async () => {
    const findMany = jest.fn();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(viewer) },
      post: { findMany },
    };
    const service = makeService(prisma);

    const res = await service.postCounts('viewer-id', ['', '  ']);

    expect(res).toEqual({ counts: [] });
    expect(findMany).not.toHaveBeenCalled();
  });
});
