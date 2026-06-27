import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReportsService } from './reports.service';

interface ReportBody {
  reason?: string;
  note?: string;
}

// User-initiated reports. Signed-in only (cuts spam + ties a reporter to the
// alert) and tightly throttled — reporting is rare per user.
@Controller('reports')
@UseGuards(ClerkGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('listing/:id')
  reportListing(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: ReportBody,
  ) {
    return this.reports.reportListing(id, clerkId, body?.reason, body?.note);
  }

  @Post('seller/:clerkId')
  reportSeller(
    @CurrentUser() clerkId: string,
    @Param('clerkId') sellerClerkId: string,
    @Body() body: ReportBody,
  ) {
    return this.reports.reportSeller(
      sellerClerkId,
      clerkId,
      body?.reason,
      body?.note,
    );
  }
}
