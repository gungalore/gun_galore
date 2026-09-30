import { GraphicTier } from '@prisma/client';
import { FeedModerationService } from './feed-moderation.service';
import { LlmError } from '../common/llm/llm.types';

function fakeLlm(opts: {
  configured?: boolean;
  text?: string;
  throwCode?: string;
}) {
  return {
    isConfiguredFor: () => opts.configured ?? true,
    complete: async () => {
      if (opts.throwCode) {
        throw new LlmError(opts.throwCode as never, 'boom');
      }
      return { text: opts.text ?? '' };
    },
  } as never;
}

function build(opts: Parameters<typeof fakeLlm>[0]) {
  return new FeedModerationService(fakeLlm(opts));
}

const input = { text: 'hello', imageUrls: [], authorIsOfficial: false };

describe('FeedModerationService', () => {
  // This suite pins the SINGLE-CALL moderator's parse/decide behaviour. The
  // live path is now the Jev-text / DeepSeek-images split; FEED_MOD_ENGINE
  // keeps the legacy lever under test.
  beforeAll(() => {
    process.env.FEED_MOD_ENGINE = 'legacy';
  });
  afterAll(() => {
    delete process.env.FEED_MOD_ENGINE;
  });

  it('fails closed when the provider is not configured', async () => {
    const v = await build({ configured: false }).moderate(input);
    expect(v.decision).toBe('PENDING_MODERATION');
    expect(v.reasons).toContain('moderation_unavailable');
  });

  it('fails closed when the model errors', async () => {
    const v = await build({ throwCode: 'timeout' }).moderate(input);
    expect(v.decision).toBe('PENDING_MODERATION');
  });

  it('fails closed on malformed JSON', async () => {
    const v = await build({ text: 'not json at all' }).moderate(input);
    expect(v.decision).toBe('PENDING_MODERATION');
    expect(v.reasons).toContain('moderation_shape_invalid');
  });

  it('rejects promotional content from a member', async () => {
    const v = await build({
      text: '{"promoDetected":true,"illegalDetected":false,"otherViolation":false,"graphicTier":"NONE","reasons":[]}',
    }).moderate(input);
    expect(v.decision).toBe('REJECT');
    expect(v.promoDetected).toBe(true);
  });

  it('lets official accounts through the promotional check', async () => {
    const v = await build({
      text: '{"promoDetected":true,"illegalDetected":false,"otherViolation":false,"graphicTier":"NONE","reasons":[]}',
    }).moderate({ ...input, authorIsOfficial: true });
    expect(v.decision).toBe('PUBLISH');
  });

  it('still rejects illegal content from an official account', async () => {
    const v = await build({
      text: '{"promoDetected":false,"illegalDetected":true,"otherViolation":false,"graphicTier":"NONE","reasons":[]}',
    }).moderate({ ...input, authorIsOfficial: true });
    expect(v.decision).toBe('REJECT');
  });

  it('holds extreme graphic content for review', async () => {
    const v = await build({
      text: '{"promoDetected":false,"illegalDetected":false,"otherViolation":false,"graphicTier":"EXTREME","reasons":[]}',
    }).moderate(input);
    expect(v.decision).toBe('PENDING_MODERATION');
    expect(v.graphicTier).toBe(GraphicTier.EXTREME);
  });

  it('publishes field-normal content', async () => {
    const v = await build({
      text: '{"promoDetected":false,"illegalDetected":false,"otherViolation":false,"graphicTier":"FIELD","reasons":["normal"]}',
    }).moderate(input);
    expect(v.decision).toBe('PUBLISH');
    expect(v.graphicTier).toBe(GraphicTier.FIELD);
  });
});

describe('FeedModerationService — video', () => {
  const okJson =
    '{"promoDetected":false,"illegalDetected":false,"otherViolation":false,"graphicTier":"NONE","reasons":[]}';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes a post with a video to the video purpose and the Gemini video model', async () => {
    const calls: Array<{ purpose: string; model?: string }> = [];
    const llm = {
      isConfiguredFor: () => true,
      complete: async (req: { purpose: string; model?: string }) => {
        calls.push(req);
        return { text: okJson };
      },
    };
    (global as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'video/mp4' },
      arrayBuffer: async () => new ArrayBuffer(1024),
    });

    const svc = new FeedModerationService(llm as never);
    const v = await svc.moderate({
      text: 'a clip',
      imageUrls: [],
      video: { url: 'https://res.cloudinary.com/x/video/upload/v1/a.mp4', thumbnailUrl: null },
      authorIsOfficial: false,
    });

    expect(v.decision).toBe('PUBLISH');
    expect(calls[0].purpose).toBe('feed.moderation.video');
    expect(calls[0].model).toBe('gemini-3.1-flash-lite');
  });

  it('holds a video post when the clip cannot be read and there is no poster', async () => {
    const llm = {
      isConfiguredFor: () => true,
      complete: async () => ({ text: okJson }),
    };
    (global as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'video/mp4' },
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const svc = new FeedModerationService(llm as never);
    const v = await svc.moderate({
      text: 'a clip',
      imageUrls: [],
      video: { url: 'https://res.cloudinary.com/x/video/upload/v1/a.mp4', thumbnailUrl: null },
      authorIsOfficial: false,
    });

    expect(v.decision).toBe('PENDING_MODERATION');
    expect(v.reasons).toContain('images_unreadable');
  });
});
