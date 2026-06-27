import { Module } from '@nestjs/common';
import { BallisticsModule } from '../ballistics/ballistics.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { ComponentDataService } from './component-data.service';
import { LoadLabService } from './load-lab.service';
import { RecommendedLoadsService } from './recommended-loads.service';
import { LoadLabController } from './load-lab.controller';

/**
 * Load Lab module — internal-ballistics engine + downrange chaining behind a
 * PRO-gated HTTP surface. Exports LoadLabService + ComponentDataService so
 * AskGgModule can wire the `computeLoadData` Claude tool. Imports
 * BallisticsModule (external solver), Prisma + Users (for ClerkGuard +
 * the tier lookup).
 */
@Module({
  imports: [BallisticsModule, PrismaModule, UsersModule],
  controllers: [LoadLabController],
  providers: [ComponentDataService, LoadLabService, RecommendedLoadsService],
  exports: [LoadLabService, ComponentDataService, RecommendedLoadsService],
})
export class LoadLabModule {}
