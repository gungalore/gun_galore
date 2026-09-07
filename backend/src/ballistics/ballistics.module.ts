import { Module } from '@nestjs/common';
import { BallisticsService } from './ballistics.service';

/**
 * Standalone ballistics module — pure-math service, no DB or HTTP
 * dependencies.
 *
 * ⚠️ Its one consumer used to be the Ask GG chat's tool loop, RETIRED
 * 2026-09-07 — AskGgModule no longer imports this. Kept in its own module
 * so the surfaces that do use the maths (the range estimator, the
 * ballistic-table page, dealer tools) can pull it on its own.
 */
@Module({
  providers: [BallisticsService],
  exports: [BallisticsService],
})
export class BallisticsModule {}
