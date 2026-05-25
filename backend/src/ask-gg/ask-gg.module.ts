import { Module } from '@nestjs/common';
import { AskGgService } from './ask-gg.service';
import { AskGgClaudeService } from './ask-gg-claude.service';
import { AskGgQuotaService } from './ask-gg-quota.service';
import { AskGgController } from './ask-gg.controller';

@Module({
  controllers: [AskGgController],
  providers: [AskGgService, AskGgClaudeService, AskGgQuotaService],
  exports: [AskGgService],
})
export class AskGgModule {}
