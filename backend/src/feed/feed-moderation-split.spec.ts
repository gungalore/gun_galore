import { GraphicTier } from '@prisma/client';
import { FeedModerationService } from './feed-moderation.service';

// The live feed path is the split: Jev reads the text and every photo, Gemini
// reads the clip. These tests pin that split — and, above all, that a video
// post no longer hands its still photos to Gemini.

jest.mock('../common/llm/jev-image', () => ({
  toJevImage: jest.fn(() => ({
    type: 'image',
    format: 'jpg',
    data_base64: 'stub',
  })),
}));

const okJson =
  '{"promoDetected":false,"illegalDetected":false,"otherViolation":false,"graphicTier":"NONE","reasons":[]}';

const ORIGINAL_KEY = process.env.JEV_API_KEY;
const ORIGINAL_ENGINE = process.env.FEED_MOD_ENGINE;

beforeEach(() => {
  process.env.JEV_API_KEY = 'test-jev';
  delete process.env.FEED_MOD_ENGINE;
});
afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.JEV_API_KEY;
  else process.env.JEV_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_ENGINE === undefined) delete process.env.FEED_MOD_ENGINE;
  else process.env.FEED_MOD_ENGINE = ORIGINAL_ENGINE;
});

function noul(noul: number) {
  return { type: 'noul', noul };
}

function imageReply(
  overrides: {
    promotional?: number;
    illegal?: number;
    other_violation?: number;
    graphic?: 'NONE' | 'FIELD' | 'EXTREME';
    confidence?: number;
  } = {},
) {
  return {
    model: 'jev-1.13.0',
    provider: 'typesafe',
    usage: { inputTokens: 1, outputTokens: 0 },
    answers: {
      promotional: noul(overrides.promotional ?? 0.05),
      illegal: noul(overrides.illegal ?? 0.05),
      other_violation: noul(overrides.other_violation ?? 0.05),
      graphic: {
        type: 'choice',
        choice: overrides.graphic ?? 'NONE',
        probabilities: {},
        confidence: overrides.confidence ?? 0.95,
      },
    },
  };
}

function mockMediaFetch(): void {
  global.fetch = jest.fn((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: {
        get: () =>
          String(url).includes('/video/') ? 'video/mp4' : 'image/jpeg',
      },
      arrayBuffer: () =>
        Promise.resolve(
          new ArrayBuffer(String(url).includes('/video/') ? 1024 : 16),
        ),
    }),
  ) as unknown as typeof fetch;
}

function build(
  opts: {
    textScores?: Record<string, number>;
    imageReplies?: ReturnType<typeof imageReply>[];
    imageError?: boolean;
    videoText?: string;
  } = {},
) {
  const imageReplies = [...(opts.imageReplies ?? [])];
  const decide = jest.fn((req: { purpose: string }) => {
    if (req.purpose === 'moderation.feed.text') {
      return {
        model: 'jev-1.13.0',
        answers: Object.fromEntries(
          Object.entries(opts.textScores ?? {}).map(([key, value]) => [
            key,
            noul(value),
          ]),
        ),
        usage: { inputTokens: 1, outputTokens: 0 },
      };
    }
    if (req.purpose === 'moderation.feed.images') {
      if (opts.imageError) throw new Error('jev down');
      return imageReplies.shift() ?? imageReply();
    }
    throw new Error(`unexpected purpose ${req.purpose}`);
  });
  const complete = jest.fn((req: { purpose: string; model?: string }) => {
    void req;
    return { text: opts.videoText ?? okJson };
  });
  const svc = new FeedModerationService({
    isConfiguredFor: () => true,
    decide,
    complete,
  } as never);
  return { svc, decide, complete };
}

const post = {
  text: 'Morning from the ridge.',
  imageUrls: ['https://res.cloudinary.com/x/image/upload/v1/a.jpg'],
  authorIsOfficial: false,
};

describe('feed split — Jev text + Jev photos', () => {
  beforeEach(() => {
    mockMediaFetch();
  });

  it('publishes a clean photo post without a Gemini call', async () => {
    const { svc, decide, complete } = build();
    const v = await svc.moderate(post);

    expect(v.decision).toBe('PUBLISH');
    expect(declaresImagePurpose(decide)).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects a member’s promotional photo', async () => {
    const { svc } = build({
      imageReplies: [imageReply({ promotional: 0.93 })],
    });
    const v = await svc.moderate(post);
    expect(v.decision).toBe('REJECT');
    expect(v.promoDetected).toBe(true);
  });

  it('lets an official account through the promotional photo check', async () => {
    const { svc } = build({
      imageReplies: [imageReply({ promotional: 0.93 })],
    });
    const v = await svc.moderate({ ...post, authorIsOfficial: true });
    expect(v.decision).toBe('PUBLISH');
  });

  it('rejects an illegal photo', async () => {
    const { svc } = build({ imageReplies: [imageReply({ illegal: 0.94 })] });
    const v = await svc.moderate(post);
    expect(v.decision).toBe('REJECT');
    expect(v.illegalDetected).toBe(true);
  });

  it('rejects a photo with contact details / another breach', async () => {
    const { svc } = build({
      imageReplies: [imageReply({ other_violation: 0.92 })],
    });
    const v = await svc.moderate(post);
    expect(v.decision).toBe('REJECT');
    expect(v.otherViolation).toBe(true);
  });

  it('holds extreme graphic photos and publishes field photos with the tier', async () => {
    const extreme = build({
      imageReplies: [imageReply({ graphic: 'EXTREME' })],
    });
    const v1 = await extreme.svc.moderate(post);
    expect(v1.decision).toBe('PENDING_MODERATION');
    expect(v1.graphicTier).toBe(GraphicTier.EXTREME);

    const field = build({ imageReplies: [imageReply({ graphic: 'FIELD' })] });
    const v2 = await field.svc.moderate(post);
    expect(v2.decision).toBe('PUBLISH');
    expect(v2.graphicTier).toBe(GraphicTier.FIELD);
  });

  it('holds the 60–80 % band instead of publishing', async () => {
    const { svc } = build({ imageReplies: [imageReply({ promotional: 0.7 })] });
    const v = await svc.moderate(post);
    expect(v.decision).toBe('PENDING_MODERATION');
  });

  it('holds when a photo call fails', async () => {
    const { svc } = build({ imageError: true });
    const v = await svc.moderate(post);
    expect(v.decision).toBe('PENDING_MODERATION');
    expect(v.reasons).toContain('images_unreadable');
  });

  it('holds when an image answer is missing', async () => {
    const { svc } = build({
      imageReplies: [
        {
          model: 'jev-1.13.0',
          provider: 'typesafe',
          usage: { inputTokens: 1, outputTokens: 0 },
          answers: {},
        } as unknown as ReturnType<typeof imageReply>,
      ],
    });
    const v = await svc.moderate(post);
    expect(v.decision).toBe('PENDING_MODERATION');
  });

  it('takes the worst result across several photos', async () => {
    const { svc, decide } = build({
      imageReplies: [imageReply(), imageReply({ illegal: 0.95 })],
    });
    const v = await svc.moderate({
      ...post,
      imageUrls: [
        'https://res.cloudinary.com/x/image/upload/v1/a.jpg',
        'https://res.cloudinary.com/x/image/upload/v1/b.jpg',
      ],
    });
    expect(imageCalls(decide)).toBe(2);
    expect(v.decision).toBe('REJECT');
  });

  it('fails closed when Jev is not configured', async () => {
    delete process.env.JEV_API_KEY;
    const { svc, decide } = build();
    const v = await svc.moderate(post);
    expect(v.decision).toBe('PENDING_MODERATION');
    expect(decide).not.toHaveBeenCalled();
  });

  it('holds a media post whose image cannot be fetched', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => '' },
      });
    const { svc } = build();
    const v = await svc.moderate(post);
    expect(v.decision).toBe('PENDING_MODERATION');
    expect(v.reasons).toContain('images_unreadable');
  });
});

describe('feed split — video posts', () => {
  beforeEach(() => {
    mockMediaFetch();
  });

  it('sends text and photos to Jev and the clip to Gemini', async () => {
    const { svc, decide, complete } = build();
    const v = await svc.moderate({
      ...post,
      video: {
        url: 'https://res.cloudinary.com/x/video/upload/v1/clip.mp4',
        thumbnailUrl: null,
      },
    });

    expect(v.decision).toBe('PUBLISH');
    expect(declaresImagePurpose(decide)).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toMatchObject({
      purpose: 'feed.moderation.video',
      model: 'gemini-3.1-flash-lite',
    });
  });

  it('rejects a video post whose photo is promotional', async () => {
    const { svc } = build({
      imageReplies: [imageReply({ promotional: 0.93 })],
    });
    const v = await svc.moderate({
      ...post,
      video: {
        url: 'https://res.cloudinary.com/x/video/upload/v1/clip.mp4',
        thumbnailUrl: null,
      },
    });
    expect(v.decision).toBe('REJECT');
  });

  it('holds when the clip cannot be read and has no poster', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes('/video/')
            ? {
                ok: false,
                status: 500,
                headers: { get: (): string => 'video/mp4' },
              }
            : {
                ok: true,
                status: 200,
                headers: { get: (): string => 'image/jpeg' },
                arrayBuffer: () => new ArrayBuffer(16),
              },
        ),
      );
    const { svc } = build();
    const v = await svc.moderate({
      ...post,
      imageUrls: [],
      video: {
        url: 'https://res.cloudinary.com/x/video/upload/v1/clip.mp4',
        thumbnailUrl: null,
      },
    });
    expect(v.decision).toBe('PENDING_MODERATION');
    expect(v.reasons).toContain('images_unreadable');
  });

  it('holds a video post with photos when the clip has no poster either', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes('/video/')
            ? {
                ok: false,
                status: 500,
                headers: { get: (): string => 'video/mp4' },
              }
            : {
                ok: true,
                status: 200,
                headers: { get: (): string => 'image/jpeg' },
                arrayBuffer: () => new ArrayBuffer(16),
              },
        ),
      );
    const { svc } = build();
    const v = await svc.moderate({
      ...post,
      video: {
        url: 'https://res.cloudinary.com/x/video/upload/v1/clip.mp4',
        thumbnailUrl: null,
      },
    });
    expect(v.decision).toBe('PENDING_MODERATION');
    expect(v.reasons).toContain('images_unreadable');
  });

  it('clears a clip-only post on Gemini even without a Jev key', async () => {
    delete process.env.JEV_API_KEY;
    const { svc, decide, complete } = build();
    const v = await svc.moderate({
      text: '',
      imageUrls: [],
      authorIsOfficial: false,
      video: {
        url: 'https://res.cloudinary.com/x/video/upload/v1/clip.mp4',
        thumbnailUrl: null,
      },
    });

    expect(v.decision).toBe('PUBLISH');
    expect(decide).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toMatchObject({
      purpose: 'feed.moderation.video',
    });
  });
});

function imageCalls(decide: jest.Mock): number {
  const calls = decide.mock.calls as Array<[{ purpose?: string }]>;
  return calls.filter((call) => call[0]?.purpose === 'moderation.feed.images')
    .length;
}

function declaresImagePurpose(decide: jest.Mock): boolean {
  return imageCalls(decide) > 0;
}
