// Bob Go → the shared carrier-neutral shapes.
//
// Kept in one pure, testable file so the orchestrator gains a call site rather
// than a second brain.
//
// DOOR + PICKUP-POINT SELECTION. Since 2026-09-24 the platform offers three
// buyer options from ONE Bob Go quote: cheapest door, fastest door, and the
// cheapest pickup-point rate (Pargo counters). Pudo lockers and TCG stay
// retired — pickup-point delivery now comes only through Bob Go's Pargo
// network, which the buyer reaches at a nominated counter.
//
// The four pickers below are the whole policy surface; keep them pure so the
// "which option" decision is unit-testable without the orchestrator.

import type { ShippingQuote } from './shipping.types';
import type { BobGoRate } from './bobgo.types';
import { deliveryDaysFor } from './service-levels';

/** True when a Bob Go rate is a door-to-door delivery (not a pickup point). */
export function isDoorRate(rate: BobGoRate): boolean {
  return rate.type !== 'pickup-point';
}

/** Every door rate in a quote. */
export function doorRates(rates: BobGoRate[]): BobGoRate[] {
  return rates.filter(isDoorRate);
}

/** Every pickup-point (counter/locker) rate in a quote. */
export function pickupPointRates(rates: BobGoRate[]): BobGoRate[] {
  return rates.filter((r) => !isDoorRate(r));
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
 * OPEN QUESTION: ShippingQuote.priceCents is documented as VAT-INCLUSIVE (it
 * has to match what the buyer is charged), and we have NOT confirmed that Bob
 * Go's total_price includes VAT. Settle it against a real invoice.
 */
export function rateToQuote(rate: BobGoRate): ShippingQuote {
  return {
    serviceCode: rate.serviceCode,
    serviceName: rate.serviceName,
    priceCents: randToCents(rate.totalPrice),
    providerSlug: rate.providerSlug,
    serviceLevelCode: rate.serviceLevelCode,
  };
}

/**
 * The cheapest door-to-door rate for a route.
 *
 * Bob Go returns every provider's rates in one response; the platform's policy
 * is to charge the buyer the cheapest door option. Returns null when no door
 * rate was quoted (a genuine "we cannot deliver this to that address").
 */
export function cheapestDoorRate(rates: BobGoRate[]): BobGoRate | null {
  const door = rates.filter(isDoorRate);
  if (door.length === 0) return null;
  return [...door].sort((a, b) => a.totalPrice - b.totalPrice)[0];
}

/**
 * The FASTEST door rate: fewest business days from the static service-level
 * lookup, then cheapest as the tie-break. Fastest first means a same-day
 * service (0 days) always wins even if pricier — the buyer explicitly asked
 * for speed. Returns null when no door rate was quoted.
 */
export function fastestDoorRate(rates: BobGoRate[]): BobGoRate | null {
  const door = rates.filter(isDoorRate);
  if (door.length === 0) return null;
  return [...door].sort((a, b) => {
    // The quote's date window is route-specific and therefore beats our
    // fallback lookup whenever Bob Go supplies it. `YYYY-MM-DD` is sortable
    // lexicographically; invalid/missing values fall through to the static
    // service-level days below.
    const aDate = validDateKey(a.minDeliveryDate);
    const bDate = validDateKey(b.minDeliveryDate);
    if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
    if (aDate && !bDate) return -1;
    if (bDate && !aDate) return 1;
    const da = deliveryDaysFor(a.providerSlug, a.serviceLevelCode).min;
    const db = deliveryDaysFor(b.providerSlug, b.serviceLevelCode).min;
    if (da !== db) return da - db;
    return a.totalPrice - b.totalPrice;
  })[0];
}

function validDateKey(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

/**
 * The cheapest pickup-point (Pargo) rate. Returns null when the quote carried
 * no counter/locker option — which is the normal case for a route with no
 * Pargo coverage, not an error.
 */
export function cheapestPickupPointRate(rates: BobGoRate[]): BobGoRate | null {
  const pp = rates.filter((r) => !isDoorRate(r));
  if (pp.length === 0) return null;
  return [...pp].sort((a, b) => a.totalPrice - b.totalPrice)[0];
}
