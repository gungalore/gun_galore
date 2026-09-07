import { toGeminiSchema } from './gemini-schema';
import { costUsdMicros } from './llm.pricing';
import {
  mapStopReason,
  mapUsage,
  parseRetryDelayMs,
  toContent,
  toGeminiPart,
  toLlmParts,
} from './gemini.provider';
import {
  mapAnthropicStopReason,
  mapAnthropicUsage,
  thinkingParam,
  toAnthropicBlock,
} from './anthropic.provider';

describe('toGeminiSchema', () => {
  // ⚠️ The whole reason this converter exists: Gemini 400s on keys it does
  // not know, and the call sites' hand-written schemas are full of them.
  it('drops the keys Gemini rejects', () => {
    const out = toGeminiSchema({
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Verdict',
      additionalProperties: false,
      default: {},
      examples: [{ ok: true }],
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    });
    expect(out).toEqual({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    });
  });

  it('rewrites a ["string","null"] union as nullable', () => {
    expect(toGeminiSchema({ type: ['string', 'null'] })).toEqual({
      type: 'string',
      nullable: true,
    });
  });

  it('treats a bare null type as a nullable string', () => {
    expect(toGeminiSchema({ type: 'null' })).toEqual({
      type: 'string',
      nullable: true,
    });
  });

  it('keeps only the first member of a union with no null', () => {
    expect(toGeminiSchema({ type: ['string', 'number'] })).toEqual({
      type: 'string',
    });
  });

  it('recurses into properties and items', () => {
    const out = toGeminiSchema({
      type: 'object',
      properties: {
        reasons: {
          type: 'array',
          title: 'Reasons',
          items: { type: 'string', additionalProperties: false },
        },
      },
    });
    expect(out).toEqual({
      type: 'object',
      properties: {
        reasons: { type: 'array', items: { type: 'string' } },
      },
    });
  });

  it('keeps description, enum, nullable and numeric bounds', () => {
    const out = toGeminiSchema({
      type: 'string',
      description: 'the verdict',
      enum: ['APPROVE', 'REJECT'],
      nullable: true,
    });
    expect(out).toEqual({
      type: 'string',
      description: 'the verdict',
      enum: ['APPROVE', 'REJECT'],
      nullable: true,
    });
  });

  // ⚠️ A `required` naming a property that is not in `properties` is itself
  // a 400, and hand-written schemas drift that way as fields are renamed.
  it('drops a required entry with no matching property', () => {
    const out = toGeminiSchema({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'goneAway'],
    });
    expect(out.required).toEqual(['a']);
  });

  it('turns const into a one-member enum and types it', () => {
    expect(toGeminiSchema({ const: 'REJECT' })).toEqual({
      type: 'string',
      enum: ['REJECT'],
    });
  });

  it('collapses a oneOf to its first branch', () => {
    expect(
      toGeminiSchema({
        oneOf: [{ type: 'string' }, { type: 'number' }],
      }),
    ).toEqual({ type: 'string' });
  });

  it('returns an untyped node rather than throwing on junk', () => {
    expect(toGeminiSchema(null)).toEqual({});
    expect(toGeminiSchema('nonsense')).toEqual({});
    expect(toGeminiSchema([1, 2])).toEqual({});
  });

  it('is pure — the input is not mutated', () => {
    const input = {
      type: 'object',
      title: 'x',
      properties: { a: { type: 'string', title: 'y' } },
    };
    const copy = JSON.parse(JSON.stringify(input));
    toGeminiSchema(input);
    expect(input).toEqual(copy);
  });
});

describe('gemini part mapping', () => {
  it('maps an assistant turn onto the model role', () => {
    expect(toContent({ role: 'assistant', content: 'hi' })).toEqual({
      role: 'model',
      parts: [{ text: 'hi' }],
    });
    expect(toContent({ role: 'user', content: 'hi' }).role).toBe('user');
  });

  it('sends images and documents alike as inlineData', () => {
    expect(
      toGeminiPart({ type: 'image', mimeType: 'image/jpeg', data: 'AAA' }),
    ).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAA' } });
    expect(
      toGeminiPart({ type: 'document', mimeType: 'application/pdf', data: 'BBB' }),
    ).toEqual({ inlineData: { mimeType: 'application/pdf', data: 'BBB' } });
  });

  // ⚠️ Gemini matches a result to its call by NAME. Losing the name here is
  // the failure that would make every tool loop hang.
  it('keys a tool result by name, and wraps the payload in an object', () => {
    expect(
      toGeminiPart({
        type: 'tool_result',
        toolCallId: 'call_1',
        name: 'lookup_cartridge',
        content: '9mm',
      }),
    ).toEqual({
      functionResponse: {
        id: 'call_1',
        name: 'lookup_cartridge',
        response: { content: '9mm' },
      },
    });
  });

  it('reports an errored tool under error, not content', () => {
    const part = toGeminiPart({
      type: 'tool_result',
      toolCallId: 'c',
      name: 'n',
      content: 'boom',
      isError: true,
    });
    expect(part.functionResponse?.response).toEqual({ error: 'boom' });
  });

  it('drops thought parts and invents an id for an id-less call', () => {
    const parts = toLlmParts([
      { thought: true, text: 'reasoning nobody should see' },
      { text: 'answer' },
      { functionCall: { name: 'lookup', args: { q: 1 } } },
    ]);
    expect(parts).toEqual([
      { type: 'text', text: 'answer' },
      { type: 'tool_call', id: 'lookup#0', name: 'lookup', input: { q: 1 } },
    ]);
  });
});

describe('mapStopReason', () => {
  it('reports a filtered response as safety', () => {
    expect(mapStopReason('SAFETY', false)).toBe('safety');
    expect(mapStopReason('PROHIBITED_CONTENT', false)).toBe('safety');
    expect(mapStopReason('RECITATION', false)).toBe('safety');
  });

  // A response carrying a functionCall finishes with STOP; the caller's next
  // move is the tool loop, not "done".
  it('prefers tool_use over a STOP finish', () => {
    expect(mapStopReason('STOP', true)).toBe('tool_use');
    expect(mapStopReason('STOP', false)).toBe('end');
  });

  it('maps max tokens and falls back to other', () => {
    expect(mapStopReason('MAX_TOKENS', false)).toBe('max_tokens');
    expect(mapStopReason(undefined, false)).toBe('other');
  });

  // A block beats even a tool call — there is no answer to loop on.
  it('lets safety win over tool calls', () => {
    expect(mapStopReason('SAFETY', true)).toBe('safety');
  });
});

describe('mapUsage', () => {
  // ⚠️ Gemini reports CUMULATIVE totals per chunk. Summing would multiply
  // the bill by the number of chunks in a stream.
  it('takes the last chunk rather than summing a stream', () => {
    const usage = mapUsage([
      { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } },
      { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 9 } },
    ] as never);
    expect(usage).toEqual({
      inputTokens: 10,
      outputTokens: 9,
      cachedInputTokens: 0,
      thinkingTokens: 0,
    });
  });

  it('reads the newer responseTokenCount alias', () => {
    const usage = mapUsage([
      { usageMetadata: { promptTokenCount: 5, responseTokenCount: 7 } },
    ] as never);
    expect(usage.outputTokens).toBe(7);
  });

  it('returns zeroes when no chunk carries usage', () => {
    expect(mapUsage([{}] as never)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      thinkingTokens: 0,
    });
  });
});

describe('parseRetryDelayMs', () => {
  it('reads the retryDelay a 429 body carries', () => {
    expect(parseRetryDelayMs('{"retryDelay":"27s"}')).toBe(27_000);
    expect(parseRetryDelayMs('retry_delay: "1.5s"')).toBe(1_500);
  });

  it('says nothing when the body says nothing', () => {
    expect(parseRetryDelayMs('429 Too Many Requests')).toBeUndefined();
  });
});

describe('costUsdMicros', () => {
  // Rate card read 2026-09-07: in $0.10/1M, out $0.40/1M, cached $0.01/1M.
  it('prices a plain flash-lite call from the published rates', () => {
    expect(
      costUsdMicros({
        model: 'gemini-2.5-flash-lite',
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(100_000);
    expect(
      costUsdMicros({
        model: 'gemini-2.5-flash-lite',
        inputTokens: 0,
        outputTokens: 1_000_000,
      }),
    ).toBe(400_000);
  });

  // ⚠️ promptTokenCount INCLUDES the cached tokens, so they must be billed
  // once at the cache rate, not twice.
  it('bills cached tokens at the cache rate, not on top of input', () => {
    expect(
      costUsdMicros({
        model: 'gemini-2.5-flash-lite',
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedInputTokens: 1_000_000,
      }),
    ).toBe(10_000);
  });

  it('prices an unknown model — Anthropic included — at zero', () => {
    expect(
      costUsdMicros({
        model: 'claude-sonnet-4-6',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(0);
  });
});

describe('anthropic mapping', () => {
  // ⚠️ Paid for by a real 400: motivation-claude.service.ts carries the
  // comment "NEVER budget_tokens — Opus 5 rejects it with a 400".
  it('never sends budget_tokens to a 5-series model', () => {
    expect(thinkingParam('claude-opus-5', 4000)).toEqual({ type: 'adaptive' });
    expect(thinkingParam('claude-sonnet-5', 0)).toEqual({ type: 'disabled' });
  });

  it('sends an explicit budget to every other model', () => {
    expect(thinkingParam('claude-sonnet-4-6', 4000)).toEqual({
      type: 'enabled',
      budget_tokens: 4000,
    });
    expect(thinkingParam('claude-sonnet-4-6', 0)).toEqual({ type: 'disabled' });
  });

  it('leaves the model default alone when no budget is asked for', () => {
    expect(thinkingParam('claude-sonnet-4-6', undefined)).toBeUndefined();
  });

  // Anthropic keys a result by ID where Gemini keys it by name — the
  // contract carries both because each side needs a different one.
  it('keys a tool result by id', () => {
    expect(
      toAnthropicBlock({
        type: 'tool_result',
        toolCallId: 'call_1',
        name: 'lookup',
        content: '9mm',
      }),
    ).toEqual({ type: 'tool_result', tool_use_id: 'call_1', content: '9mm' });
  });

  it('uses media_type, not mimeType, on a document block', () => {
    expect(
      toAnthropicBlock({
        type: 'document',
        mimeType: 'application/pdf',
        data: 'AAA',
      }),
    ).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'AAA' },
    });
  });

  it('maps a refusal to safety, matching Gemini', () => {
    expect(mapAnthropicStopReason('refusal')).toBe('safety');
    expect(mapAnthropicStopReason('end_turn')).toBe('end');
    expect(mapAnthropicStopReason('tool_use')).toBe('tool_use');
    expect(mapAnthropicStopReason(undefined)).toBe('other');
  });

  // ⚠️ Anthropic EXCLUDES cache reads from input_tokens where Gemini
  // includes them. The ledger has one column; it cannot mean two things.
  it('folds cache reads into inputTokens so both providers agree', () => {
    expect(
      mapAnthropicUsage({
        input_tokens: 100,
        cache_read_input_tokens: 900,
        output_tokens: 5,
      }),
    ).toEqual({
      inputTokens: 1000,
      outputTokens: 5,
      cachedInputTokens: 900,
      thinkingTokens: 0,
    });
  });
});
