import { PostStatus } from '@prisma/client';
import { FeedService } from './feed.service';

// The community post notification policy (operator, 2026-11-23):
//   - published successfully: SILENT
//   - held for review: notify
//   - rejected/removed: notify
// This spec pins the moderation and admin-review transitions, not the feed.

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    authorId: 'author',
    type: 'HIKING',
    title: 'Lekker 4x4',
    body: 'A quiet trail.',
    isOfficial: false,
    status: PostStatus.PENDING_MODERATION,
    images: [],
    video: null,
    graphicTier: 'NONE',
    moderationReason: null,
    moderatedAt: null as Date | null,
    publishedAt: null as Date | null,
    ...overrides,
  };
}

function build(decision: string, row = post()) {
  const notifications = {
    postHeldForReview: jest.fn().mockResolvedValue(undefined),
    postRejected: jest.fn().mockResolvedValue(undefined),
    postPublished: jest.fn().mockResolvedValue(undefined),
    postLiked: jest.fn(),
    commentReply: jest.fn(),
    newFollower: jest.fn(),
  };
  const awards = { award: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    post: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockImplementation(({ data }) => ({ ...row, ...data })),
    },
    userSocialStats: { upsert: jest.fn().mockResolvedValue(undefined) },
  };
  const moderation = {
    moderate: jest.fn().mockResolvedValue({
      decision,
      reasons: [],
      graphicTier: 'NONE',
    }),
  };
  const service = new FeedService(
    prisma as never,
    {} as never,
    {} as never,
    moderation as never,
    notifications as never,
    {} as never,
    awards as never,
    {} as never,
  );
  return { service, prisma, notifications, awards, moderation };
}

describe('community post notification policy', () => {
  it('stays silent when moderation publishes the post', async () => {
    const { service, notifications, awards } = build('PUBLISH');
    await service.runModeration('p1');
    expect(awards.award).toHaveBeenCalledTimes(1);
    expect(notifications.postPublished).not.toHaveBeenCalled();
    expect(notifications.postHeldForReview).not.toHaveBeenCalled();
    expect(notifications.postRejected).not.toHaveBeenCalled();
  });

  it('notifies when the post is held for human review', async () => {
    const { service, notifications } = build('PENDING_MODERATION');
    await service.runModeration('p1');
    expect(notifications.postHeldForReview).toHaveBeenCalledWith({
      recipientId: 'author',
      postId: 'p1',
    });
    expect(notifications.postRejected).not.toHaveBeenCalled();
  });

  it('notifies when moderation rejects the post', async () => {
    const { service, notifications } = build('REJECT');
    await service.runModeration('p1');
    expect(notifications.postRejected).toHaveBeenCalledWith({
      recipientId: 'author',
      postId: 'p1',
      reason: undefined,
    });
    expect(notifications.postHeldForReview).not.toHaveBeenCalled();
  });

  it('notifies when an admin removes a published post, but not on approve', async () => {
    const published = post({
      status: PostStatus.PUBLISHED,
      publishedAt: new Date('2026-11-01T00:00:00Z'),
    });
    const removed = build('PUBLISH', published);
    await removed.service.adminReview('p1', 'REJECT', 'Not a real trip');
    expect(removed.notifications.postRejected).toHaveBeenCalledWith({
      recipientId: 'author',
      postId: 'p1',
      reason: 'Not a real trip',
    });

    const approved = build('PUBLISH', post({ status: PostStatus.PENDING_MODERATION }));
    await approved.service.adminReview('p1', 'APPROVE');
    expect(approved.notifications.postHeldForReview).not.toHaveBeenCalled();
    expect(approved.notifications.postRejected).not.toHaveBeenCalled();
    expect(approved.notifications.postPublished).not.toHaveBeenCalled();
  });
});
