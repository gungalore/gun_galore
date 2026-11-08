import { describe, expect, it } from 'vitest';
import {
  RECENT_INPUT_MS,
  isAutoApplySafePath,
  shouldAutoApplyOnHide,
  typedRecently,
} from './sw-update-policy';

// This list is the guard that lets a service-worker update reload a page with
// no prompt. Every denial here is a route where a reload would destroy work, so
// the tests are written route-by-route rather than as a single assertion: a
// regex edited too broadly (say, denying every /listings/* path and killing the
// feature on the PDP) has to fail something.

describe('isAutoApplySafePath — allowed surfaces', () => {
  it.each([
    '/',
    '/listings',
    '/listings/cmvjgomeu00sd3gvn0zzmyzy0',
    '/my/listings',
    '/category/firearms',
    '/brand/glock',
    '/sellers/abc',
    '/orders/cmvj',
    '/my/orders',
    '/transactions/cmvj',
    '/wishlist',
    '/community',
    '/notifications',
    '/saved-searches',
    '/faq',
  ])('allows %s', (path) => {
    expect(isAutoApplySafePath(path)).toBe(true);
  });
});

describe('isAutoApplySafePath — denied surfaces', () => {
  it.each([
    '/checkout',
    '/checkout/offer/abc',
    '/checkout/resume/cmvj',
    '/listings/new',
    '/listings/new?step=2',
    '/listings/cmvjgomeu00sd3gvn0zzmyzy0/edit',
    '/licence-centre',
    '/licence-centre/cmvj',
    '/value',
    '/scan',
    '/scan/capture',
    '/sign-in',
    '/sign-up',
    '/verify-phone',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
    '/a/abcDEF123',
    '/witness/abc',
    '/v/token123',
    '/consent',
    '/kyc',
    '/admin',
    '/admin/insights',
    '/messages',
    '/settings',
    '/profile',
    '/profile/edit',
    '/account',
    '/report-a-bug',
    '/dealer-portal',
    '/documents',
    '/preview',
  ])('denies %s', (path) => {
    expect(isAutoApplySafePath(path)).toBe(false);
  });
});

describe('isAutoApplySafePath — edges', () => {
  it('treats a missing or malformed pathname as unsafe', () => {
    expect(isAutoApplySafePath(null)).toBe(false);
    expect(isAutoApplySafePath(undefined)).toBe(false);
    expect(isAutoApplySafePath('')).toBe(false);
    // No leading slash: not a route we can reason about.
    expect(isAutoApplySafePath('listings/new')).toBe(false);
  });

  it('does not over-match by prefix', () => {
    // /checkout-ish but a different route.
    expect(isAutoApplySafePath('/checkout-complete-guide')).toBe(true);
    // /listings/.../edits is not the edit form.
    expect(isAutoApplySafePath('/listings/abc/edits')).toBe(true);
    // /accounting is not /account.
    expect(isAutoApplySafePath('/accounting')).toBe(true);
    // /value-guide is not /value.
    expect(isAutoApplySafePath('/value-guide')).toBe(true);
    // /listings/new-ish but a real listing id.
    expect(isAutoApplySafePath('/listings/newcastle')).toBe(true);
  });
});

describe('typedRecently', () => {
  it('blocks while the input is fresh', () => {
    const now = 1_000_000;
    expect(typedRecently(now, now)).toBe(true);
    expect(typedRecently(now - RECENT_INPUT_MS + 1, now)).toBe(true);
  });

  it('releases once the window has passed', () => {
    const now = 1_000_000;
    expect(typedRecently(now - RECENT_INPUT_MS, now)).toBe(false);
    expect(typedRecently(now - RECENT_INPUT_MS - 1, now)).toBe(false);
  });

  it('treats "never typed" as not recent', () => {
    expect(typedRecently(0)).toBe(false);
    expect(typedRecently(null)).toBe(false);
    expect(typedRecently(undefined)).toBe(false);
    expect(typedRecently(Number.NaN)).toBe(false);
  });

  it('does not block forever on a future timestamp', () => {
    const now = 1_000_000;
    expect(typedRecently(now + 60_000, now)).toBe(false);
  });
});

describe('shouldAutoApplyOnHide', () => {
  const base = {
    pathname: '/listings',
    visibility: 'hidden',
    lastInputAt: 0,
    alreadyApplied: false,
    now: 1_000_000,
  } as const;

  it('applies on a safe route, hidden, with no recent input', () => {
    expect(shouldAutoApplyOnHide({ ...base })).toBe(true);
  });

  it('never applies while the page is visible', () => {
    expect(shouldAutoApplyOnHide({ ...base, visibility: 'visible' })).toBe(false);
  });

  it('never applies on an unsafe route', () => {
    expect(
      shouldAutoApplyOnHide({ ...base, pathname: '/checkout' }),
    ).toBe(false);
    expect(
      shouldAutoApplyOnHide({ ...base, pathname: '/listings/new' }),
    ).toBe(false);
  });

  it('never applies twice', () => {
    expect(shouldAutoApplyOnHide({ ...base, alreadyApplied: true })).toBe(false);
  });

  it('defers when the member typed within the window', () => {
    expect(
      shouldAutoApplyOnHide({ ...base, lastInputAt: base.now - 5_000 }),
    ).toBe(false);
  });

  it('applies once the typing is old enough', () => {
    expect(
      shouldAutoApplyOnHide({
        ...base,
        lastInputAt: base.now - RECENT_INPUT_MS,
      }),
    ).toBe(true);
  });
});
