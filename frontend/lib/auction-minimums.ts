// ────────────────────────────────────────────────────────────────────
// AUCTION LENGTH ↔ MINIMUM RESERVE, AND THE DERIVED OPENING BID.
//
// A longer run costs us more in exposure and carries more risk, so the
// reserve the auction is asked to commit has to justify the days. These
// figures are mirrored by the backend in `listings.service.ts`
// (`AUCTION_MIN_VALUE_CENTS`), which is the authoritative copy: this one
// greys the Continue button out early, the backend refuses the row if a
// crafted payload skips the form.
//
// ⚠️ THE FLOOR IS ON THE RESERVE, NOT ON THE DERIVED OPENING BID. The
// seller no longer types a starting bid: the opening bid is computed as
// floor(reserve * 0.7), 30% below the reserve. Holding THAT to the floor
// would contradict the rule that produces it, and the operator was
// explicit that it "can fall below the value". What must clear the floor
// is the reserve the seller stakes — every auction now requires one.
//
// ⚠️ BACKWARDS IS ALLOWED. The floors are a minimum, not an exact band: a
// R20,000 reserve is valid for 3, 5, 7 AND 14 days. A reserve BELOW a
// duration's floor locks that duration out (a R2,500 reserve cannot run 7
// days, even though 7 days is the longer, "more expensive" run).
//
// One list feeds the day pills and the gating, so the numbers printed
// under the pills and the number in the refusal message can never disagree.
// ────────────────────────────────────────────────────────────────────

/** "R1,000" — no decimals; these are round advertised floors. Grouped with
 *  commas rather than en-ZA's NBSP, so the pill sublabel and the wizard
 *  message read the way the operator writes them. */
export function formatAuctionFloor(cents: number): string {
  return `R${Math.round(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** The opening bid sits 30% below the reserve, in whole cents. The backend
 *  owns the rule; this is the same arithmetic so the read-only line on the
 *  form and the preview cannot show a figure the listing will not open at.
 *  A blank / invalid / zero reserve yields 0 — there is no opening bid to
 *  derive yet. */
export const AUCTION_STARTING_BID_RATE = 0.7;

export function auctionStartingBidCents(reserveCents: number): number {
  if (!Number.isFinite(reserveCents) || reserveCents <= 0) return 0;
  return Math.floor(reserveCents * AUCTION_STARTING_BID_RATE);
}

export type AuctionDuration = {
  days: 3 | 5 | 7 | 14;
  /** Minimum reserve the auction must commit, in ZAR cents. */
  minCents: number;
  /** Pill label. */
  label: string;
  /** Second line under the pill label — derived from minCents so the
   *  printed floor and the enforced one cannot drift apart. */
  sublabel: string;
};

export const AUCTION_DURATIONS: AuctionDuration[] = [
  { days: 3, minCents: 250_000 },
  { days: 5, minCents: 500_000 },
  { days: 7, minCents: 750_000 },
  { days: 14, minCents: 1_000_000 },
].map((d) => ({
  ...d,
  label: `${d.days} days`,
  sublabel: `min ${formatAuctionFloor(d.minCents)}`,
})) as AuctionDuration[];

/** The duration's floor, or null when no duration is chosen. */
export function auctionMinValueCents(
  durationDays: string | number | null | undefined,
): number | null {
  if (durationDays == null || durationDays === '') return null;
  const found = AUCTION_DURATIONS.find((d) => String(d.days) === String(durationDays));
  return found ? found.minCents : null;
}

/** The lowest floor of all: no auction can run on a reserve below this, so a
 *  reserve under it unlocks no duration at all. */
export const AUCTION_LOWEST_FLOOR_CENTS = AUCTION_DURATIONS.reduce(
  (min, d) => Math.min(min, d.minCents),
  Number.POSITIVE_INFINITY,
);

/**
 * The durations a given reserve unlocks. The rules are "floor ≤ reserve":
 * a reserve clears its own length and every SHORTER length (backwards is
 * allowed), but never a longer one. A blank / zero reserve unlocks nothing —
 * every auction needs a reserve now, so there is no duration to offer before
 * the seller names one.
 */
export function auctionDurationsForReserve(
  reserveCents: number,
): AuctionDuration[] {
  if (!Number.isFinite(reserveCents) || reserveCents <= 0) return [];
  return AUCTION_DURATIONS.filter((d) => d.minCents <= reserveCents);
}

/** Whether the given duration may be picked at the given reserve. An
 *  unknown duration is never allowed — the picker cannot render it, so the
 *  form must not silently accept it either. */
export function isAuctionDurationAllowed(
  durationDays: string | number | null | undefined,
  reserveCents: number,
): boolean {
  const minCents = auctionMinValueCents(durationDays);
  if (minCents == null) return false;
  if (!Number.isFinite(reserveCents) || reserveCents <= 0) return false;
  return reserveCents >= minCents;
}

export type AuctionFloorViolation = {
  /** The smallest reserve that clears the chosen duration's floor. */
  minCents: number;
};

/**
 * The reserve shortfall for a given duration, or null when the reserve clears
 * the floor or is not filled in yet. Only the reserve is measured — the
 * opening bid is derived from it and is deliberately allowed below the floor.
 * A blank duration, or a blank reserve, can never breach: a floor over an
 * empty field would grey the button before the seller has typed anything.
 * (A blank reserve is still blocked by the required-field check; it just is
 * not a "below the floor" error.)
 */
export function auctionFloorViolation(input: {
  durationDays: string | number | null | undefined;
  reserveCents: number;
}): AuctionFloorViolation | null {
  const minCents = auctionMinValueCents(input.durationDays);
  if (minCents == null) return null;
  if (!Number.isFinite(input.reserveCents) || input.reserveCents <= 0) return null;
  return input.reserveCents < minCents ? { minCents } : null;
}
