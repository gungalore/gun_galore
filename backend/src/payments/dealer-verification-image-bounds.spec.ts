// DealerVerificationService transitively imports ShippingService → the
// meilisearch client (ESM-only). Stub it so Jest can load the graph — same
// pattern the other payments specs use.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { DealerVerificationService } from './dealer-verification.service';
import type { LlmResponse } from '../common/llm/llm.types';

// Three photographs of paperwork reach the model as bytes we fetch: the SAPS
// 534, the stock-register line and the stamped serial. They keep the 1600
// DOCUMENT edge — the whole evidence is small print — but not the 12-megapixel
// original, which the model tiles down to nothing extra anyway.

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

function makeService() {
  const complete = jest.fn().mockResolvedValue(llmResponse('{}'));
  const svc = Object.create(
    DealerVerificationService.prototype,
  ) as DealerVerificationService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    llm: { complete, isConfigured: () => true },
    logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
  });
  return svc as unknown as {
    runVisionScan(args: Record<string, unknown>): Promise<unknown>;
  };
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

function args(base: string) {
  return {
    saps534Url: `${base}/534.jpg`,
    stockRegisterUrl: `${base}/register.jpg`,
    firearmSerialUrl: `${base}/serial.jpg`,
    expectedSerial: 'ABC123',
    expectedDealerLicence: 'DL-1',
    expectedDealerName: 'A Dealer',
    listingMake: 'Bergara',
    listingModel: 'B14',
    orderReference: 'ORD-1',
  };
}

describe('dealer-verification photos are fetched bounded, not original', () => {
  it('fetches all three at the 1600 document edge', async () => {
    const fetchMock = mockFetch();
    await makeService().runVisionScan(
      args('https://res.cloudinary.com/gg/image/upload/v1/dealer'),
    );
    const bound = 'w_1600,h_1600,c_limit,q_auto:good,f_jpg';
    const urls = fetchMock.mock.calls.map((c) => c[0] as string).sort();
    expect(urls).toEqual([
      `https://res.cloudinary.com/gg/image/upload/${bound}/v1/dealer/534.jpg`,
      `https://res.cloudinary.com/gg/image/upload/${bound}/v1/dealer/register.jpg`,
      `https://res.cloudinary.com/gg/image/upload/${bound}/v1/dealer/serial.jpg`,
    ]);
  });

  it('leaves a non-Cloudinary URL exactly as it is', async () => {
    const fetchMock = mockFetch();
    await makeService().runVisionScan(args('https://example.com/dealer'));
    expect(fetchMock.mock.calls.map((c) => c[0] as string).sort()).toEqual([
      'https://example.com/dealer/534.jpg',
      'https://example.com/dealer/register.jpg',
      'https://example.com/dealer/serial.jpg',
    ]);
  });
});
