// ────────────────────────────────────────────────────────────────────
// ONE SHAPE FOR EVERY MODEL CALL THE PLATFORM MAKES.
//
// Operator, 2026-09-07: "we are switching from claude API to gemini 2.5
// flash-lite api for everything on the website." Fifteen services each built
// their own Anthropic client, picked their own model and parsed their own
// response. Switching provider meant fifteen rewrites — and switching back,
// fifteen more. So the call sites now speak THIS shape, and one adapter
// (LlmService) speaks the provider's. Gemini is the provider; the Anthropic
// path stays behind LLM_PROVIDER=anthropic for rollback only.
//
// ⚠️ THE SHAPE IS THE UNION OF WHAT THE CALL SITES ALREADY NEEDED, nothing
// more: text, images and PDFs in; text and tool calls out; streaming for the
// two places a member watches the answer arrive; a thinking budget for the
// motivation writer; a JSON schema where the answer is a verdict. Add to it
// when a caller needs to, never speculatively.
// ────────────────────────────────────────────────────────────────────

export type LlmProvider = 'gemini' | 'anthropic';

/** Base64 bytes with their type. Both providers take exactly this. */
export interface LlmBlob {
  mimeType: string;
  /** Base64, no data: prefix. */
  data: string;
}

export type LlmPart =
  | { type: 'text'; text: string }
  | ({ type: 'image' } & LlmBlob)
  /** A PDF (or other document the provider can read as a whole). */
  | ({ type: 'document' } & LlmBlob)
  /** The model asked for a tool. Echoed back verbatim in the next turn. */
  | {
      type: 'tool_call';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  /** What the tool answered, in the user turn that follows. */
  | {
      type: 'tool_result';
      toolCallId: string;
      /** The tool's name — Gemini keys results by name, Anthropic by id. */
      name: string;
      content: string | LlmPart[];
      isError?: boolean;
    };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmPart[];
}

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema for the input object. */
  inputSchema: Record<string, unknown>;
}

export type LlmToolChoice = 'auto' | 'none' | { name: string };

export interface LlmRequest {
  /** Instructions that outrank the conversation. */
  system?: string;
  messages: LlmMessage[];
  /** Hard cap on output tokens. Callers keep the numbers they had. */
  maxTokens: number;
  /** Omit to take the provider's default. */
  temperature?: number;
  tools?: LlmTool[];
  toolChoice?: LlmToolChoice;
  /**
   * The answer must be JSON. With a schema the provider enforces the shape;
   * without one it only guarantees a JSON document. Cannot be combined with
   * tools on Gemini — the adapter throws rather than silently dropping one.
   */
  json?: { schema?: Record<string, unknown> };
  /**
   * Ask the PROVIDER to search the web and answer from what it read.
   *
   * ⚠️ THIS IS A PROVIDER-HOSTED SEARCH, NOT AN `LlmTool`. `tools` describes
   * functions WE execute and answer with a `tool_result`; here the provider
   * issues the queries, reads the pages and resolves the whole thing inside
   * one turn. There is nothing for us to run and nothing to echo back — which
   * is exactly why it could not be expressed as a tool and had to become its
   * own flag.
   *
   * ⚠️ ON GEMINI 2.5 IT COMBINES WITH NEITHER `json` NOR `tools`, and the
   * adapter throws `bad_request` rather than dropping one silently. Google
   * ships both combinations on the 3-series only ("Gemini 3 lets you combine
   * Structured Outputs with built-in tools"; "the Gemini API doesn't support
   * combining search tools with non-search tools in the same generateContent
   * request"). A caller that needs grounded JSON does two calls — search in
   * prose, then extract with `json` — and a caller with a tool loop runs the
   * grounded turn after the loop settles. Anthropic accepts both, so the
   * rollback path is more permissive than the live one; write for Gemini.
   *
   * ⚠️ THERE IS NO DOMAIN ALLOWLIST. Neither provider's hosted search takes
   * one — Gemini's `GoogleSearch` carries only `excludeDomains`, and the
   * declarations mark even that "not supported in Gemini API". A caller that
   * wants preferred sources says so in `system` and treats it as guidance,
   * never as a control.
   */
  grounding?: { web: true };
  /**
   * Let the model reason before answering. `budgetTokens: 0` turns it off,
   * which is what every verdict/JSON call wants (the budget must be text).
   * Omit for the provider default.
   */
  thinking?: { budgetTokens: number };
  /**
   * What this call is for, e.g. 'moderation.listing', 'motivation.generate'.
   * Written to the usage ledger so spend can be read per feature.
   */
  purpose: string;
  /** Overall timeout for the call, in ms. Default 60 000. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Override the model for this call. Every call site should leave this
   * unset and take LLM_MODEL; it exists so an operator can point ONE feature
   * elsewhere from the env without a deploy.
   */
  model?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the provider's cache, where it says so. */
  cachedInputTokens?: number;
  thinkingTokens?: number;
  /**
   * How many of `outputTokens` were a picture rather than prose.
   *
   * ⚠️ INSIDE `outputTokens`, like `thinkingTokens`. Gemini reports one
   * `candidatesTokenCount` and breaks the modalities out beside it. The image
   * rate is twenty times the text rate, so the ledger has to be able to tell
   * them apart — see llm.pricing.
   */
  imageTokens?: number;
}

export type LlmStopReason =
  | 'end'
  | 'max_tokens'
  | 'tool_use'
  | 'safety'
  | 'other';

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmResponse {
  /** Every text part, joined. Empty when the model only called tools. */
  text: string;
  /** Text and tool_call parts, in the order the model produced them. */
  parts: LlmPart[];
  toolCalls: LlmToolCall[];
  stopReason: LlmStopReason;
  usage: LlmUsage;
  model: string;
  provider: LlmProvider;
  /**
   * The assistant turn, ready to append to `messages` when continuing a tool
   * loop. Always the same content as `parts`.
   */
  assistantMessage: LlmMessage;
  /**
   * The pages the provider actually read for a `grounding: { web: true }`
   * call, in the order it reported them, deduplicated by uri.
   *
   * ⚠️ ABSENT AND EMPTY MEAN DIFFERENT THINGS ONLY BY CONVENTION, so treat
   * them the same: undefined is "the call was not grounded", [] is "it was,
   * and the model answered without opening anything". Either way a caller
   * that promises citations has none to show and must say so rather than
   * attribute the answer to a source it cannot name.
   */
  groundingSources?: Array<{ uri: string; title?: string }>;
  /** The queries the provider ran on our behalf. Diagnostics only — never
   *  logged (a query can carry whatever the caller put in the prompt). */
  webSearchQueries?: string[];
}

export type LlmStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'done'; response: LlmResponse };

export type LlmErrorCode =
  | 'not_configured'
  | 'bad_request'
  | 'rate_limited'
  | 'overloaded'
  | 'safety'
  | 'timeout'
  | 'network'
  /**
   * The active provider cannot do this AT ALL.
   *
   * ⚠️ NOT THE SAME AS `not_configured`, AND THE DIFFERENCE MATTERS TO WHOEVER
   * READS THE ALERT. A missing key is fixed by setting one; a provider with no
   * image model is fixed by switching provider back, and telling an operator
   * to "check the API key" when LLM_PROVIDER=anthropic is set would send them
   * looking for a problem that is not there.
   */
  | 'unsupported'
  | 'unknown';

/**
 * Every failure a call site can see. Call sites branch on `code`, never on a
 * provider's own error class — that is the whole point of the adapter.
 */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }

  /** Worth a second attempt after a pause. */
  get retryable(): boolean {
    return (
      this.code === 'rate_limited' ||
      this.code === 'overloaded' ||
      this.code === 'timeout' ||
      this.code === 'network'
    );
  }
}

/** What `LlmService.ping()` reports, for /admin/health. */
export interface LlmPing {
  ok: boolean;
  provider: LlmProvider;
  model: string;
  error?: string;
  latencyMs: number;
}

// ────────────────────────────────────────────────────────────────────
// MAKING A PICTURE.
//
// Operator, 2026-09-10: "We are going to insert the quarry it can hunt on the
// same page. lets wire in that nano banana use nana banana lite (the cheapest
// model)."
//
// ⚠️ ITS OWN SHAPE, NOT A FLAG ON LlmRequest. Nothing an image call needs is
// what a text call needs — no tools, no JSON schema, no streaming, no thinking
// budget — and nothing it RETURNS is a text response. Bolting a modality onto
// LlmRequest would have every text call site carrying fields that can never
// apply to it, and would make `LlmResponse.text` meaningless for half its
// implementations.
//
// ⚠️ AND IT IS STILL THE ONE ADAPTER. CLAUDE.md: no service builds its own
// client or picks its own model. The ledger, the log line and the model
// default stay in LlmService exactly as they are for text, so image spend
// lands in the same AiUsage table /admin/credits already reads.
// ────────────────────────────────────────────────────────────────────

export interface LlmImageRequest {
  /** What to draw. */
  prompt: string;
  /**
   * Reference pictures, where the model is being asked to work from one.
   * Unused today; the API takes them and leaving it out would mean changing
   * this shape the first time somebody wants a house style.
   */
  references?: LlmBlob[];
  /** Overrides the configured image model. */
  model?: string;
  /**
   * ⚠️ THERE IS NO ASPECT-RATIO KNOB HERE ON PURPOSE. Gemini has an
   * `imageConfig` and this code has never sent one; the plates come back
   * 1408×768 unasked, which is the landscape the page wants. Declaring a
   * field nothing has proved would be a knob that 400s the first time
   * somebody turns it.
   */
  /** Ledger and log label, like every other call. */
  purpose: string;
  timeoutMs?: number;
}

export interface LlmImageResponse {
  /** Every picture the model returned, in order. Usually one. */
  images: LlmBlob[];
  /** Any prose it produced alongside them. Usually empty. */
  text: string;
  model: string;
  provider: LlmProvider;
  usage: LlmUsage;
}
