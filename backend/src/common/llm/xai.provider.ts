// ────────────────────────────────────────────────────────────────────
// xAI (GROK IMAGINE) — the motivation PURPOSE and QUARRY plate generator.
//
// Operator, 2026-10-15: "wire in the grok. just send it our own enhanced
// prompt." The plates already carry a curated prompt per course of fire and
// per species (motivation-courses.ts, motivation-quarry.ts); xAI has no
// "enhance prompt" parameter and none is used — the prompt we hold is sent
// verbatim, exactly like the Gemini path. This is a provider, not a feature.
//
// ── WHAT WAS CONFIRMED, AND WHERE, ON 2026-10-15 ──────────────────────
// Probed live on this platform's key against
// `POST https://api.x.ai/v1/images/generations` before a line here was
// written, the same rule the Gemini provider was built on:
//
//   • Auth is `Authorization: Bearer <GROK_API_KEY>`.
//   • Request: `{ model, prompt, n, quality, resolution, aspect_ratio,
//     response_format }`.
//     `aspect_ratio: "21:9"` — the value the plate frames are cropped to — is
//     in xAI's enumerated list and was accepted (the model also lists "2:1",
//     which the Gemini list does not; we keep 21:9 so one constant serves
//     both providers).
//   • Response: `{ data: [{ b64_json, mime_type }], usage }`. Requesting
//     `response_format: "b64_json"` returns the bytes inline, so no second
//     download is needed; a `url` shape is still handled as a fallback.
//   • `usage.cost_in_usd_ticks` echoes the exact charge — 800000000 ticks for
//     one 2K medium 2.0 plate, i.e. $0.08, matching the published flat price
//     (see llm.pricing.ts). We still price from our own table, so the ledger's
//     money column keeps one author.
//
// ⚠️ THIS PROVIDER IS IMAGES ONLY. `complete`/`stream` throw `unsupported`;
// nothing in LlmService routes a text purpose here (the routing pin targets
// `motivation.plate` and `motivation.quarry`). It draws and does nothing else,
// which is why `acceptsDocuments` is false and the text methods refuse rather
// than half-work.
// ────────────────────────────────────────────────────────────────────

import { Logger } from '@nestjs/common';
import {
  LlmError,
  type LlmBlob,
  type LlmImageRequest,
  type LlmImageResponse,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamEvent,
} from './llm.types';
import type { LlmProviderClient } from './provider.interface';

const DEFAULT_BASE_URL = 'https://api.x.ai/v1';

/**
 * The Imagine model. `grok-imagine-image-2.0` at $0.08 an image (2K, medium).
 *
 * ⚠️ TAKEN FROM xAI'S OWN MODEL/PRICING PAGES, NOT FROM MEMORY, and probed on
 * this key — a guessed id is a 404 at the worst moment. Overridable with
 * XAI_IMAGE_MODEL so a repricing or a different model is an env edit and a
 * reload, not a deploy.
 */
const DEFAULT_IMAGE_MODEL =
  process.env.XAI_IMAGE_MODEL || 'grok-imagine-image-2.0';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3; // one try plus two retries
const MAX_BACKOFF_MS = 8_000;

export class XaiProvider implements LlmProviderClient {
  readonly name: LlmProvider = 'xai';

  /** Images only; a document part is never sent to this provider. */
  readonly acceptsDocuments = false;

  private readonly logger = new Logger(XaiProvider.name);

  isConfigured(): boolean {
    return Boolean(this.apiKey());
  }

  /** GROK_API_KEY first (the name in backend/.env); XAI_API_KEY accepted too. */
  private apiKey(): string | undefined {
    return process.env.GROK_API_KEY ?? process.env.XAI_API_KEY;
  }

  private baseUrl(): string {
    return process.env.XAI_BASE_URL ?? DEFAULT_BASE_URL;
  }

  /**
   * ⚠️ NO TEXT MODEL. xAI does have chat models, but this platform uses it for
   * pictures only, so the "default model" is the image model. `complete` and
   * `stream` throw before it is ever consulted.
   */
  defaultModel(): string {
    return DEFAULT_IMAGE_MODEL;
  }

  defaultImageModel(): string {
    return DEFAULT_IMAGE_MODEL;
  }

  // ══════════════════════════════════════════════════════════════════
  // TEXT — refused. See the header: this provider is images only.
  // ══════════════════════════════════════════════════════════════════
  async complete(_req: LlmRequest): Promise<LlmResponse> {
    throw new LlmError(
      'unsupported',
      'xai serves image generation only on this platform',
    );
  }

  // eslint-disable-next-line require-yield
  async *stream(_req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    throw new LlmError(
      'unsupported',
      'xai serves image generation only on this platform',
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // IMAGE
  // ══════════════════════════════════════════════════════════════════
  /**
   * One prompt in, pictures out.
   *
   * ⚠️ `response_format: "b64_json"` IS ASKED FOR DELIBERATELY. The default is
   * a temporary hosted URL, which would make every plate a second network hop
   * and a dependency on a URL that expires; the bytes come back inline instead.
   * A `url`-only answer is still accepted and fetched, so a provider that ever
   * ignores the flag degrades rather than fails.
   */
  async generateImage(req: LlmImageRequest): Promise<LlmImageResponse> {
    const model = req.model ?? DEFAULT_IMAGE_MODEL;

    // Reference pictures would need the /images/edits endpoint. Nothing on
    // this platform sends references today, so this refuses rather than
    // silently drawing without them and returning the wrong picture.
    if (req.references?.length) {
      throw new LlmError(
        'unsupported',
        'xai image edits (references) are not wired on this platform',
      );
    }

    /**
     * ⚠️ `quality` AND `resolution` ARE PINNED, NOT LEFT TO THE DEFAULT.
     * Omitted `quality` resolves to `auto`, which xAI documents as `low` for
     * generation; omitted `resolution` is `1k`. Those two defaults were the
     * whole reason a plate looked worse than the same prompt in Grok online —
     * and a 1K render upscaled to the page's 1800 px is soft before the crop.
     * `2k` + `medium` is the $0.08 row in llm.pricing.ts.
     */
    const body = JSON.stringify({
      model,
      prompt: req.prompt,
      n: 1,
      quality: 'medium',
      resolution: '2k',
      response_format: 'b64_json',
      // ⚠️ ONLY WHEN ASKED — absent takes the model's own default rather than a
      // shape we assumed, the same rule the Gemini path follows.
      ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
    });

    const data = await this.withRetry(req, async (signal) => {
      const res = await fetch(`${this.baseUrl()}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey()}`,
        },
        body,
        signal,
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) throw this.mapHttpError(res.status, text);
      try {
        return JSON.parse(text) as XaiImageResponse;
      } catch {
        throw new LlmError(
          'unknown',
          `xai returned a non-JSON body for ${req.purpose}`,
        );
      }
    });

    const images: LlmBlob[] = [];
    for (const d of data.data ?? []) {
      if (d.b64_json) {
        images.push({
          mimeType: d.mime_type ?? 'image/jpeg',
          data: d.b64_json,
        });
      } else if (d.url) {
        const fetched = await this.fetchAsBlob(d.url);
        if (fetched) images.push(fetched);
      }
    }

    // ⚠️ A REFUSAL ARRIVES AS AN EMPTY ANSWER, NOT AS AN ERROR — the same rule
    // the Gemini provider learned. A caller that trusted the shape would store
    // a zero-byte plate and print a blank box in a lodged document.
    if (!images.length) {
      throw new LlmError(
        'safety',
        `xAI ${model} returned no image for ${req.purpose}`,
      );
    }

    return {
      images,
      text: '',
      model,
      provider: 'xai',
      // ⚠️ NO TOKENS — xAI bills Imagine calls a flat fee per image, so the
      // count is what the ledger prices (see llm.pricing.ts).
      usage: { inputTokens: 0, outputTokens: 0, images: images.length },
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // TIMEOUT, RETRY, ERRORS
  // ══════════════════════════════════════════════════════════════════
  /**
   * Run `call` under a timeout, retrying the transient codes. Backoff is
   * exponential from 500 ms, capped at 8 s. A non-2xx is mapped to an LlmError
   * inside `call` and retried only when it is one of the transient codes.
   */
  private async withRetry<T>(
    req: { timeoutMs?: number },
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastError: LlmError | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await call(AbortSignal.timeout(timeoutMs));
      } catch (err) {
        const mapped = this.mapError(err);
        lastError = mapped;
        if (!mapped.retryable || attempt === MAX_ATTEMPTS) throw mapped;

        const backoff = Math.min(
          MAX_BACKOFF_MS,
          mapped.retryAfterMs ?? 500 * 2 ** (attempt - 1),
        );
        this.logger.warn(
          `xAI ${mapped.code} (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }

    throw lastError ?? new LlmError('unknown', 'xAI call failed');
  }

  /** Fetch a hosted image URL and return it as a base64 blob. Undefined on failure. */
  private async fetchAsBlob(url: string): Promise<LlmBlob | undefined> {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) return undefined;
      const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      return { mimeType, data: buf.toString('base64') };
    } catch {
      return undefined;
    }
  }

  /** HTTP status + body → LlmError, the codes the call sites branch on. */
  private mapHttpError(status: number, body: string): LlmError {
    const message = `xai ${status}: ${body.slice(0, 500)}`;
    if (status === 429) return new LlmError('rate_limited', message, 429);
    if (status === 401 || status === 403)
      return new LlmError('not_configured', message, status);
    if (status === 400) return new LlmError('bad_request', message, 400);
    if (status >= 500) return new LlmError('overloaded', message, status);
    return new LlmError('unknown', message, status);
  }

  /** Provider/transport error → LlmError. Call sites never see a raw fetch error. */
  private mapError(err: unknown): LlmError {
    if (err instanceof LlmError) return err;

    const e = err as { name?: string; message?: string };
    const message = e?.message ?? String(err);

    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
      return new LlmError(
        'timeout',
        'xai call timed out',
        undefined,
        undefined,
        err,
      );
    }
    // undici surfaces every DNS/TLS/socket failure as a bare "fetch failed".
    if (
      /fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
        message,
      )
    ) {
      return new LlmError('network', message, undefined, undefined, err);
    }
    return new LlmError('unknown', message, undefined, undefined, err);
  }
}

interface XaiImageResponse {
  data?: Array<{ b64_json?: string; url?: string; mime_type?: string }>;
  usage?: { cost_in_usd_ticks?: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
