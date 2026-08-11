import { Module } from '@nestjs/common';
import { RangeEstimatorModule } from './range-estimator/range-estimator.module';
import { RegionFloraModule } from './region-flora/region-flora.module';
import { InfoCentreModule } from './info-centre/info-centre.module';

/**
 * Hunt Ballistics — aggregator module for the standalone Hunt Ballistics
 * iOS app's backend endpoints. These live alongside the All Outdoor
 * marketplace but are namespaced under /api/hunt-ballistics/* so the
 * two products' surfaces never collide.
 *
 * Sub-modules:
 * - RangeEstimatorModule: POST /hunt-ballistics/estimate-range
 *     (AI camera ranging — Sonnet/Opus vision inference)
 * - RegionFloraModule:    GPS → biome lookup with regional plant
 *     reference data, used as scale anchors by the AI prompt.
 *
 * Authentication: Hunt Ballistics uses anonymous device-UUID identity
 * (X-Device-Id header) per the product's CLAUDE.md, not Clerk. Each
 * controller reads the header directly; no guard at this level.
 */
@Module({
  imports: [RangeEstimatorModule, RegionFloraModule, InfoCentreModule],
})
export class HuntBallisticsModule {}
