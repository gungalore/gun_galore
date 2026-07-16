/**
 * Shared money primitives for the module drivers:
 *   - simulatePaid()/simulateOrderPaid(): drive a checkout to PAID. The
 *     manual-EFT confirm methods were removed with the manual rail, so the
 *     harness invokes the SAME internal markPaid the future paygate webhook
 *     will (reached via as-any since it's private) — identical money-state.
 *   - drainPayouts(): getPayoutsDue → settle by stamping Transaction.paidOutAt
 *     + firing the Zoho commission-invoice-paid entry (what a paygate payout
 *     run does now that the FNB bulk-payment batch is gone).
 *   - assertConserves(): the per-transaction money-conservation invariant.
 *   - runModule(): uniform per-module begin / try / end wrapper.
 */
import { ManualPaymentsService } from '../../src/manual-payments/manual-payments.service';
import { TransactionsService } from '../../src/payments/transactions.service';
import { ZohoBooksService } from '../../src/zoho/zoho-books.service';
import { Ctx } from './seed';
import { assert } from './harness';

export function svc<T>(ctx: Ctx, type: new (...a: any[]) => T): T {
  return ctx.app.get(type, { strict: false });
}

/**
 * Mark a single-item transaction PAID via the real (private) markPaid — the
 * exact path a card-paygate verify/webhook handler drives — producing the full
 * money-state (paid + HELD + listing SOLD + PRIVATE_ARRANGE immediate release +
 * notifications + Zoho). Idempotent.
 */
export async function simulatePaid(ctx: Ctx, txId: string) {
  const P = ctx.prisma as any;
  const row = await P.transaction.findUnique({
    where: { id: txId },
    include: { listing: true },
  });
  if (!row) throw new Error(`simulatePaid: transaction ${txId} not found`);
  if (row.paidAt) return; // idempotent
  const T = svc(ctx, TransactionsService) as any;
  await T.markPaid(
    txId,
    {
      paymentId: `SIM-${txId}`,
      resultCode: 'SIM',
      amount: row.buyerTotal,
      currency: 'ZAR',
      merchantTransactionId: txId,
      isSuccess: true,
    },
    row.listing,
    row.buyerTotal,
  );
}

/**
 * Mark a multi-item Order PAID: fan the per-child markPaid out then roll the
 * Order up to PAID (the confirmManualOrder equivalent, rail-agnostic).
 */
export async function simulateOrderPaid(ctx: Ctx, orderId: string) {
  const P = ctx.prisma as any;
  const order = await P.order.findUnique({
    where: { id: orderId },
    include: { transactions: { select: { id: true } } },
  });
  if (!order) throw new Error(`simulateOrderPaid: order ${orderId} not found`);
  if (order.paidAt) return; // idempotent
  for (const child of order.transactions) {
    await simulatePaid(ctx, child.id);
  }
  await P.order.updateMany({
    where: { id: orderId, paidAt: null },
    data: { status: 'PAID', paidAt: new Date() },
  });
}

/**
 * The invariant that must hold for EVERY sale transaction, regardless of who
 * absorbs the processing fee:
 *   buyerTotal == sellerPayout + commissionZar + processingFee
 *                 + shippingCost + shippingHandlingCents
 * (shippingCost is remitted to the carrier; commission + processing + handling
 * are GG revenue; sellerPayout is the seller's cut.)
 */
export function assertConserves(tx: {
  buyerTotal: number;
  sellerPayout: number;
  commissionZar: number;
  processingFee: number;
  shippingCost: number;
  shippingHandlingCents: number;
}) {
  const rhs =
    tx.sellerPayout +
    tx.commissionZar +
    tx.processingFee +
    tx.shippingCost +
    tx.shippingHandlingCents;
  assert(
    tx.buyerTotal === rhs,
    `money not conserved: buyerTotal=${tx.buyerTotal} != seller ${tx.sellerPayout} + commission ${tx.commissionZar} + processing ${tx.processingFee} + shipping ${tx.shippingCost} + handling ${tx.shippingHandlingCents} (=${rhs})`,
  );
}

/** GG revenue on a normal sale = commission + processing + handling. */
export function ggRevenueOf(tx: {
  commissionZar: number;
  processingFee: number;
  shippingHandlingCents: number;
}) {
  return tx.commissionZar + tx.processingFee + tx.shippingHandlingCents;
}

export interface DrainResult {
  batchId: string | null;
  included: number;
  grandTotal: number;
  settledPayouts?: number;
  skipped?: number;
}

/**
 * Settle everything currently due: seller payouts (RELEASED) + buyer refunds
 * (REFUNDED). The FNB bulk-payment batch was removed with the manual rail, so
 * settlement is now stamping Transaction.paidOutAt on the due rows + firing the
 * Zoho commission-invoice-paid entry per seller payout (what a card-paygate
 * payout run does). Zero-net payouts (fully consumed by refund slices) are
 * stamped too so they leave the due queue.
 */
export async function drainPayouts(ctx: Ctx): Promise<DrainResult> {
  const mp = svc(ctx, ManualPaymentsService);
  const zoho = svc(ctx, ZohoBooksService);
  const P = ctx.prisma as any;
  const due = await mp.getPayoutsDue();
  if (due.payouts.length === 0 && due.refunds.length === 0) {
    return { batchId: null, included: 0, grandTotal: 0 };
  }
  const childrenSum = (c?: { buyerTotal: number }[] | null) =>
    (c ?? []).reduce((s, x) => s + x.buyerTotal, 0);

  let grandTotal = 0;
  const payoutIds: string[] = [];
  const refundIds: string[] = [];
  for (const p of due.payouts) {
    payoutIds.push(p.id);
    grandTotal += Math.max(0, p.sellerPayout - childrenSum(p.refundChildren));
  }
  for (const r of due.refunds) {
    refundIds.push(r.id);
    grandTotal += r.refundOfId
      ? r.buyerTotal
      : Math.max(0, r.buyerTotal - childrenSum(r.refundChildren));
  }
  const allIds = [...payoutIds, ...refundIds];
  const now = new Date();
  await P.transaction.updateMany({
    where: { id: { in: allIds }, paidOutAt: null },
    data: { paidOutAt: now },
  });
  for (const id of payoutIds) {
    await zoho.markCommissionInvoicePaid(id).catch(() => undefined);
  }
  return {
    batchId: null,
    included: allIds.length,
    grandTotal,
    settledPayouts: payoutIds.length,
    skipped: 0,
  };
}

/** Poll until fn() returns truthy (for fire-and-forget side effects). */
export async function waitFor<T>(
  fn: () => Promise<T>,
  pred: (v: T) => boolean,
  { tries = 40, gap = 50 }: { tries?: number; gap?: number } = {},
): Promise<T> {
  let last: T = await fn();
  for (let i = 0; i < tries; i++) {
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, gap));
    last = await fn();
  }
  return last;
}

export async function runModule(
  ctx: Ctx,
  name: string,
  fn: (ctx: Ctx) => Promise<void>,
) {
  ctx.rep.begin(name);
  try {
    await fn(ctx);
    ctx.rep.end();
  } catch (e) {
    ctx.rep.fail('module crashed unexpectedly', (e as Error).message);
    ctx.rep.end('FAIL', (e as Error).message);
  }
  // Let this module's fire-and-forget side-effects drain before the next one,
  // so the connection pool isn't starved across module boundaries.
  await new Promise((r) => setTimeout(r, 120));
}
