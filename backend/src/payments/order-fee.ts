// ────────────────────────────────────────────────────────────────────
// ONE PLATFORM FEE FOR THE WHOLE CART, ALLOCATED BACK TO THE LINES.
//
// Operator decision, 2026-11-27: the Platform Fee is charged ONCE on the cart,
// not once per line. The approved rule:
//
//   base = Σ(line listingPrice + shippingCost + shippingHandling)   [handling 0]
//   F    = FeeCalculator bands + R10 floor, applied ONCE to `base`
//   fee_i = a fair share of F per line; Σ fee_i === F exactly
//
// ⚠️ WHY ALLOCATE AT ALL. A child Transaction still carries its own
// processingFee/buyerTotal because refunds, fee presentation and Zoho lines all
// read the Transaction row — a cart where only the Order held the fee would
// refund the wrong amount for a single line. So the child is rewritten to
// base_i + fee_i, and the Order snapshot is B + F.
//
// ⚠️ THE ALLOCATION IS DETERMINISTIC. floor(F × base_i / B) first, then the
// leftover cents go to the largest fractional remainders (ties: lower line
// index). No randomness, no negative fees, and the sum is exact by
// construction — a "R10 fee split across three lines" must not lose a cent.
//
// ⚠️ SELLER MONEY IS UNTOUCHED. commissionZar and sellerPayout were computed
// by the normal per-line fee path and are NOT rewritten here; the Platform Fee
// is buyer-paid on BUY_NOW (the seller receives their ask).
//
// PURE — no Nest, no Prisma. The caller passes bases and the total fee.
// ────────────────────────────────────────────────────────────────────

export interface FeeBaseLine {
  /** Item subtotal for the line (unitPrice × quantity), ZAR cents. */
  listingPrice: number;
  /** Courier rate for the line (0 for siblings / non-courier), ZAR cents. */
  shippingCost: number;
  /** Legacy delivery margin — always 0 for sales after 2026-10-23. */
  shippingHandlingCents: number;
}

export interface AllocatedFeeLine {
  base: number;
  fee: number;
  /** base + fee — what the child Transaction.buyerTotal becomes. */
  buyerTotal: number;
}

export interface OrderFeeAllocation {
  /** Σ line bases — the aggregate the FeeCalculator priced. */
  base: number;
  /** The ONE Platform Fee applied to the whole cart, ZAR cents. */
  processingFee: number;
  /** What the buyer pays: base + processingFee. */
  buyerTotal: number;
  lines: AllocatedFeeLine[];
}

function assertCents(value: number, label: string, line: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `order-fee: ${label} on line ${line} must be a non-negative whole number of cents`,
    );
  }
}

/** Σ(listingPrice + shippingCost + shippingHandling) across the cart. */
export function orderFeeBase(lines: readonly FeeBaseLine[]): number {
  return lines.reduce(
    (total, line, index) => {
      assertCents(line.listingPrice, 'listingPrice', index);
      assertCents(line.shippingCost, 'shippingCost', index);
      assertCents(line.shippingHandlingCents, 'shippingHandlingCents', index);
      return (
        total +
        line.listingPrice +
        line.shippingCost +
        line.shippingHandlingCents
      );
    },
    0,
  );
}

/**
 * Split `totalFee` across `bases` proportionally, exactly.
 *
 * Largest-remainder method:
 *   1. fee_i = floor(F × base_i / B)
 *   2. distribute the `F − Σ fee_i` leftover cents, one each, to the lines
 *      with the largest fractional remainders (lower index wins a tie).
 *
 * Every base is non-negative, every fee is therefore non-negative, and
 * `Σ fee_i === totalFee` (asserted below).
 */
export function allocateFee(
  bases: readonly number[],
  totalFee: number,
): number[] {
  if (!Number.isInteger(totalFee) || totalFee < 0) {
    throw new Error('order-fee: totalFee must be a non-negative whole number of cents');
  }
  bases.forEach((base, index) => assertCents(base, 'base', index));
  if (bases.length === 0) {
    if (totalFee !== 0) {
      throw new Error('order-fee: cannot allocate a fee across zero lines');
    }
    return [];
  }

  const base = bases.reduce((sum, value) => sum + value, 0);
  if (base === 0) {
    // A free cart cannot carry a fee; the floor is capped at the base upstream,
    // so this only fires defensively. Give line 0 the whole (zero) fee.
    if (totalFee !== 0) {
      throw new Error('order-fee: cannot allocate a fee across a zero-value cart');
    }
    return bases.map(() => 0);
  }

  const fees = bases.map((value) => Math.floor((totalFee * value) / base));
  const allocated = fees.reduce((sum, value) => sum + value, 0);
  let leftover = totalFee - allocated;

  const remainders = bases.map((value, index) => ({
    index,
    remainder: (totalFee * value) % base,
  }));
  remainders.sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );
  for (const entry of remainders) {
    if (leftover <= 0) break;
    fees[entry.index] += 1;
    leftover -= 1;
  }

  const total = fees.reduce((sum, value) => sum + value, 0);
  if (total !== totalFee) {
    throw new Error(
      `order-fee: allocation lost cents (allocated ${total}, expected ${totalFee})`,
    );
  }
  return fees;
}

/**
 * The full allocation for a cart: bases, per-line fees, Order totals.
 *
 * `feeFor(base)` is the injected FeeCalculator band calculation (kept out of
 * this pure module so the fee schedule has exactly one implementation).
 */
export function allocateOrderFee(
  lines: readonly FeeBaseLine[],
  feeFor: (base: number) => number,
): OrderFeeAllocation {
  const bases = lines.map(
    (line) => line.listingPrice + line.shippingCost + line.shippingHandlingCents,
  );
  const base = orderFeeBase(lines);
  const processingFee = Math.max(0, Math.round(feeFor(base)));
  const fees = allocateFee(bases, processingFee);
  return {
    base,
    processingFee,
    buyerTotal: base + processingFee,
    lines: bases.map((lineBase, index) => ({
      base: lineBase,
      fee: fees[index],
      buyerTotal: lineBase + fees[index],
    })),
  };
}
