import { KycModelService } from './kyc-model.service';
import type { LlmService } from '../common/llm/llm.service';
import type { LlmResponse } from '../common/llm/llm.types';

// The identity document and the driving licence are fetched HERE and inlined,
// so their delivery size is a token bill. They keep the 1600 DOCUMENT edge,
// not the 1280 a product photo gets: the ID number, the date of birth and the
// licence expiry are small print, and this is the one image where detail
// decides the outcome.
//
// ⚠️ ONE TRANSFORMATION, NOT TWO. `jpegUrl` used to prepend a bare `f_jpg/`;
// the bound carries `f_jpg` itself, so the path must show a single segment.

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
  const llm = { complete, isConfigured: () => true };
  return new KycModelService(llm as unknown as LlmService);
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

describe('KYC images are fetched bounded, not original', () => {
  it('fetches the ID document and the licence card at the 1600 document edge', async () => {
    const fetchMock = mockFetch();
    await makeService().scan({
      selfieBase64: 'AAAA',
      documentUrl: 'https://res.cloudinary.com/gg/image/upload/v1/kyc/id.png',
      licenceUrl: 'https://res.cloudinary.com/gg/image/upload/v1/kyc/dl.jpg',
      mode: 'standard',
    });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://res.cloudinary.com/gg/image/upload/w_1600,h_1600,c_limit,q_auto:good,f_jpg/v1/kyc/id.png',
      'https://res.cloudinary.com/gg/image/upload/w_1600,h_1600,c_limit,q_auto:good,f_jpg/v1/kyc/dl.jpg',
    ]);
  });

  it('leaves a non-Cloudinary document URL exactly as it is', async () => {
    const fetchMock = mockFetch();
    await makeService().scan({
      selfieBase64: 'AAAA',
      documentUrl: 'https://example.com/kyc/id.png',
      mode: 'standard',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/kyc/id.png');
  });
});
