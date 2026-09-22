import { DeepSeekProvider } from './deepseek.provider';
import type { LlmRequest } from './llm.types';

const baseReq: LlmRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 16,
  purpose: 'feed.moderation',
};

function mockFetch(impl: unknown) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue(impl);
}

describe('DeepSeekProvider', () => {
  const prev = process.env.DEEPSEEK_API_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
    jest.restoreAllMocks();
  });

  it('throws not_configured without a key', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(new DeepSeekProvider().complete(baseReq)).rejects.toMatchObject({
      code: 'not_configured',
    });
  });

  it('maps a chat completion and reports the deepseek provider', async () => {
    process.env.DEEPSEEK_API_KEY = 'test';
    mockFetch({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: '{"promoDetected":false}' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    const res = await new DeepSeekProvider().complete({ ...baseReq, json: {} });
    expect(res.provider).toBe('deepseek');
    expect(res.text).toContain('promoDetected');
    expect(res.usage.inputTokens).toBe(10);
    expect(res.usage.outputTokens).toBe(5);
  });

  it('treats empty JSON content as a safety refusal (fail closed upstream)', async () => {
    process.env.DEEPSEEK_API_KEY = 'test';
    mockFetch({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      }),
    });

    await expect(
      new DeepSeekProvider().complete({ ...baseReq, json: {} }),
    ).rejects.toMatchObject({ code: 'safety' });
  });

  it('maps HTTP 429 to rate_limited', async () => {
    process.env.DEEPSEEK_API_KEY = 'test';
    mockFetch({ ok: false, status: 429, text: async () => 'slow down' });

    await expect(new DeepSeekProvider().complete(baseReq)).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('refuses tools rather than half-mapping them', async () => {
    process.env.DEEPSEEK_API_KEY = 'test';
    await expect(
      new DeepSeekProvider().complete({
        ...baseReq,
        tools: [{ name: 'x', description: 'y', inputSchema: {} }],
      }),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });
});
