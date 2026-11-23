import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PostStatus } from '@prisma/client';
import { FeedService } from './feed.service';

// ─────────────────────────────────────────────────────────────────────
// GPX route behaviour on the community post service. Prisma/Cloudinary are
// hand-stubbed (same style as feed-summary.spec.ts): these tests pin the
// authorisation and lifecycle rules, not Prisma itself.
// ─────────────────────────────────────────────────────────────────────

const viewer = {
  id: 'viewer',
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

const author = {
  username: 'trailhound',
  avatarUrl: null,
  sellerTier: null,
  isVerifiedExpert: false,
  phoneVerified: false,
  emailVerifiedAt: null,
  kycIdVerifiedAt: null,
  feedShowAvatar: true,
};

/** A stored route summary row (what the feed select returns). */
function routeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    distanceM: 423,
    ascentM: 40,
    descentM: 0,
    durationSeconds: 1200,
    pointCount: 21,
    segmentCount: 1,
    hasElevation: true,
    hasSpeed: true,
    gpxShared: true,
    profile: [100, 120, 140],
    ...overrides,
  };
}

/** A stored route with its points (what the route page/download selects). */
function routeFullRow(overrides: Record<string, unknown> = {}) {
  return {
    ...routeSummaryRow(),
    minElevationM: 100,
    maxElevationM: 140,
    segments: [
      [
        { lat: -33.1, lon: 18.1, ele: 100, speedKph: null, gradientPct: null, distM: 0 },
        { lat: -33.1001, lon: 18.1001, ele: 140, speedKph: 3.2, gradientPct: 4.5, distM: 21 },
      ],
    ],
    bounds: { south: -33.1001, west: 18.1, north: -33.1, east: 18.1001 },
    ...overrides,
  };
}

/** A post row shaped like the full `PostWithRelations` the service expects. */
function feedPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    authorId: 'author',
    type: 'HIKING',
    title: null,
    body: '',
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
    publicVisible: false,
    status: PostStatus.PENDING_MODERATION,
    graphicTier: 'NONE',
    moderationReason: null,
    moderatedAt: null,
    disputedAt: null,
    disputeNote: null,
    isPinned: false,
    isOfficial: false,
    location: null,
    locationPlaceId: null,
    likeCount: 0,
    dislikeCount: 0,
    commentCount: 0,
    reportedCount: 0,
    publishedAt: null,
    editedAt: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    images: [],
    video: null,
    route: null,
    listing: null,
    likes: [],
    author,
    ...overrides,
  };
}

/** 21-point, ~400 m zigzag track — a valid GPX the parser accepts. */
function validGpx(): string {
  const points: string[] = [];
  for (let i = 0; i < 21; i += 1) {
    const lat = (-33.1 + i * 0.0001).toFixed(6);
    const lon = (18.1 + (i % 2 === 0 ? 0.0001 : -0.0001)).toFixed(6);
    const time = new Date(Date.UTC(2026, 0, 1, 0, i, 0)).toISOString();
    points.push(
      `<trkpt lat="${lat}" lon="${lon}"><ele>${100 + i * 2}</ele><time>${time}</time></trkpt>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`;
}

function gpxFile(text: string): Express.Multer.File {
  return { buffer: Buffer.from(text, 'utf8') } as Express.Multer.File;
}

function makeService(prisma: Record<string, unknown>, cloudinary: Record<string, unknown> = {}) {
  return new FeedService(
    prisma as never,
    cloudinary as never,
    {} as never,
    // Never resolves: submitPost queues moderation in the background, and these
    // tests only care about the queuing itself.
    { moderate: jest.fn(() => new Promise(() => {})) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('FeedService GPX routes', () => {
  describe('uploadRoute', () => {
    it('404s when the post belongs to someone else', async () => {
      const upsert = jest.fn();
      const service = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue(feedPost({ authorId: 'author' })),
        },
        postRoute: { upsert },
      });

      await expect(
        service.uploadRoute('viewer', 'p1', gpxFile(validGpx())),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('refuses a type that cannot carry a route', async () => {
      const upsert = jest.fn();
      const service = makeService({
        post: {
          findUnique: jest
            .fn()
            .mockResolvedValue(feedPost({ authorId: 'viewer', type: 'GENERAL' })),
        },
        postRoute: { upsert },
      });

      await expect(
        service.uploadRoute('viewer', 'p1', gpxFile(validGpx())),
      ).rejects.toThrow(/hiking, overlanding or camping/i);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('refuses a published or rejected post', async () => {
      const upsert = jest.fn();
      const published = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue(
            feedPost({ authorId: 'viewer', status: PostStatus.PUBLISHED }),
          ),
        },
        postRoute: { upsert },
      });
      await expect(
        published.uploadRoute('viewer', 'p1', gpxFile(validGpx())),
      ).rejects.toThrow(/cannot be changed after the post is published/i);

      const rejected = makeService({
        post: {
          findUnique: jest
            .fn()
            .mockResolvedValue(
              feedPost({ authorId: 'viewer', status: PostStatus.REJECTED }),
            ),
        },
        postRoute: { upsert },
      });
      await expect(
        rejected.uploadRoute('viewer', 'p1', gpxFile(validGpx())),
      ).rejects.toThrow(/rejected/i);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('maps an invalid GPX to a 400 before touching the database', async () => {
      const upsert = jest.fn();
      const service = makeService({
        post: {
          findUnique: jest
            .fn()
            .mockResolvedValue(feedPost({ authorId: 'viewer' })),
        },
        postRoute: { upsert },
      });

      await expect(
        service.uploadRoute('viewer', 'p1', gpxFile('<gpx>not a route</gpx>')),
      ).rejects.toThrow();
      expect(upsert).not.toHaveBeenCalled();
    });

    it('stores the parsed summary and defaults gpxShared to true', async () => {
      const upsert = jest.fn().mockResolvedValue(routeSummaryRow());
      const service = makeService({
        post: {
          findUnique: jest
            .fn()
            .mockResolvedValue(feedPost({ authorId: 'viewer' })),
        },
        postRoute: { upsert },
      });

      const result = await service.uploadRoute('viewer', 'p1', gpxFile(validGpx()));

      expect(upsert).toHaveBeenCalledTimes(1);
      const args = upsert.mock.calls[0][0];
      expect(args.where).toEqual({ postId: 'p1' });
      expect(args.create.postId).toBe('p1');
      expect(args.create.distanceM).toBeGreaterThan(100);
      expect(args.create.pointCount).toBeGreaterThanOrEqual(20);
      expect(args.create.gpxShared).toBe(true);
      expect(args.update.gpxShared).toBe(true);
      // ⚠️ Full points/bounds must NEVER ride the feed summary select.
      expect(args.select.segments).toBeUndefined();
      expect(args.select.bounds).toBeUndefined();
      expect(result.route).toEqual(routeSummaryRow());
    });

    it('replaces the existing route on re-upload and honours gpxShared=false', async () => {
      const upsert = jest.fn().mockResolvedValue(routeSummaryRow({ gpxShared: false }));
      const service = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue(
            feedPost({
              authorId: 'viewer',
              route: routeSummaryRow(),
            }),
          ),
        },
        postRoute: { upsert },
      });

      const result = await service.uploadRoute(
        'viewer',
        'p1',
        gpxFile(validGpx()),
        false,
      );

      const args = upsert.mock.calls[0][0];
      expect(args.where).toEqual({ postId: 'p1' });
      expect(args.update.gpxShared).toBe(false);
      expect(args.create.gpxShared).toBe(false);
      expect(result.route?.gpxShared).toBe(false);
    });
  });

  describe('removeRoute', () => {
    it('deletes only the route, leaving media and Cloudinary untouched', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const postDelete = jest.fn();
      const deleteImages = jest.fn();
      const deleteVideo = jest.fn();
      const service = makeService(
        {
          post: {
            findUnique: jest.fn().mockResolvedValue(
              feedPost({
                authorId: 'viewer',
                images: [{ id: 'img1', url: 'u', publicId: 'pub' }],
                video: { publicId: 'vid' },
                route: routeSummaryRow(),
              }),
            ),
            delete: postDelete,
          },
          postRoute: { deleteMany },
        },
        { deleteImages, deleteVideo, deleteImage: jest.fn() },
      );

      const result = await service.removeRoute('viewer', 'p1');

      expect(result).toEqual({ deleted: true });
      expect(deleteMany).toHaveBeenCalledWith({ where: { postId: 'p1' } });
      expect(postDelete).not.toHaveBeenCalled();
      expect(deleteImages).not.toHaveBeenCalled();
      expect(deleteVideo).not.toHaveBeenCalled();
    });

    it('404s for a non-author', async () => {
      const deleteMany = jest.fn();
      const service = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue(feedPost({ authorId: 'author' })),
        },
        postRoute: { deleteMany },
      });

      await expect(service.removeRoute('viewer', 'p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('getRoute', () => {
    it('returns the full points to the author while the post is in moderation', async () => {
      const service = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue({
            authorId: 'viewer',
            status: PostStatus.PENDING_MODERATION,
            route: routeFullRow(),
          }),
        },
      });

      const result = await service.getRoute('viewer', 'p1');

      expect(result.route.segments).toHaveLength(1);
      expect(result.route.bounds).toEqual(routeFullRow().bounds);
      expect(result.route.distanceM).toBe(423);
      // The summary fields are still all there.
      expect(result.route.profile).toEqual([100, 120, 140]);
    });

    it('404s for a non-author on a non-published post', async () => {
      const service = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue({
            authorId: 'author',
            status: PostStatus.PENDING_MODERATION,
            route: routeFullRow(),
          }),
        },
      });

      await expect(service.getRoute('viewer', 'p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the route to any member once the post is published', async () => {
      const service = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue({
            authorId: 'author',
            status: PostStatus.PUBLISHED,
            route: routeFullRow(),
          }),
        },
      });

      const result = await service.getRoute('viewer', 'p1');
      expect(result.route.segments[0]).toHaveLength(2);
    });

    it('404s when the post has no route', async () => {
      const service = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue({
            authorId: 'viewer',
            status: PostStatus.PUBLISHED,
            route: null,
          }),
        },
      });

      await expect(service.getRoute('viewer', 'p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('downloadRouteGpx', () => {
    const publishedPost = (overrides: Record<string, unknown> = {}) => ({
      authorId: 'author',
      status: PostStatus.PUBLISHED,
      route: routeFullRow(),
      ...overrides,
    });

    it('refuses non-authors when the author disabled sharing', async () => {
      const service = makeService({
        post: {
          findUnique: jest
            .fn()
            .mockResolvedValue(publishedPost({ route: routeFullRow({ gpxShared: false }) })),
        },
      });

      await expect(
        service.downloadRouteGpx('viewer', 'p1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.downloadRouteGpx('viewer', 'p1')).rejects.toThrow(
        'The author has not enabled the GPX download.',
      );
    });

    it('still lets the author download their own route when sharing is off', async () => {
      const service = makeService({
        post: {
          findUnique: jest
            .fn()
            .mockResolvedValue(publishedPost({ route: routeFullRow({ gpxShared: false }) })),
        },
      });

      const result = await service.downloadRouteGpx('author', 'p1');
      expect(result.filename).toBe('alloutdoor-route-p1.gpx');
    });

    it('generates a GPX 1.1 file with elevation and no timestamps/metadata', async () => {
      const service = makeService({
        post: { findUnique: jest.fn().mockResolvedValue(publishedPost()) },
      });

      const { body, filename } = await service.downloadRouteGpx('viewer', 'p1');

      expect(filename).toBe('alloutdoor-route-p1.gpx');
      expect(body).toContain('<gpx version="1.1"');
      expect(body).toContain('<trkpt lat="-33.1000000" lon="18.1000000"><ele>100.0</ele></trkpt>');
      expect(body).toContain('<trkseg>');
      // ⚠️ No recording metadata, no times, no waypoints.
      expect(body).not.toContain('<time>');
      expect(body).not.toContain('<metadata');
      expect(body).not.toContain('<wpt');
      // The brand appears as the GPX creator, escaped.
      expect(body).toContain('creator="ALL Outdoor"');
    });

    it('404s (never 403) for a non-author on an unpublished post', async () => {
      const service = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue(
            publishedPost({ status: PostStatus.PENDING_MODERATION }),
          ),
        },
      });

      await expect(
        service.downloadRouteGpx('viewer', 'p1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setRouteGpxShared', () => {
    it('lets the author toggle sharing after the post is published', async () => {
      const update = jest.fn().mockResolvedValue({ gpxShared: false });
      const service = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue({
            authorId: 'author',
            status: PostStatus.PUBLISHED,
            route: { id: 'r1' },
          }),
        },
        postRoute: { update },
      });

      const result = await service.setRouteGpxShared('author', 'p1', false);

      expect(result).toEqual({ gpxShared: false });
      expect(update).toHaveBeenCalledWith({
        where: { postId: 'p1' },
        data: { gpxShared: false },
      });
    });

    it('404s for a non-author or a post without a route', async () => {
      const update = jest.fn();
      const nonAuthor = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue({
            authorId: 'author',
            status: PostStatus.PUBLISHED,
            route: { id: 'r1' },
          }),
        },
        postRoute: { update },
      });
      await expect(
        nonAuthor.setRouteGpxShared('viewer', 'p1', false),
      ).rejects.toBeInstanceOf(NotFoundException);

      const noRoute = makeService({
        post: {
          findUnique: jest.fn().mockResolvedValue({
            authorId: 'viewer',
            status: PostStatus.PUBLISHED,
            route: null,
          }),
        },
        postRoute: { update },
      });
      await expect(
        noRoute.setRouteGpxShared('viewer', 'p1', false),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('submitPost with a route', () => {
    function submitService(post: Record<string, unknown>) {
      const prisma: Record<string, unknown> = {
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        post: {
          findUnique: jest.fn((args: { include?: Record<string, unknown> }) => {
            // The first read is submitPost's raw post; later reads are the
            // background moderation pass and the fresh shaped response.
            if (args.include && 'route' in args.include && !('author' in args.include)) {
              return Promise.resolve(post);
            }
            return Promise.resolve(
              feedPost({
                authorId: 'viewer',
                route: routeSummaryRow(),
                status: PostStatus.PENDING_MODERATION,
              }),
            );
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        comment: { findMany: jest.fn().mockResolvedValue([]) },
      };
      return makeService(prisma);
    }

    it('accepts a route-only post (no text, no media)', async () => {
      const service = submitService(
        feedPost({
          authorId: 'viewer',
          body: '',
          images: [],
          video: null,
          route: routeSummaryRow(),
        }),
      );

      const result = await service.submitPost('viewer', 'p1');
      expect(result.moderation.decision).toBe('PROCESSING');
    });

    it('accepts a post that carries a route alongside images and video', async () => {
      const service = submitService(
        feedPost({
          authorId: 'viewer',
          body: '',
          images: [{ id: 'img1', url: 'u', publicId: 'pub' }],
          video: { id: 'v1', url: 'v', publicId: 'vpub', thumbnailUrl: null, durationSeconds: 5 },
          route: routeSummaryRow(),
        }),
      );

      await expect(service.submitPost('viewer', 'p1')).resolves.toBeDefined();
    });

    it('still refuses a truly empty post and mentions the GPX route', async () => {
      const service = submitService(
        feedPost({ authorId: 'viewer', body: '', images: [], video: null, route: null }),
      );

      await expect(service.submitPost('viewer', 'p1')).rejects.toThrow(
        /GPX route/i,
      );
    });
  });

  describe('feed payload', () => {
    it('carries the route summary but never its segments', async () => {
      const findUnique = jest.fn().mockResolvedValue(
        feedPost({
          authorId: 'viewer',
          status: PostStatus.PUBLISHED,
          route: routeSummaryRow(),
        }),
      );
      const service = makeService({
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        post: { findUnique },
        comment: { findMany: jest.fn().mockResolvedValue([]) },
      });

      const { post } = await service.getPost('viewer', 'p1');

      const include = findUnique.mock.calls[0][0].include;
      expect(include.route.select.segments).toBeUndefined();
      expect(include.route.select.bounds).toBeUndefined();
      expect(post.route).toEqual(routeSummaryRow());
      expect('segments' in (post.route as object)).toBe(false);
      expect('bounds' in (post.route as object)).toBe(false);
    });

    it('returns route: null for a post without a route', async () => {
      const service = makeService({
        user: { findUnique: jest.fn().mockResolvedValue(viewer) },
        post: {
          findUnique: jest.fn().mockResolvedValue(
            feedPost({ status: PostStatus.PUBLISHED, route: null }),
          ),
        },
        comment: { findMany: jest.fn().mockResolvedValue([]) },
      });

      const { post } = await service.getPost('viewer', 'p1');
      expect(post.route).toBeNull();
    });
  });

  describe('cascade', () => {
    it('deletePost deletes the post only — the route goes with the FK cascade', async () => {
      const postDelete = jest.fn().mockResolvedValue({});
      const routeDelete = jest.fn();
      const routeDeleteMany = jest.fn();
      const service = makeService(
        {
          post: {
            findUnique: jest
              .fn()
              .mockResolvedValue(
                feedPost({ authorId: 'viewer', route: routeSummaryRow() }),
              ),
            delete: postDelete,
          },
          postRoute: { delete: routeDelete, deleteMany: routeDeleteMany },
        },
        {
          deleteImages: jest.fn().mockResolvedValue(undefined),
          deleteVideo: jest.fn().mockResolvedValue(undefined),
        },
      );

      await expect(service.deletePost('viewer', 'p1')).resolves.toEqual({
        deleted: true,
      });
      expect(postDelete).toHaveBeenCalledWith({ where: { id: 'p1' } });
      // ⚠️ Cloudinary is never involved in a route, and the DB cascade owns the
      // PostRoute row.
      expect(routeDelete).not.toHaveBeenCalled();
      expect(routeDeleteMany).not.toHaveBeenCalled();
    });
  });
});
