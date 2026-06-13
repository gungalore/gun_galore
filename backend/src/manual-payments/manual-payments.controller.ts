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
} from '@nestjs/common';
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
}
