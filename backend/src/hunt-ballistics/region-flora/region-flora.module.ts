import { Module } from '@nestjs/common';
import { BiomeLookupService } from './biome-lookup.service';

/**
 * Region flora — exports BiomeLookupService for any module that wants
 * region-specific plant data. Currently used by RangeEstimatorModule
 * to inject reference-scale plants into the AI prompt; future hooks
 * include Spot Tracker BC-9 (fall-point recovery context) and hunt
 * journal (auto-tagging hunts with biome).
 */
@Module({
  providers: [BiomeLookupService],
  exports: [BiomeLookupService],
})
export class RegionFloraModule {}
