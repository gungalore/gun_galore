import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AskGgService } from './ask-gg.service';
import { AskGgConversationOutcome } from '@prisma/client';

/**
 * /ask-gg routes — Ask GG chat assistant.
 *
 *   POST   /ask-gg/messages                            send a new message
 *   GET    /ask-gg/conversations                       list user's conversations
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
  constructor(private readonly askGg: AskGgService) {}

  // 30 messages per minute per IP cap. Belt-and-braces alongside the
  // future per-user fair-use cap — even if a single Clerk session is
  // somehow bypassing the per-user limit, the per-IP throttle keeps
  // costs bounded.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('messages')
  send(
    @CurrentUser() clerkId: string,
    @Body()
    body: { conversationId?: string; content: string; escalate?: boolean },
  ) {
    return this.askGg.sendMessage(clerkId, body);
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
}
