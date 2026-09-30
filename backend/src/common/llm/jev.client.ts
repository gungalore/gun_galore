// ────────────────────────────────────────────────────────────────────
// JEV (TypeSafe System One) — typed decisions, not prose.
//
// Operator decision, 2026-10-01: Jev monitors every user-supplied TEXT
// surface (listings, listing Q&A, offer notes, rating comments, feed posts
// and comments) for contact details, name sharing, social handles,
// third-party advertising and any other way two users can reach each other
// off-platform. DeepSeek Flash screens the IMAGES for the same content —
// Jev cannot see a picture (models.md: "Text only. No image, audio, or
// video input"), so the two are split by modality, never by preference.
//
// ⚠️ ONE REQUEST, MANY QUESTIONS. Jev evaluates every question in parallel
// against one `state`; batching is the documented way to use it (TypeSafe's
// own cookbook measures a 13-question batch as 12× cheaper and 10× faster
// than 13 calls). The battery in `moderation/jev-battery.ts` therefore asks
// every category at once and reads the numbers back.
//
// ⚠️ THE RAW CLIENT LIVES HERE, NOT IN A CALL SITE. Repo rule: every model
// call is routed through LlmService, which owns the ledger, the log line
// and the provider choice. This class only speaks HTTP; LlmService.decide()
// is the door a feature uses.
//
// API reference: POST https://api.typesafe.ai/v1/systemone
//   { state, model, questions: { <id>: Question } }
//   -> { model, answers: { <id>: Answer }, usage: { input_tokens, output_tokens } }
// Errors: 401 unauthorised, 422 bad request, 429 rate limited, 529 overloaded.
// Rate limits are dynamic; 429/529 are retried with backoff here.
// Pricing (models.md, 2026-10-01): $42 per Btok in = $0.042 per Mtok; output
// is free. Context 64k total, 32k for `state` plus the longest question.
// ────────────────────────────────────────────────────────────────────

import {
  LlmError,
  type JevAnswer,
  type JevDecideRequest,
  type JevDecideResponse,
  type JevQuestion,
} from './llm.types';

const BASE_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_JEV_MODEL = 'jev-latest';

/** One retry is enough for a moderation call — beyond that, fail the way
 *  the call site's ladder expects rather than stalling the request. */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

/** Backoff before attempt `n` (1-based), honouring a `retry-after` when the
 *  server sends one. Capped so a stuck call cannot hold a request open. */
function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, 5_000);
  return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), 4_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JevClient {
  isConfigured(): boolean {
    return Boolean(process.env.JEV_API_KEY);
  }

  /**
   * Ask one `state` a map of typed questions and return the typed answers.
   *
   * Throws `LlmError` on every failure — `not_configured` (no key),
   * `timeout`, `network`, `rate_limited` / `overloaded` (after retries),
   * `bad_request` (422, or an answer shape we do not recognise). Callers
   * own the fail-closed / fail-open decision; this class never guesses.
   */
  async decide(req: JevDecideRequest): Promise<JevDecideResponse> {
    if (!this.isConfigured()) {
      throw new LlmError(
        'not_configured',
        'typesafe is not configured — no JEV_API_KEY',
      );
    }

    const model = req.model ?? process.env.JEV_MODEL ?? DEFAULT_JEV_MODEL;
    const body = JSON.stringify({
      state: req.state,
      model,
      questions: req.questions,
    });

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.call(body, model, req.timeoutMs ?? 10_000);
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof LlmError &&
          (err.code === 'rate_limited' ||
            err.code === 'overloaded' ||
            err.code === 'timeout' ||
            err.code === 'network');
        if (!retryable || attempt === MAX_ATTEMPTS) throw err;
        await sleep(backoffMs(attempt, err instanceof LlmError ? err.retryAfterMs : undefined));
      }
    }
    throw lastErr;
  }

  private async call(
    body: string,
    model: string,
    timeoutMs: number,
  ): Promise<JevDecideResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.JEV_API_KEY}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new LlmError('timeout', 'typesafe request timed out');
      }
      throw new LlmError(
        'network',
        `typesafe network error: ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const retryAfter = this.retryAfterMs(res.headers.get('retry-after'));
      const text = await res.text().catch(() => '');
      const code: LlmError['code'] =
        res.status === 422
          ? 'bad_request'
          : res.status === 401 || res.status === 403
            ? 'not_configured'
            : res.status === 429
              ? 'rate_limited'
              : res.status === 529 || res.status >= 500
                ? 'overloaded'
                : 'unknown';
      throw new LlmError(
        code,
        `typesafe ${res.status}: ${text}`,
        res.status,
        retryAfter,
      );
    }

    const data = (await res.json()) as {
      model?: string;
      answers?: Record<string, unknown>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const answers = this.parseAnswers(data.answers);
    return {
      // The response reports the VERSIONED id (jev-1.13.0), not the alias —
      // the ledger records the exact model that answered, as elsewhere.
      model: data.model ?? model,
      answers,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      provider: 'typesafe',
    };
  }

  /**
   * Validate the answer map hard.
   *
   * ⚠️ AN UNKNOWN OR MALFORMED ANSWER IS A FAILED CALL, NOT A PASS. A
   * moderation battery that reads a missing `noul` as "no violation" is a
   * fail-OPEN gate on a safety path; the caller's ladder can only fall
   * closed if this throws.
   */
  private parseAnswers(
    raw: Record<string, unknown> | undefined,
  ): Record<string, JevAnswer> {
    if (!raw || typeof raw !== 'object') {
      throw new LlmError('bad_request', 'typesafe returned no answers');
    }
    const out: Record<string, JevAnswer> = {};
    for (const [key, value] of Object.entries(raw)) {
      out[key] = this.parseAnswer(key, value);
    }
    return out;
  }

  private parseAnswer(key: string, value: unknown): JevAnswer {
    if (!value || typeof value !== 'object') {
      throw new LlmError(
        'bad_request',
        `typesafe answer '${key}' is not an object`,
      );
    }
    const a = value as {
      type?: string;
      noul?: unknown;
      choice?: unknown;
      score?: unknown;
      legend?: unknown;
      probabilities?: unknown;
      confidence?: unknown;
    };
    if (a.type === 'noul') {
      const noul = Number(a.noul);
      if (!Number.isFinite(noul)) {
        throw new LlmError('bad_request', `typesafe noul '${key}' is not a number`);
      }
      return { type: 'noul', noul };
    }
    if (a.type === 'choice') {
      const confidence = Number(a.confidence);
      if (typeof a.choice !== 'string' || !Number.isFinite(confidence)) {
        throw new LlmError('bad_request', `typesafe choice '${key}' is malformed`);
      }
      return {
        type: 'choice',
        choice: a.choice,
        probabilities: this.numberMap(a.probabilities),
        confidence,
      };
    }
    if (a.type === 'score') {
      const score = Number(a.score);
      const confidence = Number(a.confidence);
      if (!Number.isFinite(score) || !Number.isFinite(confidence)) {
        throw new LlmError('bad_request', `typesafe score '${key}' is malformed`);
      }
      return {
        type: 'score',
        score,
        legend: this.stringMap(a.legend),
        probabilities: this.numberMap(a.probabilities),
        confidence,
      };
    }
    throw new LlmError(
      'bad_request',
      `typesafe answer '${key}' has unknown type '${String(a.type)}'`,
    );
  }

  private numberMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  }

  private stringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = String(v);
    }
    return out;
  }

  /** `retry-after` is either seconds or an HTTP date. Anything unparseable
   *  is left undefined and the caller backs off on its own schedule. */
  private retryAfterMs(header: string | null): number | undefined {
    if (!header) return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    return undefined;
  }
}

/** Re-exported so a caller can name the question type without reaching into
 *  llm.types.ts through the barrel. */
export type { JevQuestion };
