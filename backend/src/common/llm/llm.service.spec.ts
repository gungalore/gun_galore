import { LlmService } from './llm.service';
import type { LlmProviderClient } from './provider.interface';
import {
  LlmError,
  type LlmImageRequest,
  type LlmImageResponse,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamEvent,
} from './llm.types';

// ── A fake provider, so the service is tested without a key or a network ──
class FakeProvider implements LlmProviderClient {
  calls: LlmRequest[] = [];
  imageCalls: LlmImageRequest[] = [];
  configured = true;
  error: unknown = null;
  response: LlmResponse;
  /**
   * ⚠️ PRESENT ONLY WHEN THE PROVIDER DRAWS, exactly as on the real clients.
   * Gemini has an image model and a draw method; DeepSeek has NEITHER, and
   * that absence is what the image rescue in LlmService keys off. A fake that
   * always carried the method would make every image-routing test unable to
   * fail. Declared as optional properties so the constructor can attach them
   * conditionally instead of always defining a method.
   */
  generateImage?: (req: LlmImageRequest) => Promise<LlmImageResponse>;
  defaultImageModel?: () => string;

  constructor(
    readonly name: LlmProvider = 'gemini',
    /**
     * ⚠️ DEFAULTED TRUE SO NOTHING CHANGES BY OMISSION, and set false on the
     * deepseek fake below. Every provider in this repo reads PDFs except
     * DeepSeek, so a fake that silently said `false` would make every
     * unrelated routing test take the document rescue.
     */
    readonly acceptsDocuments = true,
    /** False on the deepseek fake — it has no image model at all. */
    readonly drawsImages = true,
  ) {
    if (this.drawsImages) {
      this.generateImage = async (
        req: LlmImageRequest,
      ): Promise<LlmImageResponse> => {
        this.imageCalls.push(req);
        if (this.error) throw this.error;
        return {
          images: [{ mimeType: 'image/png', data: 'cG5n' }],
          text: '',
          model: req.model ?? this.defaultImageModel!(),
          provider: this.name,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      };
      this.defaultImageModel = () => 'gemini-2.5-flash-image';
    }
    this.response = {
      text: 'ok',
      parts: [{ type: 'text', text: 'ok' }],
      toolCalls: [],
      stopReason: 'end',
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        cachedInputTokens: 0,
        thinkingTokens: 0,
      },
      model: 'gemini-2.5-flash-lite',
      provider: name,
      assistantMessage: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    };
  }

  isConfigured() {
    return this.configured;
  }
  defaultModel() {
    return 'gemini-2.5-flash-lite';
  }
  async complete(req: LlmRequest) {
    this.calls.push(req);
    if (this.error) throw this.error;
    return this.response;
  }
  async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    this.calls.push(req);
    if (this.error) throw this.error;
    yield { type: 'text', delta: 'o' };
    yield { type: 'text', delta: 'k' };
    yield { type: 'done', response: this.response };
  }
}

function makePrisma() {
  const create = jest.fn().mockResolvedValue({});
  return { prisma: { aiUsage: { create } } as never, create };
}

/** Let the fire-and-forget ledger write settle before asserting on it. */
const flush = () => new Promise((r) => setImmediate(r));

describe('LlmService', () => {
  const ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    process.env.GEMINI_API_KEY = 'test-key';
    jest.restoreAllMocks();
    // The service logs one line per call; keep the test output readable.
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ENV };
  });

  const build = () => {
    const { prisma, create } = makePrisma();
    const gemini = new FakeProvider('gemini');
    // ⚠️ Rollback insurance with no image model — matches the real client,
    // which defines no generateImage at all.
    const anthropic = new FakeProvider('anthropic', true, false);
    // ⚠️ acceptsDocuments: false — this is the only provider that cannot
    // read a PDF, and the document-rescue tests below are built on it. And
    // drawsImages: false — DeepSeek has no image model on this platform
    // either, which the image-rescue tests are built on.
    const deepseek = new FakeProvider('deepseek', false, false);
    deepseek.response = { ...deepseek.response, model: 'deepseek-flash' };
    return {
      svc: new LlmService(prisma, gemini, anthropic, deepseek),
      gemini,
      anthropic,
      deepseek,
      create,
    };
  };

  // ── provider + model selection ────────────────────────────────────
  it('defaults to gemini and flash-lite', () => {
    const { svc } = build();
    expect(svc.provider).toBe('gemini');
    expect(svc.model).toBe('gemini-3.5-flash-lite');
  });

  it('switches to anthropic on LLM_PROVIDER, the rollback lever', async () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.LLM_MODEL = 'claude-sonnet-4-6';
    const { svc, gemini, anthropic } = build();
    expect(svc.provider).toBe('anthropic');
    expect(svc.model).toBe('claude-sonnet-4-6');

    await svc.complete({ messages: [], maxTokens: 10, purpose: 'test' });
    expect(anthropic.calls).toHaveLength(1);
    expect(gemini.calls).toHaveLength(0);
  });

  // ⚠️ No Anthropic model id is ever guessed — snapshots retire, and a
  // guessed one 404s in the middle of the incident that prompted the rollback.
  it('reports no model for anthropic when LLM_MODEL is unset', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    const { svc } = build();
    expect(svc.model).toBe('');
  });

  it('passes the resolved model down to the provider', async () => {
    process.env.LLM_MODEL = 'gemini-2.5-flash-lite';
    const { svc, gemini } = build();
    await svc.complete({ messages: [], maxTokens: 10, purpose: 'test' });
    expect(gemini.calls[0].model).toBe('gemini-2.5-flash-lite');
  });

  it('lets a call site override the model for one call', async () => {
    const { svc, gemini } = build();
    await svc.complete({
      messages: [],
      maxTokens: 10,
      purpose: 'test',
      model: 'gemini-3.1-flash-lite',
    });
    expect(gemini.calls[0].model).toBe('gemini-3.1-flash-lite');
  });

  it('reports configuration from the live provider only', () => {
    const { svc, gemini, anthropic } = build();
    gemini.configured = false;
    anthropic.configured = true;
    expect(svc.isConfigured()).toBe(false);
  });

  it('fails as not_configured rather than calling an unkeyed provider', async () => {
    const { svc, gemini } = build();
    gemini.configured = false;
    await expect(
      svc.complete({ messages: [], maxTokens: 10, purpose: 'test' }),
    ).rejects.toMatchObject({ code: 'not_configured' });
    expect(gemini.calls).toHaveLength(0);
  });

  // ── the ledger ────────────────────────────────────────────────────
  it('writes one ledger row per successful call', async () => {
    const { svc, create } = build();
    await svc.complete({
      messages: [],
      maxTokens: 10,
      purpose: 'moderation.listing',
    });
    await flush();

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      purpose: 'moderation.listing',
      inputTokens: 12,
      outputTokens: 3,
      ok: true,
      errorCode: null,
    });
    // 12 in @ $0.10/1M + 3 out @ $0.40/1M = 1.2 + 1.2 micro-dollars.
    expect(data.costUsdMicros).toBe(2);
    expect(typeof data.latencyMs).toBe('number');
  });

  it('writes a ledger row for a FAILED call too, with its error code', async () => {
    const { svc, gemini, create } = build();
    gemini.error = new LlmError('rate_limited', 'slow down', 429);
    await expect(
      svc.complete({ messages: [], maxTokens: 10, purpose: 'kyc.read' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    await flush();

    expect(create.mock.calls[0][0].data).toMatchObject({
      purpose: 'kyc.read',
      ok: false,
      errorCode: 'rate_limited',
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 0,
    });
  });

  // ⚠️ THE POINT OF FIRE-AND-FORGET. A model call must never fail because
  // its bookkeeping failed — a lost row costs a chart point, a thrown row
  // costs a member their answer.
  it('never fails a call because the ledger write failed', async () => {
    const { prisma, create } = makePrisma();
    create.mockRejectedValue(new Error('database is down'));
    const svc = new LlmService(prisma, new FakeProvider(), new FakeProvider('anthropic'));

    const res = await svc.complete({
      messages: [],
      maxTokens: 10,
      purpose: 'test',
    });
    await flush();
    expect(res.text).toBe('ok');
  });

  it('prices an anthropic row at zero', async () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.LLM_MODEL = 'claude-sonnet-4-6';
    const { svc, anthropic, create } = build();
    anthropic.response = {
      ...anthropic.response,
      model: 'claude-sonnet-4-6',
      usage: { inputTokens: 500_000, outputTokens: 500_000 },
    };
    await svc.complete({ messages: [], maxTokens: 10, purpose: 'test' });
    await flush();
    expect(create.mock.calls[0][0].data.costUsdMicros).toBe(0);
  });

  // ── streaming ─────────────────────────────────────────────────────
  it('yields deltas then done, and books the call at the end', async () => {
    const { svc, create } = build();
    const events: LlmStreamEvent[] = [];
    for await (const e of svc.stream({
      messages: [],
      maxTokens: 10,
      purpose: 'motivation.generate',
    })) {
      events.push(e);
    }
    await flush();

    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'done']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      purpose: 'motivation.generate',
      ok: true,
      outputTokens: 3,
    });
  });

  it('books a stream that failed before it opened', async () => {
    const { svc, gemini, create } = build();
    gemini.error = new LlmError('overloaded', 'try later', 503);
    const run = async () => {
      for await (const _ of svc.stream({
        messages: [],
        maxTokens: 10,
        purpose: 'ask.answer',
      })) {
        // drain
      }
    };
    await expect(run()).rejects.toMatchObject({ code: 'overloaded' });
    await flush();
    expect(create.mock.calls[0][0].data).toMatchObject({
      ok: false,
      errorCode: 'overloaded',
    });
  });

  // ── ping ──────────────────────────────────────────────────────────
  it('pings with one token, no thinking, under the health purpose', async () => {
    const { svc, gemini } = build();
    const result = await svc.ping();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.5-flash-lite');
    expect(gemini.calls[0]).toMatchObject({
      maxTokens: 1,
      purpose: 'health.ping',
      thinking: { budgetTokens: 0 },
    });
  });

  // A health probe that throws takes down the page whose job is to say
  // something is down.
  it('never throws from ping — it reports', async () => {
    const { svc, gemini } = build();
    gemini.error = new LlmError('timeout', 'no answer');
    const result = await svc.ping();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('reports not-configured from ping without calling the provider', async () => {
    const { svc, gemini } = build();
    gemini.configured = false;
    const result = await svc.ping();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not configured');
    expect(gemini.calls).toHaveLength(0);
  });

  // ── the log line ──────────────────────────────────────────────────
  // ⚠️ These prompts carry SA ID numbers, licence serials and the contents
  // of self-defence motivations. pm2 keeps logs on disk indefinitely.
  it('never logs prompt content', async () => {
    const log = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'log')
      .mockImplementation(() => {});
    const { svc } = build();
    await svc.complete({
      messages: [{ role: 'user', content: 'ID 8001015009087, Smith & Wesson #A123' }],
      system: 'secret system prompt',
      maxTokens: 10,
      purpose: 'kyc.read',
    });

    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('kyc.read');
    expect(logged).toContain('gemini-2.5-flash-lite');
    expect(logged).not.toContain('8001015009087');
    expect(logged).not.toContain('secret system prompt');
  });

  // ── the document rescue ───────────────────────────────────────────
  //
  // DeepSeek became the platform default on 2026-09-26 and cannot read a
  // PDF at all (its mapContent throws `unsupported`). A purpose that
  // defaults to it must still get a PDF read, so LlmService sends a
  // document-bearing request to Gemini. These pin that, and pin that it is
  // narrow enough not to move anything else.
  const pdf = {
    type: 'document' as const,
    mimeType: 'application/pdf',
    data: 'JVBERi0=',
  };

  it('⚠️ sends a document part to gemini when the purpose defaults to deepseek', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    const { svc, gemini, deepseek } = build();
    await svc.complete({
      messages: [{ role: 'user', content: [pdf] }],
      maxTokens: 10,
      purpose: 'vault.classify',
    });
    expect(deepseek.calls).toHaveLength(0);
    expect(gemini.calls).toHaveLength(1);
  });

  it('rescues a PDF sent as an image part too, not only a document part', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    const { svc, gemini, deepseek } = build();
    await svc.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mimeType: 'application/pdf', data: 'JVBERi0=' },
          ],
        },
      ],
      maxTokens: 10,
      purpose: 'vault.read',
    });
    expect(deepseek.calls).toHaveLength(0);
    expect(gemini.calls).toHaveLength(1);
  });

  it('leaves an image-only request on deepseek', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    const { svc, gemini, deepseek } = build();
    await svc.complete({
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', mimeType: 'image/jpeg', data: 'aGk=' }],
        },
      ],
      maxTokens: 10,
      purpose: 'motivation.classify',
    });
    expect(gemini.calls).toHaveLength(0);
    expect(deepseek.calls).toHaveLength(1);
  });

  it('does not rescue an explicit gemini pin that cannot take documents', async () => {
    // A pin is a decision. The rescue fires only when the PINNED provider
    // declares it cannot read a document — never to move a call off Gemini.
    process.env.LLM_PROVIDER_VAULT_CLASSIFY = 'gemini';
    const { svc, gemini, deepseek } = build();
    await svc.complete({
      messages: [{ role: 'user', content: [pdf] }],
      maxTokens: 10,
      purpose: 'vault.classify',
    });
    expect(gemini.calls).toHaveLength(1);
    expect(deepseek.calls).toHaveLength(0);
  });

  it('the rescue is announced on a warn, so a pinned env is not read as truth', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    const warn = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { svc } = build();
    await svc.complete({
      messages: [{ role: 'user', content: [pdf] }],
      maxTokens: 10,
      purpose: 'vault.classify',
    });
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('vault.classify');
    expect(logged).toContain('deepseek');
  });

  it('⚠️ the ledger names the provider that actually served the call', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    const { svc, create } = build();
    await svc.complete({
      messages: [{ role: 'user', content: [pdf] }],
      maxTokens: 10,
      purpose: 'vault.classify',
    });
    await flush();
    expect(create.mock.calls[0][0].data.provider).toBe('gemini');
  });

  it('rescues on the streaming path as well', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    const { svc, gemini, deepseek } = build();
    const events: unknown[] = [];
    for await (const e of svc.stream({
      messages: [{ role: 'user', content: [pdf] }],
      maxTokens: 10,
      purpose: 'vault.read',
    })) {
      events.push(e);
    }
    expect(deepseek.calls).toHaveLength(0);
    expect(gemini.calls).toHaveLength(1);
  });

  // ── grounding ─────────────────────────────────────────────────────
  it('passes grounding straight through to the provider', async () => {
    const { svc, gemini } = build();
    await svc.complete({
      messages: [],
      maxTokens: 10,
      purpose: 'motivation.research',
      grounding: { web: true },
    });
    expect(gemini.calls[0].grounding).toEqual({ web: true });
  });

  // A hosted search costs more and takes longer than the same call without
  // one, so "which of these searched" has to be answerable from the logs.
  it('marks a grounded call on the log line', async () => {
    const log = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'log')
      .mockImplementation(() => {});
    const { svc } = build();
    await svc.complete({
      messages: [],
      maxTokens: 10,
      purpose: 'motivation.research',
      grounding: { web: true },
    });
    expect(String(log.mock.calls[0][0])).toContain('grounded');
  });

  it('does not mark an ungrounded one', async () => {
    const log = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'log')
      .mockImplementation(() => {});
    const { svc } = build();
    await svc.complete({ messages: [], maxTokens: 10, purpose: 'test' });
    expect(String(log.mock.calls[0][0])).not.toContain('grounded');
  });

  // ⚠️ THE QUERIES ARE BUILT FROM THE PROMPT, and these prompts carry a
  // member's suburb and the firearm they are applying for. `webSearchQueries`
  // comes back on the response and must never reach a log line — pm2 keeps
  // logs on disk indefinitely.
  it('never logs the search queries the provider ran', async () => {
    const log = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'log')
      .mockImplementation(() => {});
    const { svc, gemini } = build();
    gemini.response = {
      ...gemini.response,
      groundingSources: [{ uri: 'https://saps.gov.za/x', title: 'SAPS' }],
      webSearchQueries: ['Langeberg Glen house robbery statistics'],
    };
    await svc.complete({
      messages: [],
      maxTokens: 10,
      purpose: 'motivation.research',
      grounding: { web: true },
    });
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('grounded');
    expect(logged).not.toContain('Langeberg Glen');
    expect(logged).not.toContain('saps.gov.za');
  });

  // ── the image rescue ──────────────────────────────────────────────
  //
  // DeepSeek defines NO generateImage at all, so a purpose that defaults to
  // it throws `unsupported` rather than drawing. Same shape as the document
  // rescue: pin the purpose, or let this backstop send it to Gemini — and
  // announce it, so a pinned env is not read as truth.
  it('⚠️ sends an image request to gemini when the purpose defaults to deepseek', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    const { svc, gemini, deepseek } = build();
    const res = await svc.generateImage({ prompt: 'a plate', purpose: 'motivation.quarry' });
    expect(deepseek.imageCalls).toHaveLength(0);
    expect(gemini.imageCalls).toHaveLength(1);
    expect(res.provider).toBe('gemini');
  });

  it('announces the image rescue, so a pinned env is not read as truth', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    const warn = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { svc } = build();
    await svc.generateImage({ prompt: 'a plate', purpose: 'motivation.quarry' });
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('motivation.quarry');
    expect(logged).toContain('deepseek');
  });

  it('leaves an image request on an explicit gemini pin', async () => {
    process.env.LLM_PROVIDER_DEALER_VERIFY = 'gemini';
    const warn = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { svc, gemini, deepseek } = build();
    await svc.generateImage({ prompt: 'a plate', purpose: 'dealer.verify' });
    expect(gemini.imageCalls).toHaveLength(1);
    expect(deepseek.imageCalls).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('books the image call under the provider that actually drew it', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    const { svc, create } = build();
    await svc.generateImage({ prompt: 'a plate', purpose: 'motivation.quarry' });
    await flush();
    expect(create.mock.calls[0][0].data.provider).toBe('gemini');
  });
});
