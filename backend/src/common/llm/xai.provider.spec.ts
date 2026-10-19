import { XaiProvider } from './xai.provider';
import type { LlmImageRequest, LlmRequest } from './llm.types';

const imageReq: LlmImageRequest = {
  prompt: 'an empty IPSC range',
  purpose: 'motivation.plate',
  aspectRatio: '21:9',
};

function mockFetch(impl: unknown) {
  (global as unknown as { fetch: unknown }).fetch = jest
    .fn()
    .mockResolvedValue(impl);
}

/** A response whose body is read with res.text() (the provider parses JSON itself). */
function okJson(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

describe('XaiProvider', () => {
  const prevGrok = process.env.GROK_API_KEY;
  const prevXai = process.env.XAI_API_KEY;

  beforeEach(() => {
    process.env.GROK_API_KEY = 'test';
    jest.restoreAllMocks();
  });

  afterEach(() => {
    if (prevGrok === undefined) delete process.env.GROK_API_KEY;
    else process.env.GROK_API_KEY = prevGrok;
    if (prevXai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevXai;
    jest.restoreAllMocks();
  });

  it('is configured from GROK_API_KEY (and XAI_API_KEY as a fallback)', () => {
    expect(new XaiProvider().isConfigured()).toBe(true);
    delete process.env.GROK_API_KEY;
    expect(new XaiProvider().isConfigured()).toBe(false);
    process.env.XAI_API_KEY = 'test2';
    expect(new XaiProvider().isConfigured()).toBe(true);
  });

  it('maps a b64 image, pins 2k medium quality, and reports the xai provider with no tokens', async () => {
    mockFetch(
      okJson({ data: [{ b64_json: 'aGk=', mime_type: 'image/jpeg' }] }),
    );
    const res = await new XaiProvider().generateImage(imageReq);
    const fetchMock = global.fetch as unknown as jest.Mock;
    const calls = fetchMock.mock.calls as Array<[string, { body: string }]>;
    const sentBody = JSON.parse(calls[0][1].body) as {
      quality?: string;
      resolution?: string;
    };
    expect(sentBody.quality).toBe('medium');
    expect(sentBody.resolution).toBe('2k');
    expect(res.provider).toBe('xai');
    expect(res.model).toBe('grok-imagine-image-2.0');
    expect(res.images).toHaveLength(1);
    expect(res.images[0].data).toBe('aGk=');
    expect(res.usage.outputTokens).toBe(0);
    expect(res.usage.images).toBe(1);
  });

  it('treats an empty data array as a safety refusal', async () => {
    mockFetch(okJson({ data: [] }));
    await expect(
      new XaiProvider().generateImage(imageReq),
    ).rejects.toMatchObject({
      code: 'safety',
    });
  });

  it('maps HTTP 400 to bad_request', async () => {
    mockFetch({ ok: false, status: 400, text: async () => 'bad' });
    await expect(
      new XaiProvider().generateImage(imageReq),
    ).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('maps HTTP 429 to rate_limited', async () => {
    mockFetch({ ok: false, status: 429, text: async () => 'slow down' });
    await expect(
      new XaiProvider().generateImage(imageReq),
    ).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('refuses reference images rather than drawing without them', async () => {
    await expect(
      new XaiProvider().generateImage({
        ...imageReq,
        references: [{ mimeType: 'image/png', data: 'aGk=' }],
      }),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('refuses every text call — this provider is images only', async () => {
    const textReq: LlmRequest = {
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 8,
      purpose: 'test',
    };
    await expect(new XaiProvider().complete(textReq)).rejects.toMatchObject({
      code: 'unsupported',
    });
  });
});
