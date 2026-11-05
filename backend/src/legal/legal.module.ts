import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/**
 * The searchable firearms-law corpus. AuthGuard is provided locally even
 * though AuthModule is @Global: a guarded controller resolves its guard in its
 * own module, and a missing provider is a boot-loop that tsc cannot see.
 */
@Module({
  controllers: [LegalController],
  providers: [AuthGuard, LegalService],
  exports: [LegalService],
})
export class LegalModule {}
