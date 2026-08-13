// Bob Go → the existing carrier-neutral shapes.
//
// This is the whole of the "Bob Go replaces Pudo and TCG" mapping, kept in one
// pure, testable file so the 1265-line orchestrator gains a call site rather
// than a second brain.
//
// THE SLOT IDEA
// We are NOT migrating the ShippingMethod enum. Bob Go is an aggregator that
// returns door and pickup-point rates from one call, and those are exactly the
// two shapes the platform already models:
//
//     ShippingMethod.TCG   -> the DOOR slot         (courier to the buyer's address)
//     ShippingMethod.PUDO  -> the PICKUP-POINT slot (buyer collects from a locker)
//
// Every cron filter, consolidation rule, seller UI branch and auto-refund sweep
// already understands those two shapes. Swapping the provider behind them means
// none of that has to change. The cost is that the enum names now describe the
// SHAPE of the delivery rather than the company performing it — hence this
// comment, and the user-facing copy being renamed separately.

import type { ShippingQuote } from './pudo.service';
import type { BobGoRate } from './bobgo.types';

/** The two delivery shapes, named by the enum values they map onto. */
export type CarrierSlot = 'PUDO' | 'TCG';

/** Which slot a Bob Go rate belongs in. */
export function slotForRate(rate: BobGoRate): CarrierSlot {
  return rate.type === 'pickup-point' ? 'PUDO' : 'TCG';
}

/**
 * Bob Go prices in RAND; every price in this codebase is integer CENTS.
 *
 * Math.round, not floor or ceil: a half-cent rounding down would under-collect
 * from the buyer and All Outdoor pays the carrier the real amount, so the
 * shortfall comes out of margin on every single order.
 */
export function randToCents(rand: number): number {
  return Math.round(rand * 100);
}

/**
 * Map a chosen rate into the shared ShippingQuote.
 *
 * OPEN QUESTION, deliberately not papered over: ShippingQuote.priceCents is
 * documented as VAT-INCLUSIVE (it has to match what the buyer is charged), and
 * we have NOT confirmed that Bob Go's total_price includes VAT. Every sandbox
 * quote had total_price === base_rate with zero surcharges and zero liability
 * cover, which tells us nothing either way. If it turns out to be VAT-exclusive
 * this is a ~15% under-collection on every courier sale — so it must be settled
 * against a real invoice before the flag is turned on, not after.
 */
export function rateToQuote(rate: BobGoRate): ShippingQuote {
  return {
    serviceCode: rate.serviceCode,
    serviceName: rate.serviceName,
    priceCents: randToCents(rate.totalPrice),
    providerSlug: rate.providerSlug,
    serviceLevelCode: rate.serviceLevelCode,
    ...(rate.pickupPointLocationId != null
      ? { pickupPointLocationId: rate.pickupPointLocationId }
      : {}),
  };
}

/**
 * Choose the rate to quote for a slot.
 *
 * Door: cheapest, matching what TcgService.getQuote has always done (it sorts
 * ascending on rate and takes the first) — so switching provider does not also
 * silently switch the selection policy.
 *
 * Pickup-point WITH a chosen locker: only a rate that actually delivers to THAT
 * locker will do. Returning a cheaper rate for a different locker would send the
 * parcel somewhere the buyer never picked, so a miss returns null and the caller
 * reports it honestly.
 *
 * Pickup-point WITHOUT a chosen locker: cheapest, then nearest as the tiebreak.
 */
export function selectRateForSlot(
  rates: BobGoRate[],
  slot: CarrierSlot,
  opts: { lockerId?: number } = {},
): BobGoRate | null {
  const inSlot = rates.filter((r) => slotForRate(r) === slot);
  if (inSlot.length === 0) return null;

  if (slot === 'TCG') {
    return [...inSlot].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  }

  if (opts.lockerId != null) {
    const exact = inSlot.filter(
      (r) => r.pickupPointLocationId === opts.lockerId,
    );
    if (exact.length === 0) return null;
    return exact.sort((a, b) => a.totalPrice - b.totalPrice)[0];
  }

  return [...inSlot].sort(
    (a, b) =>
      a.totalPrice - b.totalPrice ||
      (a.pickupPointDistanceKm ?? Infinity) -
        (b.pickupPointDistanceKm ?? Infinity),
  )[0];
}

/**
 * The buyer's pickup-point picker, built from the quote instead of a directory.
 *
 * THE FLOW INVERTS. Today it is "pick a locker, then price it": the buyer
 * searches a cached Pudo directory, chooses a terminal, and only then do we
 * quote it. Bob Go returns pickup points already priced, already carrying their
 * distance, and already bookable — the location id is baked into the
 * serviceCode — so it becomes "quote the route, then pick one of the answers".
 *
 * That is strictly better in one way: every option shown is one Bob Go has
 * confirmed it will actually carry this parcel to, which the Pudo directory
 * could never promise. It is worse in another: the buyer needs a delivery
 * address before seeing any locker, where today they can browse first.
 *
 * Deduped by location, because rates are generated PER LOCATION and the same
 * duplicate seen on /locations (#545 returned twice in one response) shows up
 * here too — dedupeLocations in the client does not cover this path. Cheapest
 * wins per location; ordered nearest-first, which is what a picker wants.
 */
export function pickupPointOptions(rates: BobGoRate[]): BobGoRate[] {
  const best = new Map<number, BobGoRate>();
  for (const r of rates) {
    if (slotForRate(r) !== 'PUDO') continue;
    const id = r.pickupPointLocationId;
    // No location id means nothing to book against and nothing to dedupe on —
    // showing it would give the buyer a choice we cannot honour.
    if (id == null || !Number.isFinite(id)) continue;
    const seen = best.get(id);
    if (!seen || r.totalPrice < seen.totalPrice) best.set(id, r);
  }
  return [...best.values()].sort(
    (a, b) =>
      (a.pickupPointDistanceKm ?? Infinity) -
        (b.pickupPointDistanceKm ?? Infinity) || a.totalPrice - b.totalPrice,
  );
}

// Province long-form mapping is NOT repeated here. shipping.service.ts already
// owns PROVINCE_LONG (:40) and builds every carrier address, and Bob Go's
// `zone` wants the same long form TCG does — a second copy would only drift.
