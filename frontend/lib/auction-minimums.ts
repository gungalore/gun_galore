// ────────────────────────────────────────────────────────────────────
// AUCTION LENGTH ↔ MINIMUM ITEM VALUE.
//
// A longer run costs us more in exposure and carries more risk, so the
// value the auction is asked to advertise has to justify the days. These
// figures are mirrored by the backend in `listings.service.ts`
// (`AUCTION_MIN_VALUE_CENTS`), which is the authoritative copy: this one
// greys the Continue button out early, the backend refuses the row if a
// crafted payload skips the form.
//
// ⚠️ THE FLOOR IS ON THE RESERVE (OR THE TYPED STARTING BID), NOT ON THE
// DERIVED 30%-UNDER STARTING BID. When a reserve is set the starting bid is
// computed as floor(reserve * 0.7); holding THAT to the floor would
// contradict the rule that produces it, and the operator was explicit that
// it "can fall below the value". What must clear the floor is what the
// seller actually stakes: their reserve, or their typed starting bid when
// there is no reserve.
//
// One list feeds both the day pills and the gating, so the numbers printed
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

export type AuctionDuration = {
  days: 3 | 5 | 7 | 14;
  /** Value the auction must advertise, in ZAR cents. */
  minCents: number;
  /** Pill label. */
  label: string;
  /** Second line under the pill label — derived from minCents so the
   *  printed floor and the enforced one cannot drift apart. */
  sublabel: string;
};

export const AUCTION_DURATIONS: AuctionDuration[] = [
  { days: 3, minCents: 100_000 },
  { days: 5, minCents: 250_000 },
  { days: 7, minCents: 600_000 },
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

export type AuctionFloorViolation = {
  /** Which field fell short — the reserve, or the typed starting bid. */
  field: 'reserve' | 'startingBid';
  minCents: number;
};

/**
 * The floor breach for a given duration, or null when the auction is within
 * the rules or is not yet filled in enough to judge. Reserve wins when set;
 * otherwise the typed starting bid is measured. A blank duration, blank
 * reserve and blank starting bid can never breach — a floor over an empty
 * field would grey the button before the seller has typed anything.
 */
export function auctionFloorViolation(input: {
  durationDays: string | number | null | undefined;
  reserveCents: number;
  startingBidCents: number;
}): AuctionFloorViolation | null {
  const minCents = auctionMinValueCents(input.durationDays);
  if (minCents == null) return null;
  if (input.reserveCents > 0) {
    return input.reserveCents < minCents ? { field: 'reserve', minCents } : null;
  }
  if (input.startingBidCents > 0) {
    return input.startingBidCents < minCents
      ? { field: 'startingBid', minCents }
      : null;
  }
  return null;
}
