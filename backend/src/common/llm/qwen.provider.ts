// ────────────────────────────────────────────────────────────────────
// QWEN CLOUD — the Value My Item valuation engine.
//
// Operator decision: valuations run on `qwen3.8-flash` through Qwen Cloud's
// OpenAI-compatible endpoint, routed per-purpose in LlmService. No call site
// constructs this; it is reached only through LlmService.complete().
//
//   base URL  QWEN_BASE_URL  (default https://maas.qwencloudapi.com/compatible-mode/v1)
//   api key   QWEN_API_KEY   (.env only, never hardcoded)
//   model     VALUATION_MODEL (default qwen3.8-flash)
//
// Supports text, images, JSON (schema or object), backend-executed tools
// (function calling) and hosted web search via `enable_search`. A document
// part is refused: the valuation flow only ever sends photos.
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

const DEFAULT_BASE_URL = 'https://maas.qwencloudapi.com/compatible-mode/v1';
const DEFAULT_QWEN_MODEL = 'qwen3.8-flash';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: string;
  content: unknown;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export class QwenProvider implements LlmProviderClient {
  readonly name: LlmProvider = 'qwen';

  /** Photos only; a PDF would be refused in mapParts. */
  readonly acceptsDocuments = false;

  isConfigured(): boolean {
    return Boolean(this.apiKey());
  }

  /** QWEN_API_KEY wins; DASHSCOPE_API_KEY is the vendor's own name for it. */
  private apiKey(): string | undefined {
    return process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY;
  }

  defaultModel(): string {
    return process.env.VALUATION_MODEL ?? process.env.LLM_MODEL ?? DEFAULT_QWEN_MODEL;
  }

  private baseUrl(): string {
    return process.env.QWEN_BASE_URL ?? DEFAULT_BASE_URL;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.isConfigured()) {
      throw new LlmError(
        'not_configured',
        'qwen is not configured — no QWEN_API_KEY',
      );
    }
    // Hosted web search on Qwen3.8 is Responses-API only (the Chat Completions
    // `enable_search` flag is a no-op and makes the model emit its native tool
    // protocol as text). When a caller asks for web grounding we route to the
    // Responses endpoint and attach web_search + web_extractor; the provider
    // runs the multi-turn retrieval itself.
    if (req.grounding?.web) return this.completeWithSearch(req);

    const model = req.model ?? this.defaultModel();
    const body: Record<string, unknown> = {
      model,
      messages: this.buildMessages(req),
      max_tokens: req.maxTokens,
      stream: false,
    };
    if (typeof req.temperature === 'number') body.temperature = req.temperature;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
      body.tool_choice =
        req.toolChoice === 'none'
          ? 'none'
          : req.toolChoice === 'auto' || req.toolChoice === undefined
            ? 'auto'
            : { type: 'function', function: { name: req.toolChoice.name } };
    }
    if (req.json) {
      body.response_format = req.json.schema
        ? {
            type: 'json_schema',
            json_schema: { name: 'result', strict: true, schema: req.json.schema },
          }
        : { type: 'json_object' };
    }
    if (req.thinking) {
      // Confirmed against the Qwen Cloud OpenAI-compatible sample: thinking is
      // a top-level body flag. `thinking_budget` is not a documented
      // compatible-mode field, so it is NOT sent (an unknown param risks a
      // 400); thinking is simply on when the caller asked for it.
      body.enable_thinking = req.thinking.budgetTokens > 0;
    }
    // ⚠️ `req.grounding` IS DELIBERATELY IGNORED HERE. The compatible-mode
    // `enable_search` flag is a no-op on this gateway: it returns no sources
    // and, worse, makes the model emit its NATIVE `<tool_call><function=
    // web_search>` protocol as plain text, which an OpenAI-style tool loop
    // cannot parse. Search is done by the backend-executed tools in
    // research.service (function calling works), so grounding is not sent.

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey()}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new LlmError('timeout', 'qwen request timed out');
      }
      throw new LlmError('network', `qwen network error: ${(e as Error).message}`);
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
      throw new LlmError(code, `qwen ${res.status}: ${text}`, res.status);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: OpenAiToolCall[];
        };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
      search_info?: {
        search_results?: Array<{ url?: string; title?: string }>;
      };
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    const toolCalls = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: this.parseArgs(tc.function.arguments),
    }));
    const finish = choice?.finish_reason ?? 'stop';

    if (req.json && !content.trim() && toolCalls.length === 0) {
      throw new LlmError('safety', 'qwen returned empty JSON content');
    }

    const parts: LlmPart[] = [];
    if (content) parts.push({ type: 'text', text: content });
    for (const tc of toolCalls) {
      parts.push({ type: 'tool_call', id: tc.id, name: tc.name, input: tc.input });
    }

    const usage = data.usage ?? {};
    const groundingSources = (data.search_info?.search_results ?? [])
      .filter((r): r is { url: string; title?: string } => Boolean(r.url))
      .map((r) => ({ uri: r.url, title: r.title }));

    return {
      text: content,
      parts,
      toolCalls,
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
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
      },
      model,
      provider: 'qwen',
      assistantMessage: { role: 'assistant', content: parts },
      groundingSources: groundingSources.length ? groundingSources : undefined,
    };
  }

  /**
   * Hosted web search via the Responses API. The provider attaches the
   * built-in web_search + web_extractor tools and runs the multi-turn
   * retrieval itself; we read the answer text and the url_citation
   * annotations as grounding sources.
   */
  private async completeWithSearch(req: LlmRequest): Promise<LlmResponse> {
    const model = req.model ?? this.defaultModel();
    const body: Record<string, unknown> = {
      model,
      input: this.buildResponsesInput(req.messages),
      tools: [{ type: 'web_search' }, { type: 'web_extractor' }],
      max_output_tokens: req.maxTokens,
    };
    if (req.system) body.instructions = req.system;
    if (req.thinking) body.enable_thinking = req.thinking.budgetTokens > 0;
    if (typeof req.temperature === 'number') body.temperature = req.temperature;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 240_000);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey()}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new LlmError('timeout', 'qwen search request timed out');
      }
      throw new LlmError('network', `qwen network error: ${(e as Error).message}`);
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
      throw new LlmError(code, `qwen responses ${res.status}: ${text}`, res.status);
    }

    const data = (await res.json()) as {
      output?: Array<{
        type?: string;
        action?: { query?: string };
        content?: Array<{
          type?: string;
          text?: string;
          annotations?: Array<{ type?: string; url?: string; title?: string }>;
        }>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      };
    };

    const texts: string[] = [];
    const sources: Array<{ uri: string; title?: string }> = [];
    const queries: string[] = [];
    for (const item of data.output ?? []) {
      if (item.type === 'web_search_call' && item.action?.query) {
        queries.push(item.action.query);
      }
      if (item.type === 'message') {
        for (const part of item.content ?? []) {
          if (part.type === 'output_text' && part.text) texts.push(part.text);
          for (const ann of part.annotations ?? []) {
            if (ann.type === 'url_citation' && ann.url) {
              sources.push({ uri: ann.url, title: ann.title });
            }
          }
        }
      }
    }

    const text = texts.join('\n').trim();
    const usage = data.usage ?? {};
    const dedupedSources = dedupeSources(sources);
    return {
      text,
      parts: text ? [{ type: 'text', text }] : [],
      toolCalls: [],
      stopReason: 'end',
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cachedInputTokens: usage.input_tokens_details?.cached_tokens,
      },
      model,
      provider: 'qwen',
      assistantMessage: { role: 'assistant', content: text },
      groundingSources: dedupedSources.length ? dedupedSources : undefined,
      webSearchQueries: queries.length ? queries : undefined,
    };
  }

  private buildResponsesInput(messages: LlmRequest['messages']): unknown[] {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: [{ type: 'input_text', text: m.content }] };
      }
      const content = m.content.map((p) => {
        if (p.type === 'text') return { type: 'input_text', text: p.text };
        if (p.type === 'image') {
          return { type: 'input_image', image_url: `data:${p.mimeType};base64,${p.data}` };
        }
        throw new LlmError(
          'unsupported',
          `qwen search path does not accept a '${p.type}' part`,
        );
      });
      return { role: m.role, content };
    });
  }

  async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    // Valuation calls do not stream tokens to the browser; progress is our own
    // SSE. One 'done' event satisfies the interface without a second path.
    const response = await this.complete(req);
    yield { type: 'done', response };
  }

  private parseArgs(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw || '{}');
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
      return {};
    }
  }

  private buildMessages(req: LlmRequest): OpenAiMessage[] {
    const out: OpenAiMessage[] = [];
    if (req.system) out.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      if (typeof m.content === 'string') {
        out.push({ role: m.role, content: m.content });
        continue;
      }
      const toolCalls = m.content.filter(
        (p): p is Extract<LlmPart, { type: 'tool_call' }> => p.type === 'tool_call',
      );
      const toolResults = m.content.filter(
        (p): p is Extract<LlmPart, { type: 'tool_result' }> => p.type === 'tool_result',
      );
      const rest = m.content.filter(
        (p) => p.type !== 'tool_call' && p.type !== 'tool_result',
      );

      if (m.role === 'assistant' && toolCalls.length) {
        const text = rest
          .filter((p): p is Extract<LlmPart, { type: 'text' }> => p.type === 'text')
          .map((p) => p.text)
          .join('');
        out.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
          })),
        });
        continue;
      }

      if (toolResults.length) {
        for (const tr of toolResults) {
          out.push({
            role: 'tool',
            tool_call_id: tr.toolCallId,
            content: this.toolContentToString(tr.content),
          });
        }
        if (rest.length) out.push({ role: 'user', content: this.mapParts(rest) });
        continue;
      }

      out.push({ role: m.role, content: this.mapParts(m.content) });
    }
    return out;
  }

  private toolContentToString(content: string | LlmPart[]): string {
    if (typeof content === 'string') return content;
    return content
      .filter((p): p is Extract<LlmPart, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
  }

  private mapParts(parts: LlmPart[]): unknown {
    const texts: Array<{ type: 'text'; text: string }> = [];
    const images: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
    for (const p of parts) {
      if (p.type === 'text') texts.push({ type: 'text', text: p.text });
      else if (p.type === 'image')
        images.push({
          type: 'image_url',
          image_url: { url: `data:${p.mimeType};base64,${p.data}` },
        });
      else if (p.type === 'document' || p.type === 'video')
        throw new LlmError(
          'unsupported',
          `qwen path does not accept a '${p.type}' part`,
        );
    }
    if (images.length === 0) return texts.map((t) => t.text).join('\n');
    return [...texts, ...images];
  }
}

function dedupeSources(
  sources: Array<{ uri: string; title?: string }>,
): Array<{ uri: string; title?: string }> {
  const seen = new Set<string>();
  const out: Array<{ uri: string; title?: string }> = [];
  for (const s of sources) {
    if (seen.has(s.uri)) continue;
    seen.add(s.uri);
    out.push(s);
  }
  return out;
}
