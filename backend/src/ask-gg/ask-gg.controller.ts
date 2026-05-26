import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AskGgService } from './ask-gg.service';
import { AskGgKbService } from './ask-gg-kb.service';
import { maxPhotosPerRequest } from './ask-gg-quota.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { AskGgConversationOutcome } from '@prisma/client';

/**
 * /ask-gg routes — Ask GG chat assistant.
 *
 *   POST   /ask-gg/messages                            send a new message
 *   POST   /ask-gg/uploads                             upload 1–5 photos for chat (Phase B)
 *   POST   /ask-gg/identify-listing                    one-shot photo ID for /listings/new (Phase B)
 *   GET    /ask-gg/conversations                       list user's conversations
 *   GET    /ask-gg/quota                               current quota snapshot (messages + photos)
 *   GET    /ask-gg/conversations/:id                   single conversation
 *   POST   /ask-gg/conversations/:id/resolved          mark outcome
 *
 * All routes are Clerk-authed and tier-gated (MEMBER + PRO only)
 * inside the service. POST /messages gets a stricter throttle bucket
 * because each call is a real Claude API hit costing real money.
 */
@Controller('ask-gg')
@UseGuards(ClerkGuard)
export class AskGgController {
  constructor(
    private readonly askGg: AskGgService,
    private readonly kb: AskGgKbService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // 30 messages per minute per IP cap. Belt-and-braces alongside the
  // future per-user fair-use cap — even if a single Clerk session is
  // somehow bypassing the per-user limit, the per-IP throttle keeps
  // costs bounded.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('messages')
  send(
    @CurrentUser() clerkId: string,
    @Body()
    body: {
      conversationId?: string;
      content: string;
      escalate?: boolean;
      imageUrls?: string[];
    },
  ) {
    return this.askGg.sendMessage(clerkId, body);
  }

  /**
   * Phase B — upload 1-5 photos to Cloudinary so they can be attached
   * to the next chat message. Returns the URLs the frontend includes
   * in the subsequent POST /ask-gg/messages call.
   *
   * Frontend flow:
   *   user picks photos → POST /ask-gg/uploads (multipart)
   *     → backend streams each to Cloudinary
   *     → returns { urls: string[] }
   *   user types message + clicks Send →
   *     POST /ask-gg/messages with { content, imageUrls }
   *
   * Tier gate: signed-in only (ClerkGuard). The actual photo-quota
   * check happens at /messages send time so an over-cap FREE user
   * gets a clean error instead of paying to upload to Cloudinary
   * then being rejected at send.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('uploads')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB each
    }),
  )
  async uploads(
    @CurrentUser() clerkId: string,
    @UploadedFiles(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      }),
    )
    files: Express.Multer.File[],
  ): Promise<{ urls: string[] }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one photo required.');
    }
    // Per-tier cap (Phase E3 — PRO=10, MEMBER/FREE=5) is enforced
    // again inside sendMessage / identifyForListing, but we also gate
    // it here so we don't upload to Cloudinary on a request that will
    // immediately be rejected downstream.
    const tier = await this.askGg.getUserTier(clerkId);
    const cap = maxPhotosPerRequest(tier);
    if (files.length > cap) {
      throw new BadRequestException(`Up to ${cap} photos per upload on your tier.`);
    }
    const results = await Promise.all(
      files.map((f) => this.cloudinary.uploadImage(f.buffer, 'ask-gg/photo-id')),
    );
    return { urls: results.map((r) => r.url) };
  }

  /**
   * Phase B Sprint 2 — one-shot photo identification for the
   * /listings/new "Help me describe this" button. Multipart upload of
   * 1-5 photos; returns a structured proposal that pre-fills the
   * listing form. No persistence, no conversation row.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('identify-listing')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async identifyListing(
    @CurrentUser() clerkId: string,
    @UploadedFiles(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      }),
    )
    files: Express.Multer.File[],
    @Query('categoryHint') categoryHint?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one photo required.');
    }
    const photos = files.map((f) => ({
      base64: f.buffer.toString('base64'),
      mediaType: f.mimetype as 'image/jpeg' | 'image/png' | 'image/webp',
    }));
    return this.askGg.identifyForListing(clerkId, photos, {
      categoryHint: categoryHint?.trim() || undefined,
    });
  }

  @Get('conversations')
  @SkipThrottle()
  list(@CurrentUser() clerkId: string) {
    return this.askGg.listConversations(clerkId);
  }

  /** Current quota snapshot. Read-only — frontend hits this on
   *  mount to render the "N free messages left" pill (FREE) and
   *  to know which empty-state UI to show. */
  @Get('quota')
  @SkipThrottle()
  quota(@CurrentUser() clerkId: string) {
    return this.askGg.getQuota(clerkId);
  }

  @Get('conversations/:id')
  @SkipThrottle()
  one(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
  ) {
    return this.askGg.getConversation(clerkId, id);
  }

  @Post('conversations/:id/resolved')
  resolved(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: { outcome: AskGgConversationOutcome },
  ) {
    return this.askGg.markResolved(clerkId, id, body.outcome);
  }

  /**
   * Phase C — search the VERIFIED knowledge base. Hits a Postgres FTS
   * index; sub-100ms typical. Frontend hits this debounced as the
   * user types in the composer. Empty / short queries return [].
   *
   * @SkipThrottle — search-as-you-type would otherwise eat the 60/min
   * global bucket. The query itself is cheap (indexed) and the result
   * is bounded to 5 entries per call.
   */
  @Get('kb/search')
  @SkipThrottle()
  searchKb(@Query('q') q?: string) {
    return this.kb.searchVerified(q ?? '', 5);
  }

  /** User clicked "This helped" on a KB card — bumps usefulCount.
   *  Cheap counter; surfacedCount is bumped automatically inside the
   *  search call so admin can see hit-rate vs help-rate. */
  @Post('kb/:id/helpful')
  markKbHelpful(@Param('id') id: string) {
    return this.kb.markHelpful(id);
  }
}
