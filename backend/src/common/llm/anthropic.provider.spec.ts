// ────────────────────────────────────────────────────────────────────
// WEB GROUNDING ON THE ROLLBACK PATH.
//
// LLM_PROVIDER=anthropic is the lever an operator pulls mid-incident. What
// makes it worth testing is that the lever must not QUIETLY change behaviour:
// a grounded call site that silently stops searching after a rollback would
// put recalled crime figures into a SAPS filing and recalled prices onto a
// price tag, and nothing would log an error.
//
// The SDK client is faked by setting the provider's already-lazy `client`, so
// no key and no network are involved.
// ────────────────────────────────────────────────────────────────────

import {
  AnthropicProvider,
  readAnthropicGrounding,
} from './anthropic.provider';
import type { LlmRequest } from './llm.types';

function build(message: Record<string, unknown> = { content: [] }) {
  const create = jest.fn().mockResolvedValue(message);
  const provider = new AnthropicProvider();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (provider as any).client = { messages: { create } };
  return { provider, create };
}

const base: LlmRequest = {
  messages: [{ role: 'user', content: 'what does a Tikka T3x cost in SA?' }],
  maxTokens: 500,
  purpose: 'test.grounded',
  model: 'claude-sonnet-4-6',
};

describe('AnthropicProvider — web grounding', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('maps grounding.web to the web_search_20250305 server tool at max_uses 1', async () => {
    const { provider, create } = build();
    await provider.complete({ ...base, grounding: { web: true } });

    expect(create.mock.calls[0][0].tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 1 },
    ]);
  });

  it('sends no tools when grounding is not asked for', async () => {
    const { provider, create } = build();
    await provider.complete(base);
    expect(create.mock.calls[0][0].tools).toBeUndefined();
  });

  // ⚠️ THE ROLLBACK PATH IS MORE PERMISSIVE THAN THE LIVE ONE, and this pins
  // it so nobody "fixes" the asymmetry by copying Gemini's throw over here.
  // Anthropic has no structural collision between a hosted search and our own
  // function declarations — but a CALL SITE still may not rely on that,
  // because Gemini 2.5 rejects the pairing and Gemini is what runs.
  it('lets the server tool sit alongside our own tools, unlike Gemini', async () => {
    const { provider, create } = build();
    await provider.complete({
      ...base,
      grounding: { web: true },
      tools: [{ name: 'searchMarketplace', description: 'x', inputSchema: {} }],
    });
    const tools = create.mock.calls[0][0].tools as Array<
      Record<string, unknown>
    >;
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ name: 'searchMarketplace' });
    expect(tools[1]).toMatchObject({ type: 'web_search_20250305' });
  });

  // toolChoice describes the CALLER's tools. Naming one that is not in the
  // array is a 400, and a 'none' would switch off the search just requested.
  it('does not map a toolChoice when only the server tool is present', async () => {
    const { provider, create } = build();
    await provider.complete({
      ...base,
      grounding: { web: true },
      toolChoice: { name: 'somethingWeDidNotSend' },
    });
    expect(create.mock.calls[0][0].tool_choice).toEqual({ type: 'auto' });
  });

  it('surfaces the searched pages and the queries as the contract shape', async () => {
    const { provider } = build({
      content: [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_1',
          name: 'web_search',
          input: { query: 'tikka t3x price south africa' },
        },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_1',
          content: [
            {
              type: 'web_search_result',
              url: 'https://hodgdon.com/p',
              title: 'Hodgdon',
            },
          ],
        },
        { type: 'text', text: 'About R18,000.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 4 },
    });

    const res = await provider.complete({ ...base, grounding: { web: true } });
    expect(res.groundingSources).toEqual([
      { uri: 'https://hodgdon.com/p', title: 'Hodgdon' },
    ]);
    expect(res.webSearchQueries).toEqual(['tikka t3x price south africa']);
    // The server blocks are not answers; only the text is.
    expect(res.text).toBe('About R18,000.');
  });

  it('leaves both fields undefined on an ungrounded call', async () => {
    const { provider } = build({
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
    });
    const res = await provider.complete(base);
    expect(res.groundingSources).toBeUndefined();
    expect(res.webSearchQueries).toBeUndefined();
  });
});

describe('readAnthropicGrounding', () => {
  it('returns nothing when no search block appears', () => {
    expect(readAnthropicGrounding([{ type: 'text', text: 'hi' }])).toEqual({});
  });

  // Same convention as the Gemini side: a search that opened nothing is [],
  // never undefined. The two providers must hand a call site one shape.
  it('reports an empty list for a search that opened nothing', () => {
    const out = readAnthropicGrounding([
      {
        type: 'server_tool_use',
        name: 'web_search',
        input: { query: 'q' },
      },
    ]);
    expect(out.groundingSources).toEqual([]);
    expect(out.webSearchQueries).toEqual(['q']);
  });

  // ⚠️ Both shapes are read because either can be the only one present: the
  // result block lists every page opened, the text citations list what a
  // sentence was actually attributed to.
  it('reads a page cited inline as well as one in the result block', () => {
    const out = readAnthropicGrounding([
      {
        type: 'web_search_tool_result',
        content: [
          { type: 'web_search_result', url: 'https://a.co', title: 'A' },
        ],
      },
      {
        type: 'text',
        text: 'x',
        citations: [
          {
            type: 'web_search_result_location',
            url: 'https://b.co',
            title: 'B',
          },
          { type: 'char_location', document_index: 0 },
        ],
      },
    ]);
    expect(out.groundingSources).toEqual([
      { uri: 'https://a.co', title: 'A' },
      { uri: 'https://b.co', title: 'B' },
    ]);
  });

  it('deduplicates by url, first title winning', () => {
    const out = readAnthropicGrounding([
      {
        type: 'web_search_tool_result',
        content: [
          { type: 'web_search_result', url: 'https://a.co', title: 'First' },
          { type: 'web_search_result', url: 'https://a.co', title: 'Second' },
        ],
      },
    ]);
    expect(out.groundingSources).toEqual([
      { uri: 'https://a.co', title: 'First' },
    ]);
  });

  it('drops an entry with no url', () => {
    const out = readAnthropicGrounding([
      {
        type: 'web_search_tool_result',
        content: [{ type: 'web_search_result', title: 'no link' }],
      },
    ]);
    expect(out.groundingSources).toEqual([]);
  });
});

describe('AnthropicProvider — sampling parameters', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'warn')
      .mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  // The 2026-08-19 incident: temperature on four calls, four silent 400s.
  it('never forwards temperature, whatever the caller asked for', async () => {
    const { provider, create } = build();
    await provider.complete({ ...base, temperature: 0 });
    const sent = create.mock.calls[0][0];
    expect(sent).not.toHaveProperty('temperature');
    expect(sent).not.toHaveProperty('top_p');
    expect(sent).not.toHaveProperty('top_k');
  });
});
