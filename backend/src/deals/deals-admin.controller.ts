import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { DealsService } from './deals.service';
import {
  CreateDealDto,
  UpdateDealDto,
  ScheduleDealDto,
  ExtendDealDto,
  DealActionDto,
} from './dto/deal.dto';

/**
 * Admin-only Daily Deals cockpit (DD-1).
 *
 *   GET    /admin/deals                list (optional ?status= filter)
 *   GET    /admin/deals/:id            single deal + metrics
 *   POST   /admin/deals                create (→ DRAFT)
 *   PATCH  /admin/deals/:id            edit (DRAFT / SCHEDULED only)
 *   POST   /admin/deals/:id/schedule   set go-live window (→ SCHEDULED)
 *   POST   /admin/deals/:id/go-live    (→ LIVE)
 *   POST   /admin/deals/:id/extend     Extra Time (→ EXTENDED)
 *   POST   /admin/deals/:id/end        (→ ENDED)
 *   POST   /admin/deals/:id/cancel     (→ CANCELLED)
 *   POST   /admin/deals/:id/duplicate  clone into a fresh DRAFT
 *   DELETE /admin/deals/:id            hard-delete a DRAFT/CANCELLED deal
 *   POST   /admin/deals/:id/images     upload a photo
 *   DELETE /admin/deals/:id/images/:imageId  remove a photo
 *
 * Every mutation is audited in DealsService. The whole surface is INERT in
 * DD-1 — no public /deals storefront, no money path, no drop cron. The
 * lifecycle transitions are admin bookkeeping only.
 */
@Controller('admin/deals')
@UseGuards(AdminJwtGuard)
@SkipThrottle()
export class DealsAdminController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.deals.list(status);
  }

  // DD-5 — first-party P&L. MUST be declared before @Get(':id') or the
  // literal 'pnl' segment is captured as an :id. Optional ISO from/to filters
  // the deals by their go-live date.
  @Get('pnl')
  pnl(@Query('from') from?: string, @Query('to') to?: string) {
    const parse = (s?: string) => {
      if (!s) return undefined;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? undefined : d;
    };
    return this.deals.pnlReport({ from: parse(from), to: parse(to) });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.deals.findOne(id);
  }

  @Post()
  create(@CurrentAdmin() admin: { sub: string }, @Body() dto: CreateDealDto) {
    return this.deals.create(admin.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
  ) {
    return this.deals.update(admin.sub, id, dto);
  }

  @Post(':id/schedule')
  schedule(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: ScheduleDealDto,
  ) {
    return this.deals.schedule(admin.sub, id, dto);
  }

  @Post(':id/go-live')
  goLive(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: DealActionDto,
  ) {
    return this.deals.goLive(admin.sub, id, dto?.reason);
  }

  @Post(':id/extend')
  extend(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: ExtendDealDto,
  ) {
    return this.deals.extend(admin.sub, id, dto);
  }

  @Post(':id/end')
  end(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: DealActionDto,
  ) {
    return this.deals.end(admin.sub, id, dto?.reason);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: DealActionDto,
  ) {
    return this.deals.cancel(admin.sub, id, dto?.reason);
  }

  @Post(':id/duplicate')
  duplicate(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: DealActionDto,
  ) {
    return this.deals.duplicate(admin.sub, id, dto?.reason);
  }

  @Delete(':id')
  remove(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: DealActionDto,
  ) {
    return this.deals.remove(admin.sub, id, dto?.reason);
  }

  @Post(':id/images')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  addImage(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 }), // 8 MB
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.deals.addImage(admin.sub, id, file);
  }

  @Delete(':id/images/:imageId')
  removeImage(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.deals.removeImage(admin.sub, id, imageId);
  }
}
