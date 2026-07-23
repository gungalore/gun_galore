// ─── Seller reject-reason policy (FIRM — operator 2026-07-23) ────────
//
// One vocabulary + one penalty engine for every seller-initiated
// rejection (offer rejections AND paid-sale rejections). The seller picks
// a reason from a ticklist; the reason determines the consequence.
//
// THE RULE: every rejection is a STRIKE except genuine buyer-concerns
// (which route to the dispute/admin path instead — no strike, but always
// logged for admin review so it can't become the free-pass excuse).
// Rationale: it is the seller's responsibility to keep their listings
// accurate — cancel or edit the listing BEFORE an offer arrives if the
// item is gone, damaged, mispriced or no longer for sale. Countering an
// offer is always penalty-free; the lowball auto-decline threshold is
// penalty-free; manual rejection is not taken lightly.
//
//   STRIKE  — sellerRejectStrikes++. At BAN_AT strikes the seller is
//             BANNED FROM LISTING (sellingBannedAt): no new listings and
//             their ACTIVE listings are cancelled. Buying is unaffected.
//             Lifted only by admin clear-reject-strikes.
//   DELIST  — the listing is cancelled immediately (an item the seller
//             says is gone/damaged must not stay live).
//   TRUST   — trust-safety alert for admin review.
//
// Dependency-free (payment-mode.ts pattern): pure maps + one apply
// function that takes the Prisma client, so OffersService and
// TransactionsService use it without module wiring.

import type { PrismaClient } from '@prisma/client';

export const BAN_AT = 3;

export type RejectConsequence = 'STRIKE' | 'DELIST' | 'TRUST' | 'NONE';

// Offer-rejection ticklist (values stored on Offer.rejectReason; frontend
// lists must mirror these).
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

// FIRM matrix — every reason strikes except BUYER_SUSPICIOUS (dispute/
// admin route). OTHER strikes AND goes to trust review (the written note
// lets an admin clear the strike if it was genuinely legitimate).
const OFFER_REASON_POLICY: Record<OfferRejectReason, RejectConsequence[]> = {
  ITEM_NO_LONGER_AVAILABLE: ['STRIKE', 'DELIST'],
  ITEM_DAMAGED: ['STRIKE', 'DELIST'],
  OFFER_TOO_LOW: ['STRIKE'],
  BUYER_SUSPICIOUS: ['TRUST'],
  LISTING_ERROR: ['STRIKE'],
  CHANGED_MIND: ['STRIKE', 'DELIST'],
  OTHER: ['STRIKE', 'TRUST'],
};

// PAID-SALE rejections (existing TOK-7 picker values — do not rename).
// Same firmness: taking a buyer's money and then rejecting is always a
// strike unless it's a buyer-concern.
const SALE_REASON_POLICY: Record<string, RejectConsequence[]> = {
  SOLD_ELSEWHERE: ['STRIKE', 'DELIST'],
  STOCK_ISSUE: ['STRIKE', 'DELIST'],
  CANT_FULFIL_SHIPPING: ['STRIKE'],
  BUYER_SUSPICIOUS: ['TRUST'],
  OTHER: ['STRIKE', 'TRUST'],
};

export function consequencesForOfferReject(
  reason: OfferRejectReason,
  // Retained for audit context (the alert records it); under the firm
  // policy the outcome no longer depends on it.
  _metAutoAccept: boolean,
): RejectConsequence[] {
  return OFFER_REASON_POLICY[reason] ?? ['STRIKE', 'TRUST'];
}

export function consequencesForSaleReject(reason: string): RejectConsequence[] {
  return SALE_REASON_POLICY[reason] ?? ['STRIKE', 'TRUST'];
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
  banned: boolean;
  delisted: boolean;
}

/**
 * Apply the decided consequences. Best-effort by design: penalties must
 * never break the rejection itself (the buyer's refund/notification is the
 * critical path) — callers await for feedback or fire-and-forget.
 */
export async function applySellerRejectPenalty(
  prisma: PrismaClient,
  input: ApplyRejectPenaltyInput,
): Promise<ApplyRejectPenaltyResult> {
  const result: ApplyRejectPenaltyResult = {
    struck: false,
    totalStrikes: 0,
    banned: false,
    delisted: false,
  };

  if (input.consequences.includes('STRIKE')) {
    const user = await prisma.user.update({
      where: { id: input.sellerId },
      data: { sellerRejectStrikes: { increment: 1 } },
      select: { sellerRejectStrikes: true, sellingBannedAt: true, username: true },
    });
    result.struck = true;
    result.totalStrikes = user.sellerRejectStrikes;

    if (user.sellerRejectStrikes >= BAN_AT && !user.sellingBannedAt) {
      // BAN: no new listings (gate in listings.create), and every ACTIVE
      // listing comes down — banned from listing means nothing stays live.
      await prisma.user.update({
        where: { id: input.sellerId },
        data: { sellingBannedAt: new Date() },
      });
      await prisma.listing.updateMany({
        where: { sellerId: input.sellerId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      result.banned = true;
    }

    await prisma.adminAlert.create({
      data: {
        type: 'SELLER_REJECT_STRIKE',
        referenceId: input.sellerId,
        urgent: user.sellerRejectStrikes >= BAN_AT,
        context: JSON.stringify({
          source: input.source,
          reason: input.reason,
          strikes: user.sellerRejectStrikes,
          banned: result.banned,
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
