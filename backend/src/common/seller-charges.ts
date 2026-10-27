// ─── Seller failure charge ledger ────────────────────────────────────
//
// Dependency-free helpers that take a Prisma client (the
// seller-reject-policy.ts pattern), so the payment, admin and payout
// paths can all use them without module wiring.
//
// The ledger is the system of record. A failed sale is already refunded
// and its sellerPayout is zero, so there is nothing left to dock there;
// the debt has to survive the sale and be set off against a LATER payout.

import { Prisma, type PrismaClient, type SellerChargeKind } from '@prisma/client';
import { sellerFailureChargeCents } from './seller-failure-policy';

type Db = PrismaClient | Prisma.TransactionClient;

export interface SellerChargeRow {
  id: string;
  sellerId: string;
  transactionId: string;
  kind: SellerChargeKind;
  reason: string | null;
  handlingCents: number;
  shippingCents: number;
  amountCents: number;
  createdAt: Date;
  waivedAt: Date | null;
  waivedById: string | null;
  waivedReason: string | null;
}

export interface RaiseSellerChargeInput {
  sellerId: string;
  transactionId: string;
  kind: SellerChargeKind;
  reason?: string | null;
  /**
   * CUMULATIVE amount refunded on the sale after this operation. Pass the
   * full buyerTotal for a one-shot seller-fault refund.
   */
  refundedTotalCents: number;
  /** True when a waybill exists and cannot be reliably voided. */
  shipmentCommitted: boolean;
  shippingCost: number | null | undefined;
}

/**
 * Raise (or update) the charge for one failed sale. Idempotent: the same
 * call twice produces the same row and amount, because the slices are
 * computed from the cumulative refunded total.
 */
export async function raiseSellerCharge(
  db: Db,
  input: RaiseSellerChargeInput,
): Promise<SellerChargeRow | null> {
  const charge = sellerFailureChargeCents({
    kind: input.kind,
    refundedTotalCents: input.refundedTotalCents,
    shipmentCommitted: input.shipmentCommitted,
    shippingCost: input.shippingCost,
  });

  const existing = await db.sellerCharge.findUnique({
    where: {
      transactionId_kind: {
        transactionId: input.transactionId,
        kind: input.kind,
      },
    },
  });

  if (!existing) {
    if (charge.amountCents <= 0) return null;
    return db.sellerCharge.create({
      data: {
        sellerId: input.sellerId,
        transactionId: input.transactionId,
        kind: input.kind,
        reason: input.reason ?? null,
        handlingCents: charge.handlingCents,
        shippingCents: charge.shippingCents,
        amountCents: charge.amountCents,
      },
    }) as Promise<SellerChargeRow>;
  }

  // Shipping is charged once; handling follows the cumulative refund.
  const nextShipping = Math.max(existing.shippingCents, charge.shippingCents);
  const nextAmount = charge.handlingCents + nextShipping;
  if (
    existing.handlingCents === charge.handlingCents &&
    existing.shippingCents === nextShipping &&
    existing.amountCents === nextAmount
  ) {
    return existing as SellerChargeRow;
  }

  return db.sellerCharge.update({
    where: { id: existing.id },
    data: {
      handlingCents: charge.handlingCents,
      shippingCents: nextShipping,
      amountCents: nextAmount,
      reason: input.reason ?? existing.reason,
    },
  }) as Promise<SellerChargeRow>;
}

/** Recoveries that still count against a charge (RESERVED or SETTLED). */
function usedCents(recoveries: { amountCents: number }[]): number {
  return recoveries.reduce((s, r) => s + r.amountCents, 0);
}

export async function outstandingSellerChargeCents(
  db: Db,
  sellerId: string,
): Promise<number> {
  const charges = await db.sellerCharge.findMany({
    where: { sellerId, waivedAt: null },
    select: {
      amountCents: true,
      recoveries: {
        where: { status: { not: 'RELEASED' } },
        select: { amountCents: true },
      },
    },
  });
  return charges.reduce(
    (total, c) => total + Math.max(0, c.amountCents - usedCents(c.recoveries)),
    0,
  );
}

/**
 * Reserve as much of the seller's outstanding charges as this payout can
 * bear, oldest charge first. Must be called inside the same transaction
 * that claims the payout row, so the reservation and the payout request
 * commit together. Returns the cents actually applied.
 */
export async function reserveSellerChargesForPayout(
  db: Db,
  args: { sellerId: string; transactionId: string; availableCents: number },
): Promise<number> {
  let remaining = Math.max(0, Math.round(args.availableCents));
  if (remaining === 0) return 0;

  const charges = await db.sellerCharge.findMany({
    where: { sellerId: args.sellerId, waivedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      amountCents: true,
      recoveries: {
        where: { status: { not: 'RELEASED' } },
        select: { amountCents: true },
      },
    },
  });

  let applied = 0;
  for (const charge of charges) {
    if (remaining === 0) break;
    const due = Math.max(0, charge.amountCents - usedCents(charge.recoveries));
    if (due === 0) continue;
    const slice = Math.min(due, remaining);
    await db.sellerChargeRecovery.create({
      data: {
        chargeId: charge.id,
        transactionId: args.transactionId,
        amountCents: slice,
      },
    });
    remaining -= slice;
    applied += slice;
  }
  return applied;
}

/** The payout completed: the withheld slice is now truly recovered. */
export async function settleSellerChargeRecoveries(
  db: Db,
  transactionId: string,
): Promise<void> {
  await db.sellerChargeRecovery.updateMany({
    where: { transactionId, status: 'RESERVED' },
    data: { status: 'SETTLED', settledAt: new Date() },
  });
}

/** The payout failed/returned: free the slice for the next payout. */
export async function releaseSellerChargeRecoveries(
  db: Db,
  transactionId: string,
): Promise<void> {
  await db.sellerChargeRecovery.updateMany({
    where: { transactionId, status: 'RESERVED' },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });
}

/**
 * Admin waiver. Also the credit path when a booked Bob Go charge is
 * reclaimed by hand in the carrier portal. Releases any still-RESERVED
 * slices; SETTLED slices already left the seller's money and must be
 * credited separately.
 */
export async function waiveSellerCharge(
  db: PrismaClient,
  args: { chargeId: string; adminId: string; reason: string },
): Promise<boolean> {
  const existing = await db.sellerCharge.findUnique({
    where: { id: args.chargeId },
    select: { id: true, waivedAt: true },
  });
  if (!existing || existing.waivedAt) return false;
  await db.$transaction(async (txc) => {
    await txc.sellerCharge.update({
      where: { id: args.chargeId },
      data: {
        waivedAt: new Date(),
        waivedById: args.adminId,
        waivedReason: args.reason.slice(0, 500),
      },
    });
    await txc.sellerChargeRecovery.updateMany({
      where: { chargeId: args.chargeId, status: 'RESERVED' },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
  });
  return true;
}

export async function listSellerCharges(db: Db, sellerId: string) {
  return db.sellerCharge.findMany({
    where: { sellerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      transactionId: true,
      kind: true,
      reason: true,
      handlingCents: true,
      shippingCents: true,
      amountCents: true,
      createdAt: true,
      waivedAt: true,
      waivedReason: true,
      recoveries: {
        select: {
          amountCents: true,
          status: true,
          transactionId: true,
          createdAt: true,
        },
      },
    },
  });
}
