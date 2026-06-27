import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { SupportService } from './support.service';

// Admin-facing support queue (Phase 7 P7.2).
@Controller('admin/support')
@UseGuards(AdminJwtGuard)
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.support.listForAdmin(status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.support.getForAdmin(id);
  }

  @Post(':id/reply')
  reply(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { body?: string },
  ) {
    return this.support.replyAsAdmin(admin.sub, id, body?.body ?? '');
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@CurrentAdmin() admin: { sub: string }, @Param('id') id: string) {
    return this.support.resolve(admin.sub, id);
  }
}
