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
  feedShowGraphic: false,
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

interface UpdateArgs {
  data: Record<string, unknown>;
  select: Record<string, unknown>;
}

function prismaWithUpdate(
  calls: UpdateArgs[],
  result: Record<string, unknown>,
) {
  const update = jest.fn((args: UpdateArgs) => {
    calls.push(args);
    return Promise.resolve(result);
  });
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(viewer),
      update,
    },
  };
}

describe('FeedService preferences — the graphic-content toggle', () => {
  it('returns feedShowGraphic from getPreferences', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(viewer) },
    };
    const service = makeService(prisma);

    const res = await service.getPreferences('viewer-id');

    expect(res).toEqual({
      feedMutedPostTypes: [],
      feedMutedAuthorIds: [],
      feedMutedTags: [],
      feedShowAvatar: true,
      feedShowGraphic: false,
    });
  });

  it('persists feedShowGraphic in setPreferences', async () => {
    const calls: UpdateArgs[] = [];
    const prisma = prismaWithUpdate(calls, {
      feedMutedPostTypes: [],
      feedMutedAuthorIds: [],
      feedMutedTags: [],
      feedShowAvatar: true,
      feedShowGraphic: true,
    });
    const service = makeService(prisma);

    const res = await service.setPreferences('viewer-id', {
      feedShowGraphic: true,
    });

    expect(calls[0]?.data.feedShowGraphic).toBe(true);
    expect(calls[0]?.select.feedShowGraphic).toBe(true);
    expect(res).toEqual({
      feedMutedPostTypes: [],
      feedMutedAuthorIds: [],
      feedMutedTags: [],
      feedShowAvatar: true,
      feedShowGraphic: true,
    });
  });

  it('leaves feedShowGraphic untouched when the DTO omits it', async () => {
    const calls: UpdateArgs[] = [];
    const prisma = prismaWithUpdate(calls, {
      feedMutedPostTypes: [],
      feedMutedAuthorIds: [],
      feedMutedTags: [],
      feedShowAvatar: true,
      feedShowGraphic: false,
    });
    const service = makeService(prisma);

    await service.setPreferences('viewer-id', {});

    expect(calls[0]?.data.feedShowGraphic).toBeUndefined();
  });
});
