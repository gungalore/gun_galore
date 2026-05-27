import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CounterOfferDto } from './dto/counter-offer.dto';
import { OfferStatus } from '@prisma/client';

const OFFER_TTL_HOURS = 48;
const COUNTER_TTL_HOURS = 24;
const CHECKOUT_TTL_HOURS = 24;
// Lazy getter — must NOT be a module-level constant. ES module imports
// hoist before main.ts's dotenv.config() runs, so a top-level
// `const APP_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000'`
// captures `undefined` and falls back to localhost. Every SMS token URL
// then breaks for live users. Calling the function at use-time defers
// the env read until after dotenv has populated process.env.
const APP_URL = () => process.env.FRONTEND_URL ?? 'http://localhost:3000';

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly contactFilter: ContactDetailFilterService,
    // ActionTokensService is @Global so no module-level import
    // needed — we mint OFFER_DECISION / COUNTER_DECISION / CHECKOUT
    // tokens at the moment each notification fires so the recipient
    // can act from the SMS link without signing in.
    private readonly actionTokens: ActionTokensService,
  ) {}

  // ----------------------------------------------------------------
  // Submit an offer (buyers only, one per listing)
  // ----------------------------------------------------------------
  async submit(buyerClerkId: string, dto: CreateOfferDto) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId: buyerClerkId } });
    if (!buyer) throw new ForbiddenException('User not found');
    if (buyer.isBanned) throw new ForbiddenException('Account is suspended');

    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      include: { seller: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== 'ACTIVE') throw new BadRequestException('Listing is no longer available');
    if (listing.listingType !== 'TAKE_A_SHOT') {
      throw new BadRequestException('Offers can only be made on Take a Shot listings');
    }
    if (listing.sellerId === buyer.id) throw new BadRequestException('Sellers cannot offer on their own listings');

    // One offer per buyer per listing (enforced by @@unique in schema)
    const existing = await this.prisma.offer.findUnique({
      where: { listingId_buyerId: { listingId: listing.id, buyerId: buyer.id } },
    });
    if (existing && !['REJECTED', 'WITHDRAWN', 'EXPIRED'].includes(existing.status)) {
      throw new BadRequestException('You already have an active offer on this listing');
    }

    // Contact-detail filter on the optional buyer note — the seller
    // sees this note verbatim in their offer-received email, so it's a
    // prime channel for "WhatsApp me on 082..." fee-bypass attempts.
    // We reject before any DB write or notification. clerkId is passed
    // so the filter can persist the rejection against this user for
    // the T&S queue + repeat-offender tracking.
    if (dto.buyerNote) {
      const check = await this.contactFilter.check(
        dto.buyerNote,
        'offer-note',
        buyerClerkId,
      );
      if (!check.allowed) {
        throw new BadRequestException(check.reason);
      }
    }

    // Auto-accept if offer meets the threshold
    const autoAccept =
      listing.autoAcceptThreshold !== null &&
      dto.offerAmount >= listing.autoAcceptThreshold;

    const expiresAt = new Date(
      Date.now() + (autoAccept ? COUNTER_TTL_HOURS : OFFER_TTL_HOURS) * 3_600_000,
    );

    // If a previous (closed) offer exists, delete it so the unique constraint is clear
    if (existing) {
      await this.prisma.offer.delete({ where: { id: existing.id } });
    }

    const offer = await this.prisma.offer.create({
      data: {
        listingId: listing.id,
        buyerId: buyer.id,
        offerAmount: dto.offerAmount,
        buyerNote: dto.buyerNote,
        status: autoAccept ? OfferStatus.ACCEPTED : OfferStatus.PENDING,
        expiresAt,
      },
    });

    // Notify seller of new offer (or skip if auto-accepted)
    if (!autoAccept) {
      void this.notifySellerOfOffer(offer.id);
    } else {
      void this.notifyBuyerOfAccept(offer.id);
    }

    return { offer, autoAccepted: autoAccept };
  }

  // ----------------------------------------------------------------
  // Seller accepts the original offer
  // ----------------------------------------------------------------
  async accept(sellerClerkId: string, offerId: string) {
    const { offer, listing } = await this.loadOfferForSeller(sellerClerkId, offerId);
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Offer is not pending');
    }

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: {
        status: OfferStatus.ACCEPTED,
        expiresAt: new Date(Date.now() + COUNTER_TTL_HOURS * 3_600_000),
      },
    });

    void this.notifyBuyerOfAccept(offerId);
    // Resolve the seller's "offer received" notification — they just
    // acted on it. The new "offer accepted" row that fires for the
    // buyer is action-required (buyer must pay) and isn't cleared
    // here; TransactionsService.payOffer handles that one.
    void this.notifications.resolveByEntity('offer', offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Seller rejects the offer
  // ----------------------------------------------------------------
  async reject(sellerClerkId: string, offerId: string) {
    const { offer } = await this.loadOfferForSeller(sellerClerkId, offerId);
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Offer is not pending');
    }

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.REJECTED },
    });

    void this.notifyBuyerOfReject(offerId);
    // Seller resolved their "offer received". Buyer's new
    // "offer rejected" row is dismissible — they handle it themselves.
    void this.notifications.resolveByEntity('offer', offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Seller counters — one counter per offer lifetime
  // ----------------------------------------------------------------
  async counter(sellerClerkId: string, offerId: string, dto: CounterOfferDto) {
    const { offer } = await this.loadOfferForSeller(sellerClerkId, offerId);
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Offer is not pending');
    }
    if (offer.counterAmount !== null) {
      throw new BadRequestException('Seller can only counter once per offer');
    }

    // Contact-detail filter on the seller's counter-note — buyer sees
    // this verbatim in their counter-offer notification, so it's the
    // mirror-image of the buyer-side note risk.
    if (dto.sellerNote) {
      const check = await this.contactFilter.check(
        dto.sellerNote,
        'counter-note',
        sellerClerkId,
      );
      if (!check.allowed) {
        throw new BadRequestException(check.reason);
      }
    }

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: {
        counterAmount: dto.counterAmount,
        sellerNote: dto.sellerNote,
        status: OfferStatus.COUNTERED,
        expiresAt: new Date(Date.now() + COUNTER_TTL_HOURS * 3_600_000),
      },
    });

    void this.notifyBuyerOfCounter(offerId);
    // Seller resolved their "offer received". Buyer's new
    // "offer countered" row is action-required (buyer must respond)
    // and stays open until they accept/reject the counter.
    void this.notifications.resolveByEntity('offer', offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Buyer accepts the seller's counter
  // ----------------------------------------------------------------
  async acceptCounter(buyerClerkId: string, offerId: string) {
    const { offer } = await this.loadOfferForBuyer(buyerClerkId, offerId);
    if (offer.status !== OfferStatus.COUNTERED) {
      throw new BadRequestException('No counter to accept');
    }

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: {
        status: OfferStatus.ACCEPTED,
        expiresAt: new Date(Date.now() + COUNTER_TTL_HOURS * 3_600_000),
      },
    });

    void this.notifySellerOfCounterAccepted(offerId);
    // Buyer resolved their "offer countered". Seller's new
    // counterAccepted row is dismissible (buyer will pay next).
    void this.notifications.resolveByEntity('offer', offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Buyer rejects the counter — offer closes
  // ----------------------------------------------------------------
  async rejectCounter(buyerClerkId: string, offerId: string) {
    const { offer } = await this.loadOfferForBuyer(buyerClerkId, offerId);
    if (offer.status !== OfferStatus.COUNTERED) {
      throw new BadRequestException('No counter to reject');
    }

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.REJECTED },
    });

    void this.notifySellerOfCounterRejected(offerId);
    // Buyer resolved their "offer countered". Seller's new
    // counterRejected row is dismissible (final state).
    void this.notifications.resolveByEntity('offer', offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Buyer withdraws (only while PENDING)
  // ----------------------------------------------------------------
  async withdraw(buyerClerkId: string, offerId: string) {
    const { offer } = await this.loadOfferForBuyer(buyerClerkId, offerId);
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Cannot withdraw — offer is no longer pending');
    }

    return this.prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.WITHDRAWN },
    });
  }

  // ----------------------------------------------------------------
  // Queries
  // ----------------------------------------------------------------
  async getMyOffers(buyerClerkId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId: buyerClerkId } });
    if (!buyer) return [];
    return this.prisma.offer.findMany({
      where: { buyerId: buyer.id },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            images: { where: { isPrimary: true }, take: 1 },
            // Public-facing — username only, no real name.
            seller: { select: { username: true, clerkId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReceivedOffers(sellerClerkId: string) {
    const seller = await this.prisma.user.findUnique({ where: { clerkId: sellerClerkId } });
    if (!seller) return [];
    return this.prisma.offer.findMany({
      where: { listing: { sellerId: seller.id } },
      include: {
        listing: { select: { id: true, title: true } },
        // Seller side viewing the buyer who made an offer — username
        // only. Buyer identity stays private until checkout completes.
        buyer: { select: { username: true, clerkId: true, totalSales: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(clerkId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            autoAcceptThreshold: true,
            passFeeToBuyer: true,
            // Seller email retained — only seller themselves sees
            // their own email via this endpoint (gated by isSeller
            // check below). Username is the public handle.
            seller: { select: { clerkId: true, username: true, email: true } },
          },
        },
        buyer: { select: { clerkId: true, username: true } },
      },
    });
    if (!offer) throw new NotFoundException('Offer not found');

    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException();

    const isBuyer = offer.buyerId === user.id;
    const isSeller = offer.listing.seller.clerkId === clerkId;
    if (!isBuyer && !isSeller) throw new ForbiddenException('Access denied');

    return offer;
  }

  // ----------------------------------------------------------------
  // Cron helper — expire stale offers
  // ----------------------------------------------------------------
  async expireStale() {
    const result = await this.prisma.offer.updateMany({
      where: {
        status: { in: [OfferStatus.PENDING, OfferStatus.COUNTERED, OfferStatus.ACCEPTED] },
        expiresAt: { lt: new Date() },
      },
      data: { status: OfferStatus.EXPIRED },
    });
    if (result.count > 0) this.logger.log(`Expired ${result.count} offer(s)`);
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------
  private async loadOfferForSeller(sellerClerkId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { listing: { include: { seller: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.listing.seller.clerkId !== sellerClerkId) throw new ForbiddenException('Access denied');
    return { offer, listing: offer.listing };
  }

  private async loadOfferForBuyer(buyerClerkId: string, offerId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId: buyerClerkId } });
    if (!buyer) throw new ForbiddenException();
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { listing: { include: { seller: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.buyerId !== buyer.id) throw new ForbiddenException('Access denied');
    return { offer, listing: offer.listing };
  }

  private async notifySellerOfOffer(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: {
          listing: { include: { seller: true } },
          buyer: true,
        },
      });
      if (!offer) return;
      // Mint an OFFER_DECISION token so the seller can accept /
      // reject / counter straight from the SMS link without
      // signing in. Token expires when the offer does.
      const token = await this.actionTokens
        .mint({
          purpose: 'OFFER_DECISION',
          targetType: 'offer',
          targetId: offer.id,
          authorisedUserId: offer.listing.sellerId,
          expiresAt: offer.expiresAt ?? new Date(Date.now() + OFFER_TTL_HOURS * 3600_000),
        })
        .catch((err) => {
          this.logger.warn(`OFFER_DECISION token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.offerReceived({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        sellerPhone: offer.listing.seller.phone,
        buyerName: `${offer.buyer.firstName ?? ''} ${offer.buyer.lastName ?? ''}`.trim() || 'A buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerAmount: offer.offerAmount,
        offerId: offer.id,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`notifySellerOfOffer failed: ${(err as Error).message}`);
    }
  }

  private async notifyBuyerOfAccept(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: true, buyer: true },
      });
      if (!offer) return;
      // Offer accepted → mint a CHECKOUT token for the buyer so the
      // SMS link drops them straight on the checkout page (no
      // sign-in). 24h expiry matches the "pay within 24h" rule.
      const token = await this.actionTokens
        .mint({
          purpose: 'CHECKOUT',
          targetType: 'listing',
          targetId: offer.listing.id,
          authorisedUserId: offer.buyerId,
          expiresAt: new Date(Date.now() + CHECKOUT_TTL_HOURS * 3600_000),
          metadata: { offerId: offer.id, agreedAmount: offer.offerAmount },
        })
        .catch((err) => {
          this.logger.warn(`CHECKOUT token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.offerAccepted({
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        buyerPhone: offer.buyer.phone,
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        acceptedAmount: offer.offerAmount,
        offerId: offer.id,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`notifyBuyerOfAccept failed: ${(err as Error).message}`);
    }
  }

  private async notifyBuyerOfReject(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: true, buyer: true },
      });
      if (!offer) return;
      await this.notifications.offerRejected({
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
      });
    } catch (err) {
      this.logger.error(`notifyBuyerOfReject failed: ${(err as Error).message}`);
    }
  }

  private async notifyBuyerOfCounter(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: true, buyer: true },
      });
      if (!offer || !offer.counterAmount) return;
      // Counter sent → mint a COUNTER_DECISION token for the buyer.
      // Expires with the counter (24h).
      const token = await this.actionTokens
        .mint({
          purpose: 'COUNTER_DECISION',
          targetType: 'offer',
          targetId: offer.id,
          authorisedUserId: offer.buyerId,
          expiresAt: offer.expiresAt ?? new Date(Date.now() + COUNTER_TTL_HOURS * 3600_000),
        })
        .catch((err) => {
          this.logger.warn(`COUNTER_DECISION token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.offerCountered({
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        buyerPhone: offer.buyer.phone,
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        originalAmount: offer.offerAmount,
        counterAmount: offer.counterAmount,
        sellerNote: offer.sellerNote ?? undefined,
        offerId: offer.id,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`notifyBuyerOfCounter failed: ${(err as Error).message}`);
    }
  }

  private async notifySellerOfCounterAccepted(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: { include: { seller: true } }, buyer: true },
      });
      if (!offer || !offer.counterAmount) return;
      await this.notifications.counterAccepted({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        buyerName: `${offer.buyer.firstName ?? ''} ${offer.buyer.lastName ?? ''}`.trim() || 'A buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        counterAmount: offer.counterAmount,
        offerId: offer.id,
      });
    } catch (err) {
      this.logger.error(`notifySellerOfCounterAccepted failed: ${(err as Error).message}`);
    }
  }

  private async notifySellerOfCounterRejected(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: { include: { seller: true } }, buyer: true },
      });
      if (!offer) return;
      await this.notifications.counterRejected({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        buyerName: `${offer.buyer.firstName ?? ''} ${offer.buyer.lastName ?? ''}`.trim() || 'A buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
      });
    } catch (err) {
      this.logger.error(`notifySellerOfCounterRejected failed: ${(err as Error).message}`);
    }
  }
}
