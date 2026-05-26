import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Two-model split mirrors the listing-moderation service so we keep one
// env contract across the codebase:
//   MODEL_SIMPLE — Haiku for cheap binary classification (is this a
//                  product-info question? yes/no)
//   MODEL_JUDGE  — Sonnet for the dedup pass (semantic match against
//                  prior Q&A + answer rewrite)
const MODEL_SIMPLE =
  process.env.ANTHROPIC_MODEL_SIMPLE ?? 'claude-haiku-4-5-20251001';
const MODEL_JUDGE =
  process.env.ANTHROPIC_MODEL_JUDGE ?? 'claude-sonnet-4-6';

// Auto-answers only re-use seller replies posted within this window.
// 30 days is the right balance: long enough to absorb a sustained
// flurry of similar questions on a popular listing, short enough that
// stale info (sold accessories, price changes) doesn't get re-served.
const AUTO_ANSWER_FRESHNESS_DAYS = 30;

// ─── Prompts ────────────────────────────────────────────────────────────────

const MODERATION_PROMPT = `You are the pre-purchase Q&A moderator for Gun Galore, a South African firearms and outdoor marketplace.

You only see one question at a time. Decide if it should reach the seller.

APPROVE when the question is purely about the product being sold:
- specs (calibre, action, capacity, barrel length, twist rate, weight, dimensions)
- condition (round count, wear, scratches, finish state)
- what's included (box, paperwork, accessories, mags, holster)
- compatibility ("will this fit a Glock 19?", "does this come with rails?")
- factory variant / model year / production run
- safety features, warranty, country of origin

REJECT for anything else:
- contact details (phone, email, WhatsApp, Telegram, social handles, URLs)
- attempts to coordinate off-platform ("meet me at", "let's chat directly", "DM me")
- price negotiation ("will you take less?", "lowest price?", "any discount?") — route to the Offer system instead
- the buyer's own location / address / suburb / town (privacy)
- the seller's location / address — already shown on the listing
- requests for the seller's full name, ID, licence number
- demands the seller do work ("can you cerakote it black before shipping?")
- abusive, rude, harassing, or sexual language
- politics, opinions, anything not factual about the item

Respond with valid JSON ONLY:
{ "decision": "APPROVE" | "REJECT",
  "reason": "<short public-facing reason if REJECT — see allowed list>" }

Allowed REJECT reasons (use one of these verbatim):
- "Keep questions to product details — no contact info, please."
- "Use the Offer button to negotiate price."
- "We don't share location details through Q&A."
- "Please keep questions polite and on-topic."

Always wrap output in {} — no preamble.`;

const DEDUP_PROMPT = `You decide whether a new pre-purchase question about a listing has already been answered by the seller in a previous question on the SAME listing.

You will be given:
- The listing's title and description
- A list of prior questions + their seller answers (only ones answered within the last 30 days)
- The new question

If a prior answer fully addresses the new question, set match=true and write a fresh answer that reuses the substance of the seller's prior reply. Don't quote verbatim — rewrite for clarity in 1–3 short sentences. Always note "based on a previous answer from the seller" so the asker knows it isn't a brand-new reply.

If the new question is even slightly different in substance — different accessory, different spec, different aspect of condition — set match=false. Better to bother the seller than auto-answer something subtly wrong.

Respond with valid JSON ONLY:
{ "match": true, "answer": "...", "sourceQuestionId": "<id of the prior Q you matched>" }
or
{ "match": false }`;

// ─── Types ──────────────────────────────────────────────────────────────────

interface ModerationResult {
  decision: 'APPROVE' | 'REJECT';
  reason?: string;
}

interface DedupResult {
  match: boolean;
  answer?: string;
  sourceQuestionId?: string;
}

@Injectable()
export class ListingQuestionsService {
  private readonly logger = new Logger(ListingQuestionsService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = key ? new Anthropic({ apiKey: key }) : null;
    if (!key)
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — Q&A will publish without moderation',
      );
  }

  // ------------------------------------------------------------------
  // PUBLIC — the questions panel on /listings/[id]
  // Returns only the ANSWERED rows (manual or auto) the public should
  // see, oldest → newest. Hidden, rejected, and pending rows are
  // filtered out at the DB level.
  // ------------------------------------------------------------------
  async listPublic(listingId: string) {
    return this.prisma.listingQuestion.findMany({
      where: {
        listingId,
        status: { in: ['ANSWERED_BY_SELLER', 'AUTO_ANSWERED'] },
        isPublic: true,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        question: true,
        answer: true,
        answeredAt: true,
        status: true,
        autoAnsweredFromQuestionId: true,
        // Username-only on public Q&A — never firstName. Real names
        // are platform-policy off the public surface. Phase E1 adds
        // the GG+ pill + verified-expert badge alongside the
        // username so a Pro-tier seller's answer reads as
        // higher-trust.
        asker: {
          select: {
            username: true,
            subscriptionTier: true,
            isVerifiedExpert: true,
          },
        },
        answeredByUser: {
          select: {
            username: true,
            subscriptionTier: true,
            isVerifiedExpert: true,
          },
        },
      },
    });
  }

  // ------------------------------------------------------------------
  // BUYER — submit a new question. Runs Claude pass 1 (moderation),
  // pass 2 (semantic dedup), and only notifies the seller when neither
  // path resolves it.
  // ------------------------------------------------------------------
  async ask(
    listingId: string,
    askerClerkId: string,
    rawQuestion: string,
  ): Promise<{
    status: 'AUTO_ANSWERED' | 'AWAITING_SELLER_ANSWER' | 'REJECTED';
    publicReason?: string;
    questionId?: string;
  }> {
    const question = rawQuestion.trim();
    if (!question) throw new BadRequestException('Question is empty');
    if (question.length > 500)
      throw new BadRequestException(
        'Question is too long (max 500 characters)',
      );

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { category: true, seller: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== 'ACTIVE') {
      throw new BadRequestException(
        'You can only ask questions on active listings.',
      );
    }

    const asker = await this.prisma.user.findUnique({
      where: { clerkId: askerClerkId },
    });
    if (!asker) throw new NotFoundException('User not found');
    if (asker.id === listing.sellerId) {
      throw new BadRequestException(
        'You can\'t ask questions on your own listing.',
      );
    }

    // ─── Claude pass 1: moderation (Haiku, cheap, binary) ────────────
    const mod = await this.runModeration(question);
    if (mod.decision === 'REJECT') {
      // Persist the rejected row for audit (admin can see how often
      // a buyer is probing the moderator).
      const row = await this.prisma.listingQuestion.create({
        data: {
          listingId,
          askerId: asker.id,
          question,
          questionDecision: 'REJECT',
          questionReason: mod.reason ?? null,
          status: 'REJECTED_BY_MODERATION',
          isPublic: false,
        },
      });
      return {
        status: 'REJECTED',
        publicReason:
          mod.reason ??
          'Keep questions to product details — no contact info, please.',
        questionId: row.id,
      };
    }

    // ─── Claude pass 2: dedup against recent answered Qs ─────────────
    const dedup = await this.runDedup(listing, question);
    if (dedup.match && dedup.answer && dedup.sourceQuestionId) {
      // Confirm the source Q still exists, still belongs to this
      // listing, and hasn't been invalidated. (Defence in depth — the
      // model occasionally cites a stale id.)
      const source = await this.prisma.listingQuestion.findUnique({
        where: { id: dedup.sourceQuestionId },
      });
      if (
        source &&
        source.listingId === listingId &&
        source.invalidatedAt === null &&
        source.status === 'ANSWERED_BY_SELLER'
      ) {
        const row = await this.prisma.listingQuestion.create({
          data: {
            listingId,
            askerId: asker.id,
            question,
            questionDecision: 'APPROVE',
            status: 'AUTO_ANSWERED',
            answer: dedup.answer,
            answeredByUserId: null, // AI-attributed
            answeredAt: new Date(),
            autoAnsweredFromQuestionId: source.id,
          },
        });
        return { status: 'AUTO_ANSWERED', questionId: row.id };
      }
      // Source Q didn't validate — fall through to the manual path.
      this.logger.warn(
        `Dedup pass returned a stale sourceQuestionId ${dedup.sourceQuestionId} — falling through to seller`,
      );
    }

    // ─── Neither path resolved → notify seller ───────────────────────
    const row = await this.prisma.listingQuestion.create({
      data: {
        listingId,
        askerId: asker.id,
        question,
        questionDecision: 'APPROVE',
        status: 'AWAITING_SELLER_ANSWER',
      },
    });

    void this.notifications
      .listingQuestionForSeller({
        sellerEmail: listing.seller.email,
        sellerName:
          [listing.seller.firstName, listing.seller.lastName]
            .filter(Boolean)
            .join(' ') || 'Seller',
        sellerPhone: listing.seller.phone,
        listingTitle: listing.title,
        listingId: listing.id,
        question,
      })
      .catch((err) =>
        this.logger.warn(
          `listingQuestionForSeller notification failed: ${(err as Error).message}`,
        ),
      );

    return { status: 'AWAITING_SELLER_ANSWER', questionId: row.id };
  }

  // ------------------------------------------------------------------
  // SELLER — list all questions on the seller's listings, with the
  // unanswered ones first. Powers the dashboard "Questions for you"
  // card.
  // ------------------------------------------------------------------
  async listForSeller(sellerClerkId: string) {
    const seller = await this.prisma.user.findUnique({
      where: { clerkId: sellerClerkId },
    });
    if (!seller) throw new NotFoundException('User not found');

    return this.prisma.listingQuestion.findMany({
      where: {
        listing: { sellerId: seller.id },
        status: {
          in: ['AWAITING_SELLER_ANSWER', 'AUTO_ANSWERED', 'ANSWERED_BY_SELLER'],
        },
      },
      // Pending first, then most-recent-answered.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        question: true,
        answer: true,
        status: true,
        answeredAt: true,
        autoAnsweredFromQuestionId: true,
        createdAt: true,
        listing: { select: { id: true, title: true } },
        asker: { select: { username: true } },
      },
    });
  }

  // ------------------------------------------------------------------
  // SELLER — answer a pending question manually.
  // ------------------------------------------------------------------
  async answer(
    questionId: string,
    sellerClerkId: string,
    rawAnswer: string,
  ) {
    const answer = rawAnswer.trim();
    if (!answer) throw new BadRequestException('Answer is empty');
    if (answer.length > 1000)
      throw new BadRequestException('Answer is too long (max 1000 characters)');

    const q = await this.prisma.listingQuestion.findUnique({
      where: { id: questionId },
      include: { listing: { include: { seller: true } } },
    });
    if (!q) throw new NotFoundException('Question not found');
    if (q.listing.seller.clerkId !== sellerClerkId) {
      throw new ForbiddenException('Not your listing');
    }
    if (q.status === 'REJECTED_BY_MODERATION') {
      throw new BadRequestException('This question was rejected by moderation');
    }

    // We moderate the answer too — same rules. Sellers occasionally
    // try to drop a phone number in their reply.
    const mod = await this.runModeration(answer);
    if (mod.decision === 'REJECT') {
      throw new BadRequestException(
        mod.reason ?? 'Keep answers to product details — no contact info, please.',
      );
    }

    const seller = await this.prisma.user.findUnique({
      where: { clerkId: sellerClerkId },
    });

    return this.prisma.listingQuestion.update({
      where: { id: questionId },
      data: {
        answer,
        answeredByUserId: seller!.id,
        answeredAt: new Date(),
        status: 'ANSWERED_BY_SELLER',
        // Clearing invalidatedAt covers the case where the seller is
        // rewriting an answer that they previously flagged as wrong.
        invalidatedAt: null,
      },
    });
  }

  // ------------------------------------------------------------------
  // SELLER — flag an AI-auto-answered row as wrong. Marks the source
  // Q as invalidated (so it can't be used for future auto-answers)
  // AND hides the bad AI answer until the seller writes a fresh reply.
  // ------------------------------------------------------------------
  async flagAutoAnswer(questionId: string, sellerClerkId: string) {
    const q = await this.prisma.listingQuestion.findUnique({
      where: { id: questionId },
      include: { listing: { include: { seller: true } } },
    });
    if (!q) throw new NotFoundException('Question not found');
    if (q.listing.seller.clerkId !== sellerClerkId) {
      throw new ForbiddenException('Not your listing');
    }
    if (q.status !== 'AUTO_ANSWERED') {
      throw new BadRequestException('Only auto-answered questions can be flagged');
    }

    await this.prisma.$transaction(async (tx) => {
      // Invalidate the source so we never auto-answer from it again.
      if (q.autoAnsweredFromQuestionId) {
        await tx.listingQuestion.update({
          where: { id: q.autoAnsweredFromQuestionId },
          data: { invalidatedAt: new Date() },
        });
      }
      // Reset the buyer's question to AWAITING_SELLER_ANSWER and clear
      // the auto-answer so the seller writes a fresh reply.
      await tx.listingQuestion.update({
        where: { id: questionId },
        data: {
          status: 'AWAITING_SELLER_ANSWER',
          answer: null,
          answeredAt: null,
          autoAnsweredFromQuestionId: null,
        },
      });
    });

    return { ok: true };
  }

  // ------------------------------------------------------------------
  // BUYER or any signed-in user — flag a public Q&A row for admin review.
  // ------------------------------------------------------------------
  async report(questionId: string) {
    const q = await this.prisma.listingQuestion.findUnique({
      where: { id: questionId },
    });
    if (!q) throw new NotFoundException('Question not found');
    if (!q.isPublic) return { ok: true };

    await this.prisma.listingQuestion.update({
      where: { id: questionId },
      data: { reportedCount: { increment: 1 } },
    });
    return { ok: true };
  }

  // ──────────────────── Claude wiring ─────────────────────────────────

  private async runModeration(text: string): Promise<ModerationResult> {
    if (!this.client) return { decision: 'APPROVE' };
    try {
      const msg = await this.client.messages.create({
        model: MODEL_SIMPLE,
        max_tokens: 200,
        system: MODERATION_PROMPT,
        messages: [{ role: 'user', content: text }],
      });
      const json = extractJson(msg);
      if (!json) return { decision: 'APPROVE' };
      const decision = json.decision === 'REJECT' ? 'REJECT' : 'APPROVE';
      return {
        decision,
        reason: typeof json.reason === 'string' ? json.reason : undefined,
      };
    } catch (err) {
      this.logger.warn(
        `Q&A moderation failed (open-fail to APPROVE): ${(err as Error).message}`,
      );
      return { decision: 'APPROVE' };
    }
  }

  private async runDedup(
    listing: {
      id: string;
      title: string;
      description: string;
    },
    newQuestion: string,
  ): Promise<DedupResult> {
    if (!this.client) return { match: false };

    const fresh = new Date();
    fresh.setDate(fresh.getDate() - AUTO_ANSWER_FRESHNESS_DAYS);

    const prior = await this.prisma.listingQuestion.findMany({
      where: {
        listingId: listing.id,
        status: 'ANSWERED_BY_SELLER',
        invalidatedAt: null,
        answeredAt: { gte: fresh },
      },
      select: { id: true, question: true, answer: true },
      orderBy: { answeredAt: 'desc' },
      take: 20, // bound the prompt size
    });
    if (prior.length === 0) return { match: false };

    const userContent = [
      `Listing title: ${listing.title}`,
      `Listing description: ${listing.description}`,
      '',
      'Prior questions (id | question → seller\'s answer):',
      ...prior.map(
        (p) => `- ${p.id} | ${p.question} → ${p.answer ?? ''}`,
      ),
      '',
      `New question: ${newQuestion}`,
    ].join('\n');

    try {
      const msg = await this.client.messages.create({
        model: MODEL_JUDGE,
        max_tokens: 500,
        system: DEDUP_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      });
      const json = extractJson(msg);
      if (!json || json.match !== true) return { match: false };
      const answer =
        typeof json.answer === 'string' ? json.answer.trim() : '';
      const sourceQuestionId =
        typeof json.sourceQuestionId === 'string'
          ? json.sourceQuestionId
          : '';
      if (!answer || !sourceQuestionId) return { match: false };
      return { match: true, answer, sourceQuestionId };
    } catch (err) {
      this.logger.warn(
        `Q&A dedup failed (falling through to seller): ${(err as Error).message}`,
      );
      return { match: false };
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface AnthropicMessage {
  content: { type: string; text?: string }[];
}

function extractJson(msg: AnthropicMessage): Record<string, unknown> | null {
  const text =
    msg.content.find((b) => b.type === 'text' && typeof b.text === 'string')
      ?.text ?? '';
  if (!text) return null;
  // Tolerate models that wrap JSON in code fences or include preamble.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
