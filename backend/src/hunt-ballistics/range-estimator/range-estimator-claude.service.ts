import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import {
  UNIVERSAL_REFERENCES,
  type UniversalReference,
  type UniversalReferenceCategory,
} from '../region-flora/universal-references';
import type { BiomeProfile } from '../region-flora/sa-biomes';
import type {
  AimRegion,
  EstimateRangeBody,
} from './dto/estimate-range.dto';

// ─── Model strategy ──────────────────────────────────────────────────
// Two-stage Sonnet → Opus fallback. Sonnet 4.6 handles the common case
// (clear subject + good references) cheaply (~$0.01/call). Opus 4.1 is
// the second-opinion model when Sonnet's confidence comes back below
// HB_RANGE_OPUS_THRESHOLD (default 0.7). Opus is ~5× the cost so we
// only spend it when we have evidence the first pass was uncertain.
//
// All three knobs are env-overridable so the operator can A/B different
// model versions / thresholds without a code change.

const MODEL_SONNET =
  process.env.ANTHROPIC_MODEL_HB_RANGE_DEFAULT ?? 'claude-sonnet-4-6';
const MODEL_OPUS =
  process.env.ANTHROPIC_MODEL_HB_RANGE_FALLBACK ?? 'claude-opus-4-1';
const OPUS_FALLBACK_THRESHOLD = parseFloat(
  process.env.HB_RANGE_OPUS_THRESHOLD ?? '0.7',
);

// Max tokens for the JSON response. The shape is tiny ({rangeM,
// confidence, species, notes}); 512 is more than enough even with
// long notes.
const MAX_TOKENS = 512;

// ─── Cost table (USD per million tokens, by model) ───────────────────
// Mirrors the table in ask-gg-claude.service.ts. Update both when the
// operator refreshes pricing.
const PRICES_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
};

function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  if (promptTokens === 0 && completionTokens === 0) return null;
  const p = PRICES_PER_MTOK_USD[model];
  if (!p) return null;
  return Number(
    (
      (promptTokens / 1_000_000) * p.input +
      (completionTokens / 1_000_000) * p.output
    ).toFixed(6),
  );
}

// ─── Prompt sections ────────────────────────────────────────────────
// Three blocks; the first two are STABLE and cached via cache_control:
// ephemeral. The third varies per request (biome flora) so it's
// rebuilt each call.

const CORE_INSTRUCTIONS = `You are an expert range estimator for South African hunters. Your job is to analyse a single photo + sensor metadata and return a calibrated distance estimate from the photographer's camera to the subject they were aiming at.

## METHOD — strict priority order

You have three reasoning paths. WORK THROUGH THEM IN ORDER; don't jump to a lower path until you've exhausted the higher one. Cross-check whenever you can.

1. **KNOWN-SIZE on the SUBJECT** — Identify what's in the aim DOT first. If nothing identifiable there, look at what's TOUCHING the BOX (any object whose pixels intersect the box). Use the subject's typical SA size to back-calculate distance from its apparent size in the frame. Phone is an iPhone main camera (~26 mm equivalent, ~63° horizontal field of view).

2. **REFERENCE-OBJECT in the HORIZONTAL BAND** (preferred over other-frame references) — A horizontal band is defined at the same image-Y as the dot, spanning the full width of the frame (see AIM REGION SEMANTICS below). On flat-ish terrain, objects in the band are at SIMILAR PHYSICAL DISTANCES to the camera as the subject is, due to perspective. Prefer reference objects found in the band — a fence post, vehicle, tree, person, crop row — because their apparent size directly gives you the subject's distance. If the band has nothing identifiable, fall back to other-frame references (the regional biome + universal lists below).

3. **SCENE-REASONING** (fallback) — When no clear references exist anywhere, reason from ground plane angle, horizon position, atmospheric perspective, terrain compression. Wide uncertainty; flag low confidence.

CROSS-CHECK: if you find two references that disagree by more than 20%, REDUCE confidence and say so in notes. If the band reference and a non-band reference agree, trust the band reference more.

## AIM REGION SEMANTICS

The hunter framed the shot with three concentric zones, each with a specific role:

- **DOT** — centerX, centerY, radius dotR (~1% of frame diameter). The PRECISE aim point. Try to identify whatever's exactly here first.

- **BOX** — centred on the dot, ~8% × 8% square. Sized to encompass a small SA car (Hyundai i10 / Toyota Yaris class, ~1.5 m × 3.7 m) at 200 m on an iPhone main camera, with safety margin. THE BOX IS ITSELF A REFERENCE SCALE — if you can't identify what's inside it, you still know that whatever fills the box is approximately car-at-200m sized in apparent angular extent. If the dot landed on empty terrain, expand your subject search to anything TOUCHING the box (pixels intersecting any of its edges).

- **BAND** — bandTop and bandBottom (Y-coordinates 0..1, 0 = top of frame), full frame width, vertically centred on the dot, typically ~15% of frame height. This is your PREFERRED region to hunt for scale references because, on flat ground, objects at the same image-Y as the subject are at the same physical distance. Use objects here as your primary distance anchors.

So your search-order priority:
1. Identify the subject in the DOT
2. If empty, anything touching the BOX
3. Reference objects in the BAND for distance anchoring
4. Reference objects elsewhere in the frame (as a fallback)
5. Scene reasoning (last resort)

## SENSOR METADATA (in the user message)

- **tiltDeg**: pitch in degrees at shutter. NEGATIVE = aiming downhill, POSITIVE = aiming uphill, 0 = horizontal. Affects how you read the ground plane — don't assume flat veld if tilt says you're aiming 15° down a slope.
- **headingDeg**: compass bearing. Not used for estimation; logged for future map plotting.
- **latitude / longitude**: GPS at capture. Used to provide the regional flora hint (see "BIOME CONTEXT" below if present in the user message).
- **knownSpecies**: optional shortlist of quarry the hunter is targeting on this trip. If your guess matches one of these, your confidence on species ID should rise.
- **regionCode**: ISO alpha-2; usually "ZA" for South Africa.

## OUTPUT FORMAT — STRICT JSON

Return **ONLY** a JSON object matching this schema. NO markdown fence, NO preamble, NO explanation outside the JSON:

\`\`\`
{
  "rangeM":     number,         // metres from camera to subject
  "confidence": number,         // 0..1 self-assessed
  "species":    string | null,  // identified subject; null if unsure
  "notes":      string | null   // 1-2 sentences: what references you used + why your confidence is what it is
}
\`\`\`

### Confidence calibration (be honest):
- **0.85-1.0**: Multiple cross-checked references + clear known-size subject + good conditions
- **0.70-0.85**: One good reference + identifiable subject
- **0.50-0.70**: Marginal reference OR partial subject ID
- **<0.50**: No reference, scene reasoning only — say so in notes

### Rounding rangeM:
- **Under 200 m**: round to nearest 5 m
- **200-500 m**: round to nearest 10 m
- **500 m+**: round to nearest 25 m
- Don't pretend more precision than the AI vision can deliver.

If you genuinely cannot estimate (photo too dark, no subject, no references, can't tell which way is up), return rangeM as your best guess with confidence < 0.3 and explain in notes. Do NOT refuse — give an estimate with appropriate uncertainty.`;

function formatUniversalSection(refs: ReadonlyArray<UniversalReference>): string {
  // Group by category, render each group as a labelled bullet list.
  // Order: invasive trees → plantations → crops → orchards →
  // vineyards → sugarcane → infra → irrigation → hay → vehicles →
  // people. Familiar narrative order.
  const order: UniversalReferenceCategory[] = [
    'invasive-tree',
    'plantation',
    'field-crop',
    'orchard',
    'vineyard',
    'sugarcane',
    'farm-infrastructure',
    'irrigation',
    'hay-bale',
    'vehicle',
    'person',
  ];
  const labels: Record<UniversalReferenceCategory, string> = {
    'invasive-tree': 'INVASIVE / INTRODUCED TREES',
    plantation: 'PLANTATION FORESTRY',
    'field-crop': 'FIELD CROPS (varmint-hunting context)',
    orchard: 'ORCHARDS (baboon + monkey + bushpig context)',
    vineyard: 'VINEYARDS (W Cape — caracal context)',
    sugarcane: 'SUGAR CANE (KZN — bushpig + caracal context)',
    'farm-infrastructure': 'FARM INFRASTRUCTURE (almost always in frame)',
    irrigation: 'IRRIGATION',
    'hay-bale': 'HAY BALES',
    vehicle: 'VEHICLES',
    person: 'PEOPLE (primary calibration when visible)',
  };

  const lines: string[] = [
    '## UNIVERSAL SCALE REFERENCES (SA-calibrated, trans-biome)',
    '',
    "These appear in SA hunting photos across all biomes. Sizes are SA-typical, not the global maximums — e.g. SA plantation eucalypts top out around 25-30 m, not 40 m+.",
    '',
  ];

  for (const cat of order) {
    const items = refs.filter((r) => r.category === cat);
    if (items.length === 0) continue;
    lines.push(`### ${labels[cat]}`);
    for (const r of items) {
      const parts: string[] = [];
      // Name + Afrikaans
      const name = r.afrikaans
        ? `${r.english} (${r.afrikaans})`
        : r.english;
      parts.push(`- **${name}**`);
      if (r.scientific) parts.push(` (${r.scientific})`);
      // Dimensions
      const dims: string[] = [];
      if (r.heightM) dims.push(`h ${r.heightM.min}-${r.heightM.max} m`);
      if (r.widthM) dims.push(`w ${r.widthM.min}-${r.widthM.max} m`);
      if (r.spacingM)
        dims.push(`spacing ${r.spacingM.min}-${r.spacingM.max} m`);
      if (dims.length > 0) parts.push(` — ${dims.join(', ')}`);
      if (r.notes) parts.push(`. ${r.notes}`);
      lines.push(parts.join(''));
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatBiomeSection(biome: BiomeProfile | null): string {
  if (!biome) {
    return [
      '## REGIONAL BIOME — NOT AVAILABLE',
      '',
      'GPS not provided or coordinate falls outside our SA biome data. Use the universal references above + visual reasoning only. Note this in your confidence rationale.',
    ].join('\n');
  }

  // Group plants by vertical layer for cleaner reasoning.
  const lines: string[] = [
    `## REGIONAL BIOME — ${biome.name}`,
    '',
    biome.description,
    '',
    `Reference vegetation typical of this biome. SA-calibrated heights.`,
    '',
  ];

  const layers = [
    { key: 'ground' as const, label: 'GROUND COVER' },
    { key: 'shrub' as const, label: 'SHRUBS (low cover)' },
    { key: 'mid-canopy' as const, label: 'MID-CANOPY (bushes + small trees)' },
    { key: 'tree' as const, label: 'TREES (mature scale anchors)' },
  ];

  for (const layer of layers) {
    const plants = biome.plants.filter((p) => p.layer === layer.key);
    if (plants.length === 0) continue;
    lines.push(`### ${layer.label}`);
    for (const p of plants) {
      const dims: string[] = [
        `h ${p.heightM.min}-${p.heightM.max} m`,
      ];
      if (p.canopyM)
        dims.push(`canopy ${p.canopyM.min}-${p.canopyM.max} m`);
      const namePart = `${p.english} / ${p.afrikaans}`;
      const sciPart = ` (*${p.scientific}*)`;
      const notesPart = p.notes ? `. ${p.notes}` : '';
      lines.push(`- **${namePart}**${sciPart} — ${dims.join(', ')}${notesPart}`);
    }
    lines.push('');
  }

  lines.push(
    'When you see ANY of these in the photo, use them as scale references. ' +
      'You may ALSO use plants/objects not listed (eucalypts, jacarandas, ' +
      'fence posts, vehicles, people, etc. — see universal references). ' +
      'The biome list is a HINT, not exhaustive.',
  );

  return lines.join('\n');
}

function formatUserMessage(
  body: EstimateRangeBody,
  biome: BiomeProfile | null,
): string {
  const parts: string[] = ['Estimate the range to the subject in this photo.', ''];

  parts.push('## SENSOR METADATA');
  parts.push('');
  parts.push(
    `- regionCode: ${body.regionCode ?? '(not provided)'}`,
  );
  parts.push(
    `- tiltDeg: ${
      body.tiltDeg != null
        ? body.tiltDeg.toFixed(1) + '°'
        : '(not provided)'
    }`,
  );
  parts.push(
    `- headingDeg: ${
      body.headingDeg != null
        ? body.headingDeg.toFixed(1) + '°'
        : '(not provided — captured for map plot, not for estimation)'
    }`,
  );
  parts.push(
    `- latitude: ${
      body.latitude != null ? body.latitude.toFixed(5) : '(not provided)'
    }`,
  );
  parts.push(
    `- longitude: ${
      body.longitude != null ? body.longitude.toFixed(5) : '(not provided)'
    }`,
  );
  parts.push(
    `- knownSpecies (quarry shortlist): ${
      body.knownSpecies && body.knownSpecies.length > 0
        ? body.knownSpecies.join(', ')
        : '(not provided)'
    }`,
  );

  parts.push('');
  parts.push('## AIM REGION (normalised 0..1 fractions of the photo)');
  parts.push('');
  if (body.aimRegion) {
    const a = body.aimRegion;
    parts.push(`- DOT centre: (${a.centerX}, ${a.centerY})`);
    parts.push(`- DOT radius: ${a.dotR} (of min(width, height))`);
    parts.push(
      `- BOX: ${a.boxW} wide × ${a.boxH} tall, centred on dot (= small-car-at-200m angular size)`,
    );
    if (a.bandTop != null && a.bandBottom != null) {
      parts.push(
        `- BAND: y=${a.bandTop} to y=${a.bandBottom}, full frame width (PREFERRED region for scale references — same physical distance as the subject on flat ground)`,
      );
    } else {
      parts.push(
        `- BAND: (not provided) — assume a horizontal band ~15% tall centred on the dot's Y`,
      );
    }
  } else {
    parts.push(
      '- (not provided) — assume subject is centred; use the whole frame for references',
    );
  }

  parts.push('');
  parts.push(formatBiomeSection(biome));
  parts.push('');
  parts.push('Return the JSON now. No preamble, no markdown fence.');

  return parts.join('\n');
}

// ─── Service ────────────────────────────────────────────────────────

export interface RangeEstimatorClaudeInput {
  /** The uploaded photo. Buffer + MIME type. */
  photo: Express.Multer.File;
  /** Parsed sensor metadata + aim region. */
  body: EstimateRangeBody;
  /** Regional biome profile from GPS lookup, or null if outside SA / no GPS. */
  biome: BiomeProfile | null;
}

export interface RangeEstimatorClaudeResult {
  /** Estimated range in metres. */
  rangeM: number;
  /** AI confidence 0..1. */
  confidence: number;
  /** Identified species/subject (null if unsure). */
  species: string | null;
  /** Notes from the AI explaining reasoning + references used. */
  notes: string | null;
  /** Which model produced the FINAL answer. */
  modelUsed: 'sonnet' | 'opus';
  /** Sum of input tokens across all passes (Sonnet + Opus if fallback fired). */
  promptTokens: number;
  /** Sum of output tokens across all passes. */
  completionTokens: number;
  /** Approximate USD cost across all passes. */
  costUsd: number | null;
}

/**
 * RangeEstimatorClaudeService — wraps the Anthropic SDK for the
 * range-estimation flow. Two-stage Sonnet → Opus fallback with strict
 * JSON parsing and graceful no-op when ANTHROPIC_API_KEY is missing.
 *
 * Follows the same fail-open pattern as AskGgClaudeService: if the
 * API key isn't configured, return a low-confidence placeholder so
 * the frontend can surface a friendly "AI temporarily offline"
 * instead of a 5xx.
 */
@Injectable()
export class RangeEstimatorClaudeService {
  private readonly logger = new Logger(RangeEstimatorClaudeService.name);
  private readonly client: Anthropic | null;
  private readonly universalSection: string;

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
    if (!this.client) {
      this.logger.warn(
        'ANTHROPIC_API_KEY missing — Range Estimator will return a placeholder ' +
          'response instead of calling Claude. Set the key in env to enable.',
      );
    }
    // Pre-build the universal section once; it never changes per request.
    this.universalSection = formatUniversalSection(UNIVERSAL_REFERENCES);
  }

  isReady(): boolean {
    return this.client !== null;
  }

  async estimate(
    input: RangeEstimatorClaudeInput,
  ): Promise<RangeEstimatorClaudeResult> {
    if (!this.client) {
      return {
        rangeM: 0,
        confidence: 0,
        species: null,
        notes:
          'AI temporarily offline — the AI service is not configured on this server. The operator has been notified.',
        modelUsed: 'sonnet',
        promptTokens: 0,
        completionTokens: 0,
        costUsd: null,
      };
    }

    // Pass 1 — Sonnet.
    const pass1 = await this.callClaude(MODEL_SONNET, input);

    // If confidence is good enough, ship it.
    if (pass1.confidence >= OPUS_FALLBACK_THRESHOLD) {
      return {
        ...pass1,
        modelUsed: 'sonnet',
      };
    }

    // Pass 2 — Opus, with a brief escalation hint added to the user message.
    this.logger.log(
      `Sonnet returned confidence ${pass1.confidence.toFixed(2)} ` +
        `(< threshold ${OPUS_FALLBACK_THRESHOLD}) — escalating to Opus.`,
    );
    const pass2 = await this.callClaude(MODEL_OPUS, input, {
      escalation: true,
    });

    // Combine token totals; return whichever pass had higher confidence.
    const pickOpus = pass2.confidence >= pass1.confidence;
    const winner = pickOpus ? pass2 : pass1;
    return {
      ...winner,
      modelUsed: pickOpus ? 'opus' : 'sonnet',
      promptTokens: pass1.promptTokens + pass2.promptTokens,
      completionTokens: pass1.completionTokens + pass2.completionTokens,
      costUsd: addCosts(pass1.costUsd, pass2.costUsd),
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  private async callClaude(
    model: string,
    input: RangeEstimatorClaudeInput,
    opts: { escalation?: boolean } = {},
  ): Promise<Omit<RangeEstimatorClaudeResult, 'modelUsed'>> {
    if (!this.client) {
      throw new Error('Claude client not initialised');
    }

    // System: 3 blocks. First two cached.
    const systemBlocks: TextBlockParam[] = [
      { type: 'text', text: CORE_INSTRUCTIONS },
      {
        type: 'text',
        text: this.universalSection,
        cache_control: { type: 'ephemeral' },
      },
    ];

    const userText = formatUserMessage(input.body, input.biome);
    const escalationNote = opts.escalation
      ? '\n\n[NOTE: Previous pass returned low confidence. Take more time to think through the scale references carefully. Cross-check multiple anchors. If genuinely uncertain, say so honestly in notes.]'
      : '';

    const userContent: ContentBlockParam[] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.photo.mimetype as
            | 'image/jpeg'
            | 'image/png'
            | 'image/webp',
          data: input.photo.buffer.toString('base64'),
        },
      },
      { type: 'text', text: userText + escalationNote },
    ];

    let r;
    try {
      r = await this.client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: systemBlocks,
        messages: [{ role: 'user', content: userContent }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Claude API error';
      this.logger.error(`Claude call failed (${model}): ${message}`);
      throw err;
    }

    const promptTokens = r.usage?.input_tokens ?? 0;
    const completionTokens = r.usage?.output_tokens ?? 0;
    const costUsd = estimateCostUsd(model, promptTokens, completionTokens);

    const textBlock = r.content.find((b) => b.type === 'text');
    const rawText =
      textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

    const parsed = parseJsonResponse(rawText);
    if (!parsed) {
      this.logger.warn(
        `Claude returned unparseable JSON from ${model}. Raw: ${rawText.slice(0, 200)}…`,
      );
      // Return a degraded result rather than throwing — the controller's
      // higher-level error handler can decide whether to retry.
      return {
        rangeM: 0,
        confidence: 0,
        species: null,
        notes: `AI returned a malformed response from ${model}. Raw start: ${rawText.slice(0, 80)}…`,
        promptTokens,
        completionTokens,
        costUsd,
      };
    }

    return {
      rangeM: parsed.rangeM,
      confidence: parsed.confidence,
      species: parsed.species,
      notes: parsed.notes,
      promptTokens,
      completionTokens,
      costUsd,
    };
  }
}

// ─── JSON parsing ───────────────────────────────────────────────────

interface ParsedResponse {
  rangeM: number;
  confidence: number;
  species: string | null;
  notes: string | null;
}

function parseJsonResponse(rawText: string): ParsedResponse | null {
  // Defend against an accidental ```json fence even though the prompt
  // says no fence — Claude occasionally adds one anyway.
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (
    typeof obj.rangeM !== 'number' ||
    !Number.isFinite(obj.rangeM) ||
    obj.rangeM < 0
  ) {
    return null;
  }
  if (
    typeof obj.confidence !== 'number' ||
    !Number.isFinite(obj.confidence) ||
    obj.confidence < 0 ||
    obj.confidence > 1
  ) {
    return null;
  }

  return {
    rangeM: obj.rangeM,
    confidence: obj.confidence,
    species:
      typeof obj.species === 'string' && obj.species.length > 0
        ? obj.species.slice(0, 80)
        : null,
    notes:
      typeof obj.notes === 'string' && obj.notes.length > 0
        ? obj.notes.slice(0, 500)
        : null,
  };
}

function addCosts(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return Number(((a ?? 0) + (b ?? 0)).toFixed(6));
}

// Re-export AimRegion so the controller layer doesn't need to know
// about both files.
export type { AimRegion };
