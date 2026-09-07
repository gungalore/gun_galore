import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/**
 * Global on purpose: fifteen modules call a model, and a provider switch is a
 * platform decision, not fifteen module decisions. Import nothing; inject
 * LlmService anywhere.
 */
@Global()
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
