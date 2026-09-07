import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { NewsService } from './news.service';

/**
 * Global: the motivation generator, the wizard's incidents step and the
 * nightly poll all read the same table.
 *
 * ⚠️ JwtModule.register({}) AND AdminJwtGuard IN PROVIDERS, from day one.
 * CrimeStatsModule shipped without them and crash-looped the backend for four
 * minutes on 2026-09-07 while tsc and every unit test were green. A boot
 * spec next to this file compiles the module the way the app does.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), PrismaModule],
  providers: [NewsService, AdminJwtGuard],
  exports: [NewsService],
})
export class NewsModule {}
