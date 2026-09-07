import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { LlmModule } from '../common/llm/llm.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NewsAdminController } from './news-admin.controller';
import { NewsController } from './news.controller';
import { NewsPollService } from './news-poll.service';
import { NewsService } from './news.service';

/**
 * Global: the motivation generator, the wizard's incidents step and the
 * nightly poll all read the same table.
 *
 * ⚠️ JwtModule.register({}) AND AdminJwtGuard IN PROVIDERS, from day one.
 * CrimeStatsModule shipped without them and crash-looped the backend for four
 * minutes on 2026-09-07 while tsc and every unit test were green. A boot
 * spec next to this file compiles the module the way the app does.
 *
 * ⚠️ LlmModule is imported even though it is itself @Global, for the same
 * reason PrismaModule is: the boot spec compiles THIS module alone, and a
 * dependency that only resolves because some other module happens to be
 * loaded first is exactly the class of failure that spec exists to catch.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), PrismaModule, LlmModule],
  controllers: [NewsController, NewsAdminController],
  providers: [NewsService, NewsPollService, AdminJwtGuard],
  exports: [NewsService, NewsPollService],
})
export class NewsModule {}
