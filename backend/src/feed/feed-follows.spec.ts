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
  avatarUrl: null,
  username: 'member',
};

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

interface FindManyArgs {
  where: Record<string, unknown>;
  take: number;
  select: Record<string, unknown>;
}

function author(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    username: id,
    avatarUrl: null,
    sellerTier: null,
    isVerifiedExpert: false,
    feedShowAvatar: true,
    ...overrides,
  };
}

describe('FeedService social lists', () => {
  describe('listFollowers', () => {
    it('maps followers newest-first, gates avatars and marks who the viewer follows back', async () => {
      const calls: FindManyArgs[] = [];
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        follow: {
          findMany: jest.fn((args: FindManyArgs) => {
            calls.push(args);
            // First call: the followers themselves. Second: who the viewer follows.
            if (args.where.followingId === 'viewer-id' && 'follower' in args.select) {
              return Promise.resolve([
                {
                  createdAt: new Date('2026-10-10T10:00:00.000Z'),
                  follower: author('u2', { avatarUrl: 'https://img/2', isVerifiedExpert: true }),
                },
                {
                  createdAt: new Date('2026-10-10T09:00:00.000Z'),
                  follower: author('u1', {
                    avatarUrl: 'https://img/1',
                    feedShowAvatar: false,
                    sellerTier: 'GOLD',
                  }),
                },
              ]);
            }
            return Promise.resolve([{ followingId: 'u2' }]);
          }),
        },
      };
      const service = makeService(prisma);

      const res = await service.listFollowers('viewer-id');

      expect(res.users).toEqual([
        {
          id: 'u2',
          username: 'u2',
          avatarUrl: 'https://img/2',
          sellerTier: null,
          isVerifiedExpert: true,
          verification: {
            phoneVerified: false,
            emailVerified: false,
            idVerified: false,
          },
          isFollowing: true,
        },
        {
          id: 'u1',
          username: 'u1',
          avatarUrl: null,
          sellerTier: 'GOLD',
          isVerifiedExpert: false,
          verification: {
            phoneVerified: false,
            emailVerified: false,
            idVerified: false,
          },
          isFollowing: false,
        },
      ]);
      expect(res.nextBefore).toBeNull();
    });

    it('trims to the page limit and sets nextBefore when more remain', async () => {
      const rows = Array.from({ length: 51 }, (_, i) => ({
        createdAt: new Date(Date.UTC(2026, 9, 10, 10, 0, 0) + (51000 - i * 1000)),
        follower: author(`u${i}`),
      }));
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        follow: {
          findMany: jest.fn((args: FindManyArgs) =>
            'follower' in args.select
              ? Promise.resolve(rows)
              : Promise.resolve([]),
          ),
        },
      };
      const service = makeService(prisma);

      const res = await service.listFollowers('viewer-id');

      expect(res.users).toHaveLength(50);
      expect(res.nextBefore).toBe(rows[49].createdAt.toISOString());
    });

    it('passes the cursor through as a strict "before" bound', async () => {
      const calls: FindManyArgs[] = [];
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        follow: {
          findMany: jest.fn((args: FindManyArgs) => {
            calls.push(args);
            return Promise.resolve([]);
          }),
        },
      };
      const service = makeService(prisma);
      const cursor = '2026-10-10T09:00:00.000Z';

      await service.listFollowers('viewer-id', cursor);

      expect(calls[0]?.where).toEqual({
        followingId: 'viewer-id',
        createdAt: { lt: new Date(cursor) },
      });
    });
  });

  describe('listFollowing', () => {
    it('maps the members followed, always marked isFollowing', async () => {
      const calls: FindManyArgs[] = [];
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        follow: {
          findMany: jest.fn((args: FindManyArgs) => {
            calls.push(args);
            return Promise.resolve([
              {
                createdAt: new Date('2026-10-10T10:00:00.000Z'),
                following: author('u9', { username: 'sipho' }),
              },
            ]);
          }),
        },
      };
      const service = makeService(prisma);

      const res = await service.listFollowing('viewer-id');

      expect(calls[0]?.where).toEqual({ followerId: 'viewer-id' });
      expect(res.users).toEqual([
        {
          id: 'u9',
          username: 'sipho',
          avatarUrl: null,
          sellerTier: null,
          isVerifiedExpert: false,
          verification: {
            phoneVerified: false,
            emailVerified: false,
            idVerified: false,
          },
          isFollowing: true,
        },
      ]);
      expect(res.nextBefore).toBeNull();
    });
  });

  describe('removeFollower', () => {
    it('deletes the follow edge and reports it was removed', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        follow: { deleteMany },
      };
      const service = makeService(prisma);

      const res = await service.removeFollower('viewer-id', 'u2');

      expect(deleteMany).toHaveBeenCalledWith({
        where: { followerId: 'u2', followingId: 'viewer-id' },
      });
      expect(res).toEqual({ removed: true });
    });

    it('is a no-op when the follower is already gone', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        follow: { deleteMany },
      };
      const service = makeService(prisma);

      const res = await service.removeFollower('viewer-id', 'u2');

      expect(res).toEqual({ removed: false });
    });

    it('ignores a self id without touching the database', async () => {
      const deleteMany = jest.fn();
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        follow: { deleteMany },
      };
      const service = makeService(prisma);

      const res = await service.removeFollower('viewer-id', 'viewer-id');

      expect(deleteMany).not.toHaveBeenCalled();
      expect(res).toEqual({ removed: false });
    });
  });
});
