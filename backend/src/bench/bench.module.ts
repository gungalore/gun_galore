import { Module } from '@nestjs/common';
import { BenchService } from './bench.service';
import { BenchController } from './bench.controller';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { ContentAccessGuard } from '../auth/content-access.guard';

/**
 * THE BENCH — the reverse load finder.
 *
 * PrismaService comes from the @Global() PrismaModule. AuthGuard comes from the
 * @Global() AuthModule.
 *
 * ⚠️ OptionalAuthGuard AND ContentAccessGuard ARE PROVIDED HERE, NOT MERELY
 * IMPORTED. Nest resolves a controller's `@UseGuards` classes inside the
 * controller's OWN module; a guard that is only exported from another module
 * (global or not) can still fail to instantiate, and the failure is a
 * crash-loop at boot while tsc and every unit test stay green. Same wiring as
 * listings.module.ts, which mounts the same pair on its public reads.
 */
@Module({
  controllers: [BenchController],
  providers: [BenchService, OptionalAuthGuard, ContentAccessGuard],
  exports: [BenchService],
})
export class BenchModule {}
