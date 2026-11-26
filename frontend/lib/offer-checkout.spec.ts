/**
 * PIN THE TWO DECISIONS THE ACCEPTED-OFFER CHECKOUT MAKES BEFORE IT RENDERS:
 * which credential reads the offer, and whether its payment window has closed.
 *
 * The page itself is a server component under app/, which vitest does not
 * collect — so the deciding logic lives in lib/offer-checkout.ts and this spec
 * is the regression test for the signed-out token flow.
 */
import { describe, expect, it } from 'vitest';
import {
  offerCheckoutSource,
  offerHasExpired,
  settledOfferAmount,
} from './offer-checkout';

describe('which credential reads an accepted offer', () => {
  it('uses the session when the buyer is signed in', () => {
    expect(offerCheckoutSource({ signedIn: true })).toBe('session');
    expect(offerCheckoutSource({ signedIn: true, actionToken: 'tok' })).toBe(
      'session',
    );
  });

  it('uses the CHECKOUT token for a signed-out buyer carrying one', () => {
    expect(offerCheckoutSource({ signedIn: false, actionToken: 'tok' })).toBe(
      'token',
    );
  });

  it('sends a signed-out buyer with no token to sign-in', () => {
    expect(offerCheckoutSource({ signedIn: false })).toBe('sign-in');
    expect(offerCheckoutSource({ signedIn: false, actionToken: null })).toBe(
      'sign-in',
    );
    expect(offerCheckoutSource({ signedIn: false, actionToken: '' })).toBe(
      'sign-in',
    );
  });
});

describe('what an accepted offer settles at', () => {
  it('prefers the seller counter', () => {
    expect(settledOfferAmount({ offerAmount: 150_000, counterAmount: 140_000 })).toBe(
      140_000,
    );
  });

  it('falls back to the buyer offer', () => {
    expect(settledOfferAmount({ offerAmount: 150_000, counterAmount: null })).toBe(
      150_000,
    );
    expect(settledOfferAmount({ offerAmount: 150_000 })).toBe(150_000);
  });
});

describe('the accepted-offer payment window', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z');

  it('is expired once the deadline has passed', () => {
    expect(offerHasExpired('2026-11-25T11:59:59.000Z', now)).toBe(true);
  });

  it('is live right up to the deadline', () => {
    expect(offerHasExpired('2026-11-25T12:00:00.000Z', now)).toBe(false);
    expect(offerHasExpired('2026-11-25T12:00:01.000Z', now)).toBe(false);
  });

  it('treats a missing or malformed deadline as live (the server decides)', () => {
    expect(offerHasExpired(null, now)).toBe(false);
    expect(offerHasExpired(undefined, now)).toBe(false);
    expect(offerHasExpired('not-a-date', now)).toBe(false);
  });
});
