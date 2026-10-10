import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { LlmService } from '../common/llm/llm.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  JEV_CATEGORY_REASONS,
  conductQuestions,
  contactQuestions,
  jevLadder,
} from '../moderation/jev-battery';

const MAX_MESSAGE_LEN = 2_000;

/**
 * Buyer ↔ seller messaging, scoped to a single Transaction (Phase 4 W4).
 *
 * Only the transaction's buyer and seller may read or write. Every message is
 * moderated on send:
 *   • Layer 1 (deterministic) — ContactDetailFilterService.redact() STRIPS
 *     contact vectors (phone/email/url/social/handle/off-platform/address) and
 *     the stripped text is what stores + sends. The original is kept on
 *     `originalContent` with `wasModerated=true` for the audit trail.
 *   • Layer 2 (Jev battery) — catches what regex can't (spelled-out digits,
 *     novel handles). A contact/off-platform hit that regex missed is NOT
 *     blocked (we can't strip a span we didn't find) — the regex-stripped text
 *     sends and the message is parked for T&S review. ABUSE is different: it is
 *     blocked outright, never sent.
 *
 * Operator rule 2026-10-10: contact details → auto-strip; abuse → block.
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactFilter: ContactDetailFilterService,
    private readonly llm: LlmService,
    private readonly notifications: NotificationsService,
  ) {}

  private async assertParticipant(transactionId: string, userId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listing: { select: { title: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      throw new ForbiddenException('You are not part of this transaction');
    }
    return tx;
  }

  /** Messages on a transaction, oldest → newest. Buyer/seller only. */
  async list(transactionId: string, userId: string) {
    await this.assertParticipant(transactionId, userId);
    return this.prisma.message.findMany({
      where: { transactionId },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        senderId: true,
        content: true,
        wasModerated: true,
        readAt: true,
        createdAt: true,
      },
    });
  }

  /** Send a moderated message. Returns the STORED (stripped) row. */
  async send(transactionId: string, userId: string, rawContent: string) {
    const text = (rawContent ?? '').trim();
    if (!text) throw new BadRequestException('Message is empty');
    if (text.length > MAX_MESSAGE_LEN) {
      throw new BadRequestException(
        `Message is too long (max ${MAX_MESSAGE_LEN} characters)`,
      );
    }
    const tx = await this.assertParticipant(transactionId, userId);

    // Layer 1 — deterministic strip.
    const { text: stripped, categories } = this.contactFilter.redact(text);

    // Layer 2 — Jev battery (fail-open: regex is the hard guarantee).
    const verdict = await jevLadder(this.llm, {
      state: text,
      questions: { ...contactQuestions(), ...conductQuestions() },
      reasons: JEV_CATEGORY_REASONS,
      purpose: 'moderation.conversation',
      onError: 'pass',
    });

    // Abuse is blocked outright — never sent, even stripped.
    if (verdict.decision === 'BLOCK' && verdict.category === 'abuse') {
      throw new BadRequestException(
        verdict.reason ?? 'That message is not allowed on ALL Outdoor.',
      );
    }

    const moderated = stripped !== text;
    // A model-only contact/off-platform hit regex couldn't strip: send the
    // stripped text and park it for a human.
    const needsReview =
      verdict.decision === 'REVIEW' ||
      (verdict.decision === 'BLOCK' && verdict.category !== 'abuse');

    const message = await this.prisma.message.create({
      data: {
        transactionId,
        senderId: userId,
        content: stripped,
        originalContent: moderated ? text : null,
        wasModerated: moderated,
      },
    });

    if (needsReview || categories.length > 0) {
      void this.prisma.adminAlert
        .create({
          data: {
            type: 'MESSAGE_MODERATION',
            referenceId: message.id,
            urgent: needsReview,
            context: `Message ${message.id} on tx ${transactionId}: ${
              needsReview ? 'T&S review requested' : 'auto-stripped'
            } (categories: ${[
              ...categories,
              verdict.category,
            ]
              .filter(Boolean)
              .join(', ')}).`,
          },
        })
        .catch(() => undefined);
    }

    // Notify the counterparty (in-app + email).
    const recipientId = userId === tx.buyerId ? tx.sellerId : tx.buyerId;
    void this.prisma.user
      .findUnique({
        where: { id: recipientId },
        select: { email: true, firstName: true },
      })
      .then((recipient) => {
        if (!recipient) return;
        void this.notifications.newMessage({
          recipientEmail: recipient.email,
          recipientName: recipient.firstName ?? 'there',
          listingTitle: tx.listing.title,
          transactionId,
          senderIsBuyer: userId === tx.buyerId,
        });
      })
      .catch(() => undefined);

    this.logger.log(
      `Message ${message.id} on tx ${transactionId} by ${userId} (moderated=${moderated}, review=${needsReview})`,
    );
    return message;
  }
}
