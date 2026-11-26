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
      // Phone capture for the valuation flow — the QR token is the credential.
      '/v/abc123',
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
      '/licence-centre/tracking/abc',
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
      // The seller's own edit surface. `/listings/<id>` itself is content —
      // see the content block below — so this one is pattern-matched, not a
      // prefix.
      '/listings/abc/edit',
      '/listings/abc/edit/',
      // A member's own complaint cases live under the hub.
      '/account/complaints',
    ])('%s', (path) => {
      expect(routeGate(path)).toBe('member-only');
    });

    it('does not treat a prefixed word as member-only', () => {
      expect(routeGate('/accounting')).toBe('content');
      expect(routeGate('/cartography')).toBe('content');
      // The edit pattern must match the whole trailing segment, or a future
      // `/listings/<id>/edit-preview` would silently become member-only.
      expect(routeGate('/listings/abc/edits')).toBe('content');
      expect(routeGate('/listings/edit')).toBe('content');
    });
  });

  describe('content (behind the 18+ gate)', () => {
    it.each([
      '/',
      '/listings/abc',
      // An ended auction's result page is content: every bidder, winner and
      // cancelled-sale recipient gets this link, and it exposes only the same
      // public auction state the PDP did.
      '/listings/abc/result',
      // Only the exact `/edit` segment is a seller action; anything else under
      // a listing stays content.
      '/listings/abc/edit-summary',
      '/listings/abc/result/something',
      '/category/camping-outdoor',
      '/brand/coleman',
      '/brands',
      '/sellers/abc',
      '/community',
      '/community/p/abc',
      '/community/u/someone',
      '/bench',
      // The trackers index is a public tool behind the gate since Phase 2;
      // a SAVED tracker's detail page above stays member-only.
      '/licence-centre/tracking',
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
