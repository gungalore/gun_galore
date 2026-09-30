// ────────────────────────────────────────────────────────────────────
// THE ADAPTER. Every model call on the platform goes through here.
//
// Operator, 2026-09-07: "we are switching from claude API to gemini 2.5
// flash-lite api for everything on the website." Then, 2026-09-26: "Deepseek
// as the default AI and when we get a pdf upload we send it to gemini."
//
// ⚠️ SO THE DEFAULT IS NOW WHATEVER `LLM_PROVIDER` SAYS, AND IT IS SET TO
// deepseek. Three levers sit on top of it, in this order:
//   1. `LLM_PROVIDER_<PURPOSE>` — pins ONE purpose (see providerFor).
//   2. `LLM_PROVIDER` — the platform default.
//   3. The document rescue (see `serve`) — a PDF cannot be read by DeepSeek,
//      so a document-bearing request goes to Gemini whatever 1 and 2 say.
// LLM_PROVIDER=gemini or anthropic remains the rollback lever.
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
import { DeepSeekProvider } from './deepseek.provider';
import { GeminiProvider } from './gemini.provider';
import { JevClient } from './jev.client';
import { costUsdMicros } from './llm.pricing';
import type { LlmProviderClient } from './provider.interface';
import {
  LlmError,
  type LlmPing,
  type LlmImageRequest,
  type LlmImageResponse,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamEvent,
  type LlmUsage,
  type JevDecideRequest,
  type JevDecideResponse,
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
export const LLM_DEEPSEEK_PROVIDER = Symbol('LLM_DEEPSEEK_PROVIDER');
export const LLM_JEV_CLIENT = Symbol('LLM_JEV_CLIENT');

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly gemini: LlmProviderClient;
  private readonly anthropic: LlmProviderClient;
  private readonly deepseek: LlmProviderClient;
  private readonly jev: JevClient;

  constructor(
    private readonly prisma: PrismaService,
    // Overridable for the unit tests, which drive a fake provider rather
    // than a live key. Production resolves both to undefined and builds the
    // real ones — see the token comment above.
    @Optional() @Inject(LLM_GEMINI_PROVIDER) gemini?: LlmProviderClient,
    @Optional() @Inject(LLM_ANTHROPIC_PROVIDER) anthropic?: LlmProviderClient,
    @Optional() @Inject(LLM_DEEPSEEK_PROVIDER) deepseek?: LlmProviderClient,
    @Optional() @Inject(LLM_JEV_CLIENT) jev?: JevClient,
  ) {
    this.gemini = gemini ?? new GeminiProvider();
    this.anthropic = anthropic ?? new AnthropicProvider();
    this.deepseek = deepseek ?? new DeepSeekProvider();
    this.jev = jev ?? new JevClient();
  }

  /**
   * Which provider is live, from LLM_PROVIDER.
   *
   * ⚠️ THE LITERAL BELOW IS THE LAST-RESORT DEFAULT ONLY. Production sets
   * `LLM_PROVIDER=deepseek`; the `'gemini'` here is what an unset env means,
   * kept so a box mid-configuration still has a working provider rather than
   * an empty one. Do not read this line as "the platform runs on Gemini" —
   * `providerFor` is the routing, and `serve` can override even that for a
   * PDF.
   */
  get provider(): LlmProvider {
    return process.env.LLM_PROVIDER === 'anthropic'
      ? 'anthropic'
      : process.env.LLM_PROVIDER === 'deepseek'
        ? 'deepseek'
        : 'gemini';
  }

  /**
   * The provider that serves ONE purpose.
   *
   * ⚠️ PER-PURPOSE ROUTING IS WHY THIS EXISTS, AND IT NOW CARRIES THE
   * GEMINI PINS. The platform default is DeepSeek (see the header), which
   * cannot take PDF/document parts, `tools`, hosted web search or an image
   * generation, and whose `stream` emits a single event — so every purpose
   * that needs one of those is pinned back to Gemini here, by env.
   *
   * The override is an env var derived from the purpose:
   * `kyc.face-match` → `LLM_PROVIDER_KYC_FACE_MATCH`. Unset falls back to the
   * global `LLM_PROVIDER`, so the default never changes.
   *
   * To move a purpose back, set `LLM_PROVIDER_<PURPOSE>=deepseek` and reload.
   * Same "env + reload, no deploy" lever as `LLM_PROVIDER=anthropic`.
   */
  private providerFor(purpose: string): LlmProviderClient {
    const key = `LLM_PROVIDER_${purpose.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const explicit = process.env[key];
    if (explicit === 'anthropic') return this.anthropic;
    if (explicit === 'deepseek') return this.deepseek;
    if (explicit === 'gemini') return this.gemini;
    // ⚠️ VIDEO IS GEMINI-ONLY ON THIS PLATFORM. A video moderation call must
    // not fall through to DeepSeek (whose vision path rejects video) just
    // because a global LLM_PROVIDER switch is set. An explicit per-purpose env
    // var still wins, above.
    if (purpose === 'feed.moderation.video') return this.gemini;
    // ⚠️ IMAGE SCREENING AND THE ESCALATION SECOND OPINION ARE DEEPSEEK-ONLY.
    // Operator decision 2026-10-01: every image (listing, feed, uploaded
    // document page) is screened by DeepSeek Flash, and the 60–80 % ladder
    // escalates to it. `deepseek-flash` is the only DeepSeek model with
    // vision. Pinned here rather than left to LLM_PROVIDER because a box with
    // no LLM_PROVIDER set would otherwise send these to Gemini — the exact
    // opposite of the decision. An explicit per-purpose env var still wins.
    if (purpose === 'moderation.escalation') return this.deepseek;
    if (purpose.endsWith('.images')) return this.deepseek;
    const name = process.env.LLM_PROVIDER ?? 'gemini';
    if (name === 'anthropic') return this.anthropic;
    if (name === 'deepseek') return this.deepseek;
    return this.gemini;
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

  /** A key is present for the provider that serves `purpose`. */
  isConfiguredFor(purpose: string): boolean {
    return this.providerFor(purpose).isConfigured();
  }

  /**
   * Which provider serves `purpose` — the public face of `providerFor`.
   *
   * ⚠️ THIS EXISTS SO A CALLER CAN BRANCH ON THE PROVIDER WITHOUT CHOOSING ONE.
   * A purpose may be pinned to DeepSeek by env, or fall back to the platform
   * default. A call site that must pass a provider-SPECIFIC model argument
   * asks here first — pinning `deepseek-flash` unconditionally is how a vision
   * call reaches Gemini and 404s on a model it does not host. Callers still
   * never construct a client or name the live provider themselves; this is
   * the routing decision, read back.
   *
   * ⚠️ IT REPORTS THE PIN, NOT THE DOCUMENT RESCUE. `serve()` can still send a
   * document-bearing request to Gemini after this has said `deepseek`, so a
   * caller must not read a `deepseek` answer as "a PDF will be accepted here".
   * Pass no document on that road, or let the rescue fire without consulting
   * this.
   */
  providerNameFor(purpose: string): LlmProvider {
    return this.providerFor(purpose).name;
  }

  private active(): LlmProviderClient {
    return this.provider === 'anthropic'
      ? this.anthropic
      : this.provider === 'deepseek'
        ? this.deepseek
        : this.gemini;
  }

  /**
   * Does this request carry something only a document-reading provider can
   * take — a `document` part, or a PDF sent as an image part?
   *
   * ⚠️ BOTH SHAPES COUNT. A caller that holds a PDF has two ways to send it
   * (`{type:'document'}` and `{type:'image', mimeType:'application/pdf'}`),
   * and the callers in this repo use both. Checking only one would let the
   * other reach DeepSeek and fail as `unsupported`.
   */
  private carriesDocument(req: LlmRequest): boolean {
    for (const m of req.messages) {
      if (typeof m.content === 'string') continue;
      for (const part of m.content) {
        if (part.type === 'document') return true;
        if (part.type === 'image' && part.mimeType === 'application/pdf') {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * The provider that actually serves this call.
   *
   * ⚠️ THE PER-PURPOSE PIN IS THE ROUTING, AND THIS ONLY RESCUES IT. A
   * purpose pinned (or defaulted) to a provider with no document support
   * cannot read a PDF at all — DeepSeek throws `unsupported` in mapContent —
   * so a document-bearing request goes to Gemini instead of failing. That
   * rescue is deliberately narrow: it fires only when the pin's provider
   * DECLARES it cannot take a document, so an explicit gemini/anthropic pin
   * is left exactly where it was put.
   *
   * ⚠️ AND IT IS NEVER SILENT. The ledger already names the serving provider
   * (`record` takes it from the response), but an operator reading a config
   * file would see `LLM_PROVIDER_X=deepseek` and believe it. The warn below is
   * what says which calls are not running where they were pointed.
   */
  private serve(req: LlmRequest): LlmProviderClient {
    const wanted = this.providerFor(req.purpose);
    if (wanted.acceptsDocuments || !this.carriesDocument(req)) return wanted;
    this.logger.warn(
      `llm ${req.purpose} carries a PDF but is pinned to ${wanted.name}, ` +
        `which cannot read one — served by gemini instead`,
    );
    return this.gemini;
  }

  // ══════════════════════════════════════════════════════════════════
  // COMPLETE
  // ══════════════════════════════════════════════════════════════════
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const provider = this.serve(req);
    const model = req.model ?? provider.defaultModel();
    const startedAt = Date.now();

    if (!provider.isConfigured()) {
      const err = new LlmError(
        'not_configured',
        `${provider.name} is not configured — no API key${provider.name === 'anthropic' ? ' or LLM_MODEL' : ''}`,
      );
      this.record(req, provider.name, model, startedAt, undefined, err);
      throw err;
    }

    try {
      const res = await provider.complete({ ...req, model });
      this.record(req, res.provider, res.model, startedAt, res.usage);
      return res;
    } catch (err) {
      this.record(req, provider.name, model, startedAt, undefined, err);
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // STREAM
  // ══════════════════════════════════════════════════════════════════
  async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    const provider = this.serve(req);
    const model = req.model ?? provider.defaultModel();
    const startedAt = Date.now();

    if (!provider.isConfigured()) {
      const err = new LlmError(
        'not_configured',
        `${provider.name} is not configured — no API key${provider.name === 'anthropic' ? ' or LLM_MODEL' : ''}`,
      );
      this.record(req, provider.name, model, startedAt, undefined, err);
      throw err;
    }

    // ⚠️ The ledger row is written when the stream ENDS, not when it opens —
    // usage is only known at the 'done' event. A stream the caller abandons
    // half way therefore books through the catch below, so an abandoned
    // stream is still counted rather than silently free.
    try {
      for await (const event of provider.stream({ ...req, model })) {
        if (event.type === 'done') {
          this.record(req, event.response.provider, event.response.model, startedAt, event.response.usage);
        }
        yield event;
      }
    } catch (err) {
      this.record(req, provider.name, model, startedAt, undefined, err);
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // IMAGE
  // ══════════════════════════════════════════════════════════════════
  /**
   * Make a picture, through the same door as everything else.
   *
   * ⚠️ THE LEDGER IS THE WHOLE REASON THIS IS NOT A DIRECT CALL. A plate is
   * about three and a half US cents against a text call's fraction of one, so
   * image spend that bypassed AiUsage would be the single biggest thing
   * /admin/credits could not see. Same row, same purpose column, priced at the
   * image rate — see llm.pricing.
   *
   * ⚠️ AND THE PROVIDER MAY SIMPLY NOT DRAW. The Anthropic path is rollback
   * insurance with no image model at all, so this refuses BEFORE spending
   * anything and names the provider, rather than failing somewhere inside a
   * mapper with a shape error.
   */
  async generateImage(req: LlmImageRequest): Promise<LlmImageResponse> {
    const wanted = this.providerFor(req.purpose);
    // ⚠️ SAME RESCUE AS A PDF, FOR THE SAME REASON. DeepSeek defines no
    // generateImage at all, so a purpose that defaults to it throws
    // `unsupported` rather than drawing. Pinning the purpose is the fix; this
    // is the backstop for a purpose nobody pinned, and it is announced for
    // the same reason the document rescue is — a pinned env must not read as
    // truth in the logs.
    const provider = wanted.generateImage ? wanted : this.gemini;
    if (provider !== wanted) {
      this.logger.warn(
        `llm ${req.purpose} asks for an image but is pinned to ${wanted.name}, ` +
          `which has no image model — served by gemini instead`,
      );
    }
    const startedAt = Date.now();
    const model =
      req.model ?? provider.defaultImageModel?.() ?? provider.defaultModel();

    if (!provider.generateImage) {
      const err = new LlmError(
        'unsupported',
        `${provider.name} has no image model on this platform`,
      );
      this.record(req, provider.name, model, startedAt, undefined, err);
      throw err;
    }

    if (!provider.isConfigured()) {
      const err = new LlmError(
        'not_configured',
        `${provider.name} is not configured — no API key`,
      );
      this.record(req, provider.name, model, startedAt, undefined, err);
      throw err;
    }

    try {
      const res = await provider.generateImage({ ...req, model });
      this.record(req, res.provider, res.model, startedAt, res.usage);
      return res;
    } catch (err) {
      this.record(req, provider.name, model, startedAt, undefined, err);
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // DECIDE — a typed question to Jev (TypeSafe System One)
  // ══════════════════════════════════════════════════════════════════
  /**
   * Ask Jev a map of typed questions and return the typed answers.
   *
   * ⚠️ THIS IS THE DOOR, NOT THE CLIENT. Call sites never construct a
   * JevClient (repo rule: every model call routes through LlmService), so the
   * ledger row, the log line and the model default all happen here exactly as
   * they do for a chat call. The summary line carries purpose/model/tokens/ms
   * ONLY — never the `state`, which for moderation is user text and may carry
   * a name or a number.
   *
   * ⚠️ THROWS ON EVERY FAILURE. `not_configured` with no key, and whatever
   * the client raises otherwise. The caller owns the fail-closed vs fail-open
   * decision; this method only books the call and rethrows.
   */
  async decide(req: JevDecideRequest): Promise<JevDecideResponse> {
    const startedAt = Date.now();
    const model = req.model ?? process.env.JEV_MODEL ?? 'jev-latest';

    if (!this.jev.isConfigured()) {
      const err = new LlmError(
        'not_configured',
        'typesafe is not configured — no JEV_API_KEY',
      );
      this.record({ purpose: req.purpose }, 'typesafe', model, startedAt, undefined, err);
      throw err;
    }

    try {
      const res = await this.jev.decide(req);
      this.record(
        { purpose: req.purpose },
        'typesafe',
        res.model,
        startedAt,
        res.usage,
      );
      return res;
    } catch (err) {
      this.record({ purpose: req.purpose }, 'typesafe', model, startedAt, undefined, err);
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
    // ⚠️ STRUCTURAL, so an image call books into the same ledger. Only these
    // two fields were ever read off the request.
    req: { purpose: string; grounding?: { web?: boolean } },
    // The provider that ACTUALLY served this call — with per-purpose routing
    // this is not always `this.provider`, and the ledger must name the one
    // that spent the money.
    provider: LlmProvider,
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
    const imageTokens = usage?.imageTokens ?? 0;
    const cost = costUsdMicros({
      model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      imageTokens,
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
    const summary = `llm ${req.purpose} ${provider}/${model} in=${inputTokens} out=${outputTokens} ${latencyMs}ms${grounded}`;
    if (ok) this.logger.log(summary);
    else this.logger.warn(`${summary} FAILED ${String(errorCode)}`);

    void this.prisma.aiUsage
      .create({
        data: {
          provider,
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
