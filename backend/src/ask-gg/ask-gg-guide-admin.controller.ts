import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AskGgGuideService } from './ask-gg-guide.service';

/**
 * GG site-guide (G5) — admin editor for the per-page guide playbooks.
 *
 *   GET    /admin/ask-gg/guides            catalog: every key + override status
 *   GET    /admin/ask-gg/guides/:key       one key: shipped default + override
 *   PUT    /admin/ask-gg/guides/:key       save the content edit (stays DRAFT
 *                                          for a fresh key; preserves status on
 *                                          an existing row)
 *   POST   /admin/ask-gg/guides/:key/publish     take the draft live
 *   POST   /admin/ask-gg/guides/:key/unpublish   revert users to the default
 *   DELETE /admin/ask-gg/guides/:key       discard the override → shipped default
 *
 * The static GUIDES catalog stays the source of truth for WHICH keys exist;
 * these endpoints only change a key's CONTENT. AdminJwtGuard-gated (same wiring
 * as the KB admin controller) with every write recorded to the audit trail.
 */
@Controller('admin/ask-gg/guides')
@UseGuards(AdminJwtGuard)
@SkipThrottle()
export class AskGgGuideAdminController {
  constructor(
    private readonly guide: AskGgGuideService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list() {
    return this.guide.adminListGuides();
  }

  @Get(':key')
  one(@Param('key') key: string) {
    return this.guide.adminGetGuide(key);
  }

  @Put(':key')
  async save(
    @CurrentAdmin() admin: { sub: string },
    @Param('key') key: string,
    @Body()
    body: {
      title?: unknown;
      intro?: unknown;
      points?: unknown;
      ctas?: unknown;
    },
  ) {
    const result = await this.guide.adminSaveGuide(key, body, admin.sub);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'ASKGG_GUIDE_EDITED',
      resourceType: 'AskGgGuideOverride',
      resourceId: key,
      reason: `Edited the "${key}" page guide.`,
    });
    return result;
  }

  @Post(':key/publish')
  async publish(
    @CurrentAdmin() admin: { sub: string },
    @Param('key') key: string,
  ) {
    const result = await this.guide.adminPublishGuide(key, admin.sub);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'ASKGG_GUIDE_PUBLISHED',
      resourceType: 'AskGgGuideOverride',
      resourceId: key,
      reason: `Published the "${key}" page guide to users.`,
    });
    return result;
  }

  @Post(':key/unpublish')
  async unpublish(
    @CurrentAdmin() admin: { sub: string },
    @Param('key') key: string,
  ) {
    const result = await this.guide.adminUnpublishGuide(key, admin.sub);
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'ASKGG_GUIDE_UNPUBLISHED',
      resourceType: 'AskGgGuideOverride',
      resourceId: key,
      reason: `Reverted the "${key}" page guide to the shipped default.`,
    });
    return result;
  }

  @Delete(':key')
  async reset(
    @CurrentAdmin() admin: { sub: string },
    @Param('key') key: string,
  ) {
    // Record BEFORE the delete so the audit row survives.
    await this.audit.record({
      adminUserId: admin.sub,
      action: 'ASKGG_GUIDE_RESET',
      resourceType: 'AskGgGuideOverride',
      resourceId: key,
      reason: `Discarded the "${key}" guide override (back to shipped default).`,
    });
    return this.guide.adminResetGuide(key);
  }
}
