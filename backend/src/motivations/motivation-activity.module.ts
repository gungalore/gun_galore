import { Module } from '@nestjs/common';
import { MotivationActivityService } from './motivation-activity.service';

/**
 * The support timeline, on its own.
 *
 * ⚠️ SEPARATE FROM MotivationsModule ON PURPOSE. The bug-report path needs the
 * activity reader, and importing the whole motivations graph for it dragged a
 * dozen providers into BugsModule's boot — and into its boot spec. This module
 * depends on nothing but the global PrismaService, so either side can import
 * it without a cycle or a test that needs the writer.
 */
@Module({
  providers: [MotivationActivityService],
  exports: [MotivationActivityService],
})
export class MotivationActivityModule {}
