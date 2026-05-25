import { Module } from '@nestjs/common';
import { AskGgService } from './ask-gg.service';
import { AskGgClaudeService } from './ask-gg-claude.service';
import { AskGgQuotaService } from './ask-gg-quota.service';
import { AskGgController } from './ask-gg.controller';
import { ReloadingModule } from '../reloading/reloading.module';

@Module({
  // ReloadingModule exports ReloadingService so AskGgClaudeService can
  // call searchPages + slicePagesAsPdf when answering reloading
  // questions (Phase D Sprint 2 tool-use loop).
  imports: [ReloadingModule],
  controllers: [AskGgController],
  providers: [AskGgService, AskGgClaudeService, AskGgQuotaService],
  exports: [AskGgService],
})
export class AskGgModule {}
