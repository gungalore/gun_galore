import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { ComponentDataService } from './component-data.service';
import { RecommendedLoadsService } from './recommended-loads.service';
import { BurnChartService } from './burn-chart.service';
import { ManualBrowseService } from './manual-browse.service';
import { LoadLabController } from './load-lab.controller';

/**
 * Load Lab module — the PRO-gated manual-load browser + the free powder
 * burn-rate chart, over a signed-in HTTP surface. The internal-ballistics
 * calculator was removed 2026-07-13 (operator decision); Load Lab now serves
 * published manual data only. Exports the read services AskGgModule wires into
 * its `lookupPublishedLoads` / `lookupPowderInfo` tools.
 */
@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [LoadLabController],
  providers: [ComponentDataService, RecommendedLoadsService, BurnChartService, ManualBrowseService],
  exports: [ComponentDataService, RecommendedLoadsService, BurnChartService],
})
export class LoadLabModule {}
