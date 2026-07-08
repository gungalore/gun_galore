/**
 * Shared money primitives for the module drivers:
 *   - drainPayouts(): getPayoutsDue → createPayoutBatch → markPayoutBatchPaid,
 *     i.e. the real daily FNB settlement, invoked directly.
 *   - assertConserves(): the per-transaction money-conservation invariant.
 *   - runModule(): uniform per-module begin / try / end wrapper.
 */
import { ManualPaymentsService } from '../../src/manual-payments/manual-payments.service';
import { Ctx } from './seed';
import { assert } from './harness';

export function svc<T>(ctx: Ctx, type: new (...a: any[]) => T): T {
  return ctx.app.get(type, { strict: false });
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

/** Run the full FNB payout settlement over everything currently due. */
export async function drainPayouts(ctx: Ctx): Promise<DrainResult> {
  const mp = svc(ctx, ManualPaymentsService);
  const due = await mp.getPayoutsDue();
  if (due.payouts.length === 0 && due.refunds.length === 0) {
    return { batchId: null, included: 0, grandTotal: 0 };
  }
  const res: any = await mp.createPayoutBatch(null);
  if (res.batchId) {
    const paid = await mp.markPayoutBatchPaid(res.batchId, null);
    return {
      batchId: res.batchId,
      included: res.included,
      grandTotal: res.grandTotal,
      settledPayouts: paid.settledPayouts,
      skipped: res.skipped,
    };
  }
  return { batchId: null, included: 0, grandTotal: res.grandTotal ?? 0, skipped: res.skipped };
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
