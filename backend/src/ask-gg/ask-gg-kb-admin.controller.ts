import {
  BadRequestException,
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

/**
 * Verified-expert badge admin surface (Phase E1 — OD2).
 *
 *   GET    /admin/ask-gg/experts/queue     users with 5+ verified KB, not yet badged
 *   GET    /admin/ask-gg/experts/granted   already-badged experts (for revoke)
 *   GET    /admin/ask-gg/experts/:userId/eligibility   single-user snapshot
 *   POST   /admin/users/:userId/verified-expert/grant  flip true (reason required)
 *   POST   /admin/users/:userId/verified-expert/revoke flip false (reason required)
 *
 * Lives in the AskGg module because the eligibility logic is
 * AskGg-specific (counts VERIFIED KB entries). The grant/revoke
 * endpoints sit under /admin/users/:id so they read naturally next
 * to other USER_* admin actions (ban, KYC override, tier change).
 */
@Controller()
@UseGuards(AdminJwtGuard)
@SkipThrottle()
export class AskGgExpertAdminController {
  constructor(
    private readonly kb: AskGgKbService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('admin/ask-gg/experts/queue')
  expertQueue(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.kb.getExpertQueue({
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('admin/ask-gg/experts/granted')
  expertGranted(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.kb.getGrantedExperts({
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('admin/ask-gg/experts/:userId/eligibility')
  expertEligibility(@Param('userId') userId: string) {
    return this.kb.getExpertEligibility(userId);
  }

  @Post('admin/users/:userId/verified-expert/grant')
  async grant(
    @CurrentAdmin() admin: { sub: string },
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
  ) {
    // Pre-check eligibility so the audit row is clean (we record
    // BOTH the new badge state AND the trailing eligibility count).
    const before = await this.kb.getExpertEligibility(userId);
    const reason = body.reason?.trim();
    if (!reason) {
      // AdminAuditService throws on empty reason; intercept earlier
      // with a clearer message tied to the badge action.
      throw new BadRequestException(
        'A reason is required to grant the verified-expert badge.',
      );
    }
    const updated = await this.kb.setVerifiedExpert(userId, true, reason);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'USER_VERIFIED_EXPERT_AWARDED',
      resourceType: 'User',
      resourceId: userId,
      oldValue: { isVerifiedExpert: false },
      newValue: {
        isVerifiedExpert: true,
        verifiedKbCount: before.verifiedKbCount,
        threshold: before.threshold,
      },
      reason,
    });
    return updated;
  }

  @Post('admin/users/:userId/verified-expert/revoke')
  async revoke(
    @CurrentAdmin() admin: { sub: string },
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
  ) {
    const reason = body.reason?.trim();
    if (!reason) {
      throw new (await import('@nestjs/common')).BadRequestException(
        'A reason is required to revoke the verified-expert badge.',
      );
    }
    const updated = await this.kb.setVerifiedExpert(userId, false, reason);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'USER_VERIFIED_EXPERT_REVOKED',
      resourceType: 'User',
      resourceId: userId,
      oldValue: { isVerifiedExpert: true },
      newValue: { isVerifiedExpert: false },
      reason,
    });
    return updated;
  }
}
