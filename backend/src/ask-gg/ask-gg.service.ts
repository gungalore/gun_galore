import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AskGgClaudeService, AskGgChatMessage } from './ask-gg-claude.service';
import { AskGgQuotaService, maxPhotosPerRequest } from './ask-gg-quota.service';
import { AskGgKbService } from './ask-gg-kb.service';
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
    private readonly kb: AskGgKbService,
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

  /** Public tier accessor used by the controller's upload route so
   *  it can enforce the per-tier photo cap before pushing to
   *  Cloudinary. Lightweight read — no auth (caller is already
   *  ClerkGuard-validated). */
  async getUserTier(clerkId: string): Promise<SubscriptionTier> {
    const u = await this.userIdFromClerk(clerkId);
    return u.subscriptionTier;
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
      /** Cloudinary URLs from prior POST /ask-gg/uploads. Phase B —
       *  photo identification. Max 5 per message. */
      imageUrls?: string[];
    },
  ) {
    const user = await this.userIdFromClerk(clerkId);
    // Quota checks FIRST, before any DB writes for this turn. FREE
    // over-cap throws 403, MEMBER/PRO over-cap throws 429 — both
    // shaped so the frontend can pick the right card.
    await this.quota.assertCanSend(user.id, user.subscriptionTier);
    const imageUrls = (input.imageUrls ?? []).filter(
      (u) => typeof u === 'string' && u.length > 0,
    );
    // Phase E3 — per-tier per-request cap. PRO=10, MEMBER/FREE=5.
    const photoCap = maxPhotosPerRequest(user.subscriptionTier);
    if (imageUrls.length > photoCap) {
      throw new BadRequestException(
        `Up to ${photoCap} photos per message on your tier.`,
      );
    }
    if (imageUrls.length > 0) {
      // Separate quota — FREE 5 photo-IDs / 30 days.
      await this.quota.assertCanUploadPhotos(user.id, user.subscriptionTier);
    }

    // Photo-only messages skip the text-content length check but we
    // still trim. Empty content + empty imageUrls is rejected as
    // "you gave us nothing to work with".
    const trimmed = input.content?.trim() ?? '';
    if (!trimmed && imageUrls.length === 0) {
      throw new BadRequestException('Message or photo required.');
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
      // Photo-only opening message gets a placeholder title.
      const titleSource =
        trimmed.length > 0 ? trimmed : `Photo identification (${imageUrls.length})`;
      const created = await this.prisma.askGgConversation.create({
        data: {
          userId: user.id,
          title:
            titleSource.length > 80
              ? `${titleSource.slice(0, 77)}…`
              : titleSource,
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
        imageUrls,
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
      // Phase D ballistics — pass user tier so the calculator tool
      // can refuse FREE users with a friendly upgrade nudge.
      subscriptionTier: user.subscriptionTier,
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

    // Daily usage rollup. Phase B: separate counter for photo-IDs
    // so the operator-facing usage dashboard can split message vs
    // photo spend. photoIdCount increments by 1 per photo-bearing
    // request (NOT per photo) so the rollup matches the FREE-tier
    // quota semantics (1 request = 1 photo-ID for cap purposes).
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const photoIdIncrement = imageUrls.length > 0 ? 1 : 0;
    await this.prisma.askGgUsage.upsert({
      where: { userId_day: { userId: user.id, day: todayUtc } },
      create: {
        userId: user.id,
        day: todayUtc,
        messageCount: 1,
        photoIdCount: photoIdIncrement,
        costUsdCents: Math.round((reply.costUsd ?? 0) * 100),
      },
      update: {
        messageCount: { increment: 1 },
        photoIdCount: { increment: photoIdIncrement },
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
    const updated = await this.prisma.askGgConversation.update({
      where: { id: conversationId },
      data: {
        outcome,
        resolvedAt: new Date(),
      },
    });
    // Phase C: a RESOLVED conversation is the seller of the platform's
    // knowledge — auto-spawn a DRAFT KB entry for the admin queue.
    // Fire-and-forget: KB creation failure must NOT fail the resolve
    // (the conversation is already updated).
    if (outcome === AskGgConversationOutcome.RESOLVED) {
      this.kb.createDraftFromConversation(conversationId).catch((err) => {
        this.logger.warn(
          `KB draft creation failed for ${conversationId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      });
    }
    return updated;
  }

  /** Current quota snapshot for the signed-in user. Used by the
   *  composer to render the "N free messages left this month" pill
   *  (FREE) or to detect the soft fair-use warning state
   *  (MEMBER / PRO). No tier gate — every signed-in user gets to
   *  see their own quota.
   *
   *  Phase B: also returns the photo-ID snapshot so the frontend can
   *  render the separate "N photo IDs left this month" indicator
   *  next to the paperclip icon.
   */
  async getQuota(clerkId: string) {
    const user = await this.userIdFromClerk(clerkId);
    const [messages, photos] = await Promise.all([
      this.quota.snapshot(user.id, user.subscriptionTier),
      this.quota.photoSnapshot(user.id, user.subscriptionTier),
    ]);
    return { ...messages, photos };
  }

  /**
   * Phase B Sprint 2 — one-shot photo identification for the
   * /listings/new "Help me describe this" button. NOT persisted as
   * a conversation; just returns a structured proposal the listing
   * form can apply via "Apply to form".
   *
   * Counts against:
   *   - FREE: assertCanUploadPhotos (5/30days photo-ID cap)
   *   - MEMBER + PRO: assertCanSend (hourly fair-use)
   * Bumps photoIdCount on AskGgUsage so the usage dashboard reflects
   * spend even though there's no conversation row.
   */
  async identifyForListing(
    clerkId: string,
    photos: Array<{
      base64: string;
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    }>,
    opts: { categoryHint?: string } = {},
  ) {
    const user = await this.userIdFromClerk(clerkId);
    await this.quota.assertCanSend(user.id, user.subscriptionTier);
    await this.quota.assertCanUploadPhotos(user.id, user.subscriptionTier);

    if (photos.length === 0) {
      throw new BadRequestException('At least one photo required.');
    }
    // Phase E3 — per-tier cap (PRO=10, MEMBER/FREE=5).
    const photoCap = maxPhotosPerRequest(user.subscriptionTier);
    if (photos.length > photoCap) {
      throw new BadRequestException(
        `Up to ${photoCap} photos per identification on your tier.`,
      );
    }

    // Build a hierarchical category tree string so Claude can pick the
    // most SPECIFIC slug (sub-category preferred over its parent).
    // Top-level categories (parentId === null) appear flush-left;
    // children indented two spaces under their parent.
    const allCategories = await this.prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, parentId: true },
    });
    const topLevel = allCategories.filter((c) => c.parentId === null);
    const lines: string[] = [];
    for (const top of topLevel) {
      lines.push(`${top.slug} — ${top.name}`);
      const kids = allCategories
        .filter((c) => c.parentId === top.id)
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const k of kids) {
        lines.push(`  ${k.slug} — ${k.name}`);
      }
    }
    const categoryTree = lines.join('\n');

    const result = await this.claude.identifyFromPhotos(photos, {
      ...opts,
      categoryTree,
    });

    // Bump the daily usage rollup. Treat as 1 message + 1 photo-ID
    // (the one-shot still costs Claude vision tokens).
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    await this.prisma.askGgUsage.upsert({
      where: { userId_day: { userId: user.id, day: todayUtc } },
      create: {
        userId: user.id,
        day: todayUtc,
        messageCount: 1,
        photoIdCount: 1,
        costUsdCents: Math.round((result.costUsd ?? 0) * 100),
      },
      update: {
        messageCount: { increment: 1 },
        photoIdCount: { increment: 1 },
        costUsdCents: { increment: Math.round((result.costUsd ?? 0) * 100) },
      },
    });

    return {
      proposal: result.proposal,
      costUsd: result.costUsd,
    };
  }
}
