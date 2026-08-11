import { redirect, permanentRedirect } from 'next/navigation';

// /firearms-compliance — RETIRED PUBLIC ROUTE.
//
// The document moved to /members/regulated-items (the Regulated Items Annex)
// when regulated categories became members-only. The URL itself was part of
// the problem: it appears as an href on every page via the footer, in the
// sitemap and in Google's index, so "firearms" was a word a crawler read on
// the homepage regardless of what the page body said.
//
// Kept as a 308 rather than deleted because the old URL is indexed and may be
// bookmarked or linked from outbound emails. The target is sign-in gated, so
// an anonymous follower lands on /sign-in and a member lands on the document.
//
// The route stays OUT of isPublicRoute and OUT of sitemap.ts — a redirect to a
// gated page should not be advertised to crawlers.
export default function FirearmsComplianceRedirect(): never {
  // permanentRedirect issues a 308 so search engines transfer and then drop
  // the old URL; fall back to a 307 on older Next runtimes.
  if (typeof permanentRedirect === 'function') {
    permanentRedirect('/members/regulated-items');
  }
  redirect('/members/regulated-items');
}
