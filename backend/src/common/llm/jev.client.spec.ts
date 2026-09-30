import { JevClient } from './jev.client';
import { LlmError } from './llm.types';

function mockFetch(impl: unknown) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue(impl);
}

const request = {
  state: 'DM me on 082 123 4567',
  questions: {
    contact_details: { type: 'noul' as const, instructions: 'phone?' },
  },
  purpose: 'test',
};

describe('JevClient', () => {
  const prev = process.env.JEV_API_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.JEV_API_KEY;
    else process.env.JEV_API_KEY = prev;
    jest.restoreAllMocks();
  });

  it('throws not_configured without a key', async () => {
    delete process.env.JEV_API_KEY;
    await expect(new JevClient().decide(request)).rejects.toMatchObject({
      code: 'not_configured',
    });
  });

  it('maps a noul answer and reports the versioned model', async () => {
    process.env.JEV_API_KEY = 'test';
    mockFetch({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: { contact_details: { type: 'noul', noul: 0.93 } },
        usage: { input_tokens: 120, output_tokens: 4 },
      }),
    });

    const res = await new JevClient().decide(request);
    expect(res.provider).toBe('typesafe');
    expect(res.model).toBe('jev-1.13.0');
    const answer = res.answers.contact_details;
    expect(answer.type).toBe('noul');
    expect(answer.type === 'noul' && answer.noul).toBe(0.93);
    expect(res.usage.inputTokens).toBe(120);
  });

  it('maps choice and score answers', async () => {
    process.env.JEV_API_KEY = 'test';
    mockFetch({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          placement: {
            type: 'choice',
            choice: 'description',
            probabilities: { title: 0.1, description: 0.9 },
            confidence: 0.8,
          },
        },
      }),
    });
    const res = await new JevClient().decide({
      ...request,
      questions: {
        placement: {
          type: 'choice',
          instructions: 'where?',
          criteria: { title: 't', description: 'd' },
        },
      },
    });
    const a = res.answers.placement;
    expect(a.type === 'choice' && a.choice).toBe('description');
  });

  it('fails a call with a malformed answer rather than passing it', async () => {
    process.env.JEV_API_KEY = 'test';
    mockFetch({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: { contact_details: { type: 'noul', noul: 'lots' } },
      }),
    });
    await expect(new JevClient().decide(request)).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('maps 429 to rate_limited and retries', async () => {
    process.env.JEV_API_KEY = 'test';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => null },
        text: async () => 'slow down',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'jev-1.13.0',
          answers: { contact_details: { type: 'noul', noul: 0.1 } },
        }),
      });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;

    const res = await new JevClient().decide(request);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.answers.contact_details.type).toBe('noul');
  });

  it('maps 422 to bad_request without retrying', async () => {
    process.env.JEV_API_KEY = 'test';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: { get: () => null },
      text: async () => 'invalid',
    });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;

    await expect(new JevClient().decide(request)).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps an abort to timeout', async () => {
    process.env.JEV_API_KEY = 'test';
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(new JevClient().decide(request)).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('exposes LlmError codes for every failure', () => {
    const err = new LlmError('rate_limited', 'x', 429);
    expect(err.retryable).toBe(true);
  });
});
