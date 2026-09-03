import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { ComplaintsService } from './complaints.service';

// Admin complaints register (backs the /complaints page's "logged, assigned
// an owner, recorded with its outcome" promise).
@Controller('admin/complaints')
@UseGuards(AdminJwtGuard)
export class ComplaintsAdminController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.complaints.adminList(
      status,
      page ? parseInt(page, 10) || 1 : 1,
      limit ? parseInt(limit, 10) || 50 : 50,
    );
  }

  /**
   * ⚠️ DECLARED BEFORE THE PATCH, and it is a GET so the two cannot collide —
   * but keep it above any future parameterised GET for the same reason
   * 'bulk-resolve' sits above ':id' on the alerts controller.
   */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.complaints.adminGet(id);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body()
    body: { status?: string; assignedAdminId?: string; outcome?: string },
  ) {
    return this.complaints.adminUpdate(admin.sub, id, body);
  }
}
