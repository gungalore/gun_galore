// ────────────────────────────────────────────────────────────────────
// TAX PROFILE — pure constants and turnover arithmetic.
//
// ⚠️ THE MARKETPLACE IS AN AGENT. Every Buy Now and Auction sale collects
// the item price and delivery on behalf of the seller/courier; those amounts
// are not ALL Outdoor revenue, turnover or VAT supplies. Only the platform
// fee, commission and handling margin are the platform's own supplies.
//
// ⚠️ MOTIVATION IS THE ONE PRINCIPAL PRODUCT, and only once its paygate
// exists. Its full sale price is platform revenue.
//
// ⚠️ MICRO-BUSINESS TURNOVER TAX IS NOT A TRANSACTION TAX. It is an annual
// income-tax regime; it must never be added to an invoice or a checkout.
// ────────────────────────────────────────────────────────────────────

/** SARS VAT registration threshold: R2.3m (2025/26), in cents. */
export const VAT_REGISTRATION_THRESHOLD_CENTS = 230_000_000;

/** Standard South African VAT rate, used only when VAT is registered. */
export const DEFAULT_VAT_RATE_PERCENT = 15;

/** Configurable default for the turnover-tax eligibility limit (R1m). */
export const DEFAULT_MICRO_BUSINESS_TURNOVER_LIMIT_CENTS = 100_000_000;

export type TaxSupplyRole = 'AGENT' | 'PRINCIPAL';

export type TaxTurnoverBasis = 'AGENT_REVENUE' | 'GROSS_SALES';

export interface TaxTurnoverRow {
  /** Paid date, used for the rolling 12-month window. */
  paidAt: Date;
  supplyRole: TaxSupplyRole;
  /** The full amount the buyer paid, before refunds. */
  grossSalesCents: number;
  /** The platform's own agent supply: fees, commission, handling. */
  agentRevenueCents: number;
  /** Principal revenue (Motivation only once paygated). */
  principalRevenueCents: number;
  /** Cumulative amount refunded on this sale. */
  refundedCents: number;
}

export interface TaxTurnoverSummary {
  grossSalesCents: number;
  agentRevenueCents: number;
  principalRevenueCents: number;
  /** The amount used against the selected threshold. */
  basisCents: number;
  basis: TaxTurnoverBasis;
}

function netRatio(row: TaxTurnoverRow): number {
  if (row.grossSalesCents <= 0) return 0;
  return Math.max(
    0,
    Math.min(1, (row.grossSalesCents - row.refundedCents) / row.grossSalesCents),
  );
}

/**
 * Rolling turnover for a window. Refunds are netted proportionally across
 * every component, because the Transaction row stores one refunded total and
 * not a per-line refund.
 */
export function summariseTurnover(
  rows: readonly TaxTurnoverRow[],
  basis: TaxTurnoverBasis = 'AGENT_REVENUE',
): TaxTurnoverSummary {
  let grossSalesCents = 0;
  let agentRevenueCents = 0;
  let principalRevenueCents = 0;
  for (const row of rows) {
    const ratio = netRatio(row);
    grossSalesCents += Math.round(row.grossSalesCents * ratio);
    agentRevenueCents += Math.round(row.agentRevenueCents * ratio);
    principalRevenueCents += Math.round(row.principalRevenueCents * ratio);
  }
  return {
    grossSalesCents,
    agentRevenueCents,
    principalRevenueCents,
    basis: basis,
    basisCents:
      basis === 'GROSS_SALES' ? grossSalesCents : agentRevenueCents,
  };
}

export function thresholdPercent(cents: number, thresholdCents: number): number {
  if (thresholdCents <= 0) return 0;
  return Math.round((Math.max(0, cents) / thresholdCents) * 1000) / 10;
}

export function thresholdHeadroomCents(
  cents: number,
  thresholdCents: number,
): number {
  return Math.max(0, thresholdCents - Math.max(0, cents));
}

/** The rolling window used by the monitor: the last twelve months. */
export function rollingWindowStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return start;
}
