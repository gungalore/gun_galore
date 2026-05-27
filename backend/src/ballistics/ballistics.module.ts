import { Module } from '@nestjs/common';
import { BallisticsService } from './ballistics.service';

/**
 * Standalone ballistics module — pure-math service, no DB or HTTP
 * dependencies. Exported for any module that wants to wire the
 * calculator into a Claude tool-use loop (currently AskGgModule).
 *
 * Kept in its own module so future surfaces (ballistic-table page,
 * mobile app, dealer tools) can pull it without dragging in
 * AskGg-specific deps.
 */
@Module({
  providers: [BallisticsService],
  exports: [BallisticsService],
})
export class BallisticsModule {}
