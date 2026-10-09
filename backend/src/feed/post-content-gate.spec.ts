import { BadRequestException } from '@nestjs/common';
import { FeedService } from './feed.service';

// A post may now be text-less (photo or video alone, operator decision
// 2026-10-09). `createPost` accepts an empty body; `submitPost` is the first
// point where the whole post is known and enforces "at least one of three".

function basePost(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    authorId: 'u1',
    type: 'HUNTING',
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
    listingId: null,
    categoryId: null,
    location: null,
    locationPlaceId: null,
    status: 'PENDING_MODERATION',
    graphicTier: 'NONE',
    isOfficial: false,
    moderationReason: null,
    likeCount: 0,
    commentCount: 0,
    disputedAt: null,
    publishedAt: null,
    moderatedAt: null,
    createdAt: new Date('2026-10-09T00:00:00Z'),
    editedAt: null,
    images: [],
    video: null,
    author: {
      username: 'u1',
      avatarUrl: null,
      sellerTier: 'BRONZE',
      isVerifiedExpert: false,
      feedShowAvatar: true,
    },
    listing: null,
    likes: [],
    ...over,
  };
}

function makeService(post: Record<string, unknown>) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'u@example.com',
        isBanned: false,
        accountClosedAt: null,
        feedMutedPostTypes: [],
        feedMutedAuthorIds: [],
        feedMutedTags: [],
        feedShowAvatar: true,
        avatarUrl: null,
        username: 'u1',
      }),
    },
    post: {
      findUnique: jest.fn().mockResolvedValue(post),
      update: jest.fn().mockResolvedValue(post),
    },
  };
  const svc = new FeedService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // Background moderation is fire-and-forget; keep it out of this unit test.
  jest.spyOn(svc, 'runModeration').mockResolvedValue(undefined);
  return { svc, prisma };
}

describe('FeedService.submitPost content gate', () => {
  it('refuses a post with no text, no images and no video', async () => {
    const { svc } = makeService(basePost());
    await expect(svc.submitPost('u1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a media-only post (an image present)', async () => {
    const { svc } = makeService(
      basePost({ images: [{ id: 'i1', url: 'u', order: 0 }] }),
    );
    await expect(svc.submitPost('u1', 'p1')).resolves.toBeDefined();
  });

  it('allows a video-only post', async () => {
    const { svc } = makeService(
      basePost({ video: { id: 'v1', url: 'u', thumbnailUrl: null, durationSeconds: 1 } }),
    );
    await expect(svc.submitPost('u1', 'p1')).resolves.toBeDefined();
  });

  it('allows a text-only post', async () => {
    const { svc } = makeService(basePost({ body: 'Kudu hunt' }));
    await expect(svc.submitPost('u1', 'p1')).resolves.toBeDefined();
  });
});
