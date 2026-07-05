// EXP-E3 — CPA-s17 cancellation policy for hunting-package / experience
// bookings. PURE — no I/O, no Nest, no Prisma — so the money split is
// unit-testable in isolation and the conservation invariant can be asserted
// on every case. The service layer (transactions.service.ts) reads the
// optional Setting override + the seller tier + calls calculateCommission,
// then delegates the maths to computeCpaCancellation here.
//
// === MONEY SEMANTICS (the adversarial review checks conservation) ===
// All maths is on `buyerTotalCents` (what the buyer actually paid), so the
// split CONSERVES exactly: refundCents + outfitterReleaseCents + ggRetainedCents
// === buyerTotalCents, and every slice is >= 0.
//
// daysBefore = whole days from `now` to `eventDate` (buyer-initiated cancel).
// The consumer's CPA-s17 right to cancel an advance booking is subject only to
// a "reasonable" charge (s17(4)); more notice = smaller charge, tracking the
// supplier's actual loss as the resale window closes. Two outcomes are
// statute-mandated zero-charge FULL refunds (exemptReason):
//   • DEATH / HOSPITALISATION — s17(5): no charge where the cancellation is due
//     to the death or hospitalisation of the person the booking was for.
//   • SUPPLIER_FAILURE — the outfitter cancelled / no-showed / failed to
//     deliver: the supplier didn't perform, so this isn't a consumer
//     cancellation and no charge applies. OUTFITTER-initiated cancels ALWAYS
//     pass this reason.
//
// Where the retained slice goes: the outfitter is compensated for their held
// date MINUS GG's standard-band commission on it (GG keeps that commission).
// EXCEPTION — the >=60d tier is a FIXED R250 admin fee that is 100%
// GG-retained (the outfitter gets 0): it is a pure GG admin cost, not a
// supplier-loss compensation.

// ── Tier schedule (the "reasonable" default; operator/attorney-tunable via a
// `experienceCancellationTiers` Setting JSON override read in the service). A
// tier's `forfeitPct` is the fraction of buyerTotal retained; `minDaysBefore`
// is the inclusive lower day-bound. The >=60d tier is special-cased as a FIXED
// admin fee (adminFeeCents), NOT a percentage. Ordered high→low notice.
export interface CancellationTier {
  minDaysBefore: number; // inclusive: applies when daysBefore >= this
  forfeitPct: number; // fraction of buyerTotal retained (0..1)
  label: string;
}

// The fixed >=60d admin fee, ZAR cents. R250. GG-retained in full.
export const CPA_ADMIN_FEE_CENTS = 25_000;

// Day-band defaults (operator decision, CPA-s17 "reasonable" starting point).
// The >=60d band's forfeitPct is IGNORED — that band uses CPA_ADMIN_FEE_CENTS
// (a fixed amount) instead — but a value is present so the shape stays uniform.
export const DEFAULT_CANCELLATION_TIERS: CancellationTier[] = [
  { minDaysBefore: 60, forfeitPct: 0, label: '60+ days — R250 admin fee' },
  { minDaysBefore: 30, forfeitPct: 0.2, label: '30–59 days — 20%' },
  { minDaysBefore: 21, forfeitPct: 0.4, label: '21–29 days — 40%' },
  { minDaysBefore: 14, forfeitPct: 0.5, label: '14–20 days — 50%' },
  { minDaysBefore: 7, forfeitPct: 0.75, label: '7–13 days — 75%' },
  { minDaysBefore: 0, forfeitPct: 1, label: 'Under 7 days / no-show — 100%' },
];

export type CancellationExemptReason =
  | 'DEATH'
  | 'HOSPITALISATION'
  | 'SUPPLIER_FAILURE';

export const EXEMPT_REASONS: readonly CancellationExemptReason[] = [
  'DEATH',
  'HOSPITALISATION',
  'SUPPLIER_FAILURE',
] as const;

export function isExemptReason(x: unknown): x is CancellationExemptReason {
  return (
    typeof x === 'string' &&
    (EXEMPT_REASONS as readonly string[]).includes(x)
  );
}

export interface ComputeCpaCancellationInput {
  buyerTotalCents: number;
  isTopSeller: boolean;
  eventDate: Date;
  now: Date;
  initiator: 'BUYER' | 'OUTFITTER';
  exemptReason?: CancellationExemptReason;
  // Commission band function — the SAME one breakdown() uses. Injected (not
  // imported) so this module stays pure and free of the Nest FeeCalculator.
  calculateCommission: (retainedCents: number, isTopSeller: boolean) => number;
  // Optional operator/attorney override of the tier schedule + admin fee.
  tiers?: CancellationTier[];
  adminFeeCents?: number;
}

export interface CpaCancellationResult {
  refundCents: number; // paid back to the buyer
  outfitterReleaseCents: number; // released to the outfitter (their loss, minus GG commission)
  ggRetainedCents: number; // GG keeps (commission on the retained slice, OR the fixed admin fee)
  retainedCents: number; // total NOT refunded = buyerTotal - refund
  tierLabel: string; // human-readable tier applied
  adminFeeCents: number; // the fixed admin-fee slice (only non-zero on the >=60d tier)
  isTopTier: boolean; // true on the >=60d fixed-admin-fee tier
}

// Whole days from `now` to `eventDate`. Floored: an event 6.9 days out is
// "6 days before" (the tighter, higher-forfeit band), which is the
// consumer-safe direction (a buyer never gets a cheaper tier by cancelling
// slightly earlier within the same day). Never negative — a past event
// clamps to 0 (the <7d / no-show band).
export function daysBefore(now: Date, eventDate: Date): number {
  const ms = eventDate.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

// Pick the tier whose minDaysBefore is the largest value <= daysBefore.
// Tiers are sorted high→low; the first match is the answer. Falls back to the
// last (lowest) tier so there is always a result.
function pickTier(days: number, tiers: CancellationTier[]): CancellationTier {
  const sorted = [...tiers].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  for (const t of sorted) {
    if (days >= t.minDaysBefore) return t;
  }
  return sorted[sorted.length - 1];
}

// THE cancellation calculator. Pure. See the module header for the semantics.
export function computeCpaCancellation(
  input: ComputeCpaCancellationInput,
): CpaCancellationResult {
  const buyerTotal = Math.max(0, Math.round(input.buyerTotalCents));
  const tiers =
    input.tiers && input.tiers.length > 0
      ? input.tiers
      : DEFAULT_CANCELLATION_TIERS;
  const adminFeeCents =
    input.adminFeeCents != null && input.adminFeeCents >= 0
      ? Math.round(input.adminFeeCents)
      : CPA_ADMIN_FEE_CENTS;

  // ── Statutory / supplier-failure exemptions → full refund, zero charge. An
  // OUTFITTER-initiated cancel is ALWAYS a SUPPLIER_FAILURE (never charge the
  // consumer for the supplier's failure), regardless of the reason passed.
  const exempt =
    input.initiator === 'OUTFITTER' || input.exemptReason != null;
  if (exempt) {
    return {
      refundCents: buyerTotal,
      outfitterReleaseCents: 0,
      ggRetainedCents: 0,
      retainedCents: 0,
      tierLabel:
        input.initiator === 'OUTFITTER'
          ? 'Outfitter cancellation (supplier failure) — full refund'
          : input.exemptReason === 'DEATH'
            ? 'Death (CPA s17(5)) — full refund'
            : input.exemptReason === 'HOSPITALISATION'
              ? 'Hospitalisation (CPA s17(5)) — full refund'
              : 'Supplier failure — full refund',
      adminFeeCents: 0,
      isTopTier: false,
    };
  }

  // ── Notice-graduated tier (buyer-initiated, no exemption). ──────────────
  const days = daysBefore(input.now, input.eventDate);
  const tier = pickTier(days, tiers);
  // The highest-notice band uses a FIXED admin fee, not a percentage. We
  // identify it by being the tier with the largest minDaysBefore (>=60d in
  // the default). Everything below it uses forfeitPct.
  const maxMinDays = Math.max(...tiers.map((t) => t.minDaysBefore));
  const isTopTier = tier.minDaysBefore === maxMinDays;

  // retainedCents: the >=60d tier retains a FIXED admin fee (capped at
  // buyerTotal so we can never retain more than the buyer paid); every other
  // tier retains round(buyerTotal * forfeitPct).
  const retainedCents = isTopTier
    ? Math.min(adminFeeCents, buyerTotal)
    : Math.round(buyerTotal * tier.forfeitPct);
  const refundCents = buyerTotal - retainedCents;

  // Of the retained slice, GG keeps its standard-band commission and the
  // outfitter is released the remainder — EXCEPT the >=60d fixed admin fee,
  // which is 100% GG-retained (the outfitter gets 0).
  const ggCommissionOnRetained = isTopTier
    ? retainedCents
    : Math.min(
        retainedCents,
        Math.max(
          0,
          input.calculateCommission(retainedCents, input.isTopSeller),
        ),
      );
  const outfitterReleaseCents = isTopTier
    ? 0
    : retainedCents - ggCommissionOnRetained;
  const ggRetainedCents = ggCommissionOnRetained;

  return {
    refundCents,
    outfitterReleaseCents,
    ggRetainedCents,
    retainedCents,
    tierLabel: tier.label,
    adminFeeCents: isTopTier ? retainedCents : 0,
    isTopTier,
  };
}
