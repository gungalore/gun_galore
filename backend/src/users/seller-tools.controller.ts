import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SellerToolsService, SellerPeriod } from './seller-tools.service';

// Seller self-service tools (Phase 6). All Clerk-guarded + scoped to the
// signed-in seller inside the service (every query filters on their id).
@Controller('sellers/me')
@UseGuards(ClerkGuard)
export class SellerToolsController {
  constructor(private readonly tools: SellerToolsService) {}

  @Get('statement')
  statement(
    @CurrentUser() clerkId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.tools.payoutStatement(clerkId, from, to);
  }

  @Get('statement.csv')
  async statementCsv(
    @CurrentUser() clerkId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.tools.payoutStatementCsv(clerkId, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gungalore-payout-statement-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }

  @Get('analytics')
  analytics(
    @CurrentUser() clerkId: string,
    @Query('period') period: SellerPeriod = '30d',
  ) {
    return this.tools.analytics(clerkId, period);
  }
}
