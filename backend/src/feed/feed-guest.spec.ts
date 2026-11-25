import 'reflect-metadata';
import {
  ForbiddenException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { PostStatus } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ContentAccessGuard } from '../auth/content-access.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { FeedQueryDto } from './dto/feed-query.dto';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

// ────────────────────────────────────────────────────────────────────
// COMMUNITY READS FOR A DECLARED GUEST (Phase 2).
//
// A visitor who accepted the 18+ gate has no session and — crucially — no
// `User` row. Every read below must therefore work with an undefined viewer id
// while keeping the response SHAPE identical to the member path: liked and
// disliked false, no mute state, no own-post branch. Writes stay members-only,
// so the controller half of this spec pins the guard wiring.
// ────────────────────────────────────────────────────────────────────

/** Nest's metadata key for @UseGuards. Same string as @nestjs/common. */
const GUARDS_METADATA = '__guards__';

function guardsOf(handler: unknown): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, handler as object) ??
    []) as unknown[];
}

/** A published post with every field shapePost reads. */
function basePost(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    authorId: 'author-1',
    type: 'GENERAL',
    title: 'Published post',
    body: 'Body',
    tags: [],
    flair: [],
    species: [],
    occurredAt: null,
    calibre: null,
    firearmType: null,
    firearmModel: null,
    bulletWeightGr: null,
    powderChargeGr: null,
    testResult: null,
    waterType: null,
    sizeCm: null,
    shotDistanceM: null,
    siteType: null,
    tripDays: null,
    gearCategory: null,
    gearRating: null,
    gearCondition: null,
    context: null,
    listingId: null,
    categoryId: null,
    location: null,
    locationPlaceId: null,
    status: PostStatus.PUBLISHED,
    graphicTier: 'NONE',
    isOfficial: false,
    moderationReason: null,
    likeCount: 2,
    dislikeCount: 0,
    commentCount: 1,
    reportedCount: 0,
    disputedAt: null,
    publishedAt: new Date('2026-11-01T00:00:00Z'),
    moderatedAt: new Date('2026-11-01T00:00:00Z'),
    createdAt: new Date('2026-11-01T00:00:00Z'),
    editedAt: null,
    images: [],
    video: null,
    route: null,
    listing: null,
    likes: [],
    author: {
      username: 'outdoors',
      avatarUrl: null,
      sellerTier: 'BRONZE',
      isVerifiedExpert: false,
      phoneVerified: false,
      emailVerifiedAt: null,
      kycIdVerifiedAt: null,
      feedShowAvatar: true,
    },
    ...over,
  };
}

function makeService(
  prisma: Record<string, unknown>,
  extra: { ads?: Record<string, unknown>; settings?: Record<string, unknown> } = {},
): FeedService {
  return new FeedService(
    prisma as never,
    {} as never, // cloudinary (unused by reads)
    {} as never, // contact filter (unused by reads)
    {} as never, // moderation service (unused by reads)
    {} as never, // notifications (unused by reads)
    (extra.settings ?? { get: jest.fn().mockResolvedValue(false) }) as never,
    {} as never, // awards (unused by reads)
    (extra.ads ?? { activeAds: jest.fn().mockResolvedValue([]) }) as never,
  );
}

describe('FeedService — declared-guest reads', () => {
  it('lists published posts for a guest without loading a viewer row', async () => {
    const findMany = jest.fn().mockResolvedValue([basePost()]);
    const userFindUnique = jest.fn();
    const service = makeService({
      user: { findUnique: userFindUnique },
      post: { findMany },
    });

    const page = await service.listFeed(undefined, {} as FeedQueryDto);

    // No session → no user lookup at all (a guest has no User row to find).
    expect(userFindUnique).not.toHaveBeenCalled();
    const args = findMany.mock.calls[0][0] as {
      where: { OR: unknown; NOT?: unknown };
      include: { likes: { where: unknown } };
    };
    // Published only: no own-post (moderation/rejected) branch for a guest.
    expect(args.where.OR).toEqual([{ status: PostStatus.PUBLISHED }]);
    expect(args.where.NOT).toBeUndefined();
    // No reaction row can match, so liked/disliked come back false.
    expect(args.include.likes.where).toEqual({ id: { in: [] } });
    expect(page.posts[0]).toMatchObject({ liked: false, disliked: false });
    expect(page.posts[0]).not.toHaveProperty('muted');
  });

  it('still gives a signed-in member their own not-yet-live posts', async () => {
    const viewer = {
      id: 'viewer-1',
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
    const findMany = jest.fn().mockResolvedValue([basePost()]);
    const service = makeService({
      user: { findUnique: jest.fn().mockResolvedValue(viewer) },
      post: { findMany },
    });

    await service.listFeed('viewer-1', {} as FeedQueryDto);

    const args = findMany.mock.calls[0][0] as {
      where: { OR: unknown[] };
      include: { likes: { where: unknown } };
    };
    expect(args.where.OR).toEqual([
      { status: PostStatus.PUBLISHED },
      {
        authorId: 'viewer-1',
        status: {
          in: [PostStatus.PENDING_MODERATION, PostStatus.REJECTED],
        },
      },
    ]);
    expect(args.include.likes.where).toEqual({ userId: 'viewer-1' });
  });

  it('404s a guest on a post that is not published (moderation never opens)', async () => {
    const service = makeService({
      user: { findUnique: jest.fn() },
      post: {
        findUnique: jest
          .fn()
          .mockResolvedValue(basePost({ status: PostStatus.PENDING_MODERATION })),
      },
      comment: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await expect(service.getPost(undefined, 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serves a published post and its comments to a guest, read-only', async () => {
    const commentFindMany = jest.fn().mockResolvedValue([
      {
        id: 'c1',
        parentId: null,
        body: 'Nice',
        likeCount: 0,
        dislikeCount: 0,
        createdAt: new Date('2026-11-02T00:00:00Z'),
        authorId: 'author-1',
        likes: [],
        author: { ...basePost().author },
      },
    ]);
    const postFindUnique = jest.fn().mockResolvedValue(basePost());
    const service = makeService({
      user: { findUnique: jest.fn() },
      post: { findUnique: postFindUnique },
      comment: { findMany: commentFindMany },
    });

    const res = await service.getPost(undefined, 'p1');

    expect(res.post).toMatchObject({ id: 'p1', liked: false, disliked: false });
    expect(res.comments[0]).toMatchObject({ liked: false, disliked: false });
    const commentArgs = commentFindMany.mock.calls[0][0] as {
      include: { likes: { where: unknown } };
    };
    expect(commentArgs.include.likes.where).toEqual({ id: { in: [] } });
  });

  it('serves a published profile to a guest without leaking a follow state', async () => {
    const profile = {
      id: 'profile-1',
      username: 'turbosnail',
      avatarUrl: null,
      sellerTier: null,
      isVerifiedExpert: false,
      phoneVerified: false,
      emailVerifiedAt: null,
      kycIdVerifiedAt: null,
      feedShowAvatar: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const followFindUnique = jest.fn();
    const service = makeService({
      user: { findUnique: jest.fn().mockResolvedValue(profile) },
      follow: {
        findUnique: followFindUnique,
        count: jest.fn().mockResolvedValue(0),
      },
      userSocialStats: { findUnique: jest.fn().mockResolvedValue({ points: 0 }) },
      post: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      comment: { count: jest.fn().mockResolvedValue(0) },
    });

    const res = await service.getProfile(undefined, 'Turbosnail');

    expect(followFindUnique).not.toHaveBeenCalled();
    expect(res.isFollowing).toBe(false);
    expect(res.profile.username).toBe('turbosnail');
  });

  it('serves config and counts to a guest without a User row', async () => {
    const userFindUnique = jest.fn();
    const service = makeService({
      user: { findUnique: userFindUnique },
      post: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'p1', likeCount: 1, dislikeCount: 0, commentCount: 2 }]),
      },
    });

    const cfg = await service.getConfig(undefined);
    const counts = await service.postCounts(undefined, ['p1']);

    expect(cfg).toHaveProperty('graphicBlurForced');
    expect(counts.counts).toHaveLength(1);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('serves a published route and its .gpx to a guest when the author shared it', async () => {
    const segments = [
      [
        { lat: -30, lon: 18, ele: 1000, speedKph: null, gradientPct: null, distM: 0 },
      ],
    ];
    const postFindUnique = jest.fn().mockResolvedValue(
      basePost({
        status: PostStatus.PUBLISHED,
        route: {
          distanceM: 100,
          ascentM: null,
          descentM: null,
          minElevationM: null,
          maxElevationM: null,
          durationSeconds: null,
          pointCount: 1,
          segmentCount: 1,
          hasElevation: true,
          hasSpeed: false,
          gpxShared: true,
          profile: [1000],
          preview: null,
          segments,
          bounds: { south: -31, west: 17, north: -29, east: 19 },
        },
      }),
    );
    const service = makeService({
      user: { findUnique: jest.fn() },
      post: { findUnique: postFindUnique },
    });

    const route = await service.getRoute(undefined, 'p1');
    const gpx = await service.downloadRouteGpx(undefined, 'p1');

    expect(route.route.segments).toBe(segments);
    expect(gpx.body).toContain('<gpx');
    expect(gpx.filename).toContain('p1');
  });

  it('refuses a guest the .gpx when the author did not share it', async () => {
    const service = makeService({
      user: { findUnique: jest.fn() },
      post: {
        findUnique: jest.fn().mockResolvedValue(
          basePost({
            route: {
              distanceM: 100,
              ascentM: null,
              descentM: null,
              minElevationM: null,
              maxElevationM: null,
              durationSeconds: null,
              pointCount: 1,
              segmentCount: 1,
              hasElevation: true,
              hasSpeed: false,
              gpxShared: false,
              profile: null,
              preview: null,
              segments: [],
              bounds: null,
            },
          }),
        ),
      },
    });

    await expect(
      service.downloadRouteGpx(undefined, 'p1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ────────────────────────────────────────────────────────────────────
// GUARD WIRING. A read that loses OptionalAuthGuard becomes a 401 for the
// declared guest; a WRITE that loses AuthGuard lets a signed-out visitor like,
// comment or post. Both are silent in the service layer, so they are pinned
// here on the controller metadata Nest actually reads.
// ────────────────────────────────────────────────────────────────────
describe('FeedController — guard wiring', () => {
  const readGuarded = (handler: unknown) => ({
    content: guardsOf(handler),
    httpMethod: Reflect.getMetadata(METHOD_METADATA, handler as object),
  });

  it('mounts no class-level (member-only) guard', () => {
    expect(guardsOf(FeedController)).toEqual([]);
  });

  it.each([
    ['feed', FeedController.prototype.list],
    ['search', FeedController.prototype.search],
    ['counts', FeedController.prototype.counts],
    ['config', FeedController.prototype.config],
    ['leaderboard', FeedController.prototype.leaderboard],
    ['users/:username', FeedController.prototype.profile],
    ['posts/:id', FeedController.prototype.post],
    ['posts/:id/route', FeedController.prototype.route],
    ['posts/:id/route.gpx', FeedController.prototype.routeGpx],
    ['posts/:id/likes', FeedController.prototype.postLikes],
    ['posts/:id/dislikes', FeedController.prototype.postDislikes],
    ['comments/:id/likes', FeedController.prototype.commentLikes],
    ['comments/:id/dislikes', FeedController.prototype.commentDislikes],
  ])('guards the read %s with OptionalAuthGuard then ContentAccessGuard', (_path, handler) => {
    expect(guardsOf(handler)).toEqual([OptionalAuthGuard, ContentAccessGuard]);
    expect(readGuarded(handler).httpMethod).toBe(RequestMethod.GET);
  });

  it.each([
    ['create post', FeedController.prototype.createPost],
    ['update post', FeedController.prototype.updatePost],
    ['delete post', FeedController.prototype.deletePost],
    ['submit post', FeedController.prototype.submitPost],
    ['like post', FeedController.prototype.likePost],
    ['unlike post', FeedController.prototype.unlikePost],
    ['dislike post', FeedController.prototype.dislikePost],
    ['undislike post', FeedController.prototype.undislikePost],
    ['like comment', FeedController.prototype.likeComment],
    ['add comment', FeedController.prototype.addComment],
    ['report post', FeedController.prototype.reportPost],
    ['report comment', FeedController.prototype.reportComment],
    ['dispute post', FeedController.prototype.disputePost],
    ['follow user', FeedController.prototype.follow],
    ['unfollow user', FeedController.prototype.unfollow],
    ['preferences', FeedController.prototype.setPreferences],
    ['feature listing', FeedController.prototype.featureListing],
    ['my posts', FeedController.prototype.myPosts],
    ['my summary', FeedController.prototype.mySummary],
    ['my followers', FeedController.prototype.myFollowers],
    ['my feed preferences', FeedController.prototype.preferences],
    ['remove follower', FeedController.prototype.removeFollower],
  ])('session-guards the write/private route %s with AuthGuard only', (_label, handler) => {
    expect(guardsOf(handler)).toEqual([AuthGuard]);
  });
});
