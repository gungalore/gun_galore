/**
 * THE ONLY PLACE THE SERVICE WORKER'S FALLBACK RULE CAN BE TESTED.
 *
 * vitest's include is ['lib/**\/*.spec.ts', 'components/**\/*.spec.tsx'] —
 * nothing under app/ is collected at all, so a rule written inline in
 * app/sw.ts is a rule no suite can ever fail on. That is why app/sw.ts is a
 * thin adapter over lib/sw-offline.ts and why this file exists.
 *
 * ⚠️ WHAT THIS SUITE CANNOT DO. It pins the DECISION — which document answers
 * which failed request. It cannot prove serwist then serves it: that needs an
 * installed service worker, a real precache and a browser with the network
 * off.
 */
import { describe, expect, it } from 'vitest';
import { SHOP_OFFLINE_URL, shopOfflineFallbackApplies } from './sw-offline';

describe('which stand-in answers a failed navigation', () => {
  it('leaves the shop to the shop', () => {
    for (const path of ['/', '/listings/abc', '/documents', '/bench', '/community']) {
      expect(shopOfflineFallbackApplies('document', path), path).toBe(true);
    }
  });

  it('gives the token, money, identity and auth paths nothing', () => {
    // Not an oversight and not a gap: a stand-in page invites a retry against
    // a single-use token, and one over a sign-in form is a form somebody fills
    // in while the API is unreachable.
    for (const path of [
      '/a/abc123',
      '/checkout',
      '/preview/xyz',
      '/kyc',
      '/sign-in',
      '/sign-up',
      '/verify-email',
      '/forgot-password',
      '/reset-password',
    ]) {
      expect(shopOfflineFallbackApplies('document', path), path).toBe(false);
    }
  });

  it('keeps the shop page off the admin prefix, by the bare prefix', () => {
    // The stricter form (=== '/admin' || startsWith('/admin/')) would leave
    // /admin-anything with no stand-in at all. Kept for the rebuilt Desk.
    for (const path of ['/admin', '/admin/desk', '/admin-anything']) {
      expect(shopOfflineFallbackApplies('document', path), path).toBe(false);
    }
  });

  it('answers nothing that is not a document', () => {
    // ⚠️ A FALLBACK PLUGIN IS ATTACHED TO EVERY RUNTIME STRATEGY, not only the
    // navigation one — serwist pushes it onto each handler in runtimeCaching.
    // Without the destination test a failed image would be answered with HTML.
    for (const destination of ['image', 'script', 'style', 'font', '']) {
      expect(shopOfflineFallbackApplies(destination, '/')).toBe(false);
    }
  });

  it('names the document it routes to', () => {
    expect(SHOP_OFFLINE_URL).toBe('/offline');
  });
});
