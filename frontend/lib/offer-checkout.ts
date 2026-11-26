/**
 * HOW THE ACCEPTED-OFFER CHECKOUT FINDS ITS OFFER.
 *
 * Three cases, and the order between them is the whole point:
 *
 *   session — a signed-in member. Unchanged behaviour: their own Bearer token
 *             reads GET /offers/:id. A `?t=` on the URL is IGNORED here on
 *             purpose — a member who opens the SMS link still gets their
 *             signed-in view, including the live offer status.
 *   token   — signed out, but the URL carries the CHECKOUT action token that
 *             the "your offer was accepted" SMS/email contains. That token is
 *             the credential; today the page bounced these buyers to /sign-in,
 *             which is a dead end for somebody who received the link on a
 *             phone that is not signed in. Read through
 *             GET /actions/:token/offer-checkout instead.
 *   sign-in — neither. Nothing authorises a private offer, so bounce to
 *             sign-in with a return path (as the page always did).
 *
 * It is a pure function so lib/offer-checkout.spec.ts can pin the precedence:
 * getting these two wrong in the other order would either leak an offer read
 * to an anonymous request or silently break the signed-in page.
 */

export type OfferCheckoutSource = 'session' | 'token' | 'sign-in';

export function offerCheckoutSource(input: {
  signedIn: boolean;
  actionToken?: string | null;
}): OfferCheckoutSource {
  if (input.signedIn) return 'session';
  return input.actionToken ? 'token' : 'sign-in';
}

/** The price an accepted offer settles at: the seller's counter if there was one. */
export function settledOfferAmount(offer: {
  offerAmount: number;
  counterAmount?: number | null;
}): number {
  return offer.counterAmount ?? offer.offerAmount;
}

/**
 * Has the 24-hour payment window on an accepted offer already closed?
 *
 * The backend sweeps EXPIRED offers on a 10-minute cron, so a buyer can load
 * this page in the gap. Refusing here means they are never asked to enter card
 * details for a purchase the server will reject on submit — the same check the
 * date-bearing page has always made.
 *
 * A malformed/absent deadline is treated as NOT expired: refusing a live offer
 * over a missing timestamp would be the worse failure, and the server is the
 * final authority on payability.
 */
export function offerHasExpired(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!expiresAt) return false;
  const deadline = new Date(expiresAt).getTime();
  if (!Number.isFinite(deadline)) return false;
  return deadline < now;
}
