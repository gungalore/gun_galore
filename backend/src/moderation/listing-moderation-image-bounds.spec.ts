import { ListingModerationService } from './listing-moderation.service';
import type { LlmResponse } from '../common/llm/llm.types';

// A listing photo is fetched by US now (LlmPart carries bytes, not a URL), so
// the size we fetch is the size we pay tokens for. A 12-megapixel phone
// original bought nothing: the model reads an image in 768px tiles and
// downsamples anyway. These pin the ONE thing a reader cannot see from the
// call site — which URL actually went over the wire.

function llmResponse(text: string): LlmResponse {
  return {
    text,
    parts: [{ type: 'text', text }],
    toolCalls: [],
    stopReason: 'end',
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    assistantMessage: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

const REPLY = [
  'A Bergara B14 HMR in .308 Win, sold with its original hard case.',
  '',
  '• Fired roughly 200 rounds',
].join('\n');

function makeService() {
  const complete = jest.fn().mockResolvedValue(llmResponse(REPLY));
  const svc = Object.create(
    ListingModerationService.prototype,
  ) as ListingModerationService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    llm: { complete, isConfigured: () => true, model: 'gemini-2.5-flash-lite' },
    logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
  });
  return svc;
}

function mockFetch(): jest.Mock {
  const fn = jest.fn(async (url: string) => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => new TextEncoder().encode(url).buffer,
  }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('moderation photos are fetched bounded, not original', () => {
  it('fetches a Cloudinary photo at the 1280 product-photo edge', async () => {
    const fetchMock = mockFetch();
    await makeService().enhanceDescription('rough draft', {
      imageUrls: [
        'https://res.cloudinary.com/gg/image/upload/v1712345678/listings/a.jpg',
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://res.cloudinary.com/gg/image/upload/w_1280,h_1280,c_limit,q_auto:good,f_jpg/v1712345678/listings/a.jpg',
    );
  });

  it('leaves a non-Cloudinary photo URL exactly as it is', async () => {
    const fetchMock = mockFetch();
    await makeService().enhanceDescription('rough draft', {
      imageUrls: ['https://example.com/photos/a.jpg'],
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/photos/a.jpg');
  });
});
