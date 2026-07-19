import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { MarketingService } from './marketing.service';

@Controller('admin/campaigns')
@UseGuards(AdminJwtGuard)
export class MarketingAdminController {
  constructor(private readonly marketing: MarketingService) {}

  @Get()
  list() {
    return this.marketing.adminList();
  }

  @Post()
  create(@Body() dto: { key?: string; name?: string; headline?: string }) {
    return this.marketing.adminCreate(dto);
  }

  @Post(':id/toggle')
  toggle(@Param('id') id: string) {
    return this.marketing.adminToggle(id);
  }
}
