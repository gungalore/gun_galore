import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LlmService } from './llm.service';

/**
 * Global on purpose: fifteen modules call a model, and a provider switch is a
 * platform decision, not fifteen module decisions. Import nothing; inject
 * LlmService anywhere.
 */
@Global()
@Module({
  // ⚠️ PrismaModule is itself @Global, so this import is redundant AT BOOT —
  // it is here so LlmModule stands alone in a testing module, and so that a
  // future reshuffle of the global modules cannot silently break the usage
  // ledger's only dependency.
  imports: [PrismaModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
