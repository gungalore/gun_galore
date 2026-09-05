import { Module } from '@nestjs/common';
import { DocCornerService } from './doccorner.service';
import { ScanController } from './scan.controller';

// DocCornerService holds a lazily-built ORT session and is stateful, so it is a
// normal singleton provider rather than @Global — only this module needs it,
// and a second instance would mean a second model in memory.
@Module({
  controllers: [ScanController],
  providers: [DocCornerService],
  exports: [DocCornerService],
})
export class ScanModule {}
