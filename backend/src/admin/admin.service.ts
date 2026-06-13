import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ListingsService } from '../listings/listings.service';
import { AdminAuditService } from './admin-audit.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { StitchService } from '../payments/stitch.service';
import { ListingReviewDto, ReviewAction } from './dto/listing-review.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly listings: ListingsService,
    private readonly audit: AdminAuditService,
    // @Global so no module import. Used by refundTransaction() to
    // post a Credit Note to Books reversing the original commission
    // invoice.
    private readonly zohoBooks: ZohoBooksService,
    // PaymentsModule (imported by AdminModule) exports StitchService.
    // refundTransaction() calls it to actually move the money back to the
    // buyer before flipping the row to REFUNDED.
    private readonly stitch: StitchService,
  ) {}

  // ---------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------
  async stats() {
    const [pendingListings, pendingPayments, totalUsers, bannedUsers] = await Promise.all([
      this.prisma.listing.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.transaction.count({ where: { paymentStatus: 'PENDING_ADMIN_VERIFICATION' } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isBanned: true } }),
    ]);
    return { pendingListings, pendingPayments, totalUsers, bannedUsers };
  }

  // ---------------------------------------------------------------
  // Listings
  // ---------------------------------------------------------------
  async getListings(status?: string, page = 1, limit = 20) {
    const where = status ? { status: status as never } : { status: 'PENDING_REVIEW' as never };
    const [listings, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: {
          seller: { select: { id: true, clerkId: true, firstName: true, lastName: true, email: true, sellerTier: true } },
          category: { select: { name: true, isFirearm: true } },
          images: { where: { isPrimary: true }, take: 1 },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { listings, total, page, limit };
  }

  async reviewListing(listingId: string, adminId: string, dto: ListingReviewDto) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== 'PENDING_REVIEW')
      throw new BadRequestException('Listing is not pending review');

    const newStatus = dto.action === ReviewAction.APPROVE ? 'ACTIVE' : 'CANCELLED';
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: newStatus,
        adminReviewedById: adminId,
        adminReviewedAt: new Date(),
        adminOverrideReason: dto.reason ?? null,
        ...(newStatus === 'ACTIVE' ? { expiresAt: new Date(Date.now() + 60 * 24 * 3600_000) } : {}),
      },
      include: { seller: { select: { email: true, firstName: true, lastName: true } } },
    });

    // CRITICAL: Meilisearch sync. ListingsService.create() only
    // indexes when status lands directly in ACTIVE; admin-approved
    // listings used to be missing from search-driven views (marketplace
    // search, category-filter combos) because nothing re-indexed them.
    // reindexById() reads the current row, indexes it if ACTIVE, or
    // removes it from the index otherwise (idempotent — a delete of
    // a non-indexed doc is a no-op in Meilisearch).
    void this.listings.reindexById(listingId);

    const sellerDetails = {
      listingTitle: updated.title,
      listingId: updated.id,
      sellerEmail: updated.seller.email,
      sellerName: [updated.seller.firstName, updated.seller.lastName].filter(Boolean).join(' ') || 'Seller',
      reason: dto.reason,
    };
    void (newStatus === 'ACTIVE'
      ? this.notifications.listingApproved(sellerDetails)
      : this.notifications.listingRejected(sellerDetails));

    return updated;
  }

  // Admin take-down for ANY listing, regardless of current status.
  // Soft-delete: we flip status → CANCELLED and stamp the admin
  // override reason so audit + future appeals stay intact. The seller
  // is always notified with the reason; this is non-negotiable per
  // the operator's policy ("user should be notified of listing being
  // deleted with a reason why").
  //
  // We also yank the row from Meilisearch on the way out so it
  // disappears from marketplace search instantly.
  async deleteListing(
    listingId: string,
    adminId: string,
    reason: string,
  ) {
    const trimmedReason = (reason ?? '').trim();
    if (!trimmedReason) {
      throw new BadRequestException(
        'A reason is required when deleting a listing — the seller will see it.',
      );
    }

    const existing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!existing) throw new NotFoundException('Listing not found');

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: 'CANCELLED',
        adminReviewedById: adminId,
        adminReviewedAt: new Date(),
        adminOverrideReason: trimmedReason,
      },
      include: {
        seller: {
          select: { email: true, firstName: true, lastName: true },
        },
      },
    });

    // Remove from search immediately (reindexById is no-op on
    // non-ACTIVE so the explicit removal is the safer call here).
    void this.listings.removeFromIndex(listingId);

    // Notify the seller. Separate template from listingRejected
    // because the wording differs — "rejected at review" ≠
    // "removed after going live". We tell them why + point at
    // support if they want to appeal.
    void this.notifications.listingRemovedByAdmin({
      sellerEmail: updated.seller.email,
      sellerName:
        [updated.seller.firstName, updated.seller.lastName]
          .filter(Boolean)
          .join(' ') || 'Seller',
      listingTitle: updated.title,
      listingId: updated.id,
      reason: trimmedReason,
    });

    return updated;
  }

  // ---------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------
  async getUsers(search?: string, page = 1, limit = 30, filter?: string) {
    // Compose filters. `search` is text against email/name; `filter`
    // is one of:
    //   'kyc-stalled' — kycRequired > 24h ago but still not verified
    //                  (command-center attention card deep-links here)
    //   'banned'      — isBanned = true
    //   'dealers'     — sellerTier = DEALER
    // Anything else (or undefined) returns all users.
    const day = 24 * 3600 * 1000;
    const filterWhere: Record<string, unknown> = (() => {
      if (filter === 'kyc-stalled' || filter === 'stalled') {
        return {
          kycRequiredAt: { not: null, lt: new Date(Date.now() - day) },
          kycStatus: { not: 'VERIFIED' },
          isBanned: false,
        };
      }
      if (filter === 'banned') return { isBanned: true };
      if (filter === 'dealers') return { sellerTier: 'DEALER' };
      return {};
    })();

    const where = {
      ...filterWhere,
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { username: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          clerkId: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          sellerTier: true,
          kycStatus: true,
          isBanned: true,
          totalSales: true,
          trustScore: true,
          averageRating: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users, total, page, limit };
  }

  async updateUser(userId: string, adminId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Snapshot before-state for the audit log so an admin reviewing
    // history later can see exactly what changed (not just "tier
    // changed", but "ESTABLISHED → TOP_SELLER").
    const before = {
      sellerTier: user.sellerTier,
      kycStatus: user.kycStatus,
      isBanned: user.isBanned,
    };

    const data: Record<string, unknown> = {};
    const actions: { action: string; oldValue: unknown; newValue: unknown }[] = [];
    if (dto.sellerTier !== undefined && dto.sellerTier !== user.sellerTier) {
      data.sellerTier = dto.sellerTier;
      actions.push({
        action: 'USER_TIER_CHANGE',
        oldValue: user.sellerTier,
        newValue: dto.sellerTier,
      });
    }
    if (dto.kycStatus !== undefined && dto.kycStatus !== user.kycStatus) {
      data.kycStatus = dto.kycStatus;
      if (dto.kycStatus === 'VERIFIED') data.kycVerifiedAt = new Date();
      actions.push({
        action: 'USER_KYC_OVERRIDE',
        oldValue: user.kycStatus,
        newValue: dto.kycStatus,
      });
    }
    if (dto.isBanned !== undefined && dto.isBanned !== user.isBanned) {
      data.isBanned = dto.isBanned;
      data.bannedAt = dto.isBanned ? new Date() : null;
      actions.push({
        action: dto.isBanned ? 'USER_BAN' : 'USER_UNBAN',
        oldValue: user.isBanned,
        newValue: dto.isBanned,
      });
    }

    // No-op PATCH (all values match current state). Don't write an
    // audit row + don't roundtrip the DB.
    if (actions.length === 0) {
      return user;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    // Audit each distinct change with its own row so /admin/audit
    // shows a clean history when an admin batches multiple field
    // changes in one request.
    for (const a of actions) {
      await this.audit.record({
        adminUserId: adminId,
        action: a.action,
        resourceType: 'User',
        resourceId: userId,
        oldValue: a.oldValue,
        newValue: a.newValue,
        reason: dto.reason,
      });
    }

    return updated;
  }

  // ---------------------------------------------------------------
  // User dossier — everything about one user on a single page.
  // Powers /admin/users/[id]. Pulls in parallel from a dozen+
  // tables so the dossier renders in one round-trip from the
  // frontend's perspective.
  // ---------------------------------------------------------------
  async getUserDossier(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      // Include EVERYTHING — admin-side, so admin-only PII fields
      // (phone, address, bank) are fair game. We're not redacting.
      // The frontend admin layout is JWT-gated separately.
      include: {
        // Relation field names live on the User model — see schema.prisma:
        //   listings, buyerTransactions, sellerTransactions,
        //   offersPlaced (NOT buyerOffers), bidsPlaced (if defined).
        // We pull only the ones that exist + are always defined.
        _count: {
          select: {
            listings: true,
            buyerTransactions: true,
            sellerTransactions: true,
            offersPlaced: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Pull every adjacent dataset in parallel. Each query is bounded
    // so a power-seller with 5,000 listings doesn't melt the page.
    const [
      listings,
      buyerTransactions,
      sellerTransactions,
      buyerOffers,
      bids,
      ratingsReceived,
      ratingsGiven,
      auditEvents,
      systemAlerts,
    ] = await Promise.all([
      this.prisma.listing.findMany({
        where: { sellerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          referenceNumber: true,
          title: true,
          price: true,
          listingType: true,
          status: true,
          createdAt: true,
          soldAt: true,
          claudeDecision: true,
          claudeConfidence: true,
          _count: { select: { offers: true, bids: true, watchers: true } },
        },
      }),
      this.prisma.transaction.findMany({
        where: { buyerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          paymentStatus: true,
          buyerTotal: true,
          createdAt: true,
          listing: { select: { title: true } },
          seller: { select: { username: true } },
        },
      }),
      this.prisma.transaction.findMany({
        where: { sellerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          paymentStatus: true,
          sellerPayout: true,
          createdAt: true,
          listing: { select: { title: true } },
          buyer: { select: { username: true } },
        },
      }),
      this.prisma.offer.findMany({
        // Schema uses `BuyerOffers` relation, so the FK column is `buyerId`.
        // (We call the variable `buyerOffers` in the response for clarity.)
        where: { buyerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          offerAmount: true,
          status: true,
          createdAt: true,
          listing: { select: { id: true, title: true } },
        },
      }),
      this.prisma.bid.findMany({
        where: { bidderId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          isWinner: true,
          listing: { select: { id: true, title: true, status: true } },
        },
      }),
      this.prisma.rating.findMany({
        where: { ratedId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          stars: true,
          comment: true,
          createdAt: true,
          rater: { select: { username: true } },
        },
      }),
      this.prisma.rating.findMany({
        where: { raterId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          stars: true,
          comment: true,
          createdAt: true,
          rated: { select: { username: true, id: true } },
        },
      }),
      this.prisma.adminAuditEvent.findMany({
        where: { resourceType: 'User', resourceId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          oldValue: true,
          newValue: true,
          reason: true,
          createdAt: true,
          adminUser: { select: { email: true } },
        },
      }),
      this.prisma.adminAlert.findMany({
        where: { referenceId: userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          type: true,
          context: true,
          urgent: true,
          resolved: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      user,
      listings,
      buyerTransactions,
      sellerTransactions,
      buyerOffers,
      bids,
      ratingsReceived,
      ratingsGiven,
      auditEvents,
      systemAlerts,
    };
  }

  // ---------------------------------------------------------------
  // Global admin search — typed in the header bar. Searches users
  // (email/username), listings (title/ref/make+model), transactions
  // (id/peach IDs/ref number) in parallel. Returns a small mixed
  // result set so the type-ahead can render quickly.
  // ---------------------------------------------------------------
  async globalSearch(query: string) {
    const q = (query ?? '').trim();
    if (q.length < 2) {
      return { users: [], listings: [], transactions: [] };
    }
    const insensitive = { contains: q, mode: 'insensitive' as const };
    const upper = q.toUpperCase();

    const [users, listings, transactions] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          OR: [
            { email: insensitive },
            { username: insensitive },
            { firstName: insensitive },
            { lastName: insensitive },
            { phone: insensitive },
          ],
        },
        take: 8,
        select: {
          id: true,
          username: true,
          email: true,
          sellerTier: true,
          isBanned: true,
        },
      }),
      this.prisma.listing.findMany({
        where: {
          OR: [
            { title: insensitive },
            { referenceNumber: { equals: upper } },
            { make: insensitive },
            { model: insensitive },
            { id: q }, // exact ID match
          ],
        },
        take: 8,
        select: {
          id: true,
          referenceNumber: true,
          title: true,
          status: true,
          listingType: true,
          price: true,
          seller: { select: { username: true } },
        },
      }),
      this.prisma.transaction.findMany({
        where: {
          OR: [
            { id: q },
            { peachCheckoutId: q },
            { peachPaymentId: q },
            { tcgWaybill: insensitive },
          ],
        },
        take: 8,
        select: {
          id: true,
          paymentStatus: true,
          buyerTotal: true,
          createdAt: true,
          listing: { select: { title: true, referenceNumber: true } },
        },
      }),
    ]);

    return { users, listings, transactions };
  }

  // ---------------------------------------------------------------
  // Bulk-review listings — admin picks N listings in PENDING_REVIEW
  // and approves or rejects them in one call. Returns per-listing
  // outcome so the UI can show partial success ("8 approved, 2 already
  // moved on"). Each successful review records its own audit row +
  // notification, identical to the single-row reviewListing path.
  // ---------------------------------------------------------------
  async bulkReviewListings(
    listingIds: string[],
    adminId: string,
    action: 'APPROVE' | 'REJECT',
    reason?: string,
  ) {
    if (listingIds.length === 0) return { processed: 0, results: [] };
    if (listingIds.length > 100) {
      throw new BadRequestException(
        'Bulk action capped at 100 listings per call — split into batches.',
      );
    }
    const trimmedReason = (reason ?? '').trim();
    if (action === 'REJECT' && trimmedReason.length < 5) {
      throw new BadRequestException(
        'Reason of at least 5 characters required for bulk reject (sent to each seller).',
      );
    }

    const results: { listingId: string; outcome: 'ok' | 'skipped'; message?: string }[] = [];
    for (const id of listingIds) {
      try {
        await this.reviewListing(id, adminId, {
          action: action === 'APPROVE'
            ? ReviewAction.APPROVE
            : ReviewAction.REJECT,
          reason: trimmedReason || undefined,
        });
        results.push({ listingId: id, outcome: 'ok' });
      } catch (err) {
        results.push({
          listingId: id,
          outcome: 'skipped',
          message: (err as Error).message,
        });
      }
    }
    return {
      processed: results.filter((r) => r.outcome === 'ok').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      results,
    };
  }

  // ---------------------------------------------------------------
  // Bulk-ban users — multi-select on the users table. Each ban runs
  // through updateUser so every user gets a USER_BAN audit row with
  // the supplied reason (≥3 chars enforced by the underlying call).
  // Stops short of unbanning in bulk — operator needs to do that
  // one-by-one since unbans should be considered individually.
  // ---------------------------------------------------------------
  async bulkBanUsers(userIds: string[], adminId: string, reason: string) {
    if (userIds.length === 0) return { processed: 0, results: [] };
    if (userIds.length > 50) {
      throw new BadRequestException(
        'Bulk ban capped at 50 users per call — review them in smaller batches.',
      );
    }
    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length < 5) {
      throw new BadRequestException(
        'Reason of at least 5 characters required for bulk ban (recorded against each user).',
      );
    }

    const results: { userId: string; outcome: 'ok' | 'skipped'; message?: string }[] = [];
    for (const id of userIds) {
      try {
        await this.updateUser(id, adminId, {
          isBanned: true,
          reason: trimmedReason,
        });
        results.push({ userId: id, outcome: 'ok' });
      } catch (err) {
        results.push({
          userId: id,
          outcome: 'skipped',
          message: (err as Error).message,
        });
      }
    }
    return {
      processed: results.filter((r) => r.outcome === 'ok').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      results,
    };
  }

  // ---------------------------------------------------------------
  // Listing dossier — full admin view of one listing.
  // Powers /admin/listings/[id]. Includes Claude moderation details,
  // every offer + bid + watcher + transaction, audit trail of admin
  // actions on this listing.
  // ---------------------------------------------------------------
  async getListingDossier(listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        seller: {
          select: {
            id: true,
            username: true,
            email: true,
            sellerTier: true,
            kycStatus: true,
            trustScore: true,
          },
        },
        category: { select: { id: true, name: true, isFirearm: true } },
        images: {
          orderBy: { order: 'asc' },
          select: { id: true, url: true, order: true, isPrimary: true },
        },
        // adminReviewedById is a free FK string — no relation defined
        // in the schema, so we just expose the ID. If we ever need the
        // reviewer's email, we'd add a relation in a separate change.
        _count: { select: { offers: true, bids: true, watchers: true } },
      },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const [offers, bids, watchers, transactions, auditEvents, questions] = await Promise.all([
      this.prisma.offer.findMany({
        where: { listingId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          offerAmount: true,
          counterAmount: true,
          buyerNote: true,
          sellerNote: true,
          status: true,
          createdAt: true,
          buyer: { select: { id: true, username: true } },
        },
      }),
      this.prisma.bid.findMany({
        where: { listingId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          amount: true,
          maxAmount: true,
          isWinner: true,
          createdAt: true,
          bidder: { select: { id: true, username: true } },
        },
      }),
      this.prisma.auctionWatch.findMany({
        where: { listingId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          user: { select: { id: true, username: true } },
        },
      }),
      this.prisma.transaction.findMany({
        where: { listingId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          paymentStatus: true,
          shippingStatus: true,
          buyerTotal: true,
          sellerPayout: true,
          createdAt: true,
          paidAt: true,
          releasedAt: true,
          dispatchedAt: true,
          deliveredAt: true,
          buyer: { select: { id: true, username: true } },
        },
      }),
      this.prisma.adminAuditEvent.findMany({
        where: { resourceType: 'Listing', resourceId: listingId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          oldValue: true,
          newValue: true,
          reason: true,
          createdAt: true,
          adminUser: { select: { email: true } },
        },
      }),
      this.prisma.listingQuestion.findMany({
        where: { listingId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          question: true,
          answer: true,
          status: true,
          questionDecision: true,
          questionReason: true,
          reportedCount: true,
          createdAt: true,
          asker: { select: { username: true } },
        },
      }),
    ]);

    return {
      listing,
      offers,
      bids,
      watchers,
      transactions,
      auditEvents,
      questions,
    };
  }

  // ---------------------------------------------------------------
  // Transaction dossier — everything about one transaction. Powers
  // /admin/transactions/[id]. Pulls parties, listing, payment data,
  // shipping events, audit, rating.
  // ---------------------------------------------------------------
  async getTransactionDossier(txId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: {
        listing: {
          select: {
            id: true,
            referenceNumber: true,
            title: true,
            price: true,
            listingType: true,
            isFirearm: true,
            images: {
              where: { isPrimary: true },
              take: 1,
              select: { url: true },
            },
          },
        },
        buyer: {
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
            kycStatus: true,
            sellerTier: true,
          },
        },
        seller: {
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
            kycStatus: true,
            sellerTier: true,
            profileCompletedAt: true,
            bankVerifiedAt: true,
            bankName: true,
            bankAccountHolder: true,
            bankAccountNumber: true,
          },
        },
        dealer: {
          select: {
            id: true,
            name: true,
            licenceNumber: true,
            city: true,
            phone: true,
          },
        },
        trackingEvents: {
          orderBy: { occurredAt: 'asc' },
          select: {
            id: true,
            status: true,
            rawStatus: true,
            source: true,
            message: true,
            occurredAt: true,
            recordedAt: true,
          },
        },
        rating: {
          select: {
            id: true,
            stars: true,
            comment: true,
            createdAt: true,
          },
        },
        // `messages` include intentionally dropped — buyer/seller
        // chat was never built. The Prisma Message model is kept
        // dormant for any legacy rows, but querying + rendering them
        // in the dossier was misleading screen real estate.
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const auditEvents = await this.prisma.adminAuditEvent.findMany({
      where: { resourceType: 'Transaction', resourceId: txId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        oldValue: true,
        newValue: true,
        reason: true,
        createdAt: true,
        adminUser: { select: { email: true } },
      },
    });

    return { transaction: tx, auditEvents };
  }

  // ---------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------
  async getTransactions(status?: string, page = 1, limit = 20) {
    const where = status
      ? { paymentStatus: status as never }
      : { paymentStatus: 'PENDING_ADMIN_VERIFICATION' as never };
    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          listing: { select: { title: true, price: true } },
          buyer: { select: { firstName: true, lastName: true, email: true } },
          seller: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { transactions, total, page, limit };
  }

  async releaseTransaction(txId: string, adminId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: {
        seller: {
          select: {
            id: true,
            email: true,
            profileCompletedAt: true,
            bankVerifiedAt: true,
            kycStatus: true,
          },
        },
        listing: { select: { isFirearm: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.paymentStatus !== 'PENDING_ADMIN_VERIFICATION')
      throw new BadRequestException('Transaction is not pending admin verification');

    // Hard gate — we will not move money to a seller who hasn't
    // (a) completed their profile (banking + ID on file), or
    // (b) passed KYC selfie.
    // Bank-account verification (AVS) was removed with Peach — the admin
    // reviews the seller's bank details manually before the payout EFT.
    // Each failure surfaces a precise reason so the admin knows exactly
    // which step the seller still owes us.
    const missing: string[] = [];
    if (!tx.seller.profileCompletedAt) missing.push('profile completion');
    if (tx.seller.kycStatus !== 'VERIFIED') missing.push('KYC (selfie + ID)');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot release payout — seller has not completed: ${missing.join(', ')}. ` +
          'Notify them via email to finish setup before re-trying.',
      );
    }

    // Firearm DEALER_TRANSFER additionally requires the SAPS 534
    // verification to be APPROVED. Admins can still override via
    // /admin/transactions/:id/resolve-dispute-release if there's a
    // legitimate reason to release without dealer paperwork (rare —
    // requires reason for audit).
    if (
      tx.listing.isFirearm &&
      tx.shippingMethod === 'DEALER_TRANSFER' &&
      tx.dealerVerificationStatus !== 'APPROVED'
    ) {
      throw new BadRequestException(
        'Cannot release payout — dealer stock-in verification status is ' +
          (tx.dealerVerificationStatus ?? 'NOT_STARTED') +
          '. Approve verification first (or use the resolve-dispute-release path if you have a documented reason to release without it).',
      );
    }

    return this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: txId },
        data: {
          paymentStatus: 'RELEASED',
          releasedAt: new Date(),
          adminReviewedById: adminId,
          adminReviewedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { id: tx.sellerId },
        data: { totalSales: { increment: 1 } },
      }),
    ]);
  }

  async refundTransaction(txId: string, adminId: string, note?: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: { listing: true, buyer: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    // ─── Only HELD or DISPUTED orders can be refunded ────────────────
    // A RELEASED order has already paid the seller (refunding would be a
    // double payout); an already-REFUNDED order must not refund twice.
    // Enforce as an atomic conditional update that ALSO flips the status
    // to REFUNDED in the same statement — this makes the flip the
    // concurrency LOCK: two near-simultaneous admin clicks can't both
    // pass (the second sees count===0 and aborts BEFORE calling the
    // gateway, so we never double-charge the refund). If the gateway
    // call below fails we roll the status back to its prior value, so
    // the buyer is never shown a REFUNDED that didn't actually move money.
    const claim = await this.prisma.transaction.updateMany({
      where: { id: txId, paymentStatus: { in: ['HELD', 'DISPUTED'] } },
      data: {
        paymentStatus: 'REFUNDED',
        adminNote: note ?? null,
        adminReviewedById: adminId,
        adminReviewedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        `Transaction is not in a refundable state (current: ${tx.paymentStatus}). Only HELD or DISPUTED orders can be refunded.`,
      );
    }

    // ─── Move the money back via the gateway ─────────────────────────
    // The status was flipped to REFUNDED above purely as the concurrency
    // lock. We now actually call the gateway; on failure we roll the
    // status back to its prior value so the buyer is never shown a
    // REFUNDED that didn't move money. (Method previously told the buyer
    // "refund issued" but never called the gateway — funds never returned.)
    // peachPaymentId holds the Stitch payment id (column reused during the
    // Peach→Stitch transition).
    const refund = tx.peachPaymentId
      ? await this.stitch.refundPayment(tx.peachPaymentId, tx.buyerTotal)
      : { success: false, resultCode: 'NO_PAYMENT_ID' };

    if (!refund.success) {
      // Roll the status (and review stamps) back to the prior value so the
      // row returns to its refundable state for a retry. Best-effort.
      await this.prisma.transaction
        .update({
          where: { id: txId },
          data: { paymentStatus: tx.paymentStatus },
        })
        .catch(() => undefined);
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'ADMIN_REFUND_GATEWAY_FAILED',
            referenceId: txId,
            urgent: true,
            context: `Admin ${adminId} refund of ${tx.buyerTotal}c failed at gateway (${refund.resultCode ?? 'unknown'}${tx.peachPaymentId ? '' : ' — no peachPaymentId on tx'}). Buyer NOT refunded; retry needed.`,
          },
        })
        .catch(() => undefined);
      throw new BadRequestException(
        `Refund failed at the payment gateway (${refund.resultCode ?? 'unknown'}). The buyer was NOT charged back; an alert has been raised. No status change applied.`,
      );
    }

    // Gateway refund succeeded — status is already REFUNDED from the
    // claim-lock above; re-read for the return value (idempotent).
    const updated = await this.prisma.transaction.update({
      where: { id: txId },
      data: { paymentStatus: 'REFUNDED' },
    });

    // Mark any related dispute alert as resolved so the
    // command-center attention queue clears the count.
    void this.prisma.adminAlert.updateMany({
      where: {
        type: 'BUYER_DISPUTE_RAISED',
        referenceId: txId,
        resolved: false,
      },
      data: { resolved: true, resolvedAt: new Date() },
    });

    // Audit row — refunds change real money state; the operator
    // must explain why (handed in via the dossier's confirm-modal).
    if (note && note.trim()) {
      await this.audit.record({
        adminUserId: adminId,
        action: 'TRANSACTION_REFUND',
        resourceType: 'Transaction',
        resourceId: txId,
        oldValue: tx.paymentStatus,
        newValue: 'REFUNDED',
        reason: note.trim(),
      });
    }

    void this.notifications.refundIssuedBuyer({
      buyerEmail: tx.buyer.email,
      buyerName: [tx.buyer.firstName, tx.buyer.lastName].filter(Boolean).join(' ') || 'Buyer',
      buyerPhone: tx.buyer.phone,
      listingTitle: tx.listing.title,
      buyerTotal: tx.buyerTotal,
      transactionId: txId,
      note,
    });
    // Inbox: refund is a terminal state — clear any unresolved
    // notifications tied to this transaction for both buyer + seller
    // (auction_won, offer_accepted, new_sale, order_dispatched all
    // become moot once the tx is refunded).
    void this.notifications.resolveByEntity('transaction', txId);

    // Zoho Books: post a Credit Note against the original commission
    // invoice so the seller's open balance reverses. No-op if the
    // transaction never had a commission invoice (PRIVATE_ARRANGE or
    // pre-verification refunds). Feature-flagged — safe to call when
    // ZOHO_BOOKS_ENABLED is off.
    void this.zohoBooks.createCommissionCreditNote(txId, note);

    return updated;
  }

  // ---------------------------------------------------------------
  // Resolve a DISPUTED transaction in favour of the SELLER — force
  // release the payout. Distinct from releaseTransaction() which only
  // operates on PENDING_ADMIN_VERIFICATION; this path is for disputes
  // where the admin has investigated and found in favour of the seller.
  // Requires a reason for the audit log (the buyer + seller will see
  // the resolution outcome via notification).
  // ---------------------------------------------------------------
  async resolveDisputeRelease(txId: string, adminId: string, reason: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 5) {
      throw new BadRequestException(
        'Provide a reason of at least 5 characters explaining the resolution.',
      );
    }
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: { seller: { select: { id: true } } },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.paymentStatus !== 'DISPUTED') {
      throw new BadRequestException(
        'Force-release is only available for DISPUTED transactions. ' +
          `Current state: ${tx.paymentStatus}.`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: txId },
        data: {
          paymentStatus: 'RELEASED',
          releasedAt: now,
          adminReviewedById: adminId,
          adminReviewedAt: now,
          adminNote: tx.adminNote
            ? `${tx.adminNote}\n\n[DISPUTE RESOLVED — release to seller] ${trimmed}`
            : `[DISPUTE RESOLVED — release to seller] ${trimmed}`,
        },
      }),
      this.prisma.user.update({
        where: { id: tx.sellerId },
        data: { totalSales: { increment: 1 } },
      }),
    ]);

    void this.prisma.adminAlert.updateMany({
      where: {
        type: 'BUYER_DISPUTE_RAISED',
        referenceId: txId,
        resolved: false,
      },
      data: { resolved: true, resolvedAt: now },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'DISPUTE_RESOLVED_RELEASE',
      resourceType: 'Transaction',
      resourceId: txId,
      oldValue: 'DISPUTED',
      newValue: 'RELEASED',
      reason: trimmed,
    });

    return { resolved: 'release' };
  }

  // ---------------------------------------------------------------
  // Admin management — only SUPERADMIN can create new admins.
  // ---------------------------------------------------------------
  // Listing is open to any admin (so monitoring admins can see who
  // else has access). Create takes a Clerk-linked user's email; we
  // look up our local User row + lift the clerkId so future SMS / email
  // alerts pull contact info from there rather than a duplicate column.
  //
  // Returns a redacted shape (no password hashes) for the admin panel.
  async listAdmins() {
    return this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        clerkId: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  async createAdmin(
    targetEmail: string,
    role: AdminRole,
    creatorAdminId: string,
  ) {
    // Verify the creator is a SUPERADMIN (defence-in-depth — the
    // SuperadminGuard already gates the controller, but we don't want
    // to rely on a single layer for something that grants account
    // access).
    const creator = await this.prisma.adminUser.findUnique({
      where: { id: creatorAdminId },
      select: { role: true },
    });
    if (!creator || creator.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only a Full admin can create admins');
    }

    const email = targetEmail.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');

    // Look up the Clerk-mirrored User. We refuse to create an admin for
    // an email that isn't already a Clerk user — that's the contract the
    // user wanted: admins go through Clerk too, so phone/email come from
    // there. If they need to be promoted, they have to sign up at the
    // public /sign-up first.
    const linkedUser = await this.prisma.user.findUnique({
      where: { email },
      select: { clerkId: true, firstName: true, lastName: true },
    });
    if (!linkedUser) {
      throw new BadRequestException(
        `No Gun Galore account found for ${email}. Ask them to sign up at /sign-up first, then promote them.`,
      );
    }

    // Don't double-create. If they're already an admin under this
    // email, return the existing row (idempotent).
    const existing = await this.prisma.adminUser.findUnique({
      where: { email },
    });
    if (existing) {
      throw new BadRequestException('That email is already an admin');
    }

    // A random throwaway password — login goes through Clerk in
    // practice (future change), but the schema requires a hash, so we
    // fill it with something the admin can't guess + reset later.
    const placeholderHash = await bcrypt.hash(
      randomBytes(24).toString('hex'),
      10,
    );

    const created = await this.prisma.adminUser.create({
      data: {
        email,
        passwordHash: placeholderHash,
        role,
        firstName: linkedUser.firstName,
        lastName: linkedUser.lastName,
        clerkId: linkedUser.clerkId,
      },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        clerkId: true,
        isActive: true,
        createdAt: true,
      },
    });
    return created;
  }

  async updateAdminRole(
    targetAdminId: string,
    role: AdminRole,
    actorAdminId: string,
  ) {
    if (targetAdminId === actorAdminId) {
      throw new BadRequestException(
        'You cannot change your own role — ask another Full admin.',
      );
    }
    const actor = await this.prisma.adminUser.findUnique({
      where: { id: actorAdminId },
      select: { role: true },
    });
    if (!actor || actor.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only a Full admin can change roles');
    }
    return this.prisma.adminUser.update({
      where: { id: targetAdminId },
      data: { role },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        isActive: true,
      },
    });
  }

  async deactivateAdmin(targetAdminId: string, actorAdminId: string) {
    if (targetAdminId === actorAdminId) {
      throw new BadRequestException('You cannot deactivate yourself.');
    }
    const actor = await this.prisma.adminUser.findUnique({
      where: { id: actorAdminId },
      select: { role: true },
    });
    if (!actor || actor.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only a Full admin can deactivate admins');
    }
    return this.prisma.adminUser.update({
      where: { id: targetAdminId },
      data: { isActive: false },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
      },
    });
  }
}
