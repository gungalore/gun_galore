// ────────────────────────────────────────────────────────────────────
// ANTHROPIC — ROLLBACK INSURANCE, NOT THE LIVE PATH.
//
// Gemini is the provider (operator, 2026-09-07). This file exists so that
// `LLM_PROVIDER=anthropic` in the env, plus a reload, puts the platform back
// on the rail it ran on for a year — no deploy, no code change, no fifteen
// services to revert. It is kept THIN on purpose: it maps the same contract
// onto messages.create/stream and does nothing clever.
//
// ⚠️ NO DEFAULT MODEL. Every Anthropic model id this codebase ever used is a
// pinned dated snapshot, and snapshots retire. Guessing one here would give
// an operator reaching for the rollback lever a 404 from a model that no
// longer exists, in the middle of whatever incident made them reach for it.
// So LLM_MODEL is REQUIRED when LLM_PROVIDER=anthropic: unset means
// isConfigured() is false and the boot warning says exactly that.
// ────────────────────────────────────────────────────────────────────

import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { LlmProviderClient } from './provider.interface';
import {
  LlmError,
  type LlmMessage,
  type LlmPart,
  type LlmRequest,
  type LlmResponse,
  type LlmStopReason,
  type LlmStreamEvent,
  type LlmToolCall,
  type LlmUsage,
} from './llm.types';

const DEFAULT_TIMEOUT_MS = 60_000;

export class AnthropicProvider implements LlmProviderClient {
  readonly name = 'anthropic' as const;
  private readonly logger = new Logger(AnthropicProvider.name);
  private client: Anthropic | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY && process.env.LLM_MODEL);
  }

  defaultModel(): string {
    const model = process.env.LLM_MODEL;
    if (!model) {
      throw new LlmError(
        'not_configured',
        'LLM_PROVIDER=anthropic requires LLM_MODEL — no model is guessed',
      );
    }
    return model;
  }

  private sdk(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LlmError('not_configured', 'ANTHROPIC_API_KEY is not set');
    }
    if (!this.client) this.client = new Anthropic({ apiKey, maxRetries: 2 });
    return this.client;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const model = req.model ?? this.defaultModel();
    try {
      const msg = await this.sdk().messages.create(
        this.buildParams(req, model) as never,
        {
          timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          signal: req.signal,
        },
      );
      return this.toResponse(msg as never, model);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    const model = req.model ?? this.defaultModel();
    let final: unknown;
    try {
      const stream = this.sdk().messages.stream(
        this.buildParams(req, model) as never,
        { timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS, signal: req.signal },
      );
      for await (const event of stream) {
        const e = event as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (
          e.type === 'content_block_delta' &&
          e.delta?.type === 'text_delta' &&
          e.delta.text
        ) {
          yield { type: 'text', delta: e.delta.text };
        }
      }
      final = await stream.finalMessage();
    } catch (err) {
      throw this.mapError(err);
    }
    yield { type: 'done', response: this.toResponse(final as never, model) };
  }

  // ══════════════════════════════════════════════════════════════════
  // REQUEST MAPPING
  // ══════════════════════════════════════════════════════════════════
  private buildParams(req: LlmRequest, model: string): Record<string, unknown> {
    const params: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens,
      messages: req.messages.map((m) => toAnthropicMessage(m)),
    };
    if (req.system) params.system = req.system;
    // ⚠️ NO SAMPLING PARAMETERS, EVER. temperature / top_p / top_k were
    // removed from the Anthropic API on Opus 4.7+ and Sonnet 5, and sending
    // one returns 400 "`temperature` is deprecated for this model". On
    // 2026-08-19 that 400 was caught and logged at warn level on four call
    // sites, so document extraction prefilled nothing, the motivation gate
    // failed closed and KYC had been failing for two days — all silently,
    // because a fail-soft path and a working path that finds nothing look
    // identical. The old grep-based spec that guarded this is retired; this
    // is now the ONE place an Anthropic request is built, so the guard lives
    // here and its spec asserts the parameter is dropped, not passed.
    if (req.temperature !== undefined) {
      this.logger.warn(
        `temperature ${req.temperature} dropped for ${req.purpose}: the Anthropic rail does not accept sampling parameters`,
      );
    }

    // ⚠️ THE SERVER TOOL GOES IN THE SAME ARRAY AS OUR OWN, and that is the
    // whole reason the rollback path is more permissive than the live one:
    // Anthropic has no structural collision between a hosted search and
    // function declarations, so a grounded turn may also carry tools. Gemini
    // 2.5 rejects both pairings (see gemini.provider.ts), so a CALL SITE must
    // still be written as if they were forbidden — this branch exists so the
    // rollback lever does not silently drop the search, not so anyone can
    // depend on the extra freedom.
    //
    // `max_uses: 1` is the figure the two surviving call sites used before the
    // provider move (price-estimate's retail anchor). Ask GG's forum layer ran
    // at 2; one is the conservative number and grounding is seasoning at every
    // site, so a second search is never worth a second round trip's latency.
    const serverTools: Array<Record<string, unknown>> = [];
    if (req.grounding?.web) {
      serverTools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 1,
      });
    }

    if (req.tools?.length || serverTools.length) {
      params.tools = [
        ...(req.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        ...serverTools,
      ];
      // ⚠️ toolChoice DESCRIBES THE CALLER'S OWN TOOLS, so it is only mapped
      // when there are some. A `{ name }` choice with nothing but the server
      // tool in the array names a tool that is not there — a 400 — and a
      // 'none' would switch off the search the caller just asked for.
      const choice = req.tools?.length ? req.toolChoice : undefined;
      if (choice === 'none') params.tool_choice = { type: 'none' };
      else if (typeof choice === 'object' && choice?.name) {
        params.tool_choice = { type: 'tool', name: choice.name };
      } else params.tool_choice = { type: 'auto' };
    }

    // ⚠️ Anthropic has no responseSchema. JSON mode is a PROMPT contract
    // there, and forcing it through a single tool would collide with a
    // caller's own tools. So `json` becomes a system suffix — weaker than
    // Gemini's guarantee, and honest about it. Only the rollback path is
    // ever affected, and the call sites all parse defensively already.
    if (req.json) {
      const instruction = req.json.schema
        ? `Reply with JSON only, matching this schema: ${JSON.stringify(req.json.schema)}`
        : 'Reply with a single valid JSON document and no other text.';
      params.system = req.system
        ? `${req.system}\n\n${instruction}`
        : instruction;
    }

    params.thinking = thinkingParam(model, req.thinking?.budgetTokens);
    return params;
  }

  // ══════════════════════════════════════════════════════════════════
  // RESPONSE MAPPING
  // ══════════════════════════════════════════════════════════════════
  private toResponse(
    msg: {
      content?: Array<Record<string, unknown>>;
      stop_reason?: string | null;
      usage?: Record<string, number | undefined>;
    },
    model: string,
  ): LlmResponse {
    const parts = toLlmPartsFromAnthropic(msg.content ?? []);
    const toolCalls = parts.filter(
      (p): p is Extract<LlmPart, { type: 'tool_call' }> => p.type === 'tool_call',
    );

    if (msg.stop_reason === 'refusal') {
      this.logger.warn('Anthropic refused the request (stop_reason=refusal)');
    }

    return {
      text: parts
        .filter((p): p is Extract<LlmPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join(''),
      parts,
      toolCalls: toolCalls.map(
        (p): LlmToolCall => ({ id: p.id, name: p.name, input: p.input }),
      ),
      stopReason: mapAnthropicStopReason(msg.stop_reason ?? undefined),
      usage: mapAnthropicUsage(msg.usage),
      model,
      provider: 'anthropic',
      assistantMessage: { role: 'assistant', content: parts },
      ...readAnthropicGrounding(msg.content ?? []),
    };
  }

  private mapError(err: unknown): LlmError {
    if (err instanceof LlmError) return err;
    const e = err as { name?: string; message?: string; status?: number; headers?: Record<string, string> };
    const message = e?.message ?? String(err);
    const status = e?.status;

    if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || /timed? ?out/i.test(message)) {
      return new LlmError('timeout', message, status, undefined, err);
    }
    if (status === 429) {
      const header = e?.headers?.['retry-after'];
      const seconds = header ? Number(header) : NaN;
      return new LlmError(
        'rate_limited',
        message,
        429,
        Number.isFinite(seconds) ? seconds * 1000 : undefined,
        err,
      );
    }
    if (status === 400) return new LlmError('bad_request', message, 400, undefined, err);
    if (status === 401 || status === 403) {
      return new LlmError('not_configured', message, status, undefined, err);
    }
    if (status === 529 || status === 503 || (status && status >= 500)) {
      return new LlmError('overloaded', message, status, undefined, err);
    }
    if (/fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(message)) {
      return new LlmError('network', message, undefined, undefined, err);
    }
    return new LlmError('unknown', message, status, undefined, err);
  }
}

// ════════════════════════════════════════════════════════════════════
// PURE MAPPERS
// ════════════════════════════════════════════════════════════════════

/**
 * The `thinking` parameter for a model, from a budget.
 *
 * PURE. Spec — and every branch of it is paid for by a real 400:
 *  - Anthropic's 5-series models (an 'opus-5' or 'sonnet-5' in the id)
 *    REJECT `budget_tokens` outright. They take `{type:'adaptive'}` or
 *    `{type:'disabled'}`, which is what motivation-claude.service.ts
 *    already does today at lines 249 and 502, with the comment
 *    "⚠️ NEVER budget_tokens — Opus 5 rejects it with a 400."
 *  - So on a 5-series model: budget 0 → disabled, anything else →
 *    adaptive. The number is discarded because there is nowhere to put it.
 *  - On every other model: budget > 0 → `{type:'enabled', budget_tokens}`,
 *    budget 0 → `{type:'disabled'}`.
 *  - An UNSET budget returns undefined, leaving the model's own default —
 *    the contract says "omit for the provider default" and inventing one
 *    here would silently change what every unmigrated caller gets.
 */
export function thinkingParam(
  model: string,
  budgetTokens: number | undefined,
): Record<string, unknown> | undefined {
  if (budgetTokens === undefined) return undefined;
  const isFiveSeries = /opus-5|sonnet-5/.test(model);
  if (isFiveSeries) {
    return budgetTokens > 0 ? { type: 'adaptive' } : { type: 'disabled' };
  }
  return budgetTokens > 0
    ? { type: 'enabled', budget_tokens: budgetTokens }
    : { type: 'disabled' };
}

/**
 * One LlmMessage → one Anthropic message.
 *
 * Spec: roles map straight through. text → text block; image/document →
 * `{type, source:{type:'base64', media_type, data}}` — note Anthropic's
 * key is `media_type` where Gemini's is `mimeType`, and a `document` block
 * is its own type rather than inline data with a PDF mime.
 * tool_call → `tool_use {id, name, input}`; tool_result →
 * `tool_result {tool_use_id, content, is_error}`. ⚠️ Anthropic keys a
 * result by ID (Gemini by name), so `toolCallId` is the load-bearing field
 * on this side and `name` is the load-bearing one on the other. The
 * contract carries both for exactly this reason.
 */
export function toAnthropicMessage(message: LlmMessage): Record<string, unknown> {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content.map(toAnthropicBlock),
  };
}

export function toAnthropicBlock(part: LlmPart): Record<string, unknown> {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
      return {
        type: 'image',
        source: { type: 'base64', media_type: part.mimeType, data: part.data },
      };
    case 'document':
      return {
        type: 'document',
        source: { type: 'base64', media_type: part.mimeType, data: part.data },
      };
    case 'tool_call':
      return {
        type: 'tool_use',
        id: part.id,
        name: part.name,
        input: part.input,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: part.toolCallId,
        content:
          typeof part.content === 'string'
            ? part.content
            : part.content.map(toAnthropicBlock),
        ...(part.isError ? { is_error: true } : {}),
      };
  }
}

/**
 * Anthropic content blocks → contract parts.
 *
 * Spec: `thinking` and `redacted_thinking` blocks are DROPPED for the same
 * reason Gemini's thought parts are — billed, but not the answer. Unknown
 * block types are ignored rather than throwing, so a new block type on
 * Anthropic's side degrades to missing text, never to a crash.
 */
export function toLlmPartsFromAnthropic(
  blocks: Array<Record<string, unknown>>,
): LlmPart[] {
  const out: LlmPart[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') {
      out.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use') {
      out.push({
        type: 'tool_call',
        id: String(b.id ?? ''),
        name: String(b.name ?? 'unknown'),
        input: (b.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  return out;
}

/**
 * Anthropic's web-search blocks → the contract's grounding fields.
 *
 * Spec — three block shapes carry the evidence, and all three are read
 * because any one of them can be the only one present:
 *  - `server_tool_use` with `name: 'web_search'` → its `input.query` is what
 *    the model asked, and is the ONLY place the queries appear.
 *  - `web_search_tool_result` → `content[]` of `web_search_result` entries
 *    with `url` and `title`. This is the authoritative source list: every
 *    page the provider opened, whether or not a sentence ended up citing it.
 *  - a `text` block's own `citations[]` of `web_search_result_location`,
 *    which is what the model actually attributed a sentence to. Read second,
 *    so a page cited but somehow absent from the result block still surfaces.
 *
 * Returns `{}` when none of them appear, so an ungrounded rollback call is
 * indistinguishable from an ungrounded Gemini one. ⚠️ Deduped by url with the
 * first title winning, exactly as readGrounding does on the other side: the
 * two providers must hand a call site the same shape or the call site starts
 * caring which one answered, which is the coupling the adapter removes.
 *
 * ⚠️ THE SERVER BLOCKS ARE DROPPED FROM `parts`, deliberately —
 * toLlmPartsFromAnthropic ignores every block type it does not know. So an
 * `assistantMessage` from a grounded turn cannot be echoed back into a
 * continuing Anthropic conversation without the API objecting that a
 * server_tool_use has no result. Nothing does that: grounding resolves inside
 * one turn at every call site, and the contract has no way to ask for a
 * second. If one ever needs it, the fix is a part type, not a patch here.
 */
export function readAnthropicGrounding(
  blocks: Array<Record<string, unknown>>,
): {
  groundingSources?: Array<{ uri: string; title?: string }>;
  webSearchQueries?: string[];
} {
  const byUri = new Map<string, { uri: string; title?: string }>();
  const queries = new Set<string>();
  let sawSearch = false;

  const addSource = (entry: unknown) => {
    const e = entry as { url?: unknown; title?: unknown };
    const uri = typeof e?.url === 'string' ? e.url : '';
    if (!uri || byUri.has(uri)) return;
    byUri.set(uri, {
      uri,
      ...(typeof e.title === 'string' && e.title ? { title: e.title } : {}),
    });
  };

  for (const b of blocks) {
    if (b.type === 'server_tool_use' && b.name === 'web_search') {
      sawSearch = true;
      const query = (b.input as { query?: unknown } | undefined)?.query;
      if (typeof query === 'string' && query) queries.add(query);
    } else if (b.type === 'web_search_tool_result') {
      sawSearch = true;
      const content = b.content;
      if (Array.isArray(content)) content.forEach(addSource);
    } else if (b.type === 'text' && Array.isArray(b.citations)) {
      for (const c of b.citations as Array<Record<string, unknown>>) {
        if (c?.type !== 'web_search_result_location') continue;
        sawSearch = true;
        addSource(c);
      }
    }
  }

  if (!sawSearch) return {};
  return {
    groundingSources: [...byUri.values()],
    ...(queries.size > 0 ? { webSearchQueries: [...queries] } : {}),
  };
}

/**
 * Anthropic stop_reason → the contract's stopReason.
 *
 * Spec: end_turn/stop_sequence → 'end'; max_tokens → 'max_tokens';
 * tool_use → 'tool_use'; refusal → 'safety' (it is the same event as a
 * Gemini SAFETY finish: the model ran and declined); anything else,
 * including a null on an interrupted stream → 'other'.
 */
export function mapAnthropicStopReason(
  reason: string | undefined,
): LlmStopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'max_tokens':
      return 'max_tokens';
    case 'tool_use':
      return 'tool_use';
    case 'refusal':
      return 'safety';
    default:
      return 'other';
  }
}

/**
 * Anthropic usage → LlmUsage.
 *
 * Spec: ⚠️ `input_tokens` EXCLUDES cache reads on Anthropic, where Gemini's
 * promptTokenCount INCLUDES them. The cache read is added in here so that
 * `inputTokens` means the same thing on both providers — the ledger has one
 * column and it cannot mean two things. Anthropic rows are priced at 0
 * anyway (see llm.pricing.ts), so this matters for reading token counts,
 * not for money.
 */
export function mapAnthropicUsage(
  usage: Record<string, number | undefined> | undefined,
): LlmUsage {
  const cached = usage?.cache_read_input_tokens ?? 0;
  return {
    inputTokens: (usage?.input_tokens ?? 0) + cached,
    outputTokens: usage?.output_tokens ?? 0,
    cachedInputTokens: cached,
    thinkingTokens: 0,
  };
}
