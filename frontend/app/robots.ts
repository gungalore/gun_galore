import type { MetadataRoute } from 'next';

// Generated /robots.txt.
//
// ── WHY THIS FILE NOW DISALLOWS EVERYTHING ──────────────────────────────
//
// The site sits behind a one-tap 18+ age gate (see lib/route-gate.ts and
// middleware.ts). Every content URL redirects a visitor without the `ao_cat`
// declaration to /gate, so a search-engine crawler can never see a listing, a
// category or the community — and a sitemap of gated URLs would be a list of
// soft-404s. Indexing of content therefore ends by design: the protection
// against platform crawlers is the gate itself, not a crawl allow-list.
//
// ⚠️ META IS NOT DETERRED BY ROBOTS.TXT. Its link-preview fetcher ignores
// this file and does fetch shared URLs; what it receives is the neutral gate
// page (no listing title, no photo, no category) because it does not click.
// That is the mechanism — never a user-agent branch in the app.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
  };
}
