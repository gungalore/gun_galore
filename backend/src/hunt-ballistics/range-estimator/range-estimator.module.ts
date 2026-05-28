import { Module } from '@nestjs/common';
import { RangeEstimatorController } from './range-estimator.controller';
import { RangeEstimatorService } from './range-estimator.service';
import { RangeEstimatorClaudeService } from './range-estimator-claude.service';
import { RegionFloraModule } from '../region-flora/region-flora.module';

/**
 * Range Estimator — POST /hunt-ballistics/estimate-range.
 *
 * Depends on RegionFloraModule for the GPS → biome lookup that
 * supplies regional plant references to the AI system prompt.
 *
 * W4 adds PrismaModule for RangeEstimate row persistence.
 */
@Module({
  imports: [RegionFloraModule],
  controllers: [RangeEstimatorController],
  providers: [RangeEstimatorService, RangeEstimatorClaudeService],
})
export class RangeEstimatorModule {}
