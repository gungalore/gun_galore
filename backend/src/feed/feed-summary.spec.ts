import { FeedService } from './feed.service';
import { levelFor } from './feed-awards.service';

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
  username: 'turbosnail',
};

const profile = {
  id: 'profile-id',
  username: 'turbosnail',
  avatarUrl: null,
  sellerTier: null,
  isVerifiedExpert: false,
  phoneVerified: true,
  emailVerifiedAt: null,
  kycIdVerifiedAt: null,
  feedShowAvatar: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

interface CountArgs {
  where: Record<string, unknown>;
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

describe('FeedService.mySummary', () => {
  it('counts live posts, not the stored counter that includes deleted posts', async () => {
    const postCount = jest.fn((args: CountArgs) =>
      Promise.resolve(args.where.status === 'PUBLISHED' ? 2 : 1),
    );
    const commentCount = jest.fn(() => Promise.resolve(5));
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(viewer) },
      follow: {
        count: jest.fn((args: CountArgs) =>
          Promise.resolve('followingId' in args.where ? 3 : 4),
        ),
      },
      post: { count: postCount },
      comment: { count: commentCount },
      // The stored row still holds the stale "7" the panel used to show.
      userSocialStats: {
        findUnique: jest.fn().mockResolvedValue({
          points: 120,
          postCount: 7,
          commentCount: 9,
        }),
      },
    };
    const service = makeService(prisma);

    const res = await service.mySummary('viewer-id');

    expect(res.postCount).toBe(2);
    expect(res.commentCount).toBe(5);
    expect(res.pendingCount).toBe(1);
    expect(res.followerCount).toBe(3);
    expect(res.followingCount).toBe(4);
    expect(res.points).toBe(120);
    expect(res.level).toBe(levelFor(120).name);

    expect(postCount).toHaveBeenCalledWith({
      where: { authorId: 'viewer-id', status: 'PUBLISHED' },
    });
    // A comment on a post that is no longer live must not be counted.
    expect(commentCount).toHaveBeenCalledWith({
      where: {
        authorId: 'viewer-id',
        status: 'PUBLISHED',
        post: { status: 'PUBLISHED' },
      },
    });
  });
});

describe('FeedService.getProfile', () => {
  it('counts only posts the visitor can see, not the stored counter', async () => {
    const userFindUnique = jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.usernameLower ? profile : viewer),
    );
    const prisma = {
      user: { findUnique: userFindUnique },
      follow: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn((args: CountArgs) =>
          Promise.resolve('followingId' in args.where ? 7 : 2),
        ),
      },
      userSocialStats: {
        findUnique: jest.fn().mockResolvedValue({
          points: 40,
          postCount: 7,
          commentCount: 9,
        }),
      },
      post: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([]),
      },
      comment: { count: jest.fn().mockResolvedValue(6) },
    };
    const service = makeService(prisma);

    const res = await service.getProfile('viewer-id', 'turbosnail');

    expect(res.postCount).toBe(2);
    expect(res.commentCount).toBe(6);
    expect(res.followerCount).toBe(7);
    expect(res.followingCount).toBe(2);
    expect(res.points).toBe(40);
  });
});
