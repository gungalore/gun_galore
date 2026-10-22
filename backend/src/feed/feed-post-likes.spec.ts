import { NotFoundException } from '@nestjs/common';
import { PostStatus } from '@prisma/client';
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
}

function prismaWith(opts: {
  rows?: unknown[];
  post?: unknown;
  calls?: FindManyArgs[];
}): Record<string, unknown> {
  const {
    rows = [],
    post = { id: 'p1', status: PostStatus.PUBLISHED },
    calls = [],
  } = opts;
  return {
    user: { findUnique: jest.fn().mockResolvedValue(viewer) },
    post: { findUnique: jest.fn().mockResolvedValue(post) },
    postLike: {
      findMany: jest.fn((args: FindManyArgs) => {
        calls.push(args);
        return Promise.resolve(rows);
      }),
    },
  };
}

describe('FeedService.listPostLikes', () => {
  it('returns likers newest-first with privacy-gated avatars', async () => {
    const prisma = prismaWith({
      rows: [
        {
          createdAt: new Date('2026-10-10T10:00:00.000Z'),
          user: {
            id: 'u2',
            username: 'jane',
            avatarUrl: 'https://img/2',
            sellerTier: null,
            isVerifiedExpert: true,
            feedShowAvatar: true,
          },
        },
        {
          createdAt: new Date('2026-10-10T09:00:00.000Z'),
          user: {
            id: 'u1',
            username: 'john',
            avatarUrl: 'https://img/1',
            sellerTier: 'GOLD',
            isVerifiedExpert: false,
            feedShowAvatar: false,
          },
        },
      ],
    });
    const service = makeService(prisma);

    const res = await service.listPostLikes('viewer-id', 'p1');

    expect(res.likers).toEqual([
      {
        id: 'u2',
        username: 'jane',
        avatarUrl: 'https://img/2',
        sellerTier: null,
        isVerifiedExpert: true,
        verification: {
          phoneVerified: false,
          emailVerified: false,
          idVerified: false,
        },
      },
      {
        id: 'u1',
        username: 'john',
        avatarUrl: null,
        sellerTier: 'GOLD',
        isVerifiedExpert: false,
        verification: {
          phoneVerified: false,
          emailVerified: false,
          idVerified: false,
        },
      },
    ]);
    expect(res.nextBefore).toBeNull();
  });

  it('trims to the page limit and sets nextBefore when more remain', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      createdAt: new Date(Date.UTC(2026, 9, 10, 10, 0, 0) + (51000 - i * 1000)),
      user: {
        id: `u${i}`,
        username: `u${i}`,
        avatarUrl: null,
        sellerTier: null,
        isVerifiedExpert: false,
        feedShowAvatar: true,
      },
    }));
    const calls: FindManyArgs[] = [];
    const service = makeService(prismaWith({ rows, calls }));

    const res = await service.listPostLikes('viewer-id', 'p1');

    expect(res.likers).toHaveLength(50);
    expect(res.nextBefore).toBe(rows[49].createdAt.toISOString());
    expect(calls[0]?.take).toBe(51);
  });

  it('passes the cursor through as a strict "before" bound', async () => {    const calls: FindManyArgs[] = [];
    const service = makeService(prismaWith({ calls }));
    const cursor = '2026-10-10T09:00:00.000Z';

    await service.listPostLikes('viewer-id', 'p1', cursor);

    expect(calls[0]?.where).toEqual({
      postId: 'p1',
      kind: 'LIKE',
      createdAt: { lt: new Date(cursor) },
    });
  });

  it('404s for a missing post', async () => {
    const service = makeService(prismaWith({ post: null }));

    await expect(
      service.listPostLikes('viewer-id', 'gone'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s for a non-published post', async () => {
    const service = makeService(
      prismaWith({
        post: { id: 'p1', status: PostStatus.PENDING_MODERATION },
      }),
    );

    await expect(
      service.listPostLikes('viewer-id', 'p1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
