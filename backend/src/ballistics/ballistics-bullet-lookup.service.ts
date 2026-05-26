import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

/**
 * AI Bullet Lookup — the killer differentiator vs every other SA
 * ballistic app. User types "175gr Sierra MatchKing" and we return
 * a structured profile (weight, BC G1, BC G7, typical MV, drag
 * model recommendation) with a confidence pill.
 *
 * Pattern mirrors `AskGgClaudeService.identifyFromPhotos`: one-shot
 * `messages.create`, JSON-only system prompt, server-side parse +
 * field-by-field validation, cost-per-call returned to the caller
 * for the per-user spend dashboard.
 *
 * Model choice (Haiku 4.5):
 *   - Bullet ID is a recall task — Sonnet's strength isn't needed
 *   - ~$0.0003 per call vs Sonnet's ~$0.005
 *   - 500 lookups in a purchaser's lifetime ≈ $0.15 → R299 buys
 *     ~2000× cost coverage even at heavy use
 *
 * Override via env var ANTHROPIC_MODEL_BALLISTICS_LOOKUP without a
 * code change. Same approach the moderation services use.
 */
const MODEL_BULLET_LOOKUP =
  process.env.ANTHROPIC_MODEL_BALLISTICS_LOOKUP ?? 'claude-haiku-4-5';

// Per-MTok pricing for cost estimation. Mirrors AskGgClaudeService.
// Kept in this file (vs. importing) so the ballistics module stays
// independent of ask-gg's internals.
const HAIKU_PRICE_PER_MTOK = { input: 0.25, output: 1.25 };

export interface BulletLookupResult {
  /** Canonical bullet name as Claude returned it (best effort). */
  name: string | null;
  manufacturer: string | null;
  weightGr: number | null;
  /** Bullet diameter in inches, when Claude can identify the calibre
   *  family. Optional — display-only. */
  diameterIn: number | null;
  bcG1: number | null;
  bcG7: number | null;
  /** Recommended drag model based on bullet design. */
  recommendedDragModel: 'G1' | 'G7';
  /** Typical published MV from a 24" barrel, fps. The user should
   *  override with the actual chronograph reading for their rifle. */
  typicalMvFps: number | null;
  /** Bullet construction — display chip. */
  bulletType:
    | 'match'
    | 'hunting-soft-point'
    | 'hunting-bonded'
    | 'hunting-monolithic'
    | 'hunting-ballistic-tip'
    | 'fmj-target'
    | 'varmint'
    | null;
  confidence: 'high' | 'medium' | 'low';
  /** Plain-text source citation Claude provides ("Sierra reloading
   *  manual 6th ed", "Hornady 2025 datasheet", etc). Display-only. */
  sources: string[];
  /** Free-text notes — e.g. "no published G7 BC; G1 only" or "MV
   *  varies widely between 22" and 26" barrels". */
  notes: string | null;
  /** Raw JSON Claude returned. Kept for audit when the parsed result
   *  looks suspicious. */
  rawText: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
}

@Injectable()
export class BallisticsBulletLookupService {
  private readonly logger = new Logger(BallisticsBulletLookupService.name);
  private readonly client: Anthropic | null;

  constructor() {
    // Graceful no-op when key isn't configured — matches the rest of
    // the codebase. Local dev without ANTHROPIC_API_KEY still boots
    // and the lookup endpoint returns a "service unavailable" shape.
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = key ? new Anthropic({ apiKey: key }) : null;
    if (!this.client) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — BallisticsBulletLookupService is a no-op',
      );
    }
  }

  async lookup(query: string): Promise<BulletLookupResult> {
    const emptyResult: BulletLookupResult = {
      name: null,
      manufacturer: null,
      weightGr: null,
      diameterIn: null,
      bcG1: null,
      bcG7: null,
      recommendedDragModel: 'G1',
      typicalMvFps: null,
      bulletType: null,
      confidence: 'low',
      sources: [],
      notes: null,
      rawText: '',
      model: MODEL_BULLET_LOOKUP,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
    };

    if (!this.client) {
      return { ...emptyResult, notes: 'AI lookup temporarily unavailable.' };
    }

    const cleaned = query.trim();
    if (cleaned.length < 2 || cleaned.length > 200) {
      return {
        ...emptyResult,
        notes: 'Lookup query must be 2-200 characters.',
      };
    }

    // JSON-only system prompt. Same pattern as identifyFromPhotos.
    const system = `You are a ballistics-data assistant for a South African long-range shooting app. The user supplies a bullet description (e.g. "175gr SMK", "Hornady 140 ELD-Match", "Berger 215 Hybrid"). Return a STRICT JSON object with the bullet's manufacturer-published ballistic data.

Output ONLY the JSON object — no markdown fence, no preamble, no explanation.

Schema:
{
  "name": string | null,                    // Canonical bullet name as on the box: "Sierra MatchKing 175gr HPBT"
  "manufacturer": string | null,            // "Sierra", "Hornady", "Berger", "Nosler", "Barnes", "Lapua", "PMP", etc.
  "weightGr": number | null,                // Bullet mass in grains (160, 168, 175, 215, 300 etc.)
  "diameterIn": number | null,              // 0.224, 0.243, 0.264, 0.277, 0.284, 0.308, 0.338, 0.375 etc. — bullet diameter in inches
  "bcG1": number | null,                    // G1 ballistic coefficient (most common — published for nearly every bullet)
  "bcG7": number | null,                    // G7 BC — only return if the manufacturer publishes one (boat-tail spitzers + match bullets typically)
  "recommendedDragModel": "G1" | "G7",      // For boat-tail match bullets, prefer "G7". For flat-base hunting bullets, "G1".
  "typicalMvFps": number | null,            // Typical published muzzle velocity from a 24" test barrel, fps (e.g. .308 168 SMK ≈ 2650)
  "bulletType": "match" | "hunting-soft-point" | "hunting-bonded" | "hunting-monolithic" | "hunting-ballistic-tip" | "fmj-target" | "varmint" | null,
  "confidence": "high" | "medium" | "low",  // How sure you are this is a real, published bullet vs. a guess
  "sources": string[],                      // ≤ 3 plain-text manufacturer-source citations: ["Sierra Reloading Manual 6th Ed", "Hornady 2025 datasheet"]
  "notes": string | null                    // Anything the user should know: "MV varies with barrel length", "no published G7", "South African import — check stock"
}

Rules:
- Manufacturer-published data ONLY. If you're not sure, set the field to null and confidence:"low".
- If you can't identify the bullet at all (gibberish query, wrong calibre, etc.), return all fields null with confidence:"low" and notes explaining why.
- For "best guess" matches (e.g. user typed "168 match .308") pick the most popular bullet matching that description — Sierra MatchKing — and set confidence:"medium". Add a notes line acknowledging the assumption.
- Prefer SA-popular bullets where multiple matches are plausible: Sierra, Hornady, Berger, Nosler, Barnes, Lapua, PMP, Somchem-loaded.
- Return G7 BCs ONLY for actual boat-tail / VLD / hybrid match bullets. Never fabricate a G7 BC for flat-base hunting bullets.
- typicalMvFps is a starting point. The user will refine with their actual chronograph reading.`;

    try {
      const r = await this.client.messages.create({
        model: MODEL_BULLET_LOOKUP,
        max_tokens: 600,
        system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Identify this bullet and return its ballistic data per the schema in your instructions: ${cleaned}`,
              },
            ],
          },
        ],
      });

      const textBlock = r.content.find((b) => b.type === 'text');
      const rawText =
        textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      let parsed: Partial<BulletLookupResult> = {};
      if (jsonMatch) {
        try {
          const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          parsed = {
            name: typeof obj.name === 'string' ? obj.name.slice(0, 200) : null,
            manufacturer:
              typeof obj.manufacturer === 'string'
                ? obj.manufacturer.slice(0, 60)
                : null,
            weightGr: this.coerceNumber(obj.weightGr, { min: 5, max: 1000 }),
            diameterIn: this.coerceNumber(obj.diameterIn, {
              min: 0.1,
              max: 1,
            }),
            bcG1: this.coerceNumber(obj.bcG1, { min: 0.05, max: 1.5 }),
            bcG7: this.coerceNumber(obj.bcG7, { min: 0.05, max: 1 }),
            recommendedDragModel:
              obj.recommendedDragModel === 'G7' ? 'G7' : 'G1',
            typicalMvFps: this.coerceNumber(obj.typicalMvFps, {
              min: 300,
              max: 5000,
            }),
            bulletType: this.coerceBulletType(obj.bulletType),
            confidence: ['high', 'medium', 'low'].includes(
              String(obj.confidence),
            )
              ? (obj.confidence as 'high' | 'medium' | 'low')
              : 'low',
            sources: Array.isArray(obj.sources)
              ? obj.sources
                  .filter((s): s is string => typeof s === 'string')
                  .slice(0, 3)
                  .map((s) => s.slice(0, 120))
              : [],
            notes:
              typeof obj.notes === 'string' ? obj.notes.slice(0, 500) : null,
          };
        } catch (parseErr) {
          this.logger.warn(
            `bullet-lookup JSON parse failed for "${cleaned.slice(
              0,
              80,
            )}": ${parseErr instanceof Error ? parseErr.message : parseErr}`,
          );
        }
      }

      const promptTokens = r.usage?.input_tokens ?? null;
      const completionTokens = r.usage?.output_tokens ?? null;
      const costUsd = this.estimateCostUsd(
        promptTokens ?? 0,
        completionTokens ?? 0,
      );

      return {
        ...emptyResult,
        ...parsed,
        rawText,
        model: MODEL_BULLET_LOOKUP,
        promptTokens,
        completionTokens,
        costUsd,
      };
    } catch (err) {
      this.logger.error(
        `bullet-lookup failed for "${cleaned.slice(0, 80)}": ${
          err instanceof Error ? err.message : err
        }`,
      );
      return {
        ...emptyResult,
        notes: 'AI lookup failed — please try again or enter the bullet manually.',
      };
    }
  }

  private coerceNumber(
    v: unknown,
    bounds?: { min?: number; max?: number },
  ): number | null {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    if (bounds?.min !== undefined && n < bounds.min) return null;
    if (bounds?.max !== undefined && n > bounds.max) return null;
    return n;
  }

  private coerceBulletType(
    v: unknown,
  ): BulletLookupResult['bulletType'] | null {
    const valid = [
      'match',
      'hunting-soft-point',
      'hunting-bonded',
      'hunting-monolithic',
      'hunting-ballistic-tip',
      'fmj-target',
      'varmint',
    ] as const;
    return (valid as readonly string[]).includes(String(v))
      ? (v as BulletLookupResult['bulletType'])
      : null;
  }

  private estimateCostUsd(
    promptTokens: number,
    completionTokens: number,
  ): number | null {
    if (promptTokens === 0 && completionTokens === 0) return null;
    const inputCost =
      (promptTokens / 1_000_000) * HAIKU_PRICE_PER_MTOK.input;
    const outputCost =
      (completionTokens / 1_000_000) * HAIKU_PRICE_PER_MTOK.output;
    return Number((inputCost + outputCost).toFixed(6));
  }
}
