// ────────────────────────────────────────────────────────────────────
// WEB GROUNDING ON THE GEMINI PATH.
//
// The provider is driven against a FAKE SDK client — `sdk()` hands back an
// already-set `client`, so no key and no network are involved and the test
// can read the exact params that would have gone over the wire. That is the
// point: the two things worth pinning here are (1) the request shape, which
// is a single object literal that a refactor could silently rename, and (2)
// the response field names, which came off the installed 2.21.0 declarations
// rather than a docs page and would otherwise be checkable only in production.
// ────────────────────────────────────────────────────────────────────

import { GeminiProvider, readGrounding, thinkingConfigFor } from './gemini.provider';
import { LlmError, type LlmRequest } from './llm.types';

type Fake = {
  generateContent: jest.Mock;
  generateContentStream: jest.Mock;
};

/** A minimal successful Gemini response, plus whatever the test adds. */
function candidate(over: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        content: { parts: [{ text: 'answer' }] },
        finishReason: 'STOP',
        ...over,
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
  };
}

function build(response: unknown = candidate()) {
  const fake: Fake = {
    generateContent: jest.fn().mockResolvedValue(response),
    generateContentStream: jest.fn(),
  };
  const provider = new GeminiProvider();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (provider as any).client = { models: fake };
  return { provider, fake };
}

const base: LlmRequest = {
  messages: [{ role: 'user', content: 'what does a Tikka T3x cost in SA?' }],
  maxTokens: 500,
  purpose: 'test.grounded',
};

describe('GeminiProvider — web grounding', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── the request ───────────────────────────────────────────────────
  it('maps grounding.web to the googleSearch tool, configured with nothing', async () => {
    const { provider, fake } = build();
    await provider.complete({ ...base, grounding: { web: true } });

    const config = fake.generateContent.mock.calls[0][0].config;
    // ⚠️ An EMPTY object is the whole configuration. Every knob GoogleSearch
    // carries is marked unsupported on this API, so sending one is a 400.
    expect(config.tools).toEqual([{ googleSearch: {} }]);
    expect(config.responseMimeType).toBeUndefined();
  });

  it('sends no tools at all when grounding is not asked for', async () => {
    const { provider, fake } = build();
    await provider.complete(base);
    expect(fake.generateContent.mock.calls[0][0].config.tools).toBeUndefined();
  });

  // ⚠️ THIS ONE FAILS QUIETLY IF WE LET IT THROUGH. On 2.5 the pairing does
  // not error at Google — a search runs and is billed while groundingChunks
  // comes back EMPTY, handing the caller sourced-looking JSON it can never
  // cite. Structured output beside a built-in tool is 3-series only.
  it('refuses grounding + json rather than billing a search it cannot cite', async () => {
    const { provider, fake } = build();
    await expect(
      provider.complete({
        ...base,
        grounding: { web: true },
        json: { schema: { type: 'object' } },
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(fake.generateContent).not.toHaveBeenCalled();
  });

  // "The Gemini API doesn't support combining search tools (such as
  // googleSearch) with non-search tools (such as function calling) in the
  // same generateContent request." Both live in config.tools, so it is a
  // structural collision as well as a documented one.
  it('refuses grounding + function declarations', async () => {
    const { provider, fake } = build();
    await expect(
      provider.complete({
        ...base,
        grounding: { web: true },
        tools: [
          { name: 'searchMarketplace', description: 'x', inputSchema: {} },
        ],
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(fake.generateContent).not.toHaveBeenCalled();
  });

  it('says which combination was wrong, so the caller can fix the right one', async () => {
    const { provider } = build();
    const err = await provider
      .complete({ ...base, grounding: { web: true }, json: {} })
      .catch((e: LlmError) => e);
    expect((err as LlmError).message).toMatch(/json/i);
    const err2 = await provider
      .complete({
        ...base,
        grounding: { web: true },
        tools: [{ name: 't', description: 'd', inputSchema: {} }],
      })
      .catch((e: LlmError) => e);
    expect((err2 as LlmError).message).toMatch(/function declarations/i);
  });

  // ── the response ──────────────────────────────────────────────────
  it('surfaces groundingChunks[].web.{uri,title} and webSearchQueries', async () => {
    const { provider } = build(
      candidate({
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://hodgdon.com/p', title: 'Hodgdon' } },
            { web: { uri: 'https://6mmbr.com/t', title: '6mmBR' } },
          ],
          webSearchQueries: ['tikka t3x price south africa'],
        },
      }),
    );
    const res = await provider.complete({ ...base, grounding: { web: true } });

    expect(res.groundingSources).toEqual([
      { uri: 'https://hodgdon.com/p', title: 'Hodgdon' },
      { uri: 'https://6mmbr.com/t', title: '6mmBR' },
    ]);
    expect(res.webSearchQueries).toEqual(['tikka t3x price south africa']);
    expect(res.text).toBe('answer');
  });

  it('leaves both fields undefined on an ungrounded call', async () => {
    const { provider } = build();
    const res = await provider.complete(base);
    expect(res.groundingSources).toBeUndefined();
    expect(res.webSearchQueries).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// The pure mapper, where the awkward cases live.
// ────────────────────────────────────────────────────────────────────
describe('readGrounding', () => {
  const withMeta = (meta: unknown) =>
    ({ candidates: [{ groundingMetadata: meta }] }) as never;

  it('returns nothing at all when no chunk carried metadata', () => {
    expect(readGrounding([{ candidates: [{}] } as never])).toEqual({});
  });

  // ⚠️ ABSENT AND EMPTY ARE DIFFERENT ANSWERS. undefined is "not grounded";
  // [] is "grounded, and it opened nothing" — which a caller promising
  // citations has to be able to tell apart, because only one of them means
  // "say you found nothing" rather than "this feature was off".
  it('reports an empty list, not undefined, for a search that found nothing', () => {
    const out = readGrounding([withMeta({ webSearchQueries: ['x'] })]);
    expect(out.groundingSources).toEqual([]);
    expect(out.webSearchQueries).toEqual(['x']);
  });

  it('reads every chunk, because a stream reports grounding before it finishes', () => {
    const out = readGrounding([
      withMeta({ groundingChunks: [{ web: { uri: 'https://a.co' } }] }),
      { candidates: [{ finishReason: 'STOP' }] } as never,
      withMeta({ groundingChunks: [{ web: { uri: 'https://b.co' } }] }),
    ]);
    expect(out.groundingSources?.map((s) => s.uri)).toEqual([
      'https://a.co',
      'https://b.co',
    ]);
  });

  it('deduplicates by uri and keeps the first title — a page cited five times is one chip', () => {
    const out = readGrounding([
      withMeta({
        groundingChunks: [
          { web: { uri: 'https://a.co', title: 'First' } },
          { web: { uri: 'https://a.co', title: 'Second' } },
        ],
        webSearchQueries: ['q', 'q'],
      }),
    ]);
    expect(out.groundingSources).toEqual([
      { uri: 'https://a.co', title: 'First' },
    ]);
    expect(out.webSearchQueries).toEqual(['q']);
  });

  // A source the member cannot open is not a source, and a bare title
  // rendered as a link is worse than nothing.
  it('drops a chunk with no uri, and a chunk that is not a web page', () => {
    const out = readGrounding([
      withMeta({
        groundingChunks: [
          { web: { title: 'no link here' } },
          { maps: { title: 'a place' } },
          { web: { uri: 'https://real.co' } },
        ],
      }),
    ]);
    expect(out.groundingSources).toEqual([{ uri: 'https://real.co' }]);
  });

  it('omits a title the provider did not give, rather than inventing an empty one', () => {
    const out = readGrounding([
      withMeta({ groundingChunks: [{ web: { uri: 'https://a.co' } }] }),
    ]);
    expect(out.groundingSources?.[0]).not.toHaveProperty('title');
  });
});

describe('thinkingConfigFor — one budget, two dialects', () => {
  // Probed live on 2026-09-07: gemini-3.5-flash-lite and
  // gemini-flash-lite-latest answer 400 "Request contains an invalid
  // argument" to thinkingBudget and accept thinkingLevel; 2.5 is the reverse.
  it('keeps the literal budget on the 2.5 generation', () => {
    expect(thinkingConfigFor('gemini-2.5-flash-lite', 0)).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfigFor('gemini-2.5-flash', 4096)).toEqual({ thinkingBudget: 4096 });
  });

  it('turns the budget into a level on every 3.x model', () => {
    expect(thinkingConfigFor('gemini-3.5-flash-lite', 0)).toEqual({ thinkingLevel: 'LOW' });
    expect(thinkingConfigFor('gemini-3.5-flash-lite', 4096)).toEqual({ thinkingLevel: 'LOW' });
    expect(thinkingConfigFor('gemini-3.1-flash-lite', 16_000)).toEqual({ thinkingLevel: 'MEDIUM' });
    expect(thinkingConfigFor('gemini-3.8-flash', 32_000)).toEqual({ thinkingLevel: 'HIGH' });
  });

  it('treats an alias with no generation number as 3.x, which is what it resolves to', () => {
    expect(thinkingConfigFor('gemini-flash-lite-latest', 0)).toEqual({ thinkingLevel: 'LOW' });
  });
});
