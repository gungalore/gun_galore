import { Global, Module } from '@nestjs/common';
import { CrimeStatsService } from './crime-stats.service';
import { CrimeStatsFetchService } from './crime-stats-fetch.service';
import { CrimeStatsController } from './crime-stats.controller';
import { CrimeStatsAdminController } from './crime-stats-admin.controller';

/**
 * Global: the motivation generator, the wizard's station picker and the
 * weekly fetch all read the same table, and none of them should have to
 * import a module to ask "what did SAPS record here".
 *
 * ⚠️ `CrimeStatsFetchService` is exported too. It is not just the cron's
 * home — `scripts/crime-stats-load.ts` and the admin "Fetch now" button both
 * drive it, and a module that keeps it private would force them to rebuild
 * the whole ingest by hand.
 */
@Global()
@Module({
  controllers: [CrimeStatsController, CrimeStatsAdminController],
  providers: [CrimeStatsService, CrimeStatsFetchService],
  exports: [CrimeStatsService, CrimeStatsFetchService],
})
export class CrimeStatsModule {}
