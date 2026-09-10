import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReportsService } from './reports.service';

interface ReportBody {
  reason?: string;
  note?: string;
}

// User-initiated reports. Signed-in only (cuts spam + ties a reporter to the
// alert) and tightly throttled — reporting is rare per user.
@Controller('reports')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('listing/:id')
  reportListing(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: ReportBody,
  ) {
    return this.reports.reportListing(id, userId, body?.reason, body?.note);
  }

  @Post('seller/:userId')
  reportSeller(
    @CurrentUser() userId: string,
    @Param('userId') sellerId: string,
    @Body() body: ReportBody,
  ) {
    return this.reports.reportSeller(
      sellerId,
      userId,
      body?.reason,
      body?.note,
    );
  }
}
