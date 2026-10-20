import { ListingModerationService } from './listing-moderation.service';
import type { LlmResponse } from '../common/llm/llm.types';

// The seller chooses whether a listing clip is published with sound. A
// sound-on clip must be judged with its audio track; a muted clip is
// visual-only. Unsure audio is held for a human, never cleared from the
// poster frame.

function llmResponse(text: string): LlmResponse {
  return {
    text,
    parts: [{ type: 'text', text }],
    toolCalls: [],
    stopReason: 'end',
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    assistantMessage: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function mockVideoFetch() {
  const fn = jest.fn((url: string) =>
    Promise.resolve({
      ok: true,
      headers: { get: () => 'video/mp4' },
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(url).buffer),
    }),
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockBrokenFetch() {
  const fn = jest.fn(() =>
    Promise.resolve({
      ok: false,
      status: 500,
      headers: { get: () => 'text/html' },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }),
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function makeService(reply: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue(llmResponse(JSON.stringify(reply)));
  const svc = Object.create(
    ListingModerationService.prototype,
  ) as ListingModerationService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    llm: { complete, isConfigured: () => true },
    logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
  });
  return { svc, complete };
}

const VIDEO =
  'https://res.cloudinary.com/demo/video/upload/v1712345678/listings/clip.mp4';

const CLEAN = {
  violation: false,
  unsure: false,
  categories: [],
  reasons: [],
};

describe('marketplace video audio moderation', () => {
  it('fetches a sound-on clip with its audio and asks the model to listen', async () => {
    const fetchMock = mockVideoFetch();
    const { svc, complete } = makeService(CLEAN);

    const r = await svc.moderateVideo({
      url: VIDEO,
      thumbnailUrl:
        'https://res.cloudinary.com/demo/video/upload/so_0/v1/x.jpg',
      audioEnabled: true,
    });

    expect(r.decision).toBe('APPROVE');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.not.stringContaining('ac_none'),
      expect.anything(),
    );
    const audioPrompt: unknown = expect.stringMatching(/hear its audio/i);
    const spokenPrompt: unknown = expect.stringMatching(/SPOKEN/i);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ system: audioPrompt }),
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ system: spokenPrompt }),
    );
  });

  it('strips audio for a muted clip and keeps the prompt visual-only', async () => {
    const fetchMock = mockVideoFetch();
    const { svc, complete } = makeService(CLEAN);

    const r = await svc.moderateVideo({ url: VIDEO, audioEnabled: false });

    expect(r.decision).toBe('APPROVE');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('ac_none'),
      expect.anything(),
    );
    const visualPrompt: unknown = expect.stringMatching(
      /audio is not provided/i,
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ system: visualPrompt }),
    );
  });

  it('hard-rejects banned content in a sound-on clip', async () => {
    mockVideoFetch();
    const { svc } = makeService({
      violation: true,
      unsure: false,
      categories: ['contact-info'],
      reasons: ['Spoken phone number at 0:07'],
    });

    const r = await svc.moderateVideo({ url: VIDEO, audioEnabled: true });
    expect(r.decision).toBe('REJECT');
  });

  it('holds an unsure sound-on verdict for admin review', async () => {
    mockVideoFetch();
    const { svc } = makeService({
      violation: true,
      unsure: true,
      categories: ['contact-info'],
      reasons: ['Could not make out the spoken number.'],
    });

    const r = await svc.moderateVideo({ url: VIDEO, audioEnabled: true });
    expect(r.decision).toBe('HUMAN_REVIEW');
  });

  it('never clears a sound-on clip from its poster frame', async () => {
    mockBrokenFetch();
    const { svc, complete } = makeService(CLEAN);

    const r = await svc.moderateVideo({
      url: VIDEO,
      thumbnailUrl:
        'https://res.cloudinary.com/demo/video/upload/so_0/v1/x.jpg',
      audioEnabled: true,
    });

    expect(r.decision).toBe('HUMAN_REVIEW');
    expect(complete).not.toHaveBeenCalled();
  });
});
