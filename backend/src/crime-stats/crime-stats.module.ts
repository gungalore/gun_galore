import { Global, Module } from '@nestjs/common';
import { CrimeStatsService } from './crime-stats.service';

/**
 * Global: the motivation generator, the wizard's station picker and the
 * weekly fetch all read the same table, and none of them should have to
 * import a module to ask "what did SAPS record here".
 */
@Global()
@Module({
  providers: [CrimeStatsService],
  exports: [CrimeStatsService],
})
export class CrimeStatsModule {}
