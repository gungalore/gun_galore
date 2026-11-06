/**
 * THE PLATFORM FEE — one copy in the frontend, and a build gate that keeps it
 * honest against the backend.
 *
 * ⚠️ THIS USED TO EXIST FIVE TIMES. `backend/src/payments/fee.calculator.ts` is
 * the authority (the charge is computed server-side, always), but the browser
 * has to draw the same number before the buyer commits: the listing page shows
 * an effective percentage, both checkout forms show a full total, and the sell
 * form shows the seller what the fee will be. Each of those carried its own
 * copy of the bands: the listing page (`app/listings/[id]/page.tsx`), the Buy
 * Now checkout (`app/checkout/[listingId]/checkout-form.tsx`), the offer
 * checkout (`app/checkout/offer/[offerId]/offer-checkout-form.tsx`), the sell
 * form (`app/listings/new/page.tsx`), and the legal fee table
 * (`app/(legal)/fees/page.tsx` — prose, deliberately left alone).
 *
 * They agreed on the day they were consolidated, which is exactly the problem:
 * the checkout total is DISPLAY ONLY, so a drifted copy does not throw, does
 * not fail a test, and does not stop the sale — the buyer is simply charged a
 * different total than the one they were shown. That is the single worst class
 * of bug for a marketplace to ship quietly.
 *
 * Two things now hold it together:
 *
 *   1. One copy in the frontend. Every fee figure on screen comes from here.
 *   2. `scripts/fee-sync.cjs` (wired into `npm run build`) parses
 *      fee.calculator.ts and this file and REFUSES THE BUILD if the bands, the
 *      floor or the auction rate disagree. Same shape as theme-sync.cjs, and
 *      for the same reason: a comment saying "keep these in sync" is not a
 *      mechanism.
 *
 * ⚠️ DO NOT PUT A FEE NUMBER ANYWHERE ELSE, and do not "fix" a mismatch by
 * editing this file to match the screen — the backend is the money. If the
 * schedule changes, change fee.calculator.ts first, then this, and let the gate
 * confirm.
 */

/**
 * ZAR cents. Tax-bracket style: each band's `limit` is the WIDTH of the slice,
 * not a cumulative cap, so the marginal rate applies only to the rand inside
 * that slice. Labels are the copy the sell form and the legal page print.
 */
export const PLATFORM_FEE_BANDS: ReadonlyArray<{
  limit: number;
  rate: number;
  label: string;
}> = [
  { limit: 2_500_000, rate: 0.1, label: 'First R25,000 at 10%' },
  { limit: 2_500_000, rate: 0.09, label: 'R25,001–R50,000 at 9%' },
  { limit: 2_500_000, rate: 0.08, label: 'R50,001–R75,000 at 8%' },
  { limit: Infinity, rate: 0.07, label: 'Above R75,000 at 7%' },
];

/** Floor on the fee, ZAR cents. Never more than the amount it is charged on. */
export const MIN_PLATFORM_FEE_CENTS = 1_000;

/**
 * Auctions carry ONE flat 10% platform charge, split evenly: the buyer pays 5%
 * of (hammer + delivery), the seller pays 5% of the hammer.
 */
export const AUCTION_SPLIT_RATE = 0.05;

/** The banded fee before the R10 floor is applied. */
export function platformFeeUnflooredCents(baseZarCents: number): number {
  const base = Math.max(0, Math.round(baseZarCents));
  if (base === 0) return 0;
  let fee = 0;
  let remaining = base;
  for (const band of PLATFORM_FEE_BANDS) {
    if (remaining <= 0) break;
    const chunk = Number.isFinite(band.limit)
      ? Math.min(remaining, band.limit)
      : remaining;
    fee += chunk * band.rate;
    remaining -= chunk;
  }
  return Math.max(0, Math.round(fee));
}

/**
 * The banded Platform Fee on a base (item + delivery), floored at R10.
 *
 * The floor is capped at the base itself, so a corrupt row can never charge a
 * fee larger than the thing being sold — the same cap the backend applies.
 */
export function platformFeeCents(baseZarCents: number): number {
  const base = Math.max(0, Math.round(baseZarCents));
  if (base === 0) return 0;
  const unfloored = platformFeeUnflooredCents(base);
  return unfloored < MIN_PLATFORM_FEE_CENTS
    ? Math.min(MIN_PLATFORM_FEE_CENTS, base)
    : unfloored;
}

/**
 * The buyer's 5% share of an auction's platform charge, floored at R10.
 *
 * ⚠️ THE FLOOR IS CAPPED AT THE BASE, and the checkout preview used to omit
 * that cap: it computed `max(R10, 5%)` while the backend computes
 * `min(R10, base)` when 5% falls below R10. The two only diverge for a base
 * under R10 — a hammer of about R8 with collection — which is why nobody ever
 * saw it, and exactly the sort of "never happens" that ships.
 */
export function auctionBuyerFeeCents(baseZarCents: number): number {
  const base = Math.max(0, Math.round(baseZarCents));
  if (base === 0) return 0;
  const raw = Math.round(base * AUCTION_SPLIT_RATE);
  return raw < MIN_PLATFORM_FEE_CENTS
    ? Math.min(MIN_PLATFORM_FEE_CENTS, base)
    : raw;
}

/**
 * The fee on a base, for whichever sale type. One entry point so a caller does
 * not have to remember which schedule applies.
 */
export function platformFeeForCents(
  baseZarCents: number,
  isAuction: boolean,
): number {
  return isAuction
    ? auctionBuyerFeeCents(baseZarCents)
    : platformFeeCents(baseZarCents);
}

/**
 * Effective rate ON THE ITEM ALONE, in percent — the number beside the price on
 * a listing ("+ 10%"). Delivery is only known at checkout, so this deliberately
 * ignores it; the checkout total is where the real figure appears.
 */
export function platformFeePctOfItem(priceCents: number): number {
  if (!priceCents || priceCents <= 0) return 0;
  return (platformFeeCents(priceCents) / priceCents) * 100;
}

/**
 * What a seller receives on a Buy Now sale: their ask, in full. The fee is the
 * buyer's, charged last on (item + delivery). Kept here so the sell form's
 * "you receive" preview cannot drift from the contract either.
 */
export function buyNowPayoutCents(sellerAskCents: number): number {
  return Math.max(0, Math.round(sellerAskCents));
}

/**
 * What a seller receives on an auction: the hammer less their 5% share.
 */
export function auctionPayoutCents(hammerCents: number): number {
  const hammer = Math.max(0, Math.round(hammerCents));
  return Math.max(0, hammer - Math.round(hammer * AUCTION_SPLIT_RATE));
}
