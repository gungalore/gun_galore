import { describe, it, expect } from 'vitest';
import { routeGate } from './route-gate';

// The 18+ gate's route classification. The dangerous failure is a route
// classified too loosely: a content page treated as exempt is served to a
// crawler without the gate. These tests pin the three classes and — more
// importantly — the PREFIX BOUNDARIES, because '/t' (credential redirects)
// must never swallow '/terms'.
describe('routeGate — the 18+ gate classes', () => {
  describe('gate-exempt (reachable without declaring)', () => {
    it.each([
      '/gate',
      '/api/listings',
      '/admin/money',
      '/sign-in',
      '/sign-up',
      '/verify-email',
      '/forgot-password',
      '/reset-password',
      '/offline',
      '/robots.txt',
      '/sitemap.xml',
      '/security.txt',
      '/.well-known/security.txt',
      '/coming-soon',
      // Credential links sent to non-members.
      '/a/abc123',
      '/t/abc123',
      '/witness/tok',
      '/consent/tok',
      '/dealer-portal/tok',
      '/licence-centre/print/book/tok',
      '/scan/handoff',
      '/scan/selftest',
      // Statutory / platform-requirement carve-outs.
      '/data-deletion',
      '/paia',
    ])('%s', (path) => {
      expect(routeGate(path)).toBe('gate-exempt');
    });

    it('does not swallow /terms via the /t credential prefix', () => {
      expect(routeGate('/terms')).toBe('content');
      expect(routeGate('/terms#payments')).toBe('content');
    });
  });

  describe('member-only (needs a signed-in account, not just the declaration)', () => {
    it.each([
      '/documents',
      '/licence-centre',
      '/licence-centre/applications',
      '/licence-centre/tracking',
      '/account',
      '/settings',
      '/profile',
      '/my/orders',
      '/messages',
      '/notifications',
      '/wishlist',
      '/saved-searches',
      '/orders/abc',
      '/transactions/abc',
      '/offers',
      '/cart',
      '/checkout/listing1',
      '/dashboard',
      '/shipping',
      '/value',
      '/kyc/verify',
      '/community/me',
      '/community/settings',
      '/listings/new',
    ])('%s', (path) => {
      expect(routeGate(path)).toBe('member-only');
    });

    it('does not treat a prefixed word as member-only', () => {
      expect(routeGate('/accounting')).toBe('content');
      expect(routeGate('/cartography')).toBe('content');
    });
  });

  describe('content (behind the 18+ gate)', () => {
    it.each([
      '/',
      '/listings/abc',
      '/category/camping-outdoor',
      '/brand/coleman',
      '/brands',
      '/sellers/abc',
      '/community',
      '/community/p/abc',
      '/community/u/someone',
      '/bench',
      '/motivation',
      '/faq',
      '/terms',
      '/privacy',
      '/legal',
      '/regions/unknown', // anything unclassified is gated by default
      '/members/regulated-items',
    ])('%s', (path) => {
      expect(routeGate(path)).toBe('content');
    });
  });
});
