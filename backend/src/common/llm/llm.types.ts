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
