import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { PrismaModule } from '../prisma/prisma.module';
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
  // ⚠️ AdminJwtGuard injects JwtService. Every module that mounts an admin
  // controller registers JwtModule for it; this one did not, and the first
  // deploy crash-looped the backend at boot (2026-09-07). Nest resolves
  // guards per module — a global import elsewhere does not cover it.
  // PrismaModule is @Global so this import is redundant at boot; it is here
  // so the module stands alone in the boot spec, the way LlmModule does.
  imports: [JwtModule.register({}), PrismaModule],
  controllers: [CrimeStatsController, CrimeStatsAdminController],
  // AdminJwtGuard is PROVIDED here, not merely referenced — same recipe as
  // licence-centre.module.ts, and the boot spec next to this file pins it.
  providers: [CrimeStatsService, CrimeStatsFetchService, AdminJwtGuard],
  exports: [CrimeStatsService, CrimeStatsFetchService],
})
export class CrimeStatsModule {}
