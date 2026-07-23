// ─── Seller reject-reason policy ─────────────────────────────────────
//
// One vocabulary + one penalty engine for every seller-initiated
// rejection (offer rejections AND paid-sale rejections). The seller picks
// a reason from a ticklist; the reason determines the consequence:
//
//   STRIKE     — counts toward sellerRejectStrikes. At SUSPEND_AT strikes,
//                offersSuspendedAt is stamped and the seller's listings
//                stop accepting new offers pending admin review.
//   DELIST     — the listing is cancelled (an item the seller says is
//                gone/damaged must not stay live collecting offers).
//   TRUST      — no penalty, but a trust-safety alert for admin review
//                (the "suspicious buyer" excuse must be auditable or it
//                becomes a free pass).
//   NONE       — legitimate, penalty-free.
//
// Dependency-free (payment-mode.ts pattern): pure maps + one apply
// function that takes the Prisma client, so OffersService and
// TransactionsService use it without module wiring.

import type { PrismaClient } from '@prisma/client';

export const SUSPEND_AT = 3;

export type RejectConsequence = 'STRIKE' | 'DELIST' | 'TRUST' | 'NONE';

// Offer-rejection ticklist (seller-facing labels live in the frontend;
// keep values stable — they're stored on Offer.rejectReason).
export const OFFER_REJECT_REASONS = [
  'ITEM_NO_LONGER_AVAILABLE',
  'ITEM_DAMAGED',
  'OFFER_TOO_LOW',
  'BUYER_SUSPICIOUS',
  'LISTING_ERROR',
  'CHANGED_MIND',
  'OTHER',
] as const;
export type OfferRejectReason = (typeof OFFER_REJECT_REASONS)[number];

export const OFFER_REASON_LABEL: Record<OfferRejectReason, string> = {
  ITEM_NO_LONGER_AVAILABLE: 'Item is no longer available',
  ITEM_DAMAGED: 'Item is damaged or faulty',
  OFFER_TOO_LOW: 'Offer is too low',
  BUYER_SUSPICIOUS: 'Concerns about the buyer',
  LISTING_ERROR: 'Listing had an error (price/details)',
  CHANGED_MIND: 'No longer selling',
  OTHER: 'Other',
};

// Consequences for OFFER rejections. OFFER_TOO_LOW is special-cased in
// consequencesForOfferReject (declining a lowball is every seller's right;
// declining an offer that MET their own auto-accept price is not).
const OFFER_REASON_POLICY: Record<OfferRejectReason, RejectConsequence[]> = {
  ITEM_NO_LONGER_AVAILABLE: ['DELIST'],
  ITEM_DAMAGED: ['DELIST'],
  OFFER_TOO_LOW: ['NONE'], // becomes STRIKE when metAutoAccept — see below
  BUYER_SUSPICIOUS: ['TRUST'],
  LISTING_ERROR: ['STRIKE'],
  CHANGED_MIND: ['STRIKE', 'DELIST'],
  OTHER: ['TRUST'],
};

// Consequences for PAID-SALE rejections (reason values are the existing
// TOK-7 picker on /transactions accept-reject — do not rename them).
// A paid sale is a stronger commitment than an offer, hence stricter:
// selling elsewhere after taking a buyer's money is always a strike.
const SALE_REASON_POLICY: Record<string, RejectConsequence[]> = {
  SOLD_ELSEWHERE: ['STRIKE', 'DELIST'],
  STOCK_ISSUE: ['DELIST'],
  CANT_FULFIL_SHIPPING: ['NONE'],
  BUYER_SUSPICIOUS: ['TRUST'],
  OTHER: ['TRUST'],
};

export function consequencesForOfferReject(
  reason: OfferRejectReason,
  metAutoAccept: boolean,
): RejectConsequence[] {
  if (reason === 'OFFER_TOO_LOW' && metAutoAccept) return ['STRIKE'];
  return OFFER_REASON_POLICY[reason] ?? ['TRUST'];
}

export function consequencesForSaleReject(reason: string): RejectConsequence[] {
  return SALE_REASON_POLICY[reason] ?? ['TRUST'];
}

export interface ApplyRejectPenaltyInput {
  sellerId: string;
  source: 'OFFER' | 'SALE';
  reason: string;
  consequences: RejectConsequence[];
  listingId?: string | null;
  /** offer id / transaction id for the audit trail */
  referenceId: string;
  note?: string | null;
}

export interface ApplyRejectPenaltyResult {
  struck: boolean;
  totalStrikes: number;
  suspended: boolean;
  delisted: boolean;
}

/**
 * Apply the decided consequences. Best-effort by design: penalties must
 * never break the rejection itself (the buyer's refund/notification is the
 * critical path) — callers fire-and-forget or catch.
 */
export async function applySellerRejectPenalty(
  prisma: PrismaClient,
  input: ApplyRejectPenaltyInput,
): Promise<ApplyRejectPenaltyResult> {
  const result: ApplyRejectPenaltyResult = {
    struck: false,
    totalStrikes: 0,
    suspended: false,
    delisted: false,
  };

  if (input.consequences.includes('STRIKE')) {
    const user = await prisma.user.update({
      where: { id: input.sellerId },
      data: { sellerRejectStrikes: { increment: 1 } },
      select: { sellerRejectStrikes: true, offersSuspendedAt: true, username: true },
    });
    result.struck = true;
    result.totalStrikes = user.sellerRejectStrikes;

    if (user.sellerRejectStrikes >= SUSPEND_AT && !user.offersSuspendedAt) {
      await prisma.user.update({
        where: { id: input.sellerId },
        data: { offersSuspendedAt: new Date() },
      });
      result.suspended = true;
    }

    await prisma.adminAlert.create({
      data: {
        type: 'SELLER_REJECT_STRIKE',
        referenceId: input.sellerId,
        urgent: user.sellerRejectStrikes >= SUSPEND_AT,
        context: JSON.stringify({
          source: input.source,
          reason: input.reason,
          strikes: user.sellerRejectStrikes,
          suspended: result.suspended,
          username: user.username ?? undefined,
          refId: input.referenceId,
        }),
      },
    });
  }

  if (input.consequences.includes('TRUST')) {
    await prisma.adminAlert.create({
      data: {
        type: 'SELLER_REJECT_REVIEW',
        referenceId: input.sellerId,
        context: JSON.stringify({
          source: input.source,
          reason: input.reason,
          note: input.note ? input.note.slice(0, 300) : undefined,
          refId: input.referenceId,
        }),
      },
    });
  }

  if (input.consequences.includes('DELIST') && input.listingId) {
    // CAS on ACTIVE so we never clobber a listing that already sold/moved.
    const del = await prisma.listing.updateMany({
      where: { id: input.listingId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    result.delisted = del.count > 0;
  }

  return result;
}
