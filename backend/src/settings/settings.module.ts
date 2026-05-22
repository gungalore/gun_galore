import { Module, Global } from '@nestjs/common';
import { SettingsService } from './settings.service';

// Global because almost every module reads a flag from time to time.
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
