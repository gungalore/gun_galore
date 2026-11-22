import { Global, Module } from '@nestjs/common';
import { YocoService } from './yoco.service';

// YocoService is a dependency-free adapter (it injects nothing), so making it
// @Global lets the motivation paygate inject it without importing a heavy
// module graph — the same pattern as OzowModule and PeachModule.
//
// ⚠️ YOCO IS THE MOTIVATION PAYGATE'S RAIL ONLY. It is not registered as a
// marketplace pay-in method and no Transaction is ever stamped YOCO.
@Global()
@Module({
  providers: [YocoService],
  exports: [YocoService],
})
export class YocoModule {}
