/**
 * THE ONLY PLACE THE SERVICE WORKER'S CACHE-EXCLUSION RULES CAN BE TESTED.
 *
 * vitest's include is ['lib/**\/*.spec.ts', 'components/**\/*.spec.tsx'] —
 * nothing under app/ is collected, so a rule written inside app/sw.ts is a rule
 * no suite can ever fail on. app/sw.ts is a thin adapter over
 * lib/sw-caching.ts, and this file is what makes the critical finding
 * ("member HTML cached by the worker") a regression test rather than a
 * paragraph in a code review.
 *
 * ⚠️ WHAT THIS SUITE CANNOT DO. It pins the DECISIONS — which requests may
 * never be cached, which cache names a sign-out deletes. It cannot prove an
 * installed worker then obeys them; that needs a browser with the SW active.
 * Still, every rule that could be written wrong (a bare startsWith, a missing
 * prefix, wrapping the matcher so it never matches anything) is a pure
 * function, and pure functions are exactly what this suite can hold.
 */
import { describe, expect, it } from 'vitest';
import type { RouteMatchCallbackOptions, RuntimeCaching } from 'serwist';
import {
  cacheNamesToPurgeOnSignOut,
  excludeUncacheableRequests,
  isDocumentRequest,
  isPrivatePath,
  mustAlwaysUseNetwork,
} from './sw-caching';

function optionsFor(
  pathname: string,
  request: { mode?: string; destination?: string } = {},
): RouteMatchCallbackOptions {
  return {
    request,
    url: new URL(`https://alloutdoor.co.za${pathname}`),
    sameOrigin: true,
    event: undefined,
  } as unknown as RouteMatchCallbackOptions;
}

describe('documents are never cached by the service worker', () => {
  it('recognises a navigation by mode or destination', () => {
    expect(isDocumentRequest({ mode: 'navigate' })).toBe(true);
    expect(isDocumentRequest({ destination: 'document' })).toBe(true);
    // A reconstructed request can carry either signal alone; both win.
    expect(isDocumentRequest({ mode: 'navigate', destination: 'document' })).toBe(
      true,
    );
  });

  it('leaves sub-resources alone', () => {
    for (const destination of ['image', 'script', 'style', 'font', '']) {
      expect(isDocumentRequest({ mode: 'cors', destination })).toBe(false);
    }
  });

  it('routes every document request to the network', () => {
    for (const path of ['/', '/listings/abc', '/category/camping-outdoor']) {
      expect(
        mustAlwaysUseNetwork({ mode: 'navigate', pathname: path }),
        path,
      ).toBe(true);
    }
  });
});

describe('private paths are never cached', () => {
  it('takes the member-only list from route-gate (one table, one place)', () => {
    for (const path of [
      '/account',
      '/account/complaints',
      '/my/orders',
      '/my/offers',
      '/transactions/tx1',
      '/messages',
      '/notifications',
      '/documents',
      '/cart',
      '/settings',
      '/profile',
      '/dashboard',
      '/wishlist',
      '/saved-searches',
      '/offers/received',
      '/shipping',
      '/value',
      '/community/me',
      '/community/settings',
      '/licence-centre/applications',
      '/listings/abc/edit',
    ]) {
      expect(isPrivatePath(path), path).toBe(true);
    }
  });

  it('adds the auth, money, identity and token paths route-gate cannot classify as private', () => {
    for (const path of [
      '/gate',
      '/kyc/verify',
      '/checkout/listing1',
      '/checkout/offer/offer1',
      '/sign-in',
      '/sign-up',
      '/verify-email',
      '/forgot-password',
      '/reset-password',
      // Single-use credentials carried in the URL.
      '/a/tok',
      '/t/code',
      '/v/tok',
      '/witness/tok',
      '/consent/tok',
      '/dealer-portal/tok',
      '/licence-centre/print/book/tok',
      '/scan/handoff',
      '/scan/selftest',
      '/api/listings',
    ]) {
      expect(isPrivatePath(path), path).toBe(true);
    }
  });

  it('keeps the public catalogue and the offline stand-in cacheable', () => {
    // ⚠️ /offline MUST NOT be private: it is precached so a failed navigation
    // has something to render with no network.
    for (const path of [
      '/',
      '/listings/abc',
      '/category/camping-outdoor',
      '/community',
      '/bench',
      '/offline',
      '/terms',
    ]) {
      expect(isPrivatePath(path), path).toBe(false);
    }
  });

  it('matches full segments, not bare prefixes', () => {
    // '/t' must not swallow '/terms'; '/account' must not swallow
    // '/accounting'; '/v' must not swallow '/verify-email'.
    expect(isPrivatePath('/terms')).toBe(false);
    expect(isPrivatePath('/accounting')).toBe(false);
    expect(isPrivatePath('/verify-email')).toBe(true); // named explicitly, not via /v
    expect(isPrivatePath('/values')).toBe(false);
    expect(isPrivatePath('/a')).toBe(true);
    expect(isPrivatePath('/ab')).toBe(false);
  });
});

describe('defaultCache matchers are wrapped so they can never store a document or private page', () => {
  function stubEntries(): RuntimeCaching[] {
    return [
      // The generic same-origin catch-all that caused the finding.
      { matcher: /.*/, handler: {} as never },
      // A function matcher — the shape serwist's own page / API rules use.
      {
        matcher: () => true,
        handler: {} as never,
      },
    ] as unknown as RuntimeCaching[];
  }

  it('refuses a document even when the wrapped matcher would match everything', () => {
    const [catchAll] = excludeUncacheableRequests(stubEntries());
    const matcher = catchAll.matcher as (o: RouteMatchCallbackOptions) => boolean;
    expect(matcher(optionsFor('/account', { mode: 'navigate' }))).toBe(false);
    expect(matcher(optionsFor('/', { mode: 'navigate' }))).toBe(false);
  });

  it('refuses a private path requested as a sub-resource', () => {
    const [catchAll, fnMatcher] = excludeUncacheableRequests(stubEntries());
    for (const entry of [catchAll, fnMatcher]) {
      const matcher = entry.matcher as (o: RouteMatchCallbackOptions) => boolean;
      expect(matcher(optionsFor('/account'))).toBe(false);
      expect(matcher(optionsFor('/transactions/tx1'))).toBe(false);
      expect(matcher(optionsFor('/checkout/listing1'))).toBe(false);
    }
  });

  it('keeps matching ordinary cacheable assets the original matcher accepted', () => {
    // The wrapper must exclude, not disable: breaking this would silently turn
    // the whole PWA cache off.
    const [catchAll, fnMatcher] = excludeUncacheableRequests(stubEntries());
    const catchAllMatcher = catchAll.matcher as (
      o: RouteMatchCallbackOptions,
    ) => boolean;
    const fnMatcherMatcher = fnMatcher.matcher as (
      o: RouteMatchCallbackOptions,
    ) => boolean;
    expect(catchAllMatcher(optionsFor('/listings/abc'))).toBe(true);
    expect(fnMatcherMatcher(optionsFor('/_next/static/chunk.js'))).toBe(true);
  });

  it('preserves the original RegExp semantics and the entry method', () => {
    const entries = [
      { matcher: /\.(?:png|jpg)$/i, method: 'GET' as const, handler: {} as never },
    ] as unknown as RuntimeCaching[];
    const wrapped = excludeUncacheableRequests(entries)[0];
    expect(wrapped.method).toBe('GET');
    const matcher = wrapped.matcher as (o: RouteMatchCallbackOptions) => boolean;
    expect(matcher(optionsFor('/icon-192.png'))).toBe(true);
    expect(matcher(optionsFor('/robots.txt'))).toBe(false);
  });
});

describe('sign-out purges the caches that can hold member HTML', () => {
  it('names the page/API caches by their serwist prefix and scope', () => {
    const names = [
      'serwist-precache-v2-https://alloutdoor.co.za',
      'serwist-pages-https://alloutdoor.co.za',
      'serwist-pages-rsc-https://alloutdoor.co.za',
      'serwist-pages-rsc-prefetch-https://alloutdoor.co.za',
      'serwist-others-https://alloutdoor.co.za',
      'serwist-apis-https://alloutdoor.co.za',
      'serwist-next-data-https://alloutdoor.co.za',
      'serwist-static-data-assets-https://alloutdoor.co.za',
      'serwist-cross-origin-https://alloutdoor.co.za',
      'serwist-gg-cloudinary-images-https://alloutdoor.co.za',
    ];
    expect(cacheNamesToPurgeOnSignOut(names)).toEqual([
      'serwist-pages-https://alloutdoor.co.za',
      'serwist-pages-rsc-https://alloutdoor.co.za',
      'serwist-pages-rsc-prefetch-https://alloutdoor.co.za',
      'serwist-others-https://alloutdoor.co.za',
      'serwist-apis-https://alloutdoor.co.za',
      'serwist-next-data-https://alloutdoor.co.za',
      'serwist-static-data-assets-https://alloutdoor.co.za',
      'serwist-cross-origin-https://alloutdoor.co.za',
    ]);
  });

  it('never deletes the offline precache', () => {
    expect(
      cacheNamesToPurgeOnSignOut([
        'serwist-precache-v2-https://alloutdoor.co.za',
      ]),
    ).toEqual([]);
  });

  it('leaves the image caches, which hold no private data', () => {
    expect(
      cacheNamesToPurgeOnSignOut([
        'serwist-gg-cloudinary-images-https://alloutdoor.co.za',
        'serwist-gg-next-images-https://alloutdoor.co.za',
        'serwist-gg-brand-assets-https://alloutdoor.co.za',
      ]),
    ).toEqual([]);
  });
});
