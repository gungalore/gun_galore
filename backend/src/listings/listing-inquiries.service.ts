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
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ListingModerationService } from '../moderation/listing-moderation.service';
import { optimizedVideoUrl } from '../common/image-url';
import {
  JEV_CATEGORY_REASONS,
  conductQuestions,
  contactQuestions,
  jevLadder,
} from '../moderation/jev-battery';

const MAX_INQUIRY_MESSAGE_LEN = 2_000;
const MAX_INQUIRY_IMAGES = 4;

/**
 * Private 1-to-1 "Contact seller" threads on a listing.
 *
 * Replaces the public pre-purchase Q&A as the buyer-facing surface while the
 * historical ListingQuestion rows stay in the database for admin history.
 *
 * Rules, locked by the operator on 2026-10-19:
 *   • Only the stream's buyer and the listing's seller can read or write it.
 *   • SELLER-ONLY media: a buyer may not attach photos or video. The seller
 *     can, to answer "can you show me …" with a clip of the item.
 *   • Text is moderated exactly like transaction messages: contact details are
 *     auto-stripped, abuse is blocked.
 *   • Media is screened BEFORE it is stored. A REJECT or an uncertain verdict
 *     deletes the Cloudinary asset and refuses the upload, so unscreened
 *     contact details/QR codes never reach the buyer.
 *   • Public projections are username-only — never a real name or email.
 */
@Injectable()
export class ListingInquiriesService {
  private readonly logger = new Logger(ListingInquiriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactFilter: ContactDetailFilterService,
    private readonly llm: LlmService,
    private readonly notifications: NotificationsService,
    private readonly cloudinary: CloudinaryService,
    private readonly moderation: ListingModerationService,
  ) {}

  // ── reads ──────────────────────────────────────────────────────────

  /**
   * The signed-in buyer's own thread on a listing, or null when they have not
   * contacted the seller yet. A seller viewing their own listing gets null
   * plus a light inbox summary so the PDP can show "N buyers waiting".
   */
  async getForListing(listingId: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        title: true,
      },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    if (listing.sellerId === userId) {
      const [open, unread] = await Promise.all([
        this.prisma.listingInquiry.count({ where: { listingId } }),
        this.prisma.listingInquiryMessage.count({
          where: {
            inquiry: { listingId },
            senderId: { not: userId },
            readAt: null,
          },
        }),
      ]);
      return {
        inquiry: null,
        sellerInbox: { open, unread },
      };
    }

    const inquiry = await this.prisma.listingInquiry.findUnique({
      where: { listingId_buyerId: { listingId, buyerId: userId } },
      select: { id: true },
    });
    if (!inquiry) return { inquiry: null };

    // Reading the thread on the PDP clears its unread badge in the dashboard,
    // exactly like opening it there.
    const thread = await this.thread(inquiry.id, userId);
    await this.markRead(inquiry.id, userId);
    return { inquiry: thread };
  }

  /** Every thread the member is in — as buyer or seller — newest first. */
  async listForMe(userId: string) {
    const rows = await this.prisma.listingInquiry.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      select: {
        id: true,
        listingId: true,
        buyerId: true,
        sellerId: true,
        lastMessageAt: true,
        createdAt: true,
        listing: { select: { id: true, title: true, status: true } },
        buyer: { select: PUBLIC_INQUIRY_USER },
        seller: { select: PUBLIC_INQUIRY_USER },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            content: true,
            senderId: true,
            createdAt: true,
            media: { select: { kind: true }, take: 1 },
          },
        },
        _count: {
          select: {
            messages: {
              where: { senderId: { not: userId }, readAt: null },
            },
          },
        },
      },
    });

    return rows.map((r) => {
      const last = r.messages[0] ?? null;
      return {
        id: r.id,
        listing: r.listing,
        role: r.sellerId === userId ? 'SELLER' : 'BUYER',
        counterparty: r.sellerId === userId ? r.buyer : r.seller,
        lastMessageAt: r.lastMessageAt,
        unread: r._count.messages,
        lastMessage: last
          ? {
              preview: last.content
                ? last.content.slice(0, 140)
                : last.media.length > 0
                  ? last.media[0].kind === 'VIDEO'
                    ? 'Sent a video'
                    : 'Sent a photo'
                  : '',
              senderId: last.senderId,
              createdAt: last.createdAt,
            }
          : null,
      };
    });
  }

  /** One thread, full messages + media. Marks the counterparty's rows read. */
  async getThread(inquiryId: string, userId: string) {
    await this.assertParticipant(inquiryId, userId);
    const out = await this.thread(inquiryId, userId);
    await this.markRead(inquiryId, userId);
    return out;
  }

  // ── writes ─────────────────────────────────────────────────────────

  /** Buyer starts (or reuses) the thread on a listing with a first message. */
  async sendAsBuyer(listingId: string, buyerId: string, rawContent: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true, title: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.sellerId === buyerId) {
      throw new BadRequestException("You can't message yourself about your own listing.");
    }
    if (listing.status !== 'ACTIVE') {
      throw new BadRequestException(
        'You can only message the seller about an active listing.',
      );
    }

    const inquiry = await this.prisma.listingInquiry.upsert({
      where: { listingId_buyerId: { listingId, buyerId } },
      create: { listingId, buyerId, sellerId: listing.sellerId },
      update: {},
      select: { id: true },
    });

    return this.sendMessage(inquiry.id, buyerId, rawContent);
  }

  /** Either participant sends a text message in an existing thread. */
  async sendMessage(inquiryId: string, userId: string, rawContent: string) {
    const inquiry = await this.assertParticipant(inquiryId, userId);
    const text = (rawContent ?? '').trim();
    if (!text) throw new BadRequestException('Message is empty');
    if (text.length > MAX_INQUIRY_MESSAGE_LEN) {
      throw new BadRequestException(
        `Message is too long (max ${MAX_INQUIRY_MESSAGE_LEN} characters)`,
      );
    }

    const { content, wasModerated, needsReview, categories } =
      await this.moderateText(text);

    const message = await this.prisma.listingInquiryMessage.create({
      data: {
        inquiryId,
        senderId: userId,
        content,
        originalContent: wasModerated ? text : null,
        wasModerated,
      },
      include: { media: true },
    });
    await this.touch(inquiryId);
    await this.raiseReviewAlert(
      inquiryId,
      message.id,
      needsReview,
      categories,
    );
    await this.notifyCounterparty(inquiry, userId, content);

    return this.toMessage(message);
  }

  /**
   * Seller-only media reply. Accepts up to 4 images and/or 1 video in one
   * request. Every asset is uploaded, screened, and only then attached to a
   * new message — a refused or uncertain asset is deleted and the whole
   * request fails, so a partial set is never published.
   */
  async sendMedia(
    inquiryId: string,
    userId: string,
    files: {
      images?: Express.Multer.File[];
      video?: Express.Multer.File;
    },
  ) {
    const inquiry = await this.assertParticipant(inquiryId, userId);
    if (inquiry.sellerId !== userId) {
      throw new ForbiddenException(
        'Only the seller can attach photos or video to this conversation.',
      );
    }

    const images = files.images ?? [];
    if (images.length === 0 && !files.video) {
      throw new BadRequestException('Attach at least one photo or a video.');
    }
    if (images.length > MAX_INQUIRY_IMAGES) {
      throw new BadRequestException(
        `Attach at most ${MAX_INQUIRY_IMAGES} photos.`,
      );
    }
    // Multer is capped globally at the video ceiling; images carry their own
    // tighter 8 MB / format checks here (same limits as listing photos).
    for (const img of images) {
      if (!/^image\/(jpeg|png|webp)$/i.test(img.mimetype)) {
        throw new BadRequestException(
          'Photos must be JPEG, PNG or WebP.',
        );
      }
      if (img.size > 8 * 1024 * 1024) {
        throw new BadRequestException('Each photo must be 8 MB or smaller.');
      }
    }
    if (files.video) {
      if (!/^video\/(mp4|quicktime|webm)$/i.test(files.video.mimetype)) {
        throw new BadRequestException('Video must be MP4, MOV or WebM.');
      }
      if (files.video.size > 64 * 1024 * 1024) {
        throw new BadRequestException('Video must be 64 MB or smaller.');
      }
    }

    const uploadedImages: { url: string; publicId: string }[] = [];
    let uploadedVideo:
      | {
          url: string;
          publicId: string;
          thumbnailUrl: string;
          durationSeconds?: number;
          width?: number;
          height?: number;
        }
      | null = null;

    try {
      for (const file of images) {
        uploadedImages.push(
          await this.cloudinary.uploadImage(file.buffer, 'inquiries'),
        );
      }
      if (files.video) {
        uploadedVideo = await this.cloudinary.uploadVideo(
          files.video.buffer,
          'inquiries',
        );
      }

      const verdict = await this.moderation.moderateInquiryMedia({
        imageUrls: uploadedImages.map((i) => i.url),
        video: uploadedVideo
          ? {
              url: uploadedVideo.url,
              thumbnailUrl: uploadedVideo.thumbnailUrl,
            }
          : null,
      });

      if (verdict.decision !== 'APPROVE') {
        await this.deleteUploads(uploadedImages, uploadedVideo);
        throw new BadRequestException(
          verdict.decision === 'REJECT'
            ? (verdict.publicReason ??
              verdict.reasons[0] ??
              'That media is not allowed on ALL Outdoor.')
            : 'We could not verify that media automatically. Try a clearer photo or a shorter clip with no on-screen text, contact details or QR codes.',
        );
      }

      const message = await this.prisma.listingInquiryMessage.create({
        data: {
          inquiryId,
          senderId: userId,
          content: '',
          media: {
            create: [
              ...uploadedImages.map((i) => ({
                kind: 'IMAGE' as const,
                url: i.url,
                publicId: i.publicId,
              })),
              ...(uploadedVideo
                ? [
                    {
                      kind: 'VIDEO' as const,
                      url: uploadedVideo.url,
                      publicId: uploadedVideo.publicId,
                      thumbnailUrl: uploadedVideo.thumbnailUrl ?? null,
                      durationSeconds:
                        uploadedVideo.durationSeconds ?? null,
                      width: uploadedVideo.width ?? null,
                      height: uploadedVideo.height ?? null,
                    },
                  ]
                : []),
            ],
          },
        },
        include: { media: true },
      });

      await this.touch(inquiryId);
      await this.notifyCounterparty(
        inquiry,
        userId,
        uploadedVideo ? 'Sent a video' : `Sent ${images.length} photo(s)`,
      );
      return this.toMessage(message);
    } catch (err) {
      // Anything that fails after upload must not leave orphans behind.
      if (!(err instanceof BadRequestException)) {
        await this.deleteUploads(uploadedImages, uploadedVideo);
      }
      throw err;
    }
  }

  // ── internals ──────────────────────────────────────────────────────

  private async assertParticipant(inquiryId: string, userId: string) {
    const inquiry = await this.prisma.listingInquiry.findUnique({
      where: { id: inquiryId },
      select: {
        id: true,
        listingId: true,
        buyerId: true,
        sellerId: true,
        listing: { select: { title: true } },
        buyer: { select: { email: true, firstName: true } },
        seller: { select: { email: true, firstName: true } },
      },
    });
    if (!inquiry) throw new NotFoundException('Conversation not found');
    if (inquiry.buyerId !== userId && inquiry.sellerId !== userId) {
      throw new ForbiddenException('You are not part of this conversation');
    }
    return inquiry;
  }

  private async thread(inquiryId: string, viewerId: string) {
    const inquiry = await this.prisma.listingInquiry.findUnique({
      where: { id: inquiryId },
      select: {
        id: true,
        listingId: true,
        buyerId: true,
        sellerId: true,
        lastMessageAt: true,
        createdAt: true,
        listing: { select: { id: true, title: true, status: true } },
        buyer: { select: PUBLIC_INQUIRY_USER },
        seller: { select: PUBLIC_INQUIRY_USER },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 500,
          include: { media: true },
        },
      },
    });
    if (!inquiry) throw new NotFoundException('Conversation not found');
    return {
      id: inquiry.id,
      role: inquiry.sellerId === viewerId ? 'SELLER' : 'BUYER',
      listing: inquiry.listing,
      buyer: inquiry.buyer,
      seller: inquiry.seller,
      lastMessageAt: inquiry.lastMessageAt,
      createdAt: inquiry.createdAt,
      messages: inquiry.messages.map((m) => this.toMessage(m)),
    };
  }

  private toMessage(m: {
    id: string;
    senderId: string;
    content: string;
    wasModerated: boolean;
    createdAt: Date;
    media?: {
      id: string;
      kind: 'IMAGE' | 'VIDEO';
      url: string;
      thumbnailUrl: string | null;
      durationSeconds: number | null;
      width: number | null;
      height: number | null;
    }[];
  }) {
    return {
      id: m.id,
      senderId: m.senderId,
      content: m.content,
      wasModerated: m.wasModerated,
      createdAt: m.createdAt,
      media: (m.media ?? []).map((x) => ({
        id: x.id,
        kind: x.kind,
        url: x.url,
        // Playback derivative for video; null for photos.
        playbackUrl:
          x.kind === 'VIDEO' ? optimizedVideoUrl(x.url, 720) : null,
        thumbnailUrl: x.thumbnailUrl,
        durationSeconds: x.durationSeconds,
        width: x.width,
        height: x.height,
      })),
    };
  }

  private async touch(inquiryId: string) {
    await this.prisma.listingInquiry.update({
      where: { id: inquiryId },
      data: { lastMessageAt: new Date() },
    });
  }

  private async markRead(inquiryId: string, userId: string) {
    await this.prisma.listingInquiryMessage.updateMany({
      where: {
        inquiryId,
        senderId: { not: userId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
  }

  /**
   * Same two-layer text gate as transaction messages: deterministic strip,
   * then the Jev contact/conduct battery. Abuse is blocked; a model-only
   * contact hit regex could not strip is sent stripped and parked for T&S.
   */
  private async moderateText(text: string): Promise<{
    content: string;
    wasModerated: boolean;
    needsReview: boolean;
    categories: string[];
  }> {
    const { text: stripped, categories } = this.contactFilter.redact(text);

    const verdict = await jevLadder(this.llm, {
      state: text,
      questions: { ...contactQuestions(), ...conductQuestions() },
      reasons: JEV_CATEGORY_REASONS,
      purpose: 'moderation.listing.inquiry',
      onError: 'pass',
    });

    if (verdict.decision === 'BLOCK' && verdict.category === 'abuse') {
      throw new BadRequestException(
        verdict.reason ?? 'That message is not allowed on ALL Outdoor.',
      );
    }

    const needsReview =
      verdict.decision === 'REVIEW' ||
      (verdict.decision === 'BLOCK' && verdict.category !== 'abuse');

    return {
      content: stripped,
      wasModerated: stripped !== text,
      needsReview,
      categories: [...categories, verdict.category].filter(
        (c): c is string => !!c,
      ),
    };
  }

  private async raiseReviewAlert(
    inquiryId: string,
    messageId: string,
    needsReview: boolean,
    categories: string[],
  ) {
    if (!needsReview && categories.length === 0) return;
    void this.prisma.adminAlert
      .create({
        data: {
          type: 'MESSAGE_MODERATION',
          referenceId: messageId,
          urgent: needsReview,
          context: `Listing inquiry message ${messageId} on ${inquiryId}: ${
            needsReview ? 'T&S review requested' : 'auto-stripped'
          } (categories: ${categories.join(', ')}).`,
        },
      })
      .catch(() => undefined);
  }

  private async notifyCounterparty(
    inquiry: {
      id: string;
      buyerId: string;
      sellerId: string;
      listing: { title: string };
      buyer: { email: string; firstName: string | null };
      seller: { email: string; firstName: string | null };
    },
    senderId: string,
    preview: string,
  ) {
    const senderIsBuyer = senderId === inquiry.buyerId;
    const recipient = senderIsBuyer ? inquiry.seller : inquiry.buyer;
    void this.notifications
      .listingInquiryMessage({
        recipientEmail: recipient.email,
        recipientName: recipient.firstName ?? 'there',
        listingTitle: inquiry.listing.title,
        inquiryId: inquiry.id,
        senderIsBuyer,
        preview,
      })
      .catch((err) =>
        this.logger.warn(
          `listingInquiryMessage notification failed: ${(err as Error).message}`,
        ),
      );
  }

  private async deleteUploads(
    images: { publicId: string }[],
    video: { publicId: string } | null,
  ) {
    await Promise.all([
      ...images.map((i) =>
        this.cloudinary.deleteImage(i.publicId).catch(() => undefined),
      ),
      video
        ? this.cloudinary.deleteVideo(video.publicId).catch(() => undefined)
        : Promise.resolve(),
    ]);
  }
}

const PUBLIC_INQUIRY_USER = {
  id: true,
  username: true,
  avatarUrl: true,
  sellerTier: true,
  subscriptionTier: true,
  isVerifiedExpert: true,
} as const;
