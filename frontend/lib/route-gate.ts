// ────────────────────────────────────────────────────────────────────
// THE 18+ GATE — route classification.
//
// The site's front door is the age declaration, not a login. Every content
// page is served only to a visitor who carries the `ao_cat` declaration (or a
// member session); a signed-out visitor with neither is sent to `/gate`.
//
// Three classes, checked in this order:
//
//   gate-exempt  — must work for someone who has NOT declared, because the
//                  page IS the gate page, belongs to an auth/credential flow,
//                  or is a statutory/Meta surface that may not be age-walled.
//   member-only  — private data and actions: personal surfaces, the Document
//                  Library, checkout, seller tools. Needs a session, not just
//                  a declaration.
//   content      — everything else: the catalogue, community, tools, legal.
//                  Needs the declaration (a member session also passes).
//
// ⚠️ DEFAULT IS "content", which is the SAFE direction: a newly added route is
// gated until someone deliberately classifies it. The dangerous mistake would
// be defaulting to exempt, where a forgotten route would leak the catalogue to
// an undeclared crawler.
//
// ⚠️ NEVER classify by user-agent, header or IP. The gate is the only door
// and it is the same door for every visitor; that is what keeps this an age
// gate rather than cloaking.
// ────────────────────────────────────────────────────────────────────

/**
 * Paths that must be reachable without an 18+ declaration.
 *
 * `/data-deletion` and `/paia` are the two statutory/Meta carve-outs: Meta's
 * platform requires a publicly-reachable data-deletion instructions page, and
 * PAIA s51 requires the manual to be free to ANY requester. Everything else —
 * legal pages, Terms, Privacy included — is behind the gate.
 */
const GATE_EXEMPT = [
  '/gate',
  '/api',
  '/admin',
  // Auth flows. A member who has not finished signing in is by definition
  // un-declared here; bouncing these to the gate dead-ends the flow.
  '/sign-in',
  '/sign-up',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  // Pre-launch / PWA plumbing.
  '/coming-soon',
  '/preview',
  '/offline',
  '/sw.js',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
  '/security.txt',
  '/.well-known',
  // Credential links sent to people who are not members. The token in the URL
  // is the credential; an age click in front of it breaks the flow (and the
  // pages are already noindex).
  '/a',
  '/t',
  '/witness',
  '/consent',
  '/dealer-portal',
  '/licence-centre/print/book',
  '/scan/handoff',
  '/scan/selftest',
  // Statutory / platform-requirement carve-outs — see the header note.
  '/data-deletion',
  '/paia',
];

/**
 * Paths that need a signed-in member, not just the 18+ declaration.
 *
 * These are private data (a member's own account, orders, messages, vault) or
 * actions that cannot be completed anonymously (buying, selling, verifying).
 * Content does NOT belong here: content is identical for a declared visitor
 * and a member.
 */
const MEMBER_ONLY = [
  '/documents',
  '/account',
  '/settings',
  '/profile',
  '/my',
  '/messages',
  '/notifications',
  '/wishlist',
  '/saved-searches',
  '/orders',
  '/transactions',
  '/offers',
  '/cart',
  '/checkout',
  '/dashboard',
  '/shipping',
  '/value',
  '/kyc',
  '/scan',
  // Community is readable signed-out (Phase 2); the member's own controls and
  // preferences are not.
  '/community/me',
  '/community/settings',
  // The Document Library + Motivation Writer (review sheet, pack, start,
  // interview, vault profile). The Application Tracker INDEX is a content
  // exception above (public tool behind the gate); a saved tracker's detail
  // page is personal and stays here.
  '/licence-centre',
  // Selling is an action, not content.
  '/listings/new',
];

export type RouteGate = 'gate-exempt' | 'member-only' | 'content';

/**
 * Exact paths that would otherwise match a member-only prefix but are
 * actually content.
 *
 * The SAPS Application Tracker's index is a public tool behind the gate: a
 * declared visitor may run one-off checks without an account. A SAVED
 * tracker's detail page (`/licence-centre/tracking/<id>`) is personal data
 * and stays member-only, so this is an exact match, not a prefix.
 */
const CONTENT_EXCEPTIONS = ['/licence-centre/tracking'];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Which wall (if any) a pathname sits behind. */
export function routeGate(pathname: string): RouteGate {
  const path = pathname || '/';
  if (GATE_EXEMPT.some((p) => matches(path, p))) return 'gate-exempt';
  if (CONTENT_EXCEPTIONS.includes(path)) return 'content';
  if (MEMBER_ONLY.some((p) => matches(path, p))) return 'member-only';
  return 'content';
}

/** True when a request carries no gate and no member wall. */
export function isGateExempt(pathname: string): boolean {
  return routeGate(pathname) === 'gate-exempt';
}

export const __testing = { GATE_EXEMPT, MEMBER_ONLY };
