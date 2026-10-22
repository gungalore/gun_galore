import { PostStatus, ReactionKind } from '@prisma/client';
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

interface MockOptions {
  existing?: { id: string; kind: ReactionKind } | null;
  postAuthorId?: string;
  comment?: { id: string; status: PostStatus } | null;
}

function makeService(opts: MockOptions = {}) {
  const {
    existing = null,
    postAuthorId = 'author-id',
    comment = { id: 'c1', status: PostStatus.PUBLISHED },
  } = opts;
  const calls = {
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    commentCreate: jest.fn().mockResolvedValue({}),
    commentUpdate: jest.fn().mockResolvedValue({}),
    commentDelete: jest.fn().mockResolvedValue({}),
    postLiked: jest.fn().mockResolvedValue(undefined),
    award: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(viewer) },
    post: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p1',
        status: PostStatus.PUBLISHED,
        authorId: postAuthorId,
        title: 'A post',
      }),
      update: calls.update,
    },
    postLike: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: calls.create,
      update: calls.update,
      delete: calls.delete,
    },
    comment: {
      findUnique: jest.fn().mockResolvedValue(comment),
      update: calls.commentUpdate,
    },
    commentLike: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: calls.commentCreate,
      update: calls.commentUpdate,
      delete: calls.commentDelete,
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const service = new FeedService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    { postLiked: calls.postLiked } as never,
    {} as never,
    { award: calls.award } as never,
    {} as never,
  );
  return { service, prisma, calls };
}

describe('FeedService post reactions', () => {
  it('creates a LIKE, increments likeCount and notifies the author', async () => {
    const { service, calls } = makeService();

    const res = await service.likePost('viewer-id', 'p1');

    expect(res).toEqual({ liked: true, disliked: false });
    expect(calls.create).toHaveBeenCalledWith({
      data: { postId: 'p1', userId: 'viewer-id', kind: ReactionKind.LIKE },
    });
    expect(calls.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { likeCount: { increment: 1 } },
    });
    expect(calls.postLiked).toHaveBeenCalled();
    expect(calls.award).toHaveBeenCalled();
  });

  it('flipping a dislike to a like moves both counters and does not re-notify', async () => {
    const { service, calls } = makeService({
      existing: { id: 'l1', kind: ReactionKind.DISLIKE },
    });

    const res = await service.likePost('viewer-id', 'p1');

    expect(res).toEqual({ liked: true, disliked: false });
    expect(calls.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { kind: ReactionKind.LIKE },
    });
    expect(calls.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        likeCount: { increment: 1 },
        dislikeCount: { decrement: 1 },
      },
    });
    expect(calls.create).not.toHaveBeenCalled();
    expect(calls.postLiked).not.toHaveBeenCalled();
  });

  it('creates a DISLIKE without notifying or awarding', async () => {
    const { service, calls } = makeService();

    const res = await service.dislikePost('viewer-id', 'p1');

    expect(res).toEqual({ liked: false, disliked: true });
    expect(calls.create).toHaveBeenCalledWith({
      data: { postId: 'p1', userId: 'viewer-id', kind: ReactionKind.DISLIKE },
    });
    expect(calls.postLiked).not.toHaveBeenCalled();
    expect(calls.award).not.toHaveBeenCalled();
  });

  it('removing a like only deletes a LIKE row', async () => {
    const { service, calls } = makeService({
      existing: { id: 'l1', kind: ReactionKind.DISLIKE },
    });

    const res = await service.unlikePost('viewer-id', 'p1');

    expect(res).toEqual({ liked: false, disliked: true });
    expect(calls.delete).not.toHaveBeenCalled();
  });

  it('removing a dislike deletes the row and decrements dislikeCount', async () => {
    const { service, calls } = makeService({
      existing: { id: 'l1', kind: ReactionKind.DISLIKE },
    });

    const res = await service.undislikePost('viewer-id', 'p1');

    expect(res).toEqual({ liked: false, disliked: false });
    expect(calls.delete).toHaveBeenCalledWith({ where: { id: 'l1' } });
    expect(calls.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { dislikeCount: { decrement: 1 } },
    });
  });
});

describe('FeedService comment reactions', () => {
  it('creates a LIKE on a comment', async () => {
    const { service, calls } = makeService();

    const res = await service.likeComment('viewer-id', 'c1');

    expect(res).toEqual({ liked: true, disliked: false });
    expect(calls.commentCreate).toHaveBeenCalledWith({
      data: { commentId: 'c1', userId: 'viewer-id', kind: ReactionKind.LIKE },
    });
    expect(calls.commentUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { likeCount: { increment: 1 } },
    });
  });

  it('flipping a comment like to a dislike moves both counters', async () => {
    const { service, calls } = makeService({
      existing: { id: 'cl1', kind: ReactionKind.LIKE },
    });

    const res = await service.dislikeComment('viewer-id', 'c1');

    expect(res).toEqual({ liked: false, disliked: true });
    expect(calls.commentUpdate).toHaveBeenCalledWith({
      where: { id: 'cl1' },
      data: { kind: ReactionKind.DISLIKE },
    });
    expect(calls.commentUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        likeCount: { decrement: 1 },
        dislikeCount: { increment: 1 },
      },
    });
  });

  it('404s for a comment that is not published', async () => {
    const { service } = makeService({
      comment: { id: 'c1', status: PostStatus.PENDING_MODERATION },
    });

    await expect(
      service.likeComment('viewer-id', 'c1'),
    ).rejects.toThrow();
  });
});
