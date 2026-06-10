import type { MetadataRoute } from 'next';

// AUDIT M30 — emit a sitemap so search engines can find and index the
// marketplace pages. Listed BY URL pattern, not every listing — for a
// growing listing set we'd ideally hit the backend and emit a real
// per-listing entry. For now we ship the static-route set that exists
// today, which is enough to give Google a stable entry point for each
// public surface. Dynamic listing pages are reachable via internal links
// from the homepage and from the categories/marketplace pages.

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
  'https://gungalore.co.za';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // Top-of-funnel pages that should always rank first.
  const top: Array<{ url: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly' }> = [
    { url: '/', priority: 1.0, changeFrequency: 'daily' },
    { url: '/competitions', priority: 0.8, changeFrequency: 'weekly' },
    { url: '/wishlist', priority: 0.4, changeFrequency: 'weekly' },
  ];
  // Legal — important for trust and (for an SA marketplace) for ECT § 43
  // discoverability.
  const legal = [
    '/terms',
    '/privacy',
    '/aml-policy',
    '/refund-policy',
    '/acceptable-use',
    '/firearms-compliance',
    '/cookies',
    '/legal',
  ].map((u) => ({ url: u, priority: 0.3, changeFrequency: 'yearly' as const }));

  return [...top, ...legal].map(({ url, priority, changeFrequency }) => ({
    url: `${SITE_URL}${url}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
