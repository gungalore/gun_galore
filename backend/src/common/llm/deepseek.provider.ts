// ────────────────────────────────────────────────────────────────────
// DEEPSEEK — the FEED-MODERATION provider, and nothing else.
//
// Operator decision: feed post/comment moderation runs on DeepSeek
// `deepseek-flash` (DeepSeek-V4.1-Flash), routed per-purpose in LlmService.
// Gemini stays the platform default and the only image generator.
//
// ⚠️ `deepseek-flash` IS THE ONLY DEEPSEEK MODEL WITH VISION. `deepseek-v4-pro`
// has none, so this provider is pinned to flash. Feed moderation classifies
// photos (graphic tier, watermarks, promotional text), so a non-vision model
// cannot do the job.
//
// ⚠️ JSON OUTPUT IS "VALID JSON", NOT A SCHEMA. DeepSeek's
// `response_format: { type: 'json_object' }` guarantees parseable JSON and
// nothing more. The caller (FeedModerationService) validates the shape and
// fails closed. And the docs warn an empty body happens, so an empty answer
// with JSON requested is thrown as `safety` — a refusal, never a blank pass.
//
// ⚠️ NOT WIRED FOR ANYTHING ELSE. Tools, hosted search and document parts are
// refused with `unsupported` rather than half-mapped: this path only ever
// carries feed text + images, and a silent mis-map on a safety call is worse
// than a loud failure.
// ────────────────────────────────────────────────────────────────────

import {
  LlmError,
  type LlmPart,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamEvent,
} from './llm.types';
import type { LlmProviderClient } from './provider.interface';

const BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';

export class DeepSeekProvider implements LlmProviderClient {
  readonly name: LlmProvider = 'deepseek';

  /**
   * ⚠️ FALSE, AND THAT IS A HARD LIMIT OF THIS PATH, NOT A SETTING. mapContent
   * below throws `unsupported` on any part that is not text or an image, and
   * a PDF travels as a `{type:'document'}` part. LlmService reads this and
   * sends a document-bearing request to Gemini instead of failing here —
   * which is why the throw stays: it is the backstop, not the routing.
   */
  readonly acceptsDocuments = false;

  isConfigured(): boolean {
    return Boolean(process.env.DEEPSEEK_API_KEY);
  }

  defaultModel(): string {
    return process.env.LLM_MODEL ?? DEFAULT_DEEPSEEK_MODEL;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.isConfigured()) {
      throw new LlmError(
        'not_configured',
        'deepseek is not configured — no DEEPSEEK_API_KEY',
      );
    }
    if (req.tools?.length) {
      throw new LlmError(
        'unsupported',
        'deepseek path does not implement tools on this platform',
      );
    }
    if (req.grounding?.web) {
      throw new LlmError(
        'unsupported',
        'deepseek path does not implement hosted web search',
      );
    }

    const model = req.model ?? this.defaultModel();

    const messages: Array<{ role: string; content: unknown }> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      messages.push({ role: m.role, content: this.mapContent(m.content) });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: req.maxTokens,
      stream: false,
      // Moderation wants a fast deterministic verdict; thinking doubles latency
      // and spend for no gain on a classification.
      thinking: { type: 'disabled' },
    };
    if (typeof req.temperature === 'number') body.temperature = req.temperature;
    if (req.json) body.response_format = { type: 'json_object' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new LlmError('timeout', 'deepseek request timed out');
      }
      throw new LlmError(
        'network',
        `deepseek network error: ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const code: LlmError['code'] =
        res.status === 400
          ? 'bad_request'
          : res.status === 401 || res.status === 403
            ? 'not_configured'
            : res.status === 429
              ? 'rate_limited'
              : res.status >= 500
                ? 'overloaded'
                : 'unknown';
      throw new LlmError(
        code,
        `deepseek ${res.status}: ${text}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
      };
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    const finish = choice?.finish_reason ?? 'stop';

    // An empty answer when JSON was requested is a REFUSAL, not a shape to
    // trust. Throw so the caller's fail-closed path takes over.
    if (req.json && !content.trim()) {
      throw new LlmError('safety', 'deepseek returned empty JSON content');
    }

    const usage = data.usage ?? {};
    return {
      text: content,
      parts: content ? [{ type: 'text', text: content }] : [],
      toolCalls: [],
      stopReason:
        finish === 'length'
          ? 'max_tokens'
          : finish === 'content_filter'
            ? 'safety'
            : finish === 'tool_calls'
              ? 'tool_use'
              : 'end',
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cachedInputTokens: usage.prompt_cache_hit_tokens,
      },
      model,
      provider: 'deepseek',
      assistantMessage: { role: 'assistant', content },
    };
  }

  async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    // Feed moderation never streams. One 'done' event satisfies the interface
    // without a second, untested SSE path.
    const response = await this.complete(req);
    yield { type: 'done', response };
  }

  private mapContent(content: string | LlmPart[]): unknown {
    if (typeof content === 'string') return content;
    return content.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      if (p.type === 'image') {
        return {
          type: 'image_url',
          image_url: { url: `data:${p.mimeType};base64,${p.data}` },
        };
      }
      throw new LlmError(
        'unsupported',
        `deepseek path does not accept a '${p.type}' part`,
      );
    });
  }
}
