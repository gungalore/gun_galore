import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BiomeLookupService } from '../region-flora/biome-lookup.service';
import { RangeEstimatorClaudeService } from './range-estimator-claude.service';
import type { EstimateRangeBody } from './dto/estimate-range.dto';

/**
 * Input shape for the orchestrator — combines the parsed body fields
 * with the uploaded photo + device identity.
 */
export interface EstimateRangeInput extends EstimateRangeBody {
  deviceId: string;
  photo: Express.Multer.File;
}

/**
 * Result shape returned to the frontend. Matches lib/api/estimate-range.ts
 * EstimateRangeResponse in the hunt-ballistics repo so the typed
 * client doesn't have to re-shape anything.
 */
export interface EstimateRangeResult {
  rangeM: number;
  confidence: number;
  species?: string;
  notes?: string;
  modelUsed: 'sonnet' | 'opus';
}

/** Round per the system prompt's contract: ≤200m → 5m steps,
 *  200-500m → 10m steps, >500m → 25m steps. The AI is asked to round
 *  itself, but we enforce on the server too so callers always see
 *  consistent precision regardless of which model produced the answer. */
function roundRange(rangeM: number): number {
  if (rangeM <= 200) return Math.round(rangeM / 5) * 5;
  if (rangeM <= 500) return Math.round(rangeM / 10) * 10;
  return Math.round(rangeM / 25) * 25;
}

/**
 * RangeEstimatorService — orchestrates the AI range-estimation flow.
 *
 * Responsibilities:
 *   1. Look up regional flora from GPS (if coordinates provided)
 *   2. Call the Claude service with photo + metadata + biome context
 *   3. Persist the result row for the future map-plot feature
 *   4. Return the typed result to the controller
 *
 * The Claude integration itself lives in RangeEstimatorClaudeService
 * (W3) — this class is the orchestrator that wires biome lookup +
 * persistence around it.
 *
 * Current state (W1):
 *   - Biome lookup hook is live (returns null until W2 data lands).
 *   - Claude call is stubbed: throws 503 so the frontend gets a clear
 *     "deploying" error instead of a silent hang.
 *
 * Hooks for later waypoints:
 *   - W3: replace the 503 with a RangeEstimatorClaudeService call.
 *   - W4: persist the result to a RangeEstimate Prisma row before
 *     returning.
 */
@Injectable()
export class RangeEstimatorService {
  private readonly logger = new Logger(RangeEstimatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly biomes: BiomeLookupService,
    private readonly claude: RangeEstimatorClaudeService,
  ) {}

  async estimate(input: EstimateRangeInput): Promise<EstimateRangeResult> {
    const biome =
      input.latitude != null && input.longitude != null
        ? this.biomes.lookup(input.latitude, input.longitude)
        : null;

    // Trim the deviceId for logs — full UUID isn't useful and bloats
    // log lines. First 8 chars is enough to correlate request → row.
    const deviceShort = input.deviceId.slice(0, 8);
    this.logger.log(
      `estimate request: device=${deviceShort}… ` +
        `photo=${input.photo.size}B (${input.photo.mimetype}) ` +
        `tilt=${input.tiltDeg ?? '—'} ` +
        `heading=${input.headingDeg ?? '—'} ` +
        `gps=${input.latitude ?? '—'},${input.longitude ?? '—'} ` +
        `biome=${biome?.id ?? 'none'} ` +
        `knownSpecies=${input.knownSpecies?.length ?? 0}`,
    );

    const claudeResult = await this.claude.estimate({
      photo: input.photo,
      body: {
        regionCode: input.regionCode,
        tiltDeg: input.tiltDeg,
        headingDeg: input.headingDeg,
        latitude: input.latitude,
        longitude: input.longitude,
        knownSpecies: input.knownSpecies,
        aimRegion: input.aimRegion,
      },
      biome,
    });

    // Server-side rounding so all callers see consistent precision.
    const rangeM = roundRange(claudeResult.rangeM);

    this.logger.log(
      `estimate result: device=${deviceShort}… ` +
        `range=${rangeM}m ` +
        `conf=${claudeResult.confidence.toFixed(2)} ` +
        `species=${claudeResult.species ?? '—'} ` +
        `model=${claudeResult.modelUsed} ` +
        `cost=$${claudeResult.costUsd?.toFixed(4) ?? '—'} ` +
        `tokens=${claudeResult.promptTokens}in/${claudeResult.completionTokens}out`,
    );

    // Fire-and-forget persistence — never let a DB failure block the
    // user-facing response. We log + swallow on failure. The frontend
    // already has its result; losing one historical row to a transient
    // Postgres blip is fine.
    void this.persist({
      deviceId: input.deviceId,
      lat: input.latitude ?? null,
      lng: input.longitude ?? null,
      headingDeg: input.headingDeg ?? null,
      tiltDeg: input.tiltDeg ?? null,
      rangeM,
      confidence: claudeResult.confidence,
      species: claudeResult.species,
      notes: claudeResult.notes,
      modelUsed: claudeResult.modelUsed,
      biomeId: biome?.id ?? null,
      regionCode: input.regionCode ?? null,
      costUsd: claudeResult.costUsd,
      promptTokens: claudeResult.promptTokens,
      completionTokens: claudeResult.completionTokens,
    }).catch((err) => {
      this.logger.error(
        `Persist failed (request still returned to user): ${
          err instanceof Error ? err.message : err
        }`,
      );
    });

    return {
      rangeM,
      confidence: claudeResult.confidence,
      species: claudeResult.species ?? undefined,
      notes: claudeResult.notes ?? undefined,
      modelUsed: claudeResult.modelUsed,
    };
  }

  private async persist(data: {
    deviceId: string;
    lat: number | null;
    lng: number | null;
    headingDeg: number | null;
    tiltDeg: number | null;
    rangeM: number;
    confidence: number;
    species: string | null;
    notes: string | null;
    modelUsed: 'sonnet' | 'opus';
    biomeId: string | null;
    regionCode: string | null;
    costUsd: number | null;
    promptTokens: number;
    completionTokens: number;
  }): Promise<void> {
    await this.prisma.rangeEstimate.create({ data });
  }
}
