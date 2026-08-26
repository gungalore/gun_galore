import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { AdminRole, Prisma } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ListingsService } from '../listings/listings.service';
import { AdminAuditService } from './admin-audit.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { sniffMime } from '../common/sniff-mime';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { PeachService } from '../payments/peach.service';
import { decryptSaIdNumber } from '../common/id-crypto';
import { SmsService } from '../sms/sms.service';
import { TransactionsService, PAYMENT_MODE } from '../payments/transactions.service';
import { reversalListingData } from '../payments/inventory';
import { ListingReviewDto, ReviewAction } from './dto/listing-review.dto';
import { UpdateUserDto } from './dto/update-user.dto';
// UsersModule is @Global, so this needs no AdminModule import — only the
// class for the injection token.
import {
  AccountClosureService,
  type ClosureBlocker,
} from '../users/account-closure.service';
import { toCsv } from '../common/csv.util';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  // closeAccount() has to delete the Clerk user, the same way the member's own
  // close does — a row closed in our database while the login still works lets
  // them sign in to a dead account. One instance per service is the existing
  // pattern (see users.service.ts:131); the SDK is cheap to construct.
  private readonly clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  });

  constructor(
    private readonly prisma: PrismaService,
    // ⚠️ Provided LOCALLY in AdminModule, like everywhere else that touches
    // the encrypted store — it is not @Global on purpose, so nothing starts
    // reading member files without a deliberate module change.
    private readonly files: SecureFileStorageService,
    private readonly notifications: NotificationsService,
    private readonly listings: ListingsService,
    private readonly audit: AdminAuditService,
    // @Global so no module import. Used by refundTransaction() to
    // post a Credit Note to Books reversing the original commission
    // invoice.
    private readonly zohoBooks: ZohoBooksService,
    // PaymentsModule (imported by AdminModule) exports PeachService.
    // refundTransaction() calls it to actually move the money back to the
    // buyer before flipping the row to REFUNDED.
    private readonly peach: PeachService,
    // PaymentsModule also exports TransactionsService — used by
    // refundTransaction() to cancel any platform-booked carrier shipment so a
    // refunded sale doesn't leave a live (already-billed) waybill (P5.2).
    private readonly transactions: TransactionsService,
    // @Global — reviewKyc() sends the seller the same SMS the automated
    // KYC verdict would have.
    private readonly sms: SmsService,
    // @Global (UsersModule). closeAccount() delegates the whole closure
    // transaction here rather than hand-rolling an admin-side copy — the
    // ordering in that service is load-bearing (the Clerk delete must run
    // AFTER our DB write, and the clerkId tombstone AFTER the webhook lands),
    // and a second implementation would drift out of step with it.
    private readonly closures: AccountClosureService,
  ) {}

  // ---------------------------------------------------------------
  // Alerts inbox — list + resolve AdminAlert rows. The command-center
  // card counts them; this is where the admin actually works them.
  // ---------------------------------------------------------------
  // Filters exist because triage after a noisy sweep is otherwise unworkable:
  // one cron pass can raise 30 STUCK_HELD_FUNDS rows, and the operator needs
  // to isolate that family (or just the urgent ones) instead of scrolling a
  // flat list. `cursor` is the id of the last row already on the operator's
  // screen — the inbox APPENDS the next page rather than re-fetching, which
  // matters here specifically because the ordering puts fresh unresolved
  // alerts at the TOP: offset paging would re-show rows already worked and
  // silently skip others as new alerts land mid-triage.
  async listAlerts(
    resolved?: boolean,
    limit = 100,
    filters: { type?: string; urgent?: boolean; cursor?: string } = {},
  ) {
    const where: Prisma.AdminAlertWhereInput = {};
    if (resolved !== undefined) where.resolved = resolved;
    // Exact type match, never a prefix/contains: the inbox chips are built
    // from real stored types, and a "starts with KYC" match would fuse
    // KYC_REVIEW (needs a human verdict) with KYC_REPEATED_FAILURE (fraud
    // signal) into one undifferentiated pile.
    if (filters.type) where.type = filters.type;
    if (filters.urgent !== undefined) where.urgent = filters.urgent;
    // skip:1 steps past the cursor row itself — it is already on screen.
    const page: Pick<Prisma.AdminAlertFindManyArgs, 'cursor' | 'skip'> =
      filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {};
    return this.prisma.adminAlert.findMany({
      where,
      // id is the tie-break that makes the cursor deterministic — a cron
      // sweep inserts a batch of alerts inside the same millisecond, so
      // createdAt alone is not a stable sort key to page against.
      orderBy: [{ resolved: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
      ...page,
    });
  }

  // Distinct alert types + unresolved counts, for the inbox filter chips.
  // Served separately from the list so the chips stay complete while a
  // filter is applied (deriving them from the filtered page would leave the
  // operator with a single chip and no way back to the other families).
  async alertTypeFacets(): Promise<{ type: string; unresolved: number }[]> {
    const rows = await this.prisma.adminAlert.groupBy({
      by: ['type'],
      where: { resolved: false },
      _count: { _all: true },
    });
    // Sorted in JS (not via groupBy orderBy) — the set is tiny (~45 known
    // types) and this keeps the busiest family at the front of the chip row.
    return rows
      .map((r) => ({ type: r.type, unresolved: r._count._all }))
      .sort(
        (a, b) => b.unresolved - a.unresolved || a.type.localeCompare(b.type),
      );
  }

  // Bulk resolve — clearing a 30-row cron sweep one button at a time (with a
  // full list reload between each) was the slowest job on the admin surface.
  //
  // Deliberately a LOOP over the single-alert resolveAlert rather than one
  // updateMany, because both of that method's properties must survive per
  // alert: the CAS guard (`resolved: false` in the where — so two admins
  // triaging the same burst can't double-resolve) and the audit row (the
  // audit log is per-resource; a single bulk entry would leave 29 alerts with
  // no recorded who/why). Never throws on a partial batch — the caller is
  // told exactly how many landed so the UI can't claim success it didn't get.
  async bulkResolveAlerts(
    adminId: string,
    alertIds: string[],
    reason?: string,
  ): Promise<{
    resolved: number;
    skipped: number;
    skippedIds: string[];
    failed: { id: string; message: string }[];
  }> {
    const ids = Array.from(
      new Set(
        (alertIds ?? []).filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        ),
      ),
    );
    if (ids.length === 0) {
      throw new BadRequestException('Select at least one alert to resolve.');
    }
    // Matches the list cap — a request bigger than one page of the inbox is
    // a script, not an operator, and each id costs an update + an audit row.
    if (ids.length > 200) {
      throw new BadRequestException('Resolve at most 200 alerts at a time.');
    }

    const skippedIds: string[] = [];
    const failed: { id: string; message: string }[] = [];
    let resolved = 0;
    for (const id of ids) {
      try {
        await this.resolveAlert(
          adminId,
          id,
          reason?.trim() || 'Bulk-resolved from the alerts inbox',
        );
        resolved += 1;
      } catch (err) {
        if (err instanceof BadRequestException) {
          // The CAS found nothing to update: the row is gone or another
          // admin got there first. Not a batch failure — just report it.
          skippedIds.push(id);
          continue;
        }
        // Anything else (DB blip mid-batch) is recorded and the loop
        // continues, so the operator gets a truthful tally instead of an
        // exception that hides the alerts that DID resolve.
        failed.push({
          id,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    return { resolved, skipped: skippedIds.length, skippedIds, failed };
  }

  // Cheap poll target for the sidebar badge — two indexed counts instead of
  // pulling 100 alert rows every 60s just to length them. An operator working
  // in Listings or Transactions for an hour otherwise never learns that a new
  // urgent alert (chargeback, stuck funds, complaint) arrived.
  async alertCounts(): Promise<{ unresolved: number; urgent: number }> {
    const [unresolved, urgent] = await Promise.all([
      this.prisma.adminAlert.count({ where: { resolved: false } }),
      this.prisma.adminAlert.count({ where: { resolved: false, urgent: true } }),
    ]);
    return { unresolved, urgent };
  }

  async resolveAlert(adminId: string, alertId: string, reason?: string) {
    // Guarded update — a second admin resolving the same alert gets a
    // clean error instead of silently double-writing.
    const updated = await this.prisma.adminAlert.updateMany({
      where: { id: alertId, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Alert not found or already resolved.');
    }
    await this.audit.record({
      adminUserId: adminId,
      action: 'ALERT_RESOLVE',
      resourceType: 'Alert',
      resourceId: alertId,
      reason: reason?.trim() || 'Resolved from the alerts inbox',
    });
    return { ok: true };
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

    // A rejection ALWAYS emails the seller, so it must always carry a why.
    // Previously reason was optional here and the seller received a bare
    // "your listing was rejected" — contradicting the operator's own policy
    // and generating avoidable support tickets. Enforced server-side (not
    // just in the review UI) so the bulk endpoint and any direct API call
    // are covered too. Mirrors every other destructive admin action.
    if (
      dto.action === ReviewAction.REJECT &&
      (dto.reason ?? '').trim().length < 5
    ) {
      throw new BadRequestException(
        'A rejection reason is required — it is sent to the seller',
      );
    }

    const newStatus = dto.action === ReviewAction.APPROVE ? 'ACTIVE' : 'CANCELLED';
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: newStatus,
        adminReviewedById: adminId,
        adminReviewedAt: new Date(),
        adminOverrideReason: dto.reason ?? null,
        // P5.1 — approval is this listing's first entry into ACTIVE (guarded to
        // PENDING_REVIEW above, so listedAt is null); stamp discoverability time
        // now so the saved-search matcher alerts on it as a NEW listing rather
        // than silently skipping it (its createdAt is already behind the cursor).
        ...(newStatus === 'ACTIVE'
          ? {
              expiresAt: new Date(Date.now() + 60 * 24 * 3600_000),
              listedAt: listing.listedAt ?? new Date(),
              // Stale-listing clock starts when the listing actually becomes
              // discoverable, not when the draft row was created — otherwise a
              // listing that sat a week in review is a week closer to the 90-day
              // auto-expiry before a single buyer ever saw it.
              lastRenewedAt: new Date(),
            }
          : {}),
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
    //   'closed'      — accountClosedAt != null. ⚠️ NOT a subset of 'banned'
    //                  and never rendered as one: closing an account is a
    //                  member's choice, not misconduct. Kept findable because
    //                  the whole point of the closure record is that an admin
    //                  answering a police request can still reach it.
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
      // Health-page queue-depth deep-link: KYC required but not yet verified,
      // with NO 24h grace — mirrors AdminHealthService.queueDepths' kycPending
      // count exactly so the card lands on the rows it counted ('kyc-stalled'
      // above is the narrower >24h view used by the command centre).
      if (filter === 'kyc-outstanding') {
        return {
          kycRequiredAt: { not: null },
          kycStatus: { not: 'VERIFIED' },
        };
      }
      if (filter === 'banned') return { isBanned: true };
      if (filter === 'closed') return { accountClosedAt: { not: null } };
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
          phone: true,
          sellerTier: true,
          kycStatus: true,
          subscriptionTier: true,
          isBanned: true,
          accountClosedAt: true,
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
    if (
      dto.subscriptionTier !== undefined &&
      dto.subscriptionTier !== user.subscriptionTier
    ) {
      data.subscriptionTier = dto.subscriptionTier;
      actions.push({
        action: 'USER_SUBSCRIPTION_CHANGE',
        oldValue: user.subscriptionTier,
        newValue: dto.subscriptionTier,
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

    // Profile support edits — each field audited separately so history
    // reads "username: old → new", never a blob. Empty string clears a
    // name/phone (→ null).
    //
    // ⚠️ USERNAME IS CLEARABLE ONLY ON A CLOSED ACCOUNT, and that carve-out is
    // deliberate. It used to be flatly non-clearable, documented as "public
    // identity — listings/ratings render it", and that is still true of a live
    // member: null it and their listings and ratings render as an anonymous
    // seller while they are still trading. But closure RELEASES the handle
    // back into the signup namespace, so if a closure half-completes — the DB
    // write lands and the follow-up does not — an admin has to be able to
    // finish it by hand. Without this the only remedy is a manual DB edit.
    const clearableUsername = user.accountClosedAt !== null;
    if (dto.username?.trim() === '' && !clearableUsername) {
      throw new BadRequestException(
        'A username can only be cleared on a closed account. Replace it instead, or close the account first.',
      );
    }
    const profileFields = [
      ['username', dto.username?.trim(), user.username, clearableUsername],
      ['firstName', dto.firstName?.trim(), user.firstName, true],
      ['lastName', dto.lastName?.trim(), user.lastName, true],
      ['phone', dto.phone?.trim(), user.phone, true],
    ] as const;
    for (const [field, rawNext, current, clearable] of profileFields) {
      if (rawNext === undefined) continue;
      const next = rawNext === '' ? (clearable ? null : undefined) : rawNext;
      if (next === undefined || next === current) continue;
      data[field] = next;
      actions.push({
        action: 'USER_PROFILE_EDIT',
        oldValue: `${field}: ${current ?? '—'}`,
        newValue: `${field}: ${next ?? '—'}`,
      });
    }

    // No-op PATCH (all values match current state). Don't write an
    // audit row + don't roundtrip the DB.
    if (actions.length === 0) {
      return user;
    }

    let updated;
    try {
      updated = await this.prisma.user.update({
        where: { id: userId },
        data,
      });
    } catch (e) {
      // Username collision — surface the friendly 400 instead of a 500.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('That username is already taken.');
      }
      throw e;
    }

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
  // Close an account, on the member's behalf.
  //
  // ⚠️ THIS IS NOT A BAN AND IT IS NOT A DELETE. Ban is an enforcement flag
  // that leaves the profile, the listings and the handle exactly where they
  // are. This takes the member off the public side of the site and releases
  // their username, email and phone back into the signup namespace, while
  // every transaction, offer, bid, rating and complaint stays attached to the
  // same User row — operator, 2026-08-22: "if a user commited a crime or
  // something they cant just vanish by deleting and wiping evidence."
  //
  // ⚠️ AND IT IS THE ONLY ROUTE BY WHICH A BANNED MEMBER'S ACCOUNT CAN BE
  // CLOSED. The self-service button refuses a restricted account outright, so
  // that closing can never be used to launder a ban; a banned member who
  // genuinely wants out comes through support and lands here, where the
  // closure carries closedByAdminId and the ban is snapshotted onto the
  // AccountClosure row so it survives re-registration.
  //
  // On an UNRESTRICTED account the §6 blockers (money in flight, undelivered
  // goods, an unfinished firearm transfer, an open complaint) refuse an admin
  // exactly as hard as they refuse the member. On a restricted one they are
  // forced past — see assertNoMoneyInFlight below for the one that is not,
  // and why.
  // ---------------------------------------------------------------
  async closeAccount(userId: string, adminId: string, reason: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 5) {
      throw new BadRequestException(
        'A reason is required — it is written onto the closure record, which is what an admin answering a later query reads.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        clerkId: true,
        username: true,
        email: true,
        accountClosedAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    // Refuse rather than no-op: a second close would snapshot an
    // already-scrubbed row, overwriting the real identity in the
    // accountability record with the tombstone that replaced it.
    if (user.accountClosedAt) {
      throw new BadRequestException('This account is already closed.');
    }

    // ⚠️ AN ADMIN MAY WAVE THROUGH THE RESTRICTION, AND NOTHING ELSE.
    // `restricted` (banned / selling-banned) is precisely the case this route
    // exists for — the self-service button refuses it so that closing can
    // never launder a ban, and support closes it here instead. Every other
    // blocker refuses an admin too, because the money and the paperwork do
    // not care who clicked.
    const eligibility = await this.closures.canClose(userId);
    if (!eligibility.canClose && !eligibility.restricted) {
      throw new ConflictException(
        eligibility.blockers.map((b: ClosureBlocker) => b.message).join(' '),
      );
    }
    if (eligibility.restricted) {
      // ⚠️ canClose() RETURNS ON THE RESTRICTION BEFORE IT COUNTS ANYTHING
      // ELSE (account-closure.service.ts:109), so for a banned member the
      // money, goods, firearm and complaint blockers were never evaluated —
      // and `force` below skips the re-check too. That leaves the restricted
      // path, which is the ONLY path this route exists for, with no money
      // guard at all unless one is run here.
      await this.assertNoMoneyInFlight(userId);
      // The rest were still not evaluated. None of them is destructive the
      // way the bank quartet is — the shipment, the SAP 534 inputs and the
      // complaint row all survive a closure — but the member loses the phone
      // and email those follow-ups would have reached them on, so it goes in
      // the log rather than passing silently.
      this.logger.warn(
        `Admin ${adminId} is closing restricted account ${userId} — undelivered goods / firearm transfer / open complaint were not evaluated for it`,
      );
    }

    const { clerkId, cancelledListingIds } = await this.closures.close(
      userId,
      {
        closedBy: 'ADMIN',
        closedByAdminId: adminId,
        reason: trimmed,
        force: eligibility.restricted,
      },
    );

    // ⚠️ AFTER THE COMMIT, AND FAIL-SOFT — the same order the member's own
    // close uses (users.service.ts closeMyAccount). A Clerk outage must not
    // roll back a closure, and closed-in-our-DB-with-a-live-login is strictly
    // safer than the reverse: every write gate already refuses the row.
    try {
      await this.clerk.users.deleteUser(clerkId);
    } catch (err) {
      this.logger.error(
        `Account ${userId} closed by admin ${adminId}, but the Clerk user could not be deleted — they can still sign in to a dead account: ${(err as Error).message}`,
      );
    }

    // ⚠️ THE SEARCH INDEX STILL LAGS. close() cancelled the listings, so
    // browseViaPrisma and every PDP already exclude them, but a stale
    // Meilisearch document can surface in ?q= until something re-indexes it.
    // The ids are on AccountClosure.cancelledListingIds for the sweep that
    // Phase 2 of ACCOUNT-CLOSURE.md adds; until then this is the only trace.
    if (cancelledListingIds.length) {
      this.logger.log(
        `Account ${userId}: ${cancelledListingIds.length} listing(s) cancelled and awaiting reindex`,
      );
    }

    // Audited as well as recorded on AccountClosure. The closure row is the
    // member-side record; this is the admin-side one, and /admin/audit is
    // where "which admin did what, and why" is actually read. Snapshot the
    // handle in oldValue — by the time anyone reads this row the User has
    // none.
    await this.audit.record({
      adminUserId: adminId,
      action: 'USER_ACCOUNT_CLOSE',
      resourceType: 'User',
      resourceId: userId,
      oldValue: { username: user.username, email: user.email },
      newValue: {
        closedBy: 'ADMIN',
        cancelledListings: cancelledListingIds.length,
      },
      reason: trimmed,
    });

    return { closed: true, cancelledListings: cancelledListingIds.length };
  }

  // ⚠️ THE ONE BLOCKER A FORCED CLOSURE STILL MAY NOT SKIP.
  //
  // Closure nulls the bank quartet (account holder, number, branch, type).
  // hasBank() is the readiness predicate for every payout run, and once the
  // account is closed there is nobody left to re-collect an account number
  // from — so a payout that was owed at closure becomes permanently unpayable,
  // silently, with no alert (ACCOUNT-CLOSURE.md H7). "The member was banned"
  // is not a reason to keep their money; a ban and a debt are separate
  // questions and only one of them is settled by closing the account.
  //
  // ⚠️ THESE TWO PREDICATES ARE COPIES of FUNDS_IN_FLIGHT and PAYOUT_DUE in
  // AccountClosureService.canClose, and a copy is a drift hazard. It is here
  // only because canClose returns on the restriction before it counts
  // anything — DELETE THIS METHOD the day canClose evaluates its blockers
  // first and returns { canClose: false, restricted: true, blockers }, which
  // is the real fix.
  private async assertNoMoneyInFlight(userId: string) {
    const [held, payoutDue] = await Promise.all([
      this.prisma.transaction.count({
        where: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
          paymentStatus: {
            in: ['HELD', 'PENDING_ADMIN_VERIFICATION', 'DISPUTED'] as never,
          },
        },
      }),
      this.prisma.transaction.count({
        where: {
          sellerId: userId,
          paymentStatus: 'RELEASED' as never,
          sellerPayout: { gt: 0 },
          paidOutAt: null,
          payoutHeldAt: null,
          refundOfId: null,
        },
      }),
    ]);
    if (held || payoutDue) {
      throw new ConflictException(
        `Money is still moving on this account — ${held} order(s) with funds held or disputed, ${payoutDue} payout(s) owed. Settle or refund those first: closing clears the banking details and there is no way to collect them again afterwards.`,
      );
    }
  }

  // ---------------------------------------------------------------
  // Clear seller reject-strikes + lift the offers suspension (the
  // reject-reason policy stamps sellingBannedAt at 3 strikes = LISTING BAN). Also
  // resolves the open SELLER_REJECT_STRIKE alerts and writes an audit
  // row so the reset is attributable.
  // ---------------------------------------------------------------
  async clearRejectStrikes(userId: string, adminId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, sellerRejectStrikes: true, sellingBannedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.update({
      where: { id: userId },
      data: { sellerRejectStrikes: 0, sellingBannedAt: null },
    });
    await this.prisma.adminAlert.updateMany({
      where: { type: 'SELLER_REJECT_STRIKE', referenceId: userId, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });
    await this.audit.record({
      adminUserId: adminId,
      action: 'REJECT_STRIKES_CLEARED',
      resourceType: 'User',
      resourceId: userId,
      oldValue: {
        sellerRejectStrikes: user.sellerRejectStrikes,
        sellingBannedAt: user.sellingBannedAt,
      },
      newValue: { sellerRejectStrikes: 0, sellingBannedAt: null },
      reason: 'Seller reject-strikes cleared after review',
    });
    return { cleared: true };
  }

  // ---------------------------------------------------------------
  // Re-run Peach bank-account verification (BANV) for a user, from the
  // dossier — e.g. after a BANK_VERIFY_FAILED alert or when the seller
  // says they've fixed their details bank-side. Same flow as the
  // automatic post-save trigger (UsersService.requestBankVerification);
  // duplicated thinly here because AdminModule doesn't import the users
  // graph. The ID number is decrypted in memory only and never logged.
  // ---------------------------------------------------------------
  async rerunBankVerification(userId: string, adminId: string) {
    if (!this.peach.isBanvEnabled()) {
      throw new BadRequestException(
        'Peach bank verification is not configured yet.',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        bankAccountNumber: true,
        bankBranchCode: true,
        bankAccountType: true,
        idNumberEncrypted: true,
        firstName: true,
        lastName: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.bankAccountNumber || !user.bankBranchCode) {
      throw new BadRequestException('User has no banking details on file.');
    }
    if (!user.idNumberEncrypted) {
      throw new BadRequestException(
        'User has no SA ID on file — bank ownership cannot be verified until their seller profile is completed.',
      );
    }
    const res = await this.peach.verifyBankAccount({
      accountNumber: user.bankAccountNumber,
      branchCode: user.bankBranchCode,
      accountType: user.bankAccountType ?? 'unknown',
      idNumber: decryptSaIdNumber(user.idNumberEncrypted),
      initials: user.firstName ? user.firstName.trim().charAt(0) : undefined,
      lastName: user.lastName ?? undefined,
    });
    if (!res) {
      throw new BadRequestException('Verification request could not be submitted.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        bankVerifiedAt: null,
        bankVerificationId: res.bankVerificationId,
        bankAvsResult: `REQUESTED:${res.resultCode ?? res.status}`,
      },
    });
    await this.audit.record({
      adminUserId: adminId,
      action: 'BANK_VERIFY_RERUN',
      resourceType: 'User',
      resourceId: userId,
      reason: 'Admin re-ran Peach bank-account verification',
    });
    return { requested: true, bankVerificationId: res.bankVerificationId, status: res.status };
  }

  // ---------------------------------------------------------------
  // Claude-KYC human review — decides an UNDER_REVIEW verification
  // from the user dossier. Guarded transition (only moves a row that
  // is still UNDER_REVIEW) so two admins can't double-decide, and the
  // seller gets the same SMS/email the automated verdict would send.
  // The blunt PATCH kycStatus override above stays for emergencies.
  // ---------------------------------------------------------------
  async reviewKyc(
    userId: string,
    adminId: string,
    decision: 'APPROVE' | 'REJECT',
    reason: string,
  ) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException(
        'A short reason (min 5 characters) is required for the audit trail.',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        kycStatus: true,
        phone: true,
        email: true,
        firstName: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.kycStatus !== 'UNDER_REVIEW') {
      throw new BadRequestException(
        `This verification is not awaiting review (status: ${user.kycStatus}).`,
      );
    }

    const newStatus = decision === 'APPROVE' ? 'VERIFIED' : 'REJECTED';
    const guarded = await this.prisma.user.updateMany({
      where: { id: userId, kycStatus: 'UNDER_REVIEW' },
      data: {
        kycStatus: newStatus,
        kycVerifiedAt: decision === 'APPROVE' ? new Date() : undefined,
        kycReviewedById: adminId,
        kycReviewedAt: new Date(),
        kycReviewNote: reason.trim(),
      },
    });
    if (guarded.count === 0) {
      throw new BadRequestException(
        'Already decided by another admin — refresh the page.',
      );
    }

    await this.audit.record({
      adminUserId: adminId,
      action: 'USER_KYC_REVIEW',
      resourceType: 'User',
      resourceId: userId,
      oldValue: 'UNDER_REVIEW',
      newValue: newStatus,
      reason: reason.trim(),
    });

    // Decision landed — auto-resolve the KYC_REVIEW alert(s) raised for
    // this user (both the inconclusive-verdict and anchored-recheck alerts
    // carry referenceId = user id). Same pattern as BUYER_DISPUTE_RAISED
    // resolving on refund/release; without it every reviewed dossier left
    // a permanently-unresolved alert inflating the command-center count.
    void this.prisma.adminAlert.updateMany({
      where: { type: 'KYC_REVIEW', referenceId: userId, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });

    // Seller comms — identical to the automated verdict paths. Never
    // include the admin's internal reason in the rejection message.
    try {
      if (decision === 'APPROVE') {
        if (user.phone) {
          await this.sms.sendSms({
            to: user.phone,
            message:
              'All Outdoor: Your identity has been verified. Your pending sale can now proceed.',
            reference: `kyc-approved-${user.id}`,
          });
        }
        if (user.email) {
          await this.notifications.sellerKycApproved(
            user.email,
            user.firstName ?? 'Seller',
          );
        }
      } else {
        const msg =
          'We could not verify your identity. Please contact support for assistance.';
        if (user.phone) {
          await this.sms.sendSms({
            to: user.phone,
            message: `All Outdoor: ${msg}`,
            reference: `kyc-review-rejected-${user.id}`,
          });
        }
        if (user.email) {
          await this.notifications.sellerKycRejected(
            user.email,
            user.firstName ?? 'Seller',
            msg,
          );
        }
      }
    } catch {
      // Notification failure never rolls back the decision.
    }

    return { success: true, kycStatus: newStatus };
  }

  // ---------------------------------------------------------------
  // User dossier — everything about one user on a single page.
  // Powers /admin/users/[id]. Pulls in parallel from a dozen+
  // tables so the dossier renders in one round-trip from the
  // frontend's perspective.
  // ---------------------------------------------------------------
  /**
   * Decrypt one of a member's stored KYC files for the dossier.
   *
   * Only the two. There is no path here that takes an arbitrary storage key —
   * the key is looked up from the user row, so an admin cannot read another
   * namespace by guessing.
   */
  async readKycFile(
    userId: string,
    which: 'id' | 'selfie',
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycIdStorageKey: true,
        kycIdMimeType: true,
        kycSelfieStorageKey: true,
      },
    });
    if (!u) throw new NotFoundException('User not found');
    const key =
      which === 'id' ? u.kycIdStorageKey : u.kycSelfieStorageKey;
    if (!key) {
      throw new NotFoundException(
        'No stored file for this user. It may still be on the old CDN — see the legacy link.',
      );
    }
    const bytes = await this.files.read(key);
    return {
      bytes,
      // A selfie is always a JPEG (it is captured from a canvas); a document
      // can be any of the four the uploader accepts, so its type is stored.
      mimeType:
        which === 'id' ? u.kycIdMimeType || sniffMime(bytes) : 'image/jpeg',
    };
  }

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
      complaintsLodged,
      complaintsAgainst,
      closure,
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
      // Complaints THIS user lodged. Before banning someone or adjudicating
      // a dispute the admin needs the pattern ("this buyer has lodged four
      // NOT_ARRIVED complaints") without cross-referencing /admin/complaints
      // by hand — the dossier's whole promise is one place.
      this.prisma.complaint.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          referenceNumber: true,
          category: true,
          subject: true,
          status: true,
          drovePayoutHold: true,
          createdAt: true,
          transactionId: true,
        },
      }),
      // Complaints lodged AGAINST this user — i.e. on orders where they are
      // the counterparty seller. The mirror image of the above: a seller
      // accumulating complaints is exactly what a ban review needs to see.
      this.prisma.complaint.findMany({
        where: { transaction: { sellerId: userId } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          referenceNumber: true,
          category: true,
          subject: true,
          status: true,
          drovePayoutHold: true,
          createdAt: true,
          transactionId: true,
          user: { select: { username: true } },
        },
      }),
      // ⚠️ THE WHOLE POINT OF THE CLOSURE RECORD. Once an account is closed
      // the User row no longer carries a username, an email or a phone
      // number — they were released so the same person can register again —
      // so "who was this" is answerable only from here. An admin fielding a
      // police request or a dispute about an old sale has nowhere else to
      // look. Fetched as its own query rather than through the relation so
      // this does not depend on the relation field name on User.
      //
      // ⚠️ ADMIN-ONLY, AND IT STAYS THAT WAY. This must never be added to a
      // public select (PUBLIC_LISTING_SELECT, SellersPublicController).
      this.prisma.accountClosure.findUnique({ where: { userId } }),
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
      complaintsLodged,
      complaintsAgainst,
      closure,
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
      return { users: [], listings: [], transactions: [], orders: [] };
    }
    const insensitive = { contains: q, mode: 'insensitive' as const };
    const upper = q.toUpperCase();

    const [users, listings, transactions, orders] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          OR: [
            { email: insensitive },
            { username: insensitive },
            { firstName: insensitive },
            { lastName: insensitive },
            { phone: insensitive },
            // ⚠️ AND THE PEOPLE WHO HAVE LEFT. A closure releases username,
            // email and phone back into the uniqueness namespaces so the
            // member can register again — which means the five predicates
            // above stop matching them the moment they close.
            //
            // That is precisely backwards for the one case this whole feature
            // exists to serve. Operator, 2026-08-22: "if a user commited a
            // crime or something they cant just vanish by deleting and wiping
            // evidence." A police or dispute request arrives as a NAME or a
            // PHONE NUMBER, never as a cuid — so without this the record is
            // preserved and unfindable, which is the same as not having it.
            { closure: { closedUsername: insensitive } },
            { closure: { closedEmail: insensitive } },
            { closure: { closedPhone: insensitive } },
            { closure: { closedFirstName: insensitive } },
            { closure: { closedLastName: insensitive } },
          ],
        },
        take: 8,
        select: {
          id: true,
          username: true,
          email: true,
          sellerTier: true,
          isBanned: true,
          accountClosedAt: true,
          // So the result can say WHO this was, rather than showing an admin a
          // row called closed+cmsq…@accounts.invalid and leaving them to guess.
          closure: {
            select: {
              closedUsername: true,
              closedEmail: true,
              closedFirstName: true,
              closedLastName: true,
              closedAt: true,
            },
          },
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
            { orderReference: insensitive },
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
      // FLOW-F3 (H11) — the buyer-quoted GG-ORD reference lives on the
      // Order, not the child transactions. Match it so an operator can
      // paste the single EFT memo and land on the parcel.
      this.prisma.order.findMany({
        where: {
          OR: [
            { id: q },
            { orderReference: insensitive },
            { gatewayCheckoutId: q },
            { gatewayPaymentId: q },
          ],
        },
        take: 8,
        select: {
          id: true,
          orderReference: true,
          status: true,
          buyerTotal: true,
          createdAt: true,
          buyer: { select: { username: true } },
          _count: { select: { transactions: true } },
        },
      }),
    ]);

    return { users, listings, transactions, orders };
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

    // ⚠️ CLOSED ACCOUNTS ARE SKIPPED SERVER-SIDE, not just greyed out in the
    // table. The checkbox in bulk-users.tsx disables them, but the ids come
    // off the wire and the table is one page of a paginated list — a stale tab
    // or a hand-rolled call would sweep a member who simply left into a bulk
    // ban and stamp a USER_BAN row on them. Every gate already refuses a
    // closed account, so the ban buys nothing and the audit row is the only
    // thing it leaves behind: a later reader reads it as misconduct.
    // Individually banning a closed account is still allowed — that is a
    // deliberate act on one person, not a sweep.
    const closedIds = new Set(
      (
        await this.prisma.user.findMany({
          where: { id: { in: userIds }, accountClosedAt: { not: null } },
          select: { id: true },
        })
      ).map((u) => u.id),
    );

    const results: { userId: string; outcome: 'ok' | 'skipped'; message?: string }[] = [];
    for (const id of userIds) {
      if (closedIds.has(id)) {
        results.push({
          userId: id,
          outcome: 'skipped',
          message: 'Account is closed — not banned. Closing is not misconduct.',
        });
        continue;
      }
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
      // NOTE (LOW-auction-watchlist-stub): AuctionWatch is a DORMANT stub —
      // the POST/DELETE :listingId/watch endpoints exist but NO frontend
      // surface writes to it (the public "N watching" count comes from
      // WatchedListing / the wishlist path, not this table), so this query is
      // effectively always empty. Wiring a real Watch button + an
      // ending-soon watcher-notification cron is a deferred FUTURE feature
      // (needs a product decision on notification cadence + throttle). Kept
      // here so the dossier shape is stable if/when the feature lands.
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
        // FLOW-F3 (H11 / M17) — parent Order + sibling lines for the P8b
        // cart rail. Single round-trip so the admin can (a) see the whole
        // parcel and jump to any sibling line when a member is funnelled
        // into a consolidated 'contact support' flow, and (b) resolve the
        // real GG-ORD EFT reference for a cart child (children carry no
        // per-tx orderReference). _count.lineItems powers the "item N of M"
        // line under the Tx-ID on the dossier page.
        order: {
          select: {
            id: true,
            orderReference: true,
            status: true,
            paidAt: true,
            buyerTotal: true,
            createdAt: true,
            _count: { select: { lineItems: true } },
            transactions: {
              select: {
                id: true,
                paymentStatus: true,
                shippingMethod: true,
                shippingStatus: true,
                shipsWithId: true,
                buyerTotal: true,
                listing: { select: { title: true, referenceNumber: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
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

    // Complaints driving this order. A complaint can flip the order to
    // DISPUTED, and THIS page is where the admin holds the release/refund
    // buttons — but the case itself lived only on /admin/complaints, so the
    // adjudicator had to eyeball-match the case in another tab and decide
    // without the evidence photos in front of them. Ship the whole case here.
    const complaints = await this.prisma.complaint.findMany({
      where: { transactionId: txId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        referenceNumber: true,
        category: true,
        subject: true,
        body: true,
        status: true,
        outcome: true,
        drovePayoutHold: true,
        createdAt: true,
        resolvedAt: true,
        user: { select: { id: true, username: true } },
        photos: { select: { id: true, url: true } },
      },
    });

    return { transaction: tx, auditEvents, complaints };
  }

  // ---------------------------------------------------------------
  // Orders (P8b multi-item cart) — list + dossier. FLOW-F3 (H11).
  // The Order is the buyer-facing parent that owns the single EFT
  // capture; each line is a child Transaction. Gives the operator a
  // grouped discovery + parcel view behind the consolidated support
  // flows.
  // ---------------------------------------------------------------
  async getOrders(status?: string, page = 1, limit = 20) {
    const where = status ? { status: status as never } : {};
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          orderReference: true,
          status: true,
          paymentMethod: true,
          buyerTotal: true,
          paidAt: true,
          createdAt: true,
          buyer: { select: { id: true, username: true, email: true } },
          _count: { select: { transactions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { orders, total, page, limit };
  }

  async getOrderDossier(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderReference: true,
        status: true,
        paymentMethod: true,
        itemsSubtotal: true,
        shippingSubtotal: true,
        handlingSubtotal: true,
        processingFee: true,
        buyerTotal: true,
        manualPayByAt: true,
        manualDetectedAt: true,
        manualCancelledAt: true,
        paidAt: true,
        createdAt: true,
        updatedAt: true,
        buyer: {
          select: { id: true, username: true, email: true, phone: true },
        },
        transactions: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            paymentStatus: true,
            shippingMethod: true,
            shippingStatus: true,
            shipsWithId: true,
            buyerTotal: true,
            sellerPayout: true,
            refundedAmount: true,
            listing: {
              select: { id: true, title: true, referenceNumber: true },
            },
            seller: { select: { id: true, username: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return { order };
  }

  // ---------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------
  async getTransactions(
    status?: string,
    page = 1,
    limit = 20,
    filter?: string,
  ) {
    // Default to HELD — the live money-in-flight queue. (The old default
    // was the manual-EFT PENDING_ADMIN_VERIFICATION fossil, which made
    // /admin/transactions land on a permanently-empty list.)
    const where: Record<string, unknown> = {
      paymentStatus: (status ?? 'HELD') as never,
    };
    // Command-center deep-link: HELD sales where the seller blew the 48h
    // accept window and the escalation cron flagged them.
    if (filter === 'accept-stalled') {
      where.acceptEscalatedAt = { not: null };
      where.acceptedAt = null;
      where.rejectedAt = null;
    }
    // Health-page queue-depth deep-link: paid >24h ago and still not
    // dispatched. Mirrors AdminHealthService.queueDepths' heldNoDispatch
    // count EXACTLY, so clicking the card lands on the same rows it counted.
    if (filter === 'dispatch-overdue') {
      where.dispatchedAt = null;
      where.paidAt = { lt: new Date(Date.now() - 24 * 3600_000) };
    }
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

  // ------------------------------------------------------------------
  // Order / financial CSV export (Phase 7 P7.3) — admin accounting.
  // Date-ranged (by createdAt), optional status filter. Admin-only, so it
  // may include party usernames + emails (the admin already sees these in
  // the dossier); it does NOT include bank-account numbers, Clerk ids, or
  // the encrypted SA ID. Range capped at 180 days + 20k rows.
  // ------------------------------------------------------------------
  async exportTransactionsCsv(
    opts: { fromISO?: string; toISO?: string; status?: string },
    adminId: string,
  ): Promise<{ csv: string; filename: string }> {
    const to = opts.toISO ? new Date(opts.toISO) : new Date();
    const from = opts.fromISO
      ? new Date(opts.fromISO)
      : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('"from" must be before "to"');
    }
    if (to.getTime() - from.getTime() > 186 * 24 * 3600 * 1000) {
      throw new BadRequestException('Export range is limited to 180 days');
    }

    const where: {
      createdAt: { gte: Date; lte: Date };
      refundOfId: null;
      paymentStatus?: never;
    } = {
      createdAt: { gte: from, lte: to },
      // Synthetic refund-slice children (P0.3) would double refund totals
      // in the accounting export — the parent row carries refundedAmount.
      refundOfId: null,
    };
    if (opts.status) {
      (where as { paymentStatus?: string }).paymentStatus = opts.status;
    }

    const rows = await this.prisma.transaction.findMany({
      where: where as never,
      select: {
        orderReference: true,
        // Cart children carry no per-tx orderReference — pull the parent
        // Order's GG-ORD reference so the accountant can tie N rows to the
        // single EFT credit on the FNB statement.
        order: { select: { orderReference: true } },
        createdAt: true,
        paidAt: true,
        releasedAt: true,
        paymentStatus: true,
        listingPrice: true,
        commissionZar: true,
        processingFee: true,
        shippingCost: true,
        // Our waybill handling margin (GG-retained), kept as its own column.
        // ⚠️ THE IDENTITY IT ONCE ASSERTED IS ONLY TRUE UNDER SELLER_DEDUCT.
        // This comment used to claim "Gross = Item + Shipping + Shipping
        // handling + Processing closes per courier row". Under BUYNOW_MARKUP
        // the processing fee is already inside Item price, so adding it again
        // overshoots Gross by exactly that fee. Read the Fee model column
        // before reconciling; see payments/fee-presentation.ts.
        shippingHandlingCents: true,
        buyerTotal: true,
        sellerPayout: true,
        refundedAmount: true,
        feeModel: true,
        listing: { select: { title: true } },
        buyer: { select: { username: true, email: true } },
        seller: { select: { username: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20_000,
    });

    const r = (c: number) => (c / 100).toFixed(2);
    const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : '');
    const header = [
      'Order ref', 'Created', 'Paid', 'Released', 'Status', 'Item',
      'Buyer', 'Buyer email', 'Seller', 'Seller email',
      'Item price', 'Gross (buyer paid)', 'Commission', 'Processing fee',
      'Shipping', 'Shipping handling (GG)', 'Net payout', 'Refunded',
      // ⚠️ WITHOUT THIS COLUMN THE EXPORT CANNOT BE RECONCILED. The raw
      // columns are identical under both fee models but mean opposite things:
      // under BUYNOW_MARKUP the commission and processing fee are ALREADY
      // INSIDE "Item price" and were charged to the buyer, so
      // Item + Shipping + Handling + Processing double-counts the fee and the
      // seller was never deducted anything. Under SELLER_DEDUCT they sit
      // outside it and the seller really was. Raw values are kept as-is
      // (an accountant wants the actual columns) — this says how to read them.
      'Fee model',
    ];
    const body = rows.map((t) => [
      t.orderReference ?? t.order?.orderReference ?? '',
      d(t.createdAt),
      d(t.paidAt),
      d(t.releasedAt),
      t.paymentStatus,
      t.listing?.title ?? '',
      t.buyer?.username ?? '',
      t.buyer?.email ?? '',
      t.seller?.username ?? '',
      t.seller?.email ?? '',
      r(t.listingPrice),
      r(t.buyerTotal),
      r(t.commissionZar),
      r(t.processingFee),
      r(t.shippingCost),
      r(t.shippingHandlingCents),
      r(t.sellerPayout),
      r(t.refundedAmount),
      t.feeModel === 'BUYNOW_MARKUP' ? 'Buy Now (fees in price)' : 'Deducted from seller',
    ]);

    await this.audit.record({
      adminUserId: adminId,
      action: 'TRANSACTIONS_EXPORT',
      resourceType: 'Transaction',
      resourceId: 'export',
      reason: `Exported ${rows.length} orders ${d(from)}..${d(to)}${opts.status ? ` (status ${opts.status})` : ''}`,
    });

    return {
      csv: toCsv([header, ...body]),
      filename: `all-outdoor-orders-${d(from)}-to-${d(to)}.csv`,
    };
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
    // Releasable state: HELD (P5.3 — the admin manually releasing a
    // delivered order the buyer never confirmed). A DISPUTED/REFUNDED/
    // RELEASED tx is not releasable here. The atomic CAS below is the
    // real guard against a race with the buyer's own confirmDelivery.
    // (The manual-EFT PENDING_ADMIN_VERIFICATION gate was removed with
    // the EFT strip — nothing can produce that status.)
    if (tx.paymentStatus !== 'HELD')
      throw new BadRequestException(
        `Transaction is not releasable (current: ${tx.paymentStatus}).`,
      );

    // CRITICAL money gate — HELD is the DEFAULT status at creation
    // (schema: paymentStatus @default(HELD), paidAt null), so a courier order
    // sits HELD-with-paidAt-null for the whole 24h EFT window BEFORE any money
    // arrives. Releasing such a row would queue a real seller payout in the
    // next FNB batch for funds All Outdoor never received. paidAt is the single
    // proof-of-payment marker on BOTH rails (markPaid sets it for the card
    // gateway; confirmManualPayment→markPaid sets it on the manual EFT rail),
    // so refuse to release anything the buyer hasn't actually funded. Mirrors
    // the identical `if (!tx.paidAt) throw` guard on raiseDispute/confirmDelivery.
    if (!tx.paidAt) {
      throw new BadRequestException(
        'Cannot release payout — this order has not been paid yet ' +
          '(no funds received). Releasing it would pay the seller for money ' +
          'the buyer never sent. Wait for payment to be confirmed first.',
      );
    }

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

    // Atomic CAS release: only flip if the row is STILL in a releasable state.
    // Closes the race where the admin releases a HELD tx at the same moment the
    // buyer taps confirm-receipt (which also flips HELD→RELEASED) — without
    // this, both would increment totalSales + fire a commission invoice.
    const released = await this.prisma.$transaction(async (txc) => {
      const claim = await txc.transaction.updateMany({
        where: {
          id: txId,
          paymentStatus: 'HELD',
          // Belt-and-braces: keep the paid-only guard inside the atomic CAS so
          // an unpaid HELD row can never be flipped to RELEASED even if the
          // pre-check above is ever bypassed.
          paidAt: { not: null },
        },
        data: {
          paymentStatus: 'RELEASED',
          releasedAt: new Date(),
          adminReviewedById: adminId,
          adminReviewedAt: new Date(),
        },
      });
      if (claim.count === 0) return false; // already released / state changed
      await txc.user.update({
        where: { id: tx.sellerId },
        data: { totalSales: { increment: 1 } },
      });
      return true;
    });
    if (!released) {
      throw new BadRequestException(
        'Transaction is no longer releasable — it was released or its state changed.',
      );
    }
    // P0.6 — commission invoicing was only ever hooked to the FIREARM
    // dealer-verification path, so ordinary sales never reached Books.
    // Idempotent + never throws; fire-and-forget at every release point.
    void this.zohoBooks.createCommissionInvoice(txId);
    return { id: txId, paymentStatus: 'RELEASED' };
  }

  // Refund a buyer. `amountZarCents` issues a PARTIAL refund of that many
  // cents; omit it for a full refund of the remaining balance. Several
  // partial refunds may stack but never exceed buyerTotal. The order only
  // flips to REFUNDED once the cumulative refunded amount reaches
  // buyerTotal — a partial refund leaves the order in its current state
  // (HELD/DISPUTED) so the remaining balance can still be released or
  // refunded later.
  async refundTransaction(
    txId: string,
    adminId: string,
    note?: string,
    amountZarCents?: number,
  ) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: { listing: true, buyer: true, seller: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    if (!['HELD', 'DISPUTED'].includes(tx.paymentStatus)) {
      throw new BadRequestException(
        `Transaction is not in a refundable state (current: ${tx.paymentStatus}). Only HELD or DISPUTED orders can be refunded.`,
      );
    }

    // ─── Resolve + validate the refund amount ────────────────────────
    const remaining = tx.buyerTotal - tx.refundedAmount;
    if (remaining <= 0) {
      throw new BadRequestException('This order has already been fully refunded.');
    }
    // No amount → full refund of whatever balance is left.
    const amount =
      amountZarCents == null ? remaining : Math.floor(amountZarCents);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Refund amount must be a positive number of cents.');
    }
    if (amount < 100) {
      throw new BadRequestException('Minimum refund is R1.00 (100 cents).');
    }
    if (amount > remaining) {
      throw new BadRequestException(
        `Refund of ${amount}c exceeds the remaining balance of ${remaining}c (buyerTotal ${tx.buyerTotal}c, already refunded ${tx.refundedAmount}c).`,
      );
    }
    const willBeFullyRefunded = tx.refundedAmount + amount >= tx.buyerTotal;

    // P6.2 — a FULL refund of a consolidated CARRIER line cancels the shared
    // parcel, which would orphan its still-HELD siblings (their shipment is
    // gone + they'd point at a refunded carrier). Refund the other items in
    // the parcel first. A sibling is always refundable (it has no siblings of
    // its own); a partial refund leaves the parcel intact, so both are allowed.
    if (willBeFullyRefunded) {
      const liveSiblings = await this.prisma.transaction.count({
        where: { shipsWithId: txId, paymentStatus: 'HELD' },
      });
      if (liveSiblings > 0) {
        throw new BadRequestException(
          `This item carries the shipment for ${liveSiblings} other item(s) in the same parcel. Refund those item(s) first, then fully refund this one.`,
        );
      }
    }

    // ─── Atomic claim (concurrency + over-refund lock) ───────────────
    // Reserve the amount in a single conditional update BEFORE the gateway
    // call. The guards make it the lock: two near-simultaneous refunds
    // can't both pass because `refundedAmount <= buyerTotal - amount`
    // (a constant) plus the increment means the second sees count===0 and
    // aborts before moving money. Only flip to REFUNDED when this refund
    // settles the whole balance; a partial leaves paymentStatus untouched.
    //
    // P0.3 — MANUAL rail: the gateway refund is a mock, so the money only
    // ever moves via the FNB refund batch — which previously picked up
    // NOTHING for partials (status stays HELD/DISPUTED) and buyerTotal for
    // fulls. Now EVERY refund operation mints a SYNTHETIC child transaction
    // (REFUNDED, buyerTotal = this slice, sellerPayout 0, refundOfId =
    // parent) in the SAME atomic claim, and the refund queue pays the
    // children — each slice settles exactly once through the existing
    // batch machinery. Card mode keeps the real gateway reversal instead.
    let claimCount = 0;
    // Terminal flag used by everything AFTER the claim. On the manual rail
    // it is recomputed from the POST-claim row inside the interactive
    // transaction — two concurrent partials that together exhaust
    // buyerTotal would otherwise BOTH see a stale pre-read flag and leave
    // the parent stuck HELD at fully-refunded (review finding). The live
    // cumulative also makes the child orderReference unique per slice.
    let fullyRefunded = willBeFullyRefunded;
    if (PAYMENT_MODE === 'manual') {
      const res = await this.prisma.$transaction(async (txc) => {
        const claim = await txc.transaction.updateMany({
          where: {
            id: txId,
            paymentStatus: { in: ['HELD', 'DISPUTED'] },
            refundedAmount: { lte: tx.buyerTotal - amount },
          },
          data: {
            refundedAmount: { increment: amount },
            lastRefundAt: new Date(),
            adminNote: note ?? null,
            adminReviewedById: adminId,
            adminReviewedAt: new Date(),
          },
        });
        if (claim.count === 0) return { count: 0, full: false };
        // Row lock from the claim serialises concurrent refunds; this read
        // sees THIS operation's cumulative total.
        const live = await txc.transaction.findUnique({
          where: { id: txId },
          select: { refundedAmount: true },
        });
        const cumulative = live?.refundedAmount ?? tx.refundedAmount + amount;
        const full = cumulative >= tx.buyerTotal;
        if (full) {
          await txc.transaction.updateMany({
            where: { id: txId, paymentStatus: { in: ['HELD', 'DISPUTED'] } },
            data: { paymentStatus: 'REFUNDED' },
          });
        }
        await txc.transaction.create({
          data: {
            refundOfId: txId,
            listingId: tx.listingId,
            buyerId: tx.buyerId,
            sellerId: tx.sellerId,
            quantity: 1,
            listingPrice: 0,
            commissionZar: 0,
            processingFee: 0,
            shippingCost: 0,
            passFeeToBuyer: false,
            buyerTotal: amount, // the slice the FNB batch pays the buyer
            sellerPayout: 0,
            refundedAmount: amount,
            paymentStatus: 'REFUNDED',
            orderReference: `${tx.orderReference ?? tx.id}-R${cumulative}`,
          },
        });
        return { count: claim.count, full };
      });
      claimCount = res.count;
      fullyRefunded = res.full;
    } else {
      const claim = await this.prisma.transaction.updateMany({
        where: {
          id: txId,
          paymentStatus: { in: ['HELD', 'DISPUTED'] },
          refundedAmount: { lte: tx.buyerTotal - amount },
        },
        data: {
          refundedAmount: { increment: amount },
          lastRefundAt: new Date(),
          adminNote: note ?? null,
          adminReviewedById: adminId,
          adminReviewedAt: new Date(),
          ...(willBeFullyRefunded ? { paymentStatus: 'REFUNDED' as const } : {}),
        },
      });
      claimCount = claim.count;
    }
    if (claimCount === 0) {
      throw new BadRequestException(
        'Refund could not be reserved — the order state or refunded balance changed. Reload and try again.',
      );
    }

    // ─── Move the money back via the gateway ─────────────────────────
    // peachPaymentId holds the Peach payment id (Stitch was evaluated as the
    // rail in 2026-06/07 and dropped — the column never changed hands).
    // On failure roll back the reservation (and
    // the status flip, if any) so the row returns to its refundable state.
    // Manual mode skips the gateway entirely — the FNB batch on the child
    // row IS the refund; there is nothing to reverse at a gateway.
    const refund =
      PAYMENT_MODE === 'manual'
        ? { success: true as const, resultCode: 'MANUAL_EFT_BATCH' }
        : tx.peachPaymentId
          ? await this.peach.refundPayment(tx.peachPaymentId, amount)
          : { success: false, resultCode: 'NO_PAYMENT_ID' };

    if (!refund.success) {
      await this.prisma.transaction
        .update({
          where: { id: txId },
          data: {
            refundedAmount: { decrement: amount },
            ...(willBeFullyRefunded ? { paymentStatus: tx.paymentStatus } : {}),
          },
        })
        .catch(() => undefined);
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'ADMIN_REFUND_GATEWAY_FAILED',
            referenceId: txId,
            urgent: true,
            context: `Admin ${adminId} refund of ${amount}c failed at gateway (${refund.resultCode ?? 'unknown'}${tx.peachPaymentId ? '' : ' — no peachPaymentId on tx'}). Buyer NOT refunded; retry needed.`,
          },
        })
        .catch(() => undefined);
      throw new BadRequestException(
        `Refund failed at the payment gateway (${refund.resultCode ?? 'unknown'}). The buyer was NOT charged back; an alert has been raised. No status change applied.`,
      );
    }

    // Re-read for the return value (the claim updated the row).
    const updated = await this.prisma.transaction.findUnique({
      where: { id: txId },
    });

    // Only a FULL/final refund clears the dispute alert + inbox, since a
    // partial leaves the order live.
    if (fullyRefunded) {
      void this.prisma.adminAlert.updateMany({
        where: {
          type: 'BUYER_DISPUTE_RAISED',
          referenceId: txId,
          resolved: false,
        },
        data: { resolved: true, resolvedAt: new Date() },
      });
      // P5.2: a fully-refunded sale is dead — cancel any platform-booked
      // carrier shipment so we don't leave a live, already-billed waybill.
      // Best-effort + idempotent; only cancels while the parcel hasn't been
      // collected yet, else it alerts an admin to handle manually.
      void this.transactions.cancelBookedShipment(txId);

      // M3 — a fully-refunded sale must be reversed on the listing too, the
      // same way seller-reject / buyer-cancel / auto-refund do. Without this
      // the item stays SOLD (and a tracked listing loses its units) after the
      // admin returns the money. reversalListingData: ended auctions → EXPIRED
      // (never resurrected to ACTIVE), tracked listings → restock units,
      // single items → plain ACTIVE reactivation.
      void this.prisma.listing
        .update({
          where: { id: tx.listingId },
          data: reversalListingData(
            tx.listing.trackInventory ?? false,
            tx.quantity ?? 1,
            tx.listing.listingType,
          ),
        })
        .catch(() => undefined);

      // DD-2 — if this was a sold-out Daily Deal, the reversal above put the
      // listing back to ACTIVE, so un-sold-out the Deal to keep its status
      // consistent with the now-buyable listing (money-neutral state resync).
      if (tx.listing.isDealListing) {
        void this.prisma.deal
          .updateMany({
            where: { listingId: tx.listingId, status: 'SOLD_OUT' },
            data: { status: 'LIVE', soldOutAt: null },
          })
          .catch(() => undefined);
      }

      // M3 — notify the seller their item was refunded + relisted, mirroring
      // the buyer notification above and the buyer-cancel seller email. The
      // seller took no wrongdoing here (admin decision) so no strike copy.
      void this.notifications.refundIssuedSeller({
        sellerEmail: tx.seller.email,
        sellerName: tx.seller.firstName ?? tx.seller.username ?? 'Seller',
        sellerPhone: tx.seller.phone,
        listingTitle: tx.listing.title,
        transactionId: txId,
      });
    }

    // Audit row — refunds change real money state; the operator
    // must explain why (handed in via the dossier's confirm-modal).
    if (note && note.trim()) {
      await this.audit.record({
        adminUserId: adminId,
        action: fullyRefunded ? 'TRANSACTION_REFUND' : 'TRANSACTION_REFUND_PARTIAL',
        resourceType: 'Transaction',
        resourceId: txId,
        oldValue: `${tx.paymentStatus} (refunded ${tx.refundedAmount}c)`,
        newValue: `${fullyRefunded ? 'REFUNDED' : tx.paymentStatus} (refunded ${tx.refundedAmount + amount}c of ${tx.buyerTotal}c)`,
        reason: note.trim(),
      });
    }

    void this.notifications.refundIssuedBuyer({
      buyerEmail: tx.buyer.email,
      buyerName: [tx.buyer.firstName, tx.buyer.lastName].filter(Boolean).join(' ') || 'Buyer',
      buyerPhone: tx.buyer.phone,
      listingTitle: tx.listing.title,
      buyerTotal: amount, // the amount refunded in THIS operation
      transactionId: txId,
      note,
      // P0.4 — manual rail pays refunds by EFT; if the buyer has no
      // banking on file the batch would silently skip the row, so the
      // notification becomes an action-required "add your bank details".
      manualEft: PAYMENT_MODE === 'manual',
      needsBankDetails:
        PAYMENT_MODE === 'manual' &&
        !(
          tx.buyer.bankAccountHolder &&
          tx.buyer.bankAccountNumber &&
          tx.buyer.bankBranchCode
        ),
    });
    if (fullyRefunded) {
      // Inbox: a fully-refunded order is terminal — clear unresolved
      // notifications tied to it (auction_won, offer_accepted, new_sale,
      // order_dispatched all become moot).
      void this.notifications.resolveByEntity('transaction', txId);

      // Zoho Books: post a Credit Note reversing the commission. Only on a
      // FULL refund — a partial would otherwise credit the full commission
      // (the credit-note helper isn't proportional), so we skip it for
      // partials and let the operator reconcile the final settlement.
      void this.zohoBooks.createCommissionCreditNote(txId, note);
    }

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

    // P0.6 — commission invoice at every release point (idempotent).
    void this.zohoBooks.createCommissionInvoice(txId);

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
  // M26 (FLOW-F4) — payout-HOLD lever. The only admin control between a PA
  // immediate release (HELD->RELEASED at payment, no delivery gate) and the
  // daily FNB bulk-payment sweep. Setting payoutHeldAt drops the row out of
  // getPayoutsDue/collectDue so the cash stays with GG until the hold is
  // cleared — buying time to refund or dispute after release. Only valid while
  // the row is still DUE (not yet frozen into a batch, not yet paid); once
  // committed the money is gone and a hold would mislead.
  // ---------------------------------------------------------------
  async holdPayout(txId: string, adminId: string, reason: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 5) {
      throw new BadRequestException(
        'Provide a reason of at least 5 characters for placing this payout on hold.',
      );
    }
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: {
        id: true,
        paymentStatus: true,
        paidOutAt: true,
        payoutHeldAt: true,
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (!['RELEASED', 'REFUNDED'].includes(tx.paymentStatus)) {
      throw new BadRequestException(
        `Payout hold only applies to a RELEASED or REFUNDED payout awaiting settlement. Current state: ${tx.paymentStatus}.`,
      );
    }
    if (tx.paidOutAt) {
      throw new BadRequestException(
        'This payout has already been paid out — it can no longer be held.',
      );
    }
    if (tx.payoutHeldAt) {
      throw new BadRequestException('This payout is already on hold.');
    }

    const now = new Date();
    await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        payoutHeldAt: now,
        payoutHoldReason: trimmed,
        payoutHeldById: adminId,
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'PAYOUT_HELD',
      resourceType: 'Transaction',
      resourceId: txId,
      oldValue: 'due',
      newValue: 'held',
      reason: trimmed,
    });

    return { payoutHeld: true };
  }

  async releasePayoutHold(txId: string, adminId: string, reason: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 5) {
      throw new BadRequestException(
        'Provide a reason of at least 5 characters for releasing this payout hold.',
      );
    }
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: { id: true, payoutHeldAt: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (!tx.payoutHeldAt) {
      throw new BadRequestException('This payout is not currently on hold.');
    }

    await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        payoutHeldAt: null,
        payoutHoldReason: null,
        payoutHeldById: null,
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'PAYOUT_HOLD_RELEASED',
      resourceType: 'Transaction',
      resourceId: txId,
      oldValue: 'held',
      newValue: 'due',
      reason: trimmed,
    });

    return { payoutHeld: false };
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
        `No All Outdoor account found for ${email}. Ask them to sign up at /sign-up first, then promote them.`,
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
