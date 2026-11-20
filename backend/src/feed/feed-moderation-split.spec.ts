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

jest.mock('../moderation/photo-mask', () => ({
  maskPhotoRegions: jest.fn(async () => Buffer.from('masked-image')),
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
    sexual_explicit?: number;
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
      sexual_explicit: noul(overrides.sexual_explicit ?? 0.05),
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

  it('⚠️ REJECTS FULL NUDITY IN A PHOTO', async () => {
    const { svc } = build({
      imageReplies: [imageReply({ sexual_explicit: 0.94 })],
    });
    const v = await svc.moderate(post);
    expect(v.decision).toBe('REJECT');
    expect(v.otherViolation).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/full nudity|explicit sexual/i);
  });

  it('⚠️ REJECTS EXPLICIT SEXUAL TEXT', async () => {
    const { svc } = build({ textScores: { sexual_explicit: 0.95 } });
    const v = await svc.moderate({ ...post, imageUrls: [] });
    expect(v.decision).toBe('REJECT');
    expect(v.otherViolation).toBe(true);
  });

  it('⚠️ DOES NOT BLOCK ON BAD LANGUAGE — IT IS MASKED', async () => {
    const { svc } = build({ textScores: { bad_language: 0.99 } });
    const v = await svc.moderate({ ...post, imageUrls: [] });
    expect(v.decision).toBe('PUBLISH');
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

describe('feed photo auto-mask', () => {
  function buildMask(opts: { contact: number; recheck: number }) {
    const decide = jest.fn((req: { purpose: string }) => {
      if (req.purpose === 'moderation.feed.contact') {
        return { answers: { contact: noul(opts.contact) } };
      }
      if (req.purpose === 'moderation.feed.contact.boxes') {
        return {
          answers: {
            mask_contact_1: {
              type: 'box',
              box: { top: 0.1, bottom: 0.2, left: 0.1, right: 0.3 },
              confidence: 0.9,
            },
          },
        };
      }
      if (req.purpose === 'moderation.feed.contact.recheck') {
        return { answers: { contact: noul(opts.recheck) } };
      }
      throw new Error(`unexpected purpose ${req.purpose}`);
    });
    const svc = new FeedModerationService({
      isConfiguredFor: () => true,
      decide,
      complete: jest.fn(),
    } as never);
    return { svc, decide };
  }

  const part = {
    type: 'image' as const,
    mimeType: 'image/jpeg' as const,
    data: Buffer.from('original').toString('base64'),
  };

  it('returns masked bytes when contact is readable and the recheck clears', async () => {
    const { svc, decide } = buildMask({ contact: 0.95, recheck: 0.05 });
    const out = await svc.maskContactDetails(part);
    expect(out?.toString()).toBe('masked-image');
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'moderation.feed.contact.boxes' }),
    );
  });

  it('leaves a clean photo untouched without paying for box detection', async () => {
    const { svc, decide } = buildMask({ contact: 0.1, recheck: 0.1 });
    await expect(svc.maskContactDetails(part)).resolves.toBeNull();
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('refuses the mask when the recheck can still read contact details', async () => {
    const { svc } = buildMask({ contact: 0.95, recheck: 0.9 });
    await expect(svc.maskContactDetails(part)).resolves.toBeNull();
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
