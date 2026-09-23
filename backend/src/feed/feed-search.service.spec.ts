import { PostStatus } from '@prisma/client';
import { FeedSearchDto } from './dto/feed-search.dto';
import { FeedService } from './feed.service';

describe('FeedService.searchFeed', () => {
  it('searches post text, tags, users, categories, groups and feed topics with viewer filters', async () => {
    const viewer = {
      id: 'viewer-id',
      email: 'member@example.test',
      isBanned: false,
      accountClosedAt: null,
      feedMutedPostTypes: ['FISHING'],
      feedMutedAuthorIds: ['muted-author'],
      feedMutedTags: ['muted-tag'],
      feedMutedTopicIds: ['muted-group'],
      feedShowAvatar: true,
      avatarUrl: null,
      username: 'member',
    };
    const calls: { where: Record<string, unknown> }[] = [];
    const findMany = jest.fn((args: { where: Record<string, unknown> }) => {
      calls.push(args);
      return Promise.resolve([]);
    });
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(viewer) },
      post: { findMany },
    };
    const settings = { get: jest.fn().mockResolvedValue(true) };
    const service = new FeedService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settings as never,
      {} as never,
      {} as never,
    );
    const query = { q: 'Hunting', type: 'HUNTING' } as FeedSearchDto;

    await service.searchFeed(viewer.id, query);

    const where = calls[0]?.where ?? {};
    expect(where.status).toBe(PostStatus.PUBLISHED);
    expect(where.type).toBe('HUNTING');
    expect(where.NOT).toEqual([
      { type: { in: ['FISHING'] } },
      { authorId: { in: ['muted-author'] } },
      { tags: { hasSome: ['muted-tag'] } },
      { groupId: { in: ['muted-group'] } },
    ]);
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { title: { contains: 'Hunting', mode: 'insensitive' } },
        { body: { contains: 'Hunting', mode: 'insensitive' } },
        { tags: { hasSome: ['hunting'] } },
        { author: { username: { contains: 'Hunting', mode: 'insensitive' } } },
        { category: { name: { contains: 'Hunting', mode: 'insensitive' } } },
        { group: { name: { contains: 'Hunting', mode: 'insensitive' } } },
        { location: { contains: 'Hunting', mode: 'insensitive' } },
        { listing: { title: { contains: 'Hunting', mode: 'insensitive' } } },
        { type: { in: ['HUNTING'] } },
      ]),
    );
  });
});
