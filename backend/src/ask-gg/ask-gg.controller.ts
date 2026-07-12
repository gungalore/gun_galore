import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  Get,
  HttpException,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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
   * Streaming variant of POST /messages — Server-Sent Events. Delivers
   * a seamless UX: the heads-up + answer stream in token-by-token, and
   * because bytes flow continuously neither nginx nor Cloudflare idle-
   * times-out (no more 504 on deep forum answers).
   *
   * Protocol — newline-delimited `data: {json}` events:
   *   { type: 'meta',  conversationId, isNew, userMessage }   (once, first)
   *   { type: 'delta', text }                                 (many)
   *   { type: 'done',  assistantMessage }                     (once, last)
   *   { type: 'error', message }                              (on failure)
   *
   * Quota / validation errors are returned as a normal HTTP 4xx BEFORE
   * the stream opens (the frontend handles 403/429 exactly as for the
   * JSON endpoint).
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('messages/stream')
  async sendStream(
    @CurrentUser() clerkId: string,
    @Body()
    body: {
      conversationId?: string;
      content: string;
      escalate?: boolean;
      imageUrls?: string[];
    },
    @Res() res: Response,
  ): Promise<void> {
    // Preflight FIRST — surfaces quota/validation errors as a normal
    // HTTP response before we switch to SSE.
    let prep;
    try {
      prep = await this.askGg.preflight(clerkId, body);
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const payload =
        err instanceof HttpException
          ? err.getResponse()
          : { message: 'Could not start — try again.' };
      res.status(status).json(payload);
      return;
    }

    // Open the SSE stream. X-Accel-Buffering:no stops nginx buffering so
    // deltas flush in real time; text/event-stream + no-transform keep
    // the proxies from re-chunking or idle-closing the connection.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    // Tell the client the conversation id + confirmed user message up
    // front, so it renders the user bubble + persists the id before any
    // answer tokens arrive.
    send({
      type: 'meta',
      conversationId: prep.conversationId,
      isNew: prep.isNew,
      userMessage: prep.userMessage,
    });

    try {
      const assistantMessage = await this.askGg.finishReply(prep, (delta) =>
        send({ type: 'delta', text: delta }),
      );
      send({ type: 'done', assistantMessage });
    } catch {
      send({
        type: 'error',
        message:
          "I hit a problem generating that — try again. If it keeps failing, the operator's been pinged.",
      });
    } finally {
      res.end();
    }
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

/**
 * Ask GG Everywhere (W3) — PUBLIC, read-only Help-Centre search.
 *
 * The site-wide panel shows signed-OUT visitors free instant answers
 * (zero Claude spend) with a sign-in CTA. The main controller is
 * class-level Clerk-guarded, so this tiny sibling exposes ONLY the
 * verified-KB search — public platform FAQ content, bounded to 5 rows,
 * throttled per IP. No user data, no writes ("This helped" stays on
 * the authed route).
 */
@Controller('ask-gg/public')
export class AskGgPublicController {
  constructor(private readonly kb: AskGgKbService) {}

  @Get('kb/search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  searchKb(@Query('q') q?: string) {
    return this.kb.searchVerified(q ?? '', 5);
  }
}
