// ────────────────────────────────────────────────────────────────────
// GEMINI. The provider every model call on this platform goes through.
//
// Operator, 2026-09-07: "we are switching from claude API to gemini 2.5
// flash-lite api for everything on the website."
//
// ── WHAT WAS CONFIRMED, AND WHERE, ON 2026-09-07 ──────────────────────
// Read from ai.google.dev (docs/models, docs/pricing, api/generate-content,
// api/caching) and cross-checked against the installed @google/genai 2.21.0
// type declarations, which are the thing that actually has to compile:
//
//   • Model id: `gemini-2.5-flash-lite` (docs/models). Newer Flash-Lite
//     generations exist (3.1, 3.5); we pin 2.5 because that is what the
//     operator named. LLM_MODEL overrides without a deploy.
//   • Media: images and PDFs travel as `inlineData: { mimeType, data }`
//     with `data` base64 and NO `data:` prefix — the same shape the
//     LlmBlob contract already carries. ⚠️ Inline data is bounded by the
//     REQUEST size (~20 MB total per request); anything larger has to go
//     through the Files API, which nothing on this platform needs today
//     (a licence scan is a few hundred KB). If a call site ever sends a
//     large PDF, this is the limit it will hit.
//   • Structured output: `responseMimeType: 'application/json'` plus an
//     optional `responseSchema` (api/generate-content). The schema is an
//     OpenAPI-flavoured SUBSET — see gemini-schema.ts, which is where the
//     conversion and its reasoning live.
//   • Function calling: `tools: [{ functionDeclarations: [...] }]` and
//     `toolConfig.functionCallingConfig.{mode, allowedFunctionNames}`
//     with mode AUTO | ANY | NONE (FunctionCallingConfigMode in the SDK).
//     `allowedFunctionNames` is only honoured with mode ANY, which is why
//     a named toolChoice maps to ANY and not AUTO.
//   • Thinking: TWO DIALECTS, BY MODEL GENERATION. 2.5 takes
//     `thinkingConfig.thinkingBudget` (SDK comment: "0 is DISABLED. -1 is
//     AUTOMATIC"). ⚠️ EVERY 3.x MODEL REJECTS thinkingBudget WITH A BARE
//     400 "Request contains an invalid argument" — probed live on
//     gemini-3.5-flash-lite and gemini-flash-lite-latest on 2026-09-07 —
//     and takes `thinkingLevel` (low | medium | high; docs/thinking).
//     `thinkingConfigFor` below picks the dialect off the model id, so a
//     caller's `budgetTokens` means the same thing on either generation.
//   • Streaming: `models.generateContentStream()` yields the same
//     response object per chunk.
//   • System prompt: `config.systemInstruction`.
//   • Usage: `usageMetadata.{promptTokenCount, candidatesTokenCount,
//     cachedContentTokenCount, thoughtsTokenCount}`. ⚠️ The 2.21.0
//     declarations also carry a newer `responseTokenCount` alias for the
//     candidates count, so both are read — one of them is undefined and
//     silently reporting zero output tokens would corrupt the ledger.
//   • Safety: `safetySettings: [{ category, threshold }]`, thresholds
//     BLOCK_NONE and OFF both present in the enum. See the safety note
//     below for which we send and why.
//
// ── WEB GROUNDING, ADDED 2026-09-07, AND ITS TWO HARD RULES ───────────
// `tools: [{ googleSearch: {} }]` turns on Google Search grounding, and the
// answer comes back with `candidates[0].groundingMetadata` carrying
// `groundingChunks[].web.{uri,title}` and `webSearchQueries[]` — all four
// names read off the installed 2.21.0 declarations (GroundingMetadata,
// GroundingChunk, GroundingChunkWeb), not off a docs page. The live docs
// have moved on to the Interactions API, which describes a DIFFERENT shape
// (`google_search_call` / `url_citation`) belonging to a different endpoint;
// the declarations are what has to compile, so the declarations win.
//
//   1. ⚠️ IT DOES NOT COMBINE WITH JSON MODE ON 2.5. Structured output
//      alongside a built-in tool is documented as "available only to Gemini 3
//      series models". On 2.5 the pairing does not fail loudly — the reported
//      symptom is a response whose `webSearchQueries` is populated (so a
//      search DID run, and was billed) while `groundingChunks` comes back
//      EMPTY. That is the worst possible outcome: a caller sees JSON, assumes
//      it was sourced, and can never show a source. So the adapter throws.
//   2. ⚠️ IT DOES NOT COMBINE WITH FUNCTION DECLARATIONS ON 2.5 either —
//      "the Gemini API doesn't support combining search tools (such as
//      googleSearch) with non-search tools (such as function calling) in the
//      same generateContent request". Both live in `config.tools`, so the
//      collision is structural as well as documented.
//
// Both are checked at the door for the same reason `json` + `tools` already
// is: the failure lands far from here and reads as a model problem.
//
// ⚠️ AND THERE IS NO ALLOWLIST. `GoogleSearch` in the declarations offers
// `excludeDomains` (an EXCLUDE list, and marked "not supported in Gemini
// API") and nothing else. A caller wanting preferred sources must ask for
// them in the system prompt and treat the answer as guidance, never as an
// enforced boundary.
// ────────────────────────────────────────────────────────────────────

import { Logger } from '@nestjs/common';
import {
  FunctionCallingConfigMode,
  ThinkingLevel,
  type ThinkingConfig,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
  type SafetySetting,
} from '@google/genai';
import { toGeminiSchema } from './gemini-schema';
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

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

/**
 * The thinking setting in the dialect the model generation understands.
 *
 * On 2.5 the budget is literal. On 3.x there is no budget, only a level, so
 * the budget is read as intent: 0 means "spend nothing on reasoning" and maps
 * to `low` (the floor the docs list; on flash-lite it produced no thinking
 * tokens at all when probed), anything up to 8k to `low`, up to 24k to
 * `medium`, beyond that `high`. A verdict call therefore stays a verdict call
 * on either generation, and the motivation writer's 4096 stays modest.
 */
export function thinkingConfigFor(
  model: string,
  budgetTokens: number,
): ThinkingConfig {
  // ⚠️ AN ALIAS WITH NO NUMBER (gemini-flash-lite-latest, gemini-pro-latest)
  // RESOLVES TO A 3.x MODEL TODAY and 400s on a budget — probed. Only an
  // explicit 2.x id gets the budget dialect.
  const generation = /^gemini-(\d+)/.exec(model);
  const major = generation ? Number(generation[1]) : 3;
  if (major >= 3) {
    if (budgetTokens <= 8_192) return { thinkingLevel: ThinkingLevel.LOW };
    if (budgetTokens <= 24_576) return { thinkingLevel: ThinkingLevel.MEDIUM };
    return { thinkingLevel: ThinkingLevel.HIGH };
  }
  return { thinkingBudget: budgetTokens };
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3; // one try plus two retries
const MAX_BACKOFF_MS = 8_000;

/**
 * ⚠️ SAFETY IS TURNED DOWN ON PURPOSE, AND THIS IS THE REASON.
 *
 * All Outdoor is a lawful, regulated South African firearms marketplace.
 * The model is asked to read firearm licences, grade Section 13
 * self-defence motivations, moderate hunting and self-defence listings,
 * and answer questions about ammunition components. Every one of those is
 * a legitimate, legally required business function — and every one of them
 * reads to a general-purpose content filter as HARM_CATEGORY_DANGEROUS_CONTENT.
 *
 * A filter that refuses to grade a self-defence motivation does not make
 * anyone safer. It fails a member who is applying for a licence they are
 * entitled to, and it fails them SILENTLY — a blocked response is an empty
 * response, so the feature degrades to "the AI said nothing" rather than
 * to an error anyone would investigate. That is why the block reason is
 * always logged and mapped to a real stopReason below, and never swallowed.
 *
 * So we ask for the most permissive threshold the API will accept per
 * category. BLOCK_NONE is documented as available on all four core
 * categories; OFF is not accepted everywhere and is deliberately not used,
 * because an unaccepted enum value is a 400 on every call. Google applies
 * its own non-negotiable floor regardless of what we send — these settings
 * lower OUR filter, they do not remove Google's, and content that is
 * genuinely prohibited is still blocked upstream.
 *
 * CIVIC_INTEGRITY is deprecated in the SDK enum and JAILBREAK is not
 * configurable, so neither is sent.
 */
const SAFETY_SETTINGS: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));

/** finishReason values that mean "the filter stopped this", not "done". */
const BLOCKING_FINISH_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'IMAGE_SAFETY',
]);

export class GeminiProvider implements LlmProviderClient {
  readonly name = 'gemini' as const;
  private readonly logger = new Logger(GeminiProvider.name);
  private client: GoogleGenAI | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  defaultModel(): string {
    return DEFAULT_MODEL;
  }

  // ⚠️ Lazily built, not built in a constructor: the key can be absent at
  // boot (local dev, a box mid-configuration) and a provider that throws
  // when it is constructed takes the whole Nest container down with it.
  private sdk(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new LlmError('not_configured', 'GEMINI_API_KEY is not set');
    }
    if (!this.client) this.client = new GoogleGenAI({ apiKey });
    return this.client;
  }

  // ══════════════════════════════════════════════════════════════════
  // COMPLETE
  // ══════════════════════════════════════════════════════════════════
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const model = req.model ?? DEFAULT_MODEL;
    const params = this.buildParams(req, model);

    const raw = await this.withRetry(req, (signal) =>
      this.sdk().models.generateContent({
        ...params,
        config: { ...params.config, abortSignal: signal },
      }),
    );

    return this.toResponse(raw, model);
  }

  // ══════════════════════════════════════════════════════════════════
  // STREAM
  // ══════════════════════════════════════════════════════════════════
  async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    const model = req.model ?? DEFAULT_MODEL;
    const params = this.buildParams(req, model);

    // ⚠️ The retry wrapper covers OPENING the stream only. Once deltas have
    // been yielded a retry would replay text the member has already seen,
    // so a mid-stream failure is surfaced, not retried.
    const iterator = await this.withRetry(req, (signal) =>
      this.sdk().models.generateContentStream({
        ...params,
        config: { ...params.config, abortSignal: signal },
      }),
    );

    const chunks: GenerateContentResponse[] = [];
    try {
      for await (const chunk of iterator) {
        chunks.push(chunk);
        const delta = textOf(firstCandidateParts(chunk));
        if (delta) yield { type: 'text', delta };
      }
    } catch (err) {
      throw this.mapError(err);
    }

    yield { type: 'done', response: this.aggregate(chunks, model) };
  }

  // ══════════════════════════════════════════════════════════════════
  // REQUEST MAPPING
  // ══════════════════════════════════════════════════════════════════
  private buildParams(
    req: LlmRequest,
    model: string,
  ): { model: string; contents: Content[]; config: GenerateContentConfig } {
    // ⚠️ Gemini cannot do both at once: a responseSchema and a tool schema
    // are the same slot in the request. Silently dropping one would make a
    // moderation verdict arrive as prose, or a tool loop never fire — both
    // fail far from here and look like a model problem. Throw at the door.
    if (req.json && req.tools?.length) {
      throw new LlmError(
        'bad_request',
        'Gemini cannot combine json output with tools — send one or the other',
      );
    }

    // ⚠️ See the grounding note in the header. Neither pairing is supported on
    // 2.5, and the json one FAILS QUIETLY (a search runs, is billed, and
    // groundingChunks comes back empty) — which would hand a caller sourced-
    // looking JSON with nothing to cite. Throw at the door instead.
    if (req.grounding?.web && req.json) {
      throw new LlmError(
        'bad_request',
        'Gemini 2.5 cannot combine web grounding with json output — ground in prose, then extract with a second json call',
      );
    }
    if (req.grounding?.web && req.tools?.length) {
      throw new LlmError(
        'bad_request',
        'Gemini 2.5 cannot combine web grounding with function declarations — run the grounded turn on its own',
      );
    }

    const config: GenerateContentConfig = {
      maxOutputTokens: req.maxTokens,
      safetySettings: SAFETY_SETTINGS,
    };

    if (req.system) config.systemInstruction = req.system;
    if (req.temperature !== undefined) config.temperature = req.temperature;

    if (req.json) {
      config.responseMimeType = 'application/json';
      if (req.json.schema) {
        config.responseSchema = toGeminiSchema(req.json.schema);
      }
    }

    // Provider-hosted search. An empty object is the whole configuration —
    // the only knobs `GoogleSearch` carries are unsupported on this API (see
    // the header), so sending any of them would be a 400 dressed as a feature.
    if (req.grounding?.web) config.tools = [{ googleSearch: {} }];

    if (req.tools?.length) {
      config.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: toGeminiSchema(t.inputSchema),
          })),
        },
      ];
      const choice = req.toolChoice;
      if (choice === 'none') {
        config.toolConfig = {
          functionCallingConfig: { mode: FunctionCallingConfigMode.NONE },
        };
      } else if (typeof choice === 'object' && choice?.name) {
        // ⚠️ allowedFunctionNames is only honoured with mode ANY — under
        // AUTO it is ignored and the model is free to answer in prose,
        // which is the opposite of what "call this tool" asked for.
        config.toolConfig = {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [choice.name],
          },
        };
      } else {
        config.toolConfig = {
          functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
        };
      }
    }

    // Omitted entirely when the caller says nothing, so the model's own
    // default stands rather than us inventing one.
    if (req.thinking) {
      config.thinkingConfig = thinkingConfigFor(model, req.thinking.budgetTokens);
    }

    return { model, contents: req.messages.map(toContent), config };
  }

  // ══════════════════════════════════════════════════════════════════
  // RESPONSE MAPPING
  // ══════════════════════════════════════════════════════════════════
  private toResponse(
    raw: GenerateContentResponse,
    model: string,
  ): LlmResponse {
    return this.aggregate([raw], model);
  }

  /**
   * Fold one or more response objects into a single LlmResponse. A
   * non-streamed call is the one-chunk case, so complete() and stream()
   * cannot drift apart in how they read a candidate.
   */
  private aggregate(
    chunks: GenerateContentResponse[],
    model: string,
  ): LlmResponse {
    const last = chunks[chunks.length - 1];
    const blockReason = last?.promptFeedback?.blockReason;
    const finishReason = lastDefined(
      chunks.map((c) => c.candidates?.[0]?.finishReason as string | undefined),
    );

    const allParts = chunks.flatMap(firstCandidateParts);
    const hasCandidate = chunks.some((c) => (c.candidates?.length ?? 0) > 0);

    // ⚠️ A PROMPT block returns no candidate at all — there is nothing to
    // report a stopReason on, and returning an empty success would let a
    // caller file a blank motivation or auto-approve a listing nobody read.
    // That one is an error. A blocked CANDIDATE is different: the model ran,
    // the filter stopped the output, and the caller can act on 'safety'.
    if (!hasCandidate) {
      const why = blockReason ?? finishReason ?? 'no candidate returned';
      this.logger.warn(
        `Gemini returned no candidate (blockReason=${String(blockReason ?? 'none')}, finishReason=${String(finishReason ?? 'none')})`,
      );
      throw new LlmError('safety', `Gemini blocked the request: ${String(why)}`);
    }

    if (finishReason && BLOCKING_FINISH_REASONS.has(finishReason)) {
      this.logger.warn(
        `Gemini blocked the response (finishReason=${finishReason}, blockReason=${String(blockReason ?? 'none')})`,
      );
    }

    const parts = toLlmParts(allParts);
    const toolCalls = parts.filter(
      (p): p is Extract<LlmPart, { type: 'tool_call' }> =>
        p.type === 'tool_call',
    );

    const grounding = readGrounding(chunks);

    return {
      text: parts
        .filter((p): p is Extract<LlmPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join(''),
      parts,
      toolCalls: toolCalls.map(
        (p): LlmToolCall => ({ id: p.id, name: p.name, input: p.input }),
      ),
      stopReason: mapStopReason(finishReason, toolCalls.length > 0),
      usage: mapUsage(chunks),
      model,
      provider: 'gemini',
      assistantMessage: { role: 'assistant', content: parts },
      ...grounding,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // TIMEOUT, RETRY, ERRORS
  // ══════════════════════════════════════════════════════════════════
  /**
   * Run `call` under a combined timeout+caller signal, retrying the
   * transient codes. Backoff is exponential from 500 ms, capped at 8 s,
   * and a server-supplied retryDelay wins over the schedule.
   *
   * ⚠️ The caller's abort is NEVER retried: an aborted request is a member
   * who navigated away or a request the server already cancelled, and
   * retrying it spends money on an answer nobody will read.
   */
  private async withRetry<T>(
    req: LlmRequest,
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastError: LlmError | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (req.signal?.aborted) {
        throw new LlmError('timeout', 'Request aborted by the caller');
      }
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = req.signal
        ? AbortSignal.any([req.signal, timeout])
        : timeout;

      try {
        return await call(signal);
      } catch (err) {
        const mapped = this.mapError(err, timeout.aborted);
        lastError = mapped;

        const retryable =
          mapped.code === 'rate_limited' ||
          mapped.code === 'overloaded' ||
          mapped.code === 'network';
        if (!retryable || attempt === MAX_ATTEMPTS || req.signal?.aborted) {
          throw mapped;
        }

        const backoff = Math.min(
          MAX_BACKOFF_MS,
          mapped.retryAfterMs ?? 500 * 2 ** (attempt - 1),
        );
        this.logger.warn(
          `Gemini ${mapped.code} (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }

    throw lastError ?? new LlmError('unknown', 'Gemini call failed');
  }

  /**
   * Provider error → LlmError. Call sites branch on `code` and must never
   * need to know what a GoogleGenAI error looks like.
   */
  private mapError(err: unknown, timedOut = false): LlmError {
    if (err instanceof LlmError) return err;

    const e = err as {
      name?: string;
      message?: string;
      status?: number;
      code?: number | string;
      cause?: unknown;
    };
    const message = e?.message ?? String(err);

    // AbortSignal.timeout fires a TimeoutError; a caller abort fires an
    // AbortError. Both surface here as an abort, so `timedOut` (read off
    // the timeout signal itself) is what tells them apart.
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || timedOut) {
      return new LlmError(
        'timeout',
        timedOut ? 'Gemini call timed out' : 'Gemini call aborted',
        undefined,
        undefined,
        err,
      );
    }

    const status = numericStatus(e) ?? statusFromMessage(message);

    if (status === 429 || /RESOURCE_EXHAUSTED/i.test(message)) {
      return new LlmError(
        'rate_limited',
        message,
        429,
        parseRetryDelayMs(message),
        err,
      );
    }
    if (status === 503 || status === 502 || /UNAVAILABLE/i.test(message)) {
      return new LlmError('overloaded', message, status, undefined, err);
    }
    if (status === 400 || /INVALID_ARGUMENT/i.test(message)) {
      return new LlmError('bad_request', message, 400, undefined, err);
    }
    if (status === 401 || status === 403) {
      return new LlmError('not_configured', message, status, undefined, err);
    }
    // ⚠️ undici surfaces every DNS/TLS/socket failure as a bare
    // "fetch failed" with the real reason on `cause`. Without this branch
    // a dead network reads as 'unknown' and is never retried.
    if (/fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) {
      return new LlmError('network', message, undefined, undefined, err);
    }
    if (status && status >= 500) {
      return new LlmError('overloaded', message, status, undefined, err);
    }

    return new LlmError('unknown', message, status, undefined, err);
  }
}

// ════════════════════════════════════════════════════════════════════
// PURE MAPPERS
// ════════════════════════════════════════════════════════════════════

/**
 * One LlmMessage → one Gemini Content.
 *
 * Spec: role 'assistant' becomes 'model' (Gemini's name for the same
 * turn); 'user' stays. A bare string becomes a single text part.
 */
export function toContent(message: LlmMessage): Content {
  const parts =
    typeof message.content === 'string'
      ? [{ text: message.content }]
      : message.content.map(toGeminiPart);
  return { role: message.role === 'assistant' ? 'model' : 'user', parts };
}

/**
 * One LlmPart → one Gemini Part.
 *
 * Spec:
 *  - text → `{ text }`.
 *  - image / document → `{ inlineData: { mimeType, data } }`. Gemini makes
 *    no distinction between the two; a PDF is inline data with a PDF mime
 *    type. The contract keeps them apart because Anthropic does.
 *  - tool_call → `{ functionCall: { id, name, args } }` on the model turn.
 *  - tool_result → `{ functionResponse: { id, name, response } }` on the
 *    user turn. ⚠️ Gemini matches a result to its call by NAME, where
 *    Anthropic matches by id — the id is sent as well because the SDK
 *    accepts it and newer models do use it, but the NAME is what must be
 *    right. The payload is wrapped as `{ content }` because `response`
 *    must be a JSON OBJECT; a bare string is rejected. An errored tool
 *    reports under `{ error }` so the model can tell the two apart.
 */
export function toGeminiPart(part: LlmPart): Part {
  switch (part.type) {
    case 'text':
      return { text: part.text };
    case 'image':
    case 'document':
      return { inlineData: { mimeType: part.mimeType, data: part.data } };
    case 'tool_call':
      return {
        functionCall: { id: part.id, name: part.name, args: part.input },
      };
    case 'tool_result': {
      const content =
        typeof part.content === 'string'
          ? part.content
          : part.content
              .map((p) => (p.type === 'text' ? p.text : `[${p.type}]`))
              .join('\n');
      return {
        functionResponse: {
          id: part.toolCallId,
          name: part.name,
          response: part.isError ? { error: content } : { content },
        },
      };
    }
  }
}

/** Parts of the first candidate, or [] — chunks legitimately arrive empty. */
function firstCandidateParts(chunk: GenerateContentResponse): Part[] {
  return chunk.candidates?.[0]?.content?.parts ?? [];
}

/** Joined text of the non-thought parts. Thought parts are never surfaced. */
function textOf(parts: Part[]): string {
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/**
 * Gemini parts → contract parts, in order.
 *
 * Spec: thought parts are DROPPED — they are the model's scratch work, they
 * are billed but not answers, and a caller joining `text` must never get
 * reasoning mixed into a verdict. Adjacent text parts are kept separate;
 * `text` on the response joins them. A functionCall with no id gets
 * `${name}#${n}` (n counting calls in this response), because the contract
 * promises an id and a tool loop needs a stable handle to echo back.
 */
export function toLlmParts(parts: Part[]): LlmPart[] {
  const out: LlmPart[] = [];
  let callIndex = 0;

  for (const p of parts) {
    if (p.thought) continue;
    if (typeof p.text === 'string' && p.text.length > 0) {
      out.push({ type: 'text', text: p.text });
      continue;
    }
    if (p.functionCall) {
      const name = p.functionCall.name ?? 'unknown';
      out.push({
        type: 'tool_call',
        id: p.functionCall.id ?? `${name}#${callIndex}`,
        name,
        input: (p.functionCall.args ?? {}) as Record<string, unknown>,
      });
      callIndex++;
    }
  }
  return out;
}

/**
 * `candidates[0].groundingMetadata` → the contract's grounding fields.
 *
 * Spec:
 *  - Returns `{}` when NO chunk carried groundingMetadata, so an ungrounded
 *    call leaves both fields undefined rather than reporting an empty search
 *    it never ran. ⚠️ A grounded call that opened nothing returns
 *    `groundingSources: []` — absent and empty are different answers and the
 *    caller is told which it got.
 *  - Reads EVERY chunk, not the last. A stream reports grounding as it
 *    arrives, and the chunk carrying the metadata is not the chunk carrying
 *    finishReason.
 *  - `groundingChunks[].web.{uri,title}` are the field names; a chunk with no
 *    `web` (Maps, retrievedContext, image) is skipped — nothing on this
 *    platform asks for those and a Maps place has no page to cite.
 *  - Deduplicated by uri, first title wins, order preserved: the model cites
 *    the same page from several supports and a citation list must not repeat.
 *  - A chunk with no uri is dropped. A source the member cannot open is not
 *    a source, and rendering a bare title as a link is worse than omitting it.
 */
export function readGrounding(chunks: GenerateContentResponse[]): {
  groundingSources?: Array<{ uri: string; title?: string }>;
  webSearchQueries?: string[];
} {
  const metas = chunks
    .map((c) => c.candidates?.[0]?.groundingMetadata)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (metas.length === 0) return {};

  const byUri = new Map<string, { uri: string; title?: string }>();
  const queries = new Set<string>();
  for (const meta of metas) {
    for (const chunk of meta.groundingChunks ?? []) {
      const uri = chunk.web?.uri;
      if (!uri || byUri.has(uri)) continue;
      byUri.set(uri, { uri, ...(chunk.web?.title ? { title: chunk.web.title } : {}) });
    }
    for (const q of meta.webSearchQueries ?? []) {
      if (q) queries.add(q);
    }
  }

  return {
    groundingSources: [...byUri.values()],
    ...(queries.size > 0 ? { webSearchQueries: [...queries] } : {}),
  };
}

/**
 * finishReason → the contract's stopReason.
 *
 * Spec: tool calls win over everything except a block, because a response
 * that carries a functionCall finishes with STOP and the caller's next move
 * is the tool loop, not "done". SAFETY / RECITATION / PROHIBITED_CONTENT and
 * friends → 'safety'. MAX_TOKENS → 'max_tokens'. STOP → 'end'. Anything
 * else, including a missing reason on an aborted stream → 'other'.
 */
export function mapStopReason(
  finishReason: string | undefined,
  hasToolCalls: boolean,
): LlmStopReason {
  if (finishReason && BLOCKING_FINISH_REASONS.has(finishReason)) {
    return 'safety';
  }
  if (hasToolCalls) return 'tool_use';
  if (finishReason === 'STOP') return 'end';
  if (finishReason === 'MAX_TOKENS') return 'max_tokens';
  return 'other';
}

/**
 * usageMetadata → LlmUsage.
 *
 * Spec: reads the LAST chunk that carries usage. Gemini reports cumulative
 * totals per chunk, so summing across a stream would multiply the bill;
 * the final chunk holds the whole call. ⚠️ `candidatesTokenCount` and the
 * newer `responseTokenCount` are both read — 2.21.0 declares the latter and
 * the API returns the former, and a missing output count would under-report
 * spend rather than fail.
 */
export function mapUsage(chunks: GenerateContentResponse[]): LlmUsage {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const u = chunks[i]?.usageMetadata as
      | {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          responseTokenCount?: number;
          cachedContentTokenCount?: number;
          thoughtsTokenCount?: number;
        }
      | undefined;
    if (!u) continue;
    return {
      inputTokens: u.promptTokenCount ?? 0,
      outputTokens: u.candidatesTokenCount ?? u.responseTokenCount ?? 0,
      cachedInputTokens: u.cachedContentTokenCount ?? 0,
      thinkingTokens: u.thoughtsTokenCount ?? 0,
    };
  }
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, thinkingTokens: 0 };
}

/**
 * Pull a retry delay out of a 429 body.
 *
 * Spec: Gemini returns `RetryInfo` with a duration string such as
 * `"retryDelay": "27s"` (or `"1.5s"`). Returns milliseconds, or undefined
 * when the body says nothing — the caller then uses its own backoff.
 */
export function parseRetryDelayMs(message: string): number | undefined {
  const m = /"?retry_?[Dd]elay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s"?/.exec(message);
  if (!m) return undefined;
  const seconds = Number(m[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

/** The last non-undefined entry — a stream reports finishReason only at the end. */
function lastDefined<T>(values: (T | undefined)[]): T | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== undefined) return values[i];
  }
  return undefined;
}

function numericStatus(e: { status?: number; code?: number | string }): number | undefined {
  if (typeof e?.status === 'number') return e.status;
  if (typeof e?.code === 'number') return e.code;
  return undefined;
}

/** GoogleGenAI stringifies the HTTP status into the message: "got status: 429 ...". */
function statusFromMessage(message: string): number | undefined {
  const m = /\b(?:status|code)"?\s*[:=]?\s*(\d{3})\b/i.exec(message);
  return m ? Number(m[1]) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
