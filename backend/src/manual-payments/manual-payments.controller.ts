import {
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  BadRequestException,
  Query,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { ManualPaymentsService } from './manual-payments.service';

// Admin surfaces for the manual-EFT reconciliation:
//   - upload the daily FNB statement CSV (authoritative reconcile)
//   - the unmatched/ambiguous investigation queue
//   - upload history
//   - a manual "scan inbox now" trigger (the 10-min cron does this too)
@Controller('admin/manual-payments')
@UseGuards(AdminJwtGuard)
export class ManualPaymentsController {
  constructor(private readonly manual: ManualPaymentsService) {}

  // Upload an FNB statement CSV → reconcile the day's credits against
  // awaiting orders. This is the AUTHORITATIVE step that confirms
  // payments + notifies sellers.
  @Post('statement')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadStatement(
    @CurrentAdmin() admin: { sub: string },
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ) {
    const name = (file.originalname ?? '').toLowerCase();
    if (!name.endsWith('.csv')) {
      throw new BadRequestException('Please upload the FNB statement as a .csv file');
    }
    const content = file.buffer.toString('utf8');
    return this.manual.reconcileStatement(content, file.originalname, admin.sub);
  }

  // The admin investigation queue — payments we saw but could not bind
  // to an order (wrong/missing reference or amount mismatch).
  @Get('unmatched')
  unmatched(@Query('limit') limit?: string) {
    return this.manual.listUnmatched(limit ? Number(limit) : 100);
  }

  @Get('uploads')
  uploads() {
    return this.manual.listRecentUploads();
  }

  // Manual trigger for the inContact inbox scan (the 10-min cron runs
  // this automatically; this is for on-demand admin use / testing).
  @Post('scan')
  scan() {
    return this.manual.scanInbox();
  }

  // Preview of what's due now — seller payouts (RELEASED) + buyer refunds
  // (REFUNDED), excluding anything already frozen into a batch or paid out.
  @Get('payouts-due')
  payoutsDue() {
    return this.manual.getPayoutsDue();
  }

  // P1.3 — every entity whose latest Zoho Books sync FAILED, in one list.
  @Get('zoho-failed')
  zohoFailed() {
    return this.manual.getZohoFailedSyncs();
  }

  // P1.4 — held-funds position: how much of the FNB balance is client
  // money (held orders + owed payouts + owed refunds + held swap cash).
  @Get('held-funds')
  heldFunds() {
    return this.manual.getHeldFundsReport();
  }

  // ── Payout batches (freeze-on-download) ─────────────────────────────
  // Freeze EXACTLY what's due now into a PENDING batch + generate the FNB
  // file. Those rows leave the due queue; the operator pays in FNB then
  // marks THIS batch paid.
  @Post('payout-batches')
  createPayoutBatch(@CurrentAdmin() admin: { sub: string }) {
    return this.manual.createPayoutBatch(admin.sub);
  }

  // History of batches (pending + paid + cancelled).
  @Get('payout-batches')
  listPayoutBatches(@Query('limit') limit?: string) {
    return this.manual.listPayoutBatches(limit ? Number(limit) : 30);
  }

  @Get('payout-batches/:id')
  getPayoutBatch(@Param('id') id: string) {
    return this.manual.getPayoutBatch(id);
  }

  // Re-download a frozen batch's exact FNB CSV.
  @Get('payout-batches/:id.csv')
  async payoutBatchCsv(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.manual.getPayoutBatchCsv(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gungalore-payout-batch-${id}.csv"`,
    );
    res.send(csv);
  }

  // Settle: the operator confirms they made the FNB bulk payment for this
  // batch. Stamps each line paid + fires the Zoho book entries.
  @Post('payout-batches/:id/mark-paid')
  markPayoutBatchPaid(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
  ) {
    return this.manual.markPayoutBatchPaid(id, admin.sub);
  }

  // Abandon a pending batch — returns its lines to the due queue.
  @Post('payout-batches/:id/cancel')
  cancelPayoutBatch(@Param('id') id: string) {
    return this.manual.cancelPayoutBatch(id);
  }
}
