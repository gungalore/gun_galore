import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

// User-initiated listing/seller reports → AdminAlert (trust-safety queue).
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
