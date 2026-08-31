import { Module } from '@nestjs/common';
import { DocQuadService } from './docquad.service';
import { ScanController } from './scan.controller';

// DocQuadService holds a lazily-built ORT session and is stateful, so it is a
// normal singleton provider rather than @Global — only this module needs it,
// and a second instance would mean a second 13MB model in memory.
@Module({
  controllers: [ScanController],
  providers: [DocQuadService],
  exports: [DocQuadService],
})
export class ScanModule {}
