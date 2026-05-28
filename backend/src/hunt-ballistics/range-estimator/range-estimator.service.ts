import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BiomeLookupService } from '../region-flora/biome-lookup.service';
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

  constructor(private readonly biomes: BiomeLookupService) {}

  async estimate(input: EstimateRangeInput): Promise<EstimateRangeResult> {
    const biome =
      input.latitude != null && input.longitude != null
        ? this.biomes.lookup(input.latitude, input.longitude)
        : null;

    // Trim the deviceId for logs — full UUID isn't useful and bloats
    // log lines. First 8 chars is enough to correlate request → row.
    this.logger.log(
      `estimate request: ` +
        `device=${input.deviceId.slice(0, 8)}… ` +
        `photo=${input.photo.size}B (${input.photo.mimetype}) ` +
        `tilt=${input.tiltDeg ?? '—'} ` +
        `heading=${input.headingDeg ?? '—'} ` +
        `gps=${input.latitude ?? '—'},${input.longitude ?? '—'} ` +
        `biome=${biome?.id ?? 'none'} ` +
        `knownSpecies=${input.knownSpecies?.length ?? 0}`,
    );

    // W3 will replace this with a real RangeEstimatorClaudeService call:
    //   const result = await this.claude.estimate({ ...input, biome });
    //
    // W4 will then persist the result:
    //   await this.prisma.rangeEstimate.create({ data: { ...result, ... } });
    //
    // Returning 503 (not 500) signals "feature being deployed" to the
    // frontend — RangeEstimator.tsx surfaces this as a friendly
    // error-card message rather than the angry-red "server crashed" UI.
    throw new ServiceUnavailableException(
      'Range Estimator is being deployed — Claude integration ships in W3.',
    );
  }
}
