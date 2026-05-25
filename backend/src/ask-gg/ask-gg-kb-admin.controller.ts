import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AskGgKbService } from './ask-gg-kb.service';
import { AskGgKbStatus } from '@prisma/client';

/**
 * Admin-only endpoints for the Ask GG knowledge base (Phase C
 * Sprint 3 — verification queue).
 *
 *   GET    /admin/ask-gg/kb               list entries (filtered by status)
 *   PATCH  /admin/ask-gg/kb/:id           edit fields
 *   POST   /admin/ask-gg/kb/:id/verify    mark VERIFIED (reason required)
 *   POST   /admin/ask-gg/kb/:id/archive   soft-hide
 *   POST   /admin/ask-gg/kb/:id/unarchive flip ARCHIVED → DRAFT
 *   DELETE /admin/ask-gg/kb/:id           hard delete (reason required)
 *
 * Sits next to AskGgController in the same module — they share the
 * same backing service but use different guards (ClerkGuard vs
 * AdminJwtGuard).
 */
@Controller('admin/ask-gg/kb')
@UseGuards(AdminJwtGuard)
@SkipThrottle()
export class AskGgKbAdminController {
  constructor(
    private readonly kb: AskGgKbService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Default to DRAFT so the admin sees the queue first.
    const statusFilter =
      status && Object.values(AskGgKbStatus).includes(status as AskGgKbStatus)
        ? (status as AskGgKbStatus)
        : (AskGgKbStatus.DRAFT);
    return this.kb.adminList({
      status: status === 'ALL' ? undefined : statusFilter,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Patch(':id')
  async update(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      question?: string;
      answer?: string;
      category?: string | null;
      tags?: string[];
    },
  ) {
    const result = await this.kb.adminUpdate(id, body);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'ASKGG_KB_EDITED',
      resourceType: 'AskGgKbEntry',
      resourceId: id,
      newValue: body,
      reason: `Edited KB entry: ${Object.keys(body).join(', ')}`,
    });
    return result;
  }

  @Post(':id/verify')
  async verify(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const result = await this.kb.adminVerify(id, admin.sub);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'ASKGG_KB_VERIFIED',
      resourceType: 'AskGgKbEntry',
      resourceId: id,
      reason:
        body.reason?.trim() ||
        'Reviewed and verified for the user-facing search-first flow.',
    });
    return result;
  }

  @Post(':id/archive')
  async archive(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const result = await this.kb.adminArchive(id);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'ASKGG_KB_ARCHIVED',
      resourceType: 'AskGgKbEntry',
      resourceId: id,
      reason: body.reason?.trim() || 'Soft-hidden from user search.',
    });
    return result;
  }

  @Post(':id/unarchive')
  async unarchive(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const result = await this.kb.adminUnarchive(id);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'ASKGG_KB_UNARCHIVED',
      resourceType: 'AskGgKbEntry',
      resourceId: id,
      reason: body.reason?.trim() || 'Returned to DRAFT for re-review.',
    });
    return result;
  }

  @Delete(':id')
  async remove(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    // Record BEFORE the delete so the audit row survives.
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'ASKGG_KB_DELETED',
      resourceType: 'AskGgKbEntry',
      resourceId: id,
      reason:
        body.reason?.trim() ||
        'Hard-deleted (mis-collapsed conversation or unsalvageable content).',
    });
    return this.kb.adminDelete(id);
  }
}
