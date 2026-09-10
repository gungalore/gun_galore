import { describe, it, expect } from 'vitest';
import { routeMatcher } from './route-matcher';

// A representative slice of the real public-route list in middleware.ts,
// picked for the shapes rather than the coverage: a wildcard suffix, a bare
// path, a path containing a dot, and a trailing-slash wildcard.
const isPublic = routeMatcher([
  '/scan/handoff(.*)',
  '/sign-in(.*)',
  '/',
  '/marketplace',
  '/admin(.*)',
  '/offline',
  '/sw.js',
  '/a/(.*)',
  '/.well-known/(.*)',
  '/sitemap.xml',
]);

describe('routeMatcher — what a signed-out visitor may see', () => {
  it('matches a wildcard suffix, with or without anything after it', () => {
    expect(isPublic('/scan/handoff')).toBe(true);
    expect(isPublic('/scan/handoff/abc')).toBe(true);
    expect(isPublic('/sign-in')).toBe(true);
    expect(isPublic('/sign-in/factor-one')).toBe(true);
    expect(isPublic('/admin')).toBe(true);
    expect(isPublic('/admin/desk/site')).toBe(true);
  });

  it('matches a bare path ONLY as itself', () => {
    expect(isPublic('/')).toBe(true);
    expect(isPublic('/marketplace')).toBe(true);
    // No implicit wildcard. /marketplace being public must not make every
    // path beneath it public too.
    expect(isPublic('/marketplace/firearms')).toBe(false);
  });

  // ⚠️ Without escaping, `.` is "any character" and /sw.js quietly publishes
  // /swXjs as well. Harmless there; the same bug on /sitemap.xml or a future
  // pattern is not.
  it('treats a dot as a literal dot', () => {
    expect(isPublic('/sw.js')).toBe(true);
    expect(isPublic('/swXjs')).toBe(false);
    expect(isPublic('/sitemap.xml')).toBe(true);
    expect(isPublic('/sitemapAxml')).toBe(false);
  });

  it('honours a trailing-slash wildcard exactly', () => {
    expect(isPublic('/a/abc')).toBe(true);
    expect(isPublic('/a/')).toBe(true);
    // The pattern is '/a/(.*)' — the slash is part of it.
    expect(isPublic('/a')).toBe(false);
    expect(isPublic('/.well-known/security.txt')).toBe(true);
  });

  // The half that matters. Every one of these is behind the auth wall, and
  // the members-only catalogue is what the wall exists for.
  it('does NOT match members-only routes', () => {
    for (const path of [
      '/dashboard',
      '/listings/123',
      '/kyc/verify',
      '/bench',
      '/licence-centre',
      '/profile/edit',
      '/category/firearms',
      '/scan',
    ]) {
      expect(isPublic(path), path).toBe(false);
    }
  });

  // ⚠️ A WILDCARD DOES NOT STOP AT A PATH SEGMENT, and this is inherited
  // behaviour, not a new bug: '/admin(.*)' matches '/administrivia' as surely
  // as '/admin/desk'. It is harmless for the patterns we have — everything
  // under /admin is meant to be reachable, since admin runs its own JWT — but
  // it is the shape to remember before adding a short prefix to the list.
  // '/deal(.*)' would quietly publish '/dealer-transfers'.
  it('lets a wildcard run past the segment boundary', () => {
    expect(isPublic('/administrivia')).toBe(true);
  });

  it('anchors at both ends', () => {
    expect(isPublic('/prefix/marketplace')).toBe(false);
    expect(isPublic('/marketplacex')).toBe(false);
  });
});
