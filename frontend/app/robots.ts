import type { MetadataRoute } from 'next';

// Generated /robots.txt — tells crawlers what to index and points at
// the sitemap. Lighthouse SEO audit flagged the missing file. The
// values here mirror what we want public Google results to surface:
//
//   - Allow: marketplace, auctions, take-a-shot, listing detail pages,
//     legal docs, the homepage. These are the SEO surface.
//   - Disallow: admin console (sensitive), the JSON API (no crawlable
//     content), checkout (per-user prices/addresses, no SEO value),
//     KYC + sign-in/up flows (auth-gated), the /offline PWA fallback
//     (would show up as a duplicate of every real page otherwise),
//     and the /a/* admin acceptance pages.
//
// The canonical host comes from NEXT_PUBLIC_SITE_URL — fallback to
// production so local builds still emit usable robots.txt content.

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
  'https://gungalore.co.za';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin/',
          '/api/',
          '/checkout/',
          '/kyc/',
          '/sign-in/',
          '/sign-up/',
          '/sso-callback/',
          '/a/', // token-gated single-action pages
          // ⚠️ PUBLIC BY DESIGN, AND IT NAMES A FIREARM LICENCE APPLICATION.
          // /witness/* cannot be auth-walled — the person opening it is a
          // stranger who followed an SMS link, and a 307 to sign-in reads as a
          // suspicious link rather than a login prompt (middleware.ts). But the
          // page says "Character statement for a firearm licence application",
          // so it must not be crawlable. The token in the path makes each URL
          // unguessable; this stops the route itself being indexed.
          '/witness/',
          '/offline',
          '/preview/',
          // Members area — regulated-item terms and anything else that only
          // exists behind sign-in. Belt and braces: these routes already 307
          // to /sign-in via middleware, but a Disallow keeps them out of the
          // crawl budget and out of "indexed, though blocked" reports.
          '/members/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
