import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AskGgClaudeService, AskGgChatMessage } from './ask-gg-claude.service';
import { AskGgQuotaService } from './ask-gg-quota.service';
import {
  AskGgConversationOutcome,
  SubscriptionTier,
} from '@prisma/client';

/**
 * Ask GG orchestration service.
 *
 * Responsibilities:
 *   - Quota / fair-use gate via AskGgQuotaService (spec OD3):
 *     FREE → 5 msg / rolling 30 days, MEMBER → 20/hr, PRO → 60/hr.
 *     FREE over-cap returns 403 with upgrade-CTA hint;
 *     MEMBER/PRO over-cap returns 429 with retry-after.
 *   - Conversation lifecycle: create if no ID provided, otherwise
 *     load + verify ownership before appending.
 *   - Per-turn flow: persist user message → build history → call
 *     Claude wrapper → persist assistant message with cost data.
 *   - Resolve flow: stamp `outcome` when the user responds to the
 *     "did this solve it?" prompt. RESOLVED conversations become
 *     KB draft candidates (wiring lives in Phase C).
 *
 * KB search-first + vision uploads land in later drops. Drop 1 is
 * the smallest end-to-end Claude-backed chat we can ship, now with
 * the FREE trial.
 *
 * Sign-in is enforced by ClerkGuard on the controller, so any
 * signed-in user (FREE / MEMBER / PRO) can list + read their own
 * conversation history. Only sending new messages is quota-gated.
 */
@Injectable()
export class AskGgService {
  private readonly logger = new Logger(AskGgService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: AskGgClaudeService,
    private readonly quota: AskGgQuotaService,
  ) {}

  private async userIdFromClerk(clerkId: string): Promise<{
    id: string;
    subscriptionTier: SubscriptionTier;
  }> {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, subscriptionTier: true },
    });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  /**
   * Send a new user message. If `conversationId` is omitted, starts
   * a new conversation and seeds its title from the first user
   * message. Returns both the persisted user message and the
   * persisted assistant reply so the frontend can render them in
   * one round-trip.
   */
  async sendMessage(
    clerkId: string,
    input: {
      conversationId?: string;
      content: string;
      escalate?: boolean;
    },
  ) {
    const user = await this.userIdFromClerk(clerkId);
    // Quota check FIRST, before any DB writes for this turn. FREE
    // over-cap throws 403, MEMBER/PRO over-cap throws 429 — both
    // shaped so the frontend can pick the right card.
    await this.quota.assertCanSend(user.id, user.subscriptionTier);

    const trimmed = input.content?.trim() ?? '';
    if (!trimmed) {
      throw new BadRequestException('Message cannot be empty.');
    }
    if (trimmed.length > 4_000) {
      throw new BadRequestException(
        'Message too long — keep it under 4,000 characters.',
      );
    }

    // Load or create the conversation. New conversations get a title
    // = the first user message, truncated. Existing ones must belong
    // to the requesting user.
    let conversationId = input.conversationId;
    let isNew = false;
    if (conversationId) {
      const c = await this.prisma.askGgConversation.findUnique({
        where: { id: conversationId },
        select: { id: true, userId: true },
      });
      if (!c || c.userId !== user.id) {
        throw new NotFoundException('Conversation not found');
      }
    } else {
      const created = await this.prisma.askGgConversation.create({
        data: {
          userId: user.id,
          title: trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed,
        },
        select: { id: true },
      });
      conversationId = created.id;
      isNew = true;
    }

    // Persist the user message immediately so the conversation history
    // exists even if Claude errors out later.
    const userMessage = await this.prisma.askGgMessage.create({
      data: {
        conversationId: conversationId!,
        role: 'user',
        content: trimmed,
      },
    });

    // Build history for Claude — every prior message in this
    // conversation, oldest first. Includes the message we just
    // persisted (so Claude sees it as the latest user turn).
    const history = await this.prisma.askGgMessage.findMany({
      where: { conversationId: conversationId! },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, imageUrls: true },
    });
    const claudeHistory: AskGgChatMessage[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      imageUrls: m.imageUrls ?? [],
    }));

    // Call Claude. AskGgClaudeService handles its own failures and
    // returns a placeholder rather than throwing — keeps the
    // assistant message row creation on the happy path.
    const reply = await this.claude.complete(claudeHistory, {
      escalate: input.escalate,
    });

    const assistantMessage = await this.prisma.askGgMessage.create({
      data: {
        conversationId: conversationId!,
        role: 'assistant',
        content: reply.content,
        model: reply.model,
        promptTokens: reply.promptTokens ?? null,
        completionTokens: reply.completionTokens ?? null,
        costUsd: reply.costUsd ?? null,
        // Reloading-manual citations Claude collected via tool-use.
        // Stored as Json so the frontend can render verification
        // chips on every assistant turn, both live and on reload.
        citations:
          reply.citations.length > 0
            ? (reply.citations as unknown as object[])
            : undefined,
      },
    });

    // Bump the conversation's updatedAt so the history list orders by
    // most-recent activity.
    await this.prisma.askGgConversation.update({
      where: { id: conversationId! },
      data: { updatedAt: new Date() },
    });

    // Daily usage rollup — single counter for now (Drop 1 doesn't
    // need to differentiate message vs photo). Day truncation in JS
    // keeps Prisma simple.
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    await this.prisma.askGgUsage.upsert({
      where: { userId_day: { userId: user.id, day: todayUtc } },
      create: {
        userId: user.id,
        day: todayUtc,
        messageCount: 1,
        costUsdCents: Math.round((reply.costUsd ?? 0) * 100),
      },
      update: {
        messageCount: { increment: 1 },
        costUsdCents: { increment: Math.round((reply.costUsd ?? 0) * 100) },
      },
    });

    return {
      conversationId: conversationId!,
      isNew,
      userMessage,
      assistantMessage,
    };
  }

  /** Paginated list of the current user's conversations,
   * most-recent first. Drop 1 returns up to 50 — full pagination
   * lands when the user actually has more. No tier gate: any
   * signed-in user can see their own history (FREE users still
   * have access to past conversations even if they're at cap). */
  async listConversations(clerkId: string) {
    const user = await this.userIdFromClerk(clerkId);
    return this.prisma.askGgConversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        outcome: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** Single conversation with all its messages, oldest first.
   *  Any signed-in user can read their own conversations regardless
   *  of tier (so a FREE user who maxed their cap can still re-open
   *  past chats). */
  async getConversation(clerkId: string, conversationId: string) {
    const user = await this.userIdFromClerk(clerkId);
    const c = await this.prisma.askGgConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            imageUrls: true,
            model: true,
            citations: true,
            createdAt: true,
          },
        },
      },
    });
    if (!c || c.userId !== user.id) {
      throw new NotFoundException('Conversation not found');
    }
    return c;
  }

  /** Stamp the user's response to the "did this solve it?" prompt.
   *  Open to any signed-in user — they own the conversation. */
  async markResolved(
    clerkId: string,
    conversationId: string,
    outcome: AskGgConversationOutcome,
  ) {
    const user = await this.userIdFromClerk(clerkId);
    const c = await this.prisma.askGgConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true },
    });
    if (!c || c.userId !== user.id) {
      throw new NotFoundException('Conversation not found');
    }
    return this.prisma.askGgConversation.update({
      where: { id: conversationId },
      data: {
        outcome,
        resolvedAt: new Date(),
      },
    });
  }

  /** Current quota snapshot for the signed-in user. Used by the
   *  composer to render the "N free messages left this month" pill
   *  (FREE) or to detect the soft fair-use warning state
   *  (MEMBER / PRO). No tier gate — every signed-in user gets to
   *  see their own quota. */
  async getQuota(clerkId: string) {
    const user = await this.userIdFromClerk(clerkId);
    return this.quota.snapshot(user.id, user.subscriptionTier);
  }
}
