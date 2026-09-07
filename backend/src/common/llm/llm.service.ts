// ────────────────────────────────────────────────────────────────────
// THE ADAPTER. Every model call on the platform goes through here.
//
// Operator, 2026-09-07: "we are switching from claude API to gemini 2.5
// flash-lite api for everything on the website." Gemini is the provider;
// LLM_PROVIDER=anthropic is the rollback lever and nothing else.
//
// This class owns three things a provider must not, because a second
// provider would then have to remember them:
//   1. WHICH provider and WHICH model — read from the env once per call, so
//      an operator can repoint the platform with an env edit and a reload.
//   2. The usage ledger — one AiUsage row per call, success or failure.
//   3. The log line — purpose, model, tokens, ms. ⚠️ NEVER prompt content:
//      these prompts carry SA ID numbers, licence serials, addresses and
//      the contents of self-defence motivations. A log line is not a place
//      any of that may appear, and pm2 keeps logs on disk indefinitely.
// ────────────────────────────────────────────────────────────────────

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AnthropicProvider } from './anthropic.provider';
import { GeminiProvider } from './gemini.provider';
import { costUsdMicros } from './llm.pricing';
import type { LlmProviderClient } from './provider.interface';
import {
  LlmError,
  type LlmPing,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamEvent,
  type LlmUsage,
} from './llm.types';

// ⚠️ 3.5, NOT 2.5. The operator asked for 2.5-flash-lite; Google refused it to
// every key created on 2026-09-07 ("no longer available to new users") and
// pointed at 3.5-flash-lite, which passed every probe. Operator: "use 3.5
// flash-lite". A default no new key can reach is a trap for the next person.
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

// ⚠️ DI tokens for the two providers, deliberately NOT registered anywhere.
// A constructor parameter typed as an interface emits `Object` as its design
// type, and Nest would try to resolve a provider called Object and fail to
// start the container. `@Optional() @Inject(token)` on an unregistered token
// resolves to undefined instead, which is what production wants — the real
// providers are constructed below. Tests bypass Nest and pass fakes directly.
export const LLM_GEMINI_PROVIDER = Symbol('LLM_GEMINI_PROVIDER');
export const LLM_ANTHROPIC_PROVIDER = Symbol('LLM_ANTHROPIC_PROVIDER');

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly gemini: LlmProviderClient;
  private readonly anthropic: LlmProviderClient;

  constructor(
    private readonly prisma: PrismaService,
    // Overridable for the unit tests, which drive a fake provider rather
    // than a live key. Production resolves both to undefined and builds the
    // real ones — see the token comment above.
    @Optional() @Inject(LLM_GEMINI_PROVIDER) gemini?: LlmProviderClient,
    @Optional() @Inject(LLM_ANTHROPIC_PROVIDER) anthropic?: LlmProviderClient,
  ) {
    this.gemini = gemini ?? new GeminiProvider();
    this.anthropic = anthropic ?? new AnthropicProvider();
  }

  /** Which provider is live, from LLM_PROVIDER (default 'gemini'). */
  get provider(): LlmProvider {
    return process.env.LLM_PROVIDER === 'anthropic' ? 'anthropic' : 'gemini';
  }

  /**
   * The model every call takes unless it overrides.
   *
   * ⚠️ Anthropic gets NO default (see anthropic.provider.ts) — an unset
   * LLM_MODEL on that path reports an empty string here rather than a
   * plausible-looking snapshot id that may have been retired.
   */
  get model(): string {
    if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
    return this.provider === 'gemini' ? DEFAULT_GEMINI_MODEL : '';
  }

  /** A key is present for the live provider. Call sites gate on this. */
  isConfigured(): boolean {
    return this.active().isConfigured();
  }

  private active(): LlmProviderClient {
    return this.provider === 'anthropic' ? this.anthropic : this.gemini;
  }

  // ══════════════════════════════════════════════════════════════════
  // COMPLETE
  // ══════════════════════════════════════════════════════════════════
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const provider = this.active();
    const model = req.model ?? this.model;
    const startedAt = Date.now();

    if (!provider.isConfigured()) {
      const err = new LlmError(
        'not_configured',
        `${this.provider} is not configured — no API key${this.provider === 'anthropic' ? ' or LLM_MODEL' : ''}`,
      );
      this.record(req, model, startedAt, undefined, err);
      throw err;
    }

    try {
      const res = await provider.complete({ ...req, model });
      this.record(req, res.model, startedAt, res.usage);
      return res;
    } catch (err) {
      this.record(req, model, startedAt, undefined, err);
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // STREAM
  // ══════════════════════════════════════════════════════════════════
  async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    const provider = this.active();
    const model = req.model ?? this.model;
    const startedAt = Date.now();

    if (!provider.isConfigured()) {
      const err = new LlmError(
        'not_configured',
        `${this.provider} is not configured — no API key${this.provider === 'anthropic' ? ' or LLM_MODEL' : ''}`,
      );
      this.record(req, model, startedAt, undefined, err);
      throw err;
    }

    // ⚠️ The ledger row is written when the stream ENDS, not when it opens —
    // usage is only known at the 'done' event. A stream the caller abandons
    // half way therefore books through the catch below, so an abandoned
    // stream is still counted rather than silently free.
    try {
      for await (const event of provider.stream({ ...req, model })) {
        if (event.type === 'done') {
          this.record(req, event.response.model, startedAt, event.response.usage);
        }
        yield event;
      }
    } catch (err) {
      this.record(req, model, startedAt, undefined, err);
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PING — used by /admin/health
  // ══════════════════════════════════════════════════════════════════
  /**
   * Smallest real call the provider will take: one token out, two words in.
   * Costs well under a thousandth of a cent and proves the whole path —
   * key, network, model id, quota — in a way a HEAD on the host never did.
   *
   * NEVER THROWS. It is a health probe; a probe that throws takes down the
   * page whose job is to tell you something is down.
   */
  async ping(): Promise<LlmPing> {
    const startedAt = Date.now();
    const provider = this.provider;
    const model = this.model;

    if (!this.isConfigured()) {
      return {
        ok: false,
        provider,
        model,
        error: `${provider} is not configured`,
        latencyMs: 0,
      };
    }

    try {
      await this.complete({
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1,
        purpose: 'health.ping',
        // No reasoning on a liveness probe — a thinking budget would spend
        // tokens and seconds proving nothing the first token has not proved.
        thinking: { budgetTokens: 0 },
        timeoutMs: 10_000,
      });
      return { ok: true, provider, model, latencyMs: Date.now() - startedAt };
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'unknown';
      return {
        ok: false,
        provider,
        model,
        error: `${code}: ${(err as Error).message}`,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // LEDGER
  // ══════════════════════════════════════════════════════════════════
  /**
   * Log the call and write its ledger row.
   *
   * ⚠️ FIRE AND FORGET, DELIBERATELY. The insert is not awaited and its
   * rejection is caught and logged. A model call must never fail, and never
   * wait, because its bookkeeping did — a lost row costs a point on a spend
   * chart, a thrown row costs a member their answer.
   */
  private record(
    req: LlmRequest,
    model: string,
    startedAt: number,
    usage?: LlmUsage,
    error?: unknown,
  ): void {
    const latencyMs = Date.now() - startedAt;
    const ok = !error;
    const errorCode =
      error instanceof LlmError
        ? error.code
        : error
          ? 'unknown'
          : null;

    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cachedInputTokens = usage?.cachedInputTokens ?? 0;
    const thinkingTokens = usage?.thinkingTokens ?? 0;
    const cost = costUsdMicros({
      model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
    });

    // One line per call. Purpose, model, tokens, ms — never content.
    //
    // ⚠️ A GROUNDED CALL SAYS SO, AND SAYS NOTHING ELSE. A provider-hosted
    // search costs more and takes longer than the same call without one, so
    // "which of these ran a search" has to be answerable from the logs. What
    // may NOT appear is the queries: they are built from the prompt, and this
    // platform's prompts carry a member's suburb, their firearm and what they
    // are applying for. `webSearchQueries` comes back on the response and is
    // deliberately never read here.
    const grounded = req.grounding?.web ? ' grounded' : '';
    const summary = `llm ${req.purpose} ${this.provider}/${model} in=${inputTokens} out=${outputTokens} ${latencyMs}ms${grounded}`;
    if (ok) this.logger.log(summary);
    else this.logger.warn(`${summary} FAILED ${String(errorCode)}`);

    void this.prisma.aiUsage
      .create({
        data: {
          provider: this.provider,
          model,
          purpose: req.purpose,
          inputTokens,
          outputTokens,
          cachedInputTokens,
          thinkingTokens,
          costUsdMicros: cost,
          latencyMs,
          ok,
          errorCode,
        },
      })
      .catch((e: unknown) => {
        this.logger.error(
          `AiUsage ledger write failed (call itself was unaffected): ${(e as Error).message}`,
        );
      });
  }
}
