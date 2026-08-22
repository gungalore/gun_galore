import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ────────────────────────────────────────────────────────────────────
// CLOSING AN ACCOUNT WITHOUT ERASING THE EVIDENCE.
//
// Operator, 2026-08-22: "It must delete the profile from the public [side], but
// still keep transaction links etc, reason for that is if a user commited a
// crime or something they cant just vanish by deleting and wiping evidence."
//
// Three requirements that pull against each other:
//   A. the person disappears from every public surface
//   B. the accountability record survives, attributable to a human
//   C. they can register again afterwards, with the same identity
//
// ⚠️ THIS IS NOT A POPIA ERASURE BUTTON, and conflating the two is what made
// the old Clerk webhook destroy a complaints register. An erasure request is a
// separate, support-reviewed path; the confirmation copy says so plainly.
//
// ⚠️ WHY C IS HARD. Four uniqueness claims sit on User — username, email,
// kycIdHash and (in application code) phone. Requirement B says keep the row;
// keeping the row keeps the claims; keeping the claims means the member is
// told their own SA ID belongs to somebody else when they try to come back.
// So the claims are RELEASED and snapshotted onto the closure record.
//
// ⚠️ EXCEPT kycIdHash, WHICH IS HELD ON PURPOSE. It is, by accident, the only
// identity-anchored enforcement barrier in the whole codebase: every ban and
// strike is a defaulted column, so a new row is a clean row. Releasing it
// would hand every banned seller a clean slate. Instead the block becomes a
// RELINK — see relinkFromClosure — and a member who is banned cannot use the
// self-service button at all.
//
// ⚠️ HONEST LIMIT, STATED SO NOBODY OVERSELLS IT. The relink is a SELLER-side
// control, because KYC fires at first payment as a seller. A member banned for
// buyer-side misconduct can close, register on a new email and buy again
// immediately, whatever we do with the hash. Closing that needs KYC at signup,
// which is a business decision nobody has taken.
// ────────────────────────────────────────────────────────────────────

/** One reason a closure cannot go ahead, in words the member can act on. */
export interface ClosureBlocker {
  code: string;
  message: string;
  /** Where to go and deal with it. */
  href?: string;
  count?: number;
}

export interface ClosureEligibility {
  canClose: boolean;
  /** Restricted accounts go through support, not the button. See §6. */
  restricted: boolean;
  blockers: ClosureBlocker[];
}

/** The ticklist. ⚠️ Free text is not accepted — see close(). */
export const CLOSURE_REASONS = [
  'NOT_USING',
  'DID_NOT_FIND',
  'BAD_EXPERIENCE',
  'PRIVACY',
  'DIFFERENT_ACCOUNT',
  'OTHER',
] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

@Injectable()
export class AccountClosureService {
  private readonly logger = new Logger(AccountClosureService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────────────
  // WHAT STOPS A CLOSURE
  //
  // ⚠️ EVERY PREDICATE HERE IS RUN TWICE: once for the screen, and again
  // INSIDE the closure transaction. The first is courtesy; the second is the
  // guard. Somebody who leaves the confirmation open while an offer lands on
  // their listing must not close over the top of it.
  // ──────────────────────────────────────────────────────────────────

  async canClose(userId: string): Promise<ClosureEligibility> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isBanned: true, sellingBannedAt: true, accountClosedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.accountClosedAt) {
      return {
        canClose: false,
        restricted: false,
        blockers: [
          { code: 'ALREADY_CLOSED', message: 'This account is already closed.' },
        ],
      };
    }

    // ⚠️ A RESTRICTED ACCOUNT CANNOT USE THE BUTTON. This is the other half of
    // the ban-evasion answer: the relink catches somebody banned AFTER they
    // closed, and this stops anybody closing in order to shed a live one.
    //
    // ⚠️ BUT IT DOES NOT SHORT-CIRCUIT, AND THAT WAS A REAL BUG. It used to
    // return here with an empty blocker list, so for a banned member none of
    // the money, goods, firearm or complaint checks below ever ran — and the
    // admin route, whose whole purpose is closing restricted accounts, had
    // nothing to consult. An admin closing a banned seller who was still owed
    // a payout would have cleared the bank quartet and made that money
    // permanently unpayable, with nobody left to re-collect details from.
    //
    // `restricted` and `blockers` are now independent answers: the first says
    // "not through the button", the second says "not at all yet".
    const restricted = !!(user.isBanned || user.sellingBannedAt);

    const blockers: ClosureBlocker[] = [];
    const asEither = [{ buyerId: userId }, { sellerId: userId }];

    // ── money in flight ────────────────────────────────────────────
    const held = await this.prisma.transaction.count({
      where: {
        OR: asEither,
        paymentStatus: {
          in: ['HELD', 'PENDING_ADMIN_VERIFICATION', 'DISPUTED'] as never,
        },
      },
    });
    if (held > 0) {
      blockers.push({
        code: 'FUNDS_IN_FLIGHT',
        count: held,
        href: '/my/orders',
        message: `We are still holding or still owe money on ${held} of your orders. These have to settle first.`,
      });
    }

    // ⚠️ THE EXACT getPayoutsDue PREDICATE. This is what makes it safe for the
    // closure to clear the bank quartet — hasBank() is the readiness check for
    // every payout run, and clearing it while money is due makes that money
    // permanently unpayable, with nobody left to re-collect details from.
    const payoutDue = await this.prisma.transaction.count({
      where: {
        sellerId: userId,
        paymentStatus: 'RELEASED' as never,
        sellerPayout: { gt: 0 },
        paidOutAt: null,
        payoutHeldAt: null,
        refundOfId: null,
      },
    });
    if (payoutDue > 0) {
      blockers.push({
        code: 'PAYOUT_DUE',
        count: payoutDue,
        href: '/my/earnings',
        message: `We still owe you money on ${payoutDue} sale${payoutDue === 1 ? '' : 's'}. That has to be paid out first.`,
      });
    }

    // ── goods that have not arrived ────────────────────────────────
    const undelivered = await this.prisma.transaction.count({
      where: {
        OR: asEither,
        paidAt: { not: null },
        shippingStatus: {
          in: [
            'PENDING',
            'COLLECTED',
            'IN_TRANSIT',
            'OUT_FOR_DELIVERY',
            'DELIVERY_FAILED',
          ] as never,
        },
      },
    });
    if (undelivered > 0) {
      blockers.push({
        code: 'UNDELIVERED',
        count: undelivered,
        href: '/shipping',
        message: `${undelivered} order${undelivered === 1 ? ' is' : 's are'} paid for and not delivered yet.`,
      });
    }

    // ── a firearm still moving through a dealer ────────────────────
    // ⚠️ THE SAP 534 CHAIN. A transfer part-way through is a statutory
    // obligation with a form still to be completed, and Section C of that form
    // is assembled live off this row.
    const firearmInFlight = await this.prisma.transaction.count({
      where: {
        // ⚠️ AND-of-ORs, NOT TWO `OR` KEYS. An object literal cannot carry the
        // same key twice — the second silently wins — so the buyer/seller test
        // and the not-yet-verified test have to be separate AND clauses.
        AND: [
          { OR: asEither },
          {
            OR: [
              { dealerVerifiedAt: null },
              {
                dealerVerificationStatus: {
                  in: [
                    'PENDING_UPLOAD',
                    'PENDING_CLAUDE',
                    'PENDING_ADMIN_REVIEW',
                  ],
                },
              },
            ],
          },
        ],
        paidAt: { not: null },
        listing: { isFirearm: true },
        shippingMethod: 'DEALER_TRANSFER' as never,
      },
    });
    if (firearmInFlight > 0) {
      blockers.push({
        code: 'FIREARM_TRANSFER',
        count: firearmInFlight,
        href: '/shipping',
        message:
          'A firearm sale is still going through a dealer. The transfer paperwork has to be finished before you can close.',
      });
    }

    // ── an open complaint, either direction ────────────────────────
    // ⚠️ THE ONE THE OPERATOR ACTUALLY ASKED ABOUT. Somebody who has a
    // complaint standing against them must not be able to close over it.
    const complaints = await this.prisma.complaint.count({
      where: {
        status: { notIn: ['RESOLVED', 'CLOSED'] as never },
        OR: [
          { userId },
          { transaction: { sellerId: userId } },
          { transaction: { buyerId: userId } },
        ],
      },
    });
    if (complaints > 0) {
      blockers.push({
        code: 'OPEN_COMPLAINT',
        count: complaints,
        href: '/complaints',
        message: `There is an open complaint involving one of your orders. It has to be closed out first.`,
      });
    }

    // ── live commitments ───────────────────────────────────────────
    const liveAuctions = await this.prisma.listing.count({
      where: {
        sellerId: userId,
        listingType: 'AUCTION' as never,
        status: 'ACTIVE' as never,
        bidCount: { gt: 0 },
      },
    });
    if (liveAuctions > 0) {
      blockers.push({
        code: 'LIVE_AUCTION',
        count: liveAuctions,
        href: '/my/listings',
        message: `${liveAuctions} of your auctions ${liveAuctions === 1 ? 'has' : 'have'} bids on ${liveAuctions === 1 ? 'it' : 'them'} and cannot be cancelled.`,
      });
    }

    const midCheckout = await this.prisma.listing.count({
      where: { sellerId: userId, status: 'PAYMENT_PENDING' as never },
    });
    if (midCheckout > 0) {
      blockers.push({
        code: 'MID_CHECKOUT',
        count: midCheckout,
        href: '/my/listings',
        message: `Somebody is part-way through buying ${midCheckout} of your listings.`,
      });
    }

    const offers = await this.prisma.offer.count({
      where: {
        status: { in: ['PENDING', 'COUNTERED', 'ACCEPTED'] as never },
        OR: [{ buyerId: userId }, { listing: { sellerId: userId } }],
      },
    });
    if (offers > 0) {
      blockers.push({
        code: 'OPEN_OFFERS',
        count: offers,
        href: '/my/offers',
        message: `You have ${offers} open offer${offers === 1 ? '' : 's'}.`,
      });
    }

    // ⚠️ `restricted` DOES NOT MAKE canClose FALSE ON ITS OWN — the caller
    // decides. A member is refused on it (the self-service route checks it);
    // an admin is not, because closing a restricted account through support is
    // exactly what the admin route is for. What neither may force past is a
    // blocker: money in flight is money in flight whoever is pressing.
    return {
      canClose: blockers.length === 0 && !restricted,
      restricted,
      blockers,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // THE CLOSURE ITSELF
  // ──────────────────────────────────────────────────────────────────

  /**
   * Close an account.
   *
   * ⚠️ THIS DOES OUR DATABASE AND NOTHING ELSE. The Clerk deletion and the
   * listing re-index happen AFTER, in the caller, and both are deliberately
   * outside the transaction — a Meilisearch hiccup must not roll back a
   * closure, and a Clerk outage must not either. See ACCOUNT-CLOSURE.md §4 for
   * what each failure costs.
   *
   * Returns the cancelled listing ids so the caller can re-index them.
   */
  async close(
    userId: string,
    opts: {
      closedBy: 'MEMBER' | 'ADMIN' | 'CLERK_WEBHOOK';
      reason: string;
      closedByAdminId?: string;
      /**
       * Waive the RESTRICTION only — never a blocker.
       *
       * ⚠️ THE DISTINCTION IS LOAD-BEARING. Closing a banned member is what
       * the admin route exists for; closing one who is still owed money makes
       * that money permanently unpayable. `force` covers the first and must
       * never cover the second.
       */
      force?: boolean;
    },
  ): Promise<{ clerkId: string; cancelledListingIds: string[] }> {
    // ⚠️ ALREADY CLOSED IS A NO-OP, AND IT IS CHECKED BEFORE THE BLOCKERS.
    // The Clerk webhook can arrive twice and a member can double-submit; a
    // repeat must return quietly, not throw ALREADY_CLOSED at somebody whose
    // account is in exactly the state they asked for. Checking it after the
    // blocker set would also mean a closed account with an old open offer
    // could never be re-confirmed as closed.
    const already = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { clerkId: true, accountClosedAt: true },
    });
    if (!already) throw new NotFoundException('User not found');
    if (already.accountClosedAt) {
      return { clerkId: already.clerkId, cancelledListingIds: [] };
    }

    // ⚠️ `force` WAIVES THE RESTRICTION, NEVER A BLOCKER. An admin closing a
    // banned member is the supported path; an admin closing an account that is
    // still owed a payout is how that payout becomes unpayable. Two different
    // things, and the old single `force` flag treated them as one.
    const check = await this.canClose(userId);
    if (check.blockers.length > 0) {
      throw new ConflictException(
        check.blockers[0].message ?? 'This account cannot be closed just yet.',
      );
    }
    if (check.restricted && !opts.force) {
      throw new ConflictException(
        'There is a restriction on this account, so it cannot be closed from here.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          clerkId: true,
          username: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          kycIdHash: true,
          isBanned: true,
          bannedAt: true,
          sellingBannedAt: true,
          sellerRejectStrikes: true,
          auctionStrikes: true,
          dispatchStrikes: true,
          trustScore: true,
          accountClosedAt: true,
        },
      });
      if (!u) throw new NotFoundException('User not found');
      // ⚠️ IDEMPOTENT. The webhook can arrive twice, and a member can
      // double-submit. A second call is a no-op, not a second closure record.
      if (u.accountClosedAt) {
        return { clerkId: u.clerkId, cancelledListingIds: [] };
      }

      // Everything still ACTIVE comes down. ⚠️ Auctions WITH BIDS are already
      // refused above, so nothing here strands a bidder.
      const live = await tx.listing.findMany({
        where: {
          sellerId: userId,
          status: { in: ['ACTIVE', 'DRAFT', 'PENDING_REVIEW'] as never },
        },
        select: { id: true },
      });
      const cancelledListingIds = live.map((l) => l.id);
      if (cancelledListingIds.length) {
        await tx.listing.updateMany({
          where: { id: { in: cancelledListingIds } },
          data: { status: 'CANCELLED' as never },
        });
      }

      await tx.accountClosure.create({
        data: {
          userId,
          closedBy: opts.closedBy,
          closedByAdminId: opts.closedByAdminId ?? null,
          reason: opts.reason,
          closedUsername: u.username,
          closedEmail: u.email,
          closedPhone: u.phone,
          closedFirstName: u.firstName,
          closedLastName: u.lastName,
          kycIdHashArchived: u.kycIdHash,
          wasBanned: u.isBanned,
          wasBannedAt: u.bannedAt,
          wasSellingBannedAt: u.sellingBannedAt,
          wasSellerRejectStrikes: u.sellerRejectStrikes,
          wasAuctionStrikes: u.auctionStrikes,
          wasDispatchStrikes: u.dispatchStrikes,
          wasTrustScore: u.trustScore,
          cancelledListingIds,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          accountClosedAt: new Date(),
          // ── the claims go back into the namespace ─────────────────
          // ⚠️ WITHOUT THIS THEY CANNOT COME BACK. The signup form hard-blocks
          // on a taken username, and the OTP step refuses a phone already
          // linked to an account. Both were held forever by the old scrub.
          username: null,
          // ⚠️ .invalid is reserved by RFC 6761 so it can never resolve. A
          // subdomain of a domain we own can be created by accident and start
          // accepting mail addressed to closed accounts.
          email: `closed+${userId}@accounts.invalid`,
          phone: null,
          phoneVerified: false,
          avatarUrl: null,
          bankVerificationId: null,
          peachCustomerId: null,
          bankAccountHolder: null,
          bankAccountNumber: null,
          bankBranchCode: null,
          bankName: null,
          bankAccountType: null,
          // Nothing may reach them again. The address above is not deliverable
          // and the phone is gone.
          notifyEmailEnabled: false,
          notifySmsEnabled: false,
          notifyWhatsappEnabled: false,
          // ⚠️ NOT TOUCHED, EACH FOR ITS OWN REASON:
          //   isBanned / bannedAt  — closing is not misconduct.
          //   clerkId              — tombstoned later, by the webhook.
          //   kycIdHash            — held; it is the relink key and the only
          //                          identity-anchored ban barrier we have.
          //   idNumberEncrypted    — Section C of the SAP 534 is built off it.
          //   firstName/lastName   — same form, same reason.
        },
      });

      // ⚠️ EVERY OUTSTANDING MAGIC LINK DIES WITH THE ACCOUNT. These authorise
      // actions without a login — a KYC link, a witness signature, a scan
      // hand-off — and one still working after closure is an open door.
      await tx.actionToken.deleteMany({ where: { authorisedUserId: userId } });

      this.logger.log(
        `Account ${userId} closed by ${opts.closedBy} (${opts.reason}); ${cancelledListingIds.length} listing(s) cancelled`,
      );
      return { clerkId: u.clerkId, cancelledListingIds };
    });
  }

  /**
   * The same human is back.
   *
   * ⚠️ CALLED FROM THE DUPLICATE-ID CHECK, WHICH USED TO JUST THROW. A closed
   * account holds the SA ID hash, so re-verifying returned "this ID is already
   * registered" — about their own ID, with no way out but a manual database
   * edit. Now the collision is the SIGNAL: it means we already know this
   * person, so their record follows them onto the new account.
   *
   * That is also what stops closure being a way to shed a ban. Everything the
   * old account carried — bans, strikes, trust score — is copied forward. The
   * archived hash stays on the closure record, so the history of "this
   * identity has been here before" survives the live hash moving.
   */
  async relinkFromClosure(
    closedUserId: string,
    newUserId: string,
  ): Promise<boolean> {
    const closure = await this.prisma.accountClosure.findUnique({
      where: { userId: closedUserId },
    });
    if (!closure) return false;

    await this.prisma.$transaction(async (tx) => {
      const old = await tx.user.findUnique({
        where: { id: closedUserId },
        select: { kycIdHash: true, accountClosedAt: true },
      });
      if (!old?.accountClosedAt) return;

      // ⚠️ OFF THE OLD ROW FIRST. kycIdHash is @unique, so writing it onto the
      // new row while the old one still holds it is a P2002.
      await tx.user.update({
        where: { id: closedUserId },
        data: { kycIdHash: null },
      });
      await tx.user.update({
        where: { id: newUserId },
        data: {
          kycIdHash: old.kycIdHash,
          isBanned: closure.wasBanned,
          bannedAt: closure.wasBannedAt,
          sellingBannedAt: closure.wasSellingBannedAt,
          sellerRejectStrikes: closure.wasSellerRejectStrikes,
          auctionStrikes: closure.wasAuctionStrikes,
          dispatchStrikes: closure.wasDispatchStrikes,
          trustScore: closure.wasTrustScore,
        },
      });
      await tx.accountClosure.update({
        where: { userId: closedUserId },
        data: { reRegisteredAsUserId: newUserId, reRegisteredAt: new Date() },
      });
    });

    this.logger.log(
      `Closed account ${closedUserId} relinked to new account ${newUserId}` +
        (closure.wasBanned || closure.wasSellingBannedAt
          ? ' — ⚠️ ENFORCEMENT CARRIED FORWARD'
          : ''),
    );
    return true;
  }

  /** Validate a ticklist reason. Free text is refused on purpose. */
  assertReason(reason: unknown): string {
    const r = String(reason ?? '').trim();
    if (!(CLOSURE_REASONS as readonly string[]).includes(r)) {
      throw new BadRequestException('Choose a reason from the list.');
    }
    return r;
  }
}

/** Exported for the admin dossier's typing. */
export type AccountClosureRow = Prisma.AccountClosureGetPayload<object>;
