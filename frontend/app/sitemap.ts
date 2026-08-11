import type { MetadataRoute } from 'next';
import { apiFetch } from '@/lib/api';
import type { Category, BrandSummary } from '@/lib/types';

// Emits a real sitemap: the static top-of-funnel + legal routes PLUS every
// PUBLICLY-VISIBLE ACTIVE listing and category landing page, so Google can
// crawl the money pages directly instead of relying on internal links alone.
//
// LOAD-BEARING: every fetch below uses apiFetch (anonymous), NEVER viewerFetch.
// The backend returns members-only categories/listings/brands only to a caller
// holding a session, so staying anonymous is exactly what keeps regulated
// stock out of the sitemap. Adding a token here would re-publish the firearm
// taxonomy to every crawler — which is how 111 of 207 URLs were weapon-adjacent
// before this change. `revalidate` is safe for the same reason: there is only
// one audience for this file.

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
  'https://gungalore.co.za';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const top: Array<{
    url: string;
    priority: number;
    changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  }> = [
    { url: '/', priority: 1.0, changeFrequency: 'daily' },
    { url: '/about', priority: 0.5, changeFrequency: 'monthly' },
    { url: '/faq', priority: 0.5, changeFrequency: 'monthly' },
    { url: '/how-selling-works', priority: 0.5, changeFrequency: 'monthly' },
    { url: '/how-payments-work', priority: 0.5, changeFrequency: 'monthly' },
    { url: '/fees', priority: 0.5, changeFrequency: 'monthly' },
    { url: '/brands', priority: 0.5, changeFrequency: 'weekly' },
    { url: '/contact', priority: 0.4, changeFrequency: 'monthly' },
    { url: '/support', priority: 0.4, changeFrequency: 'monthly' },
    { url: '/complaints', priority: 0.4, changeFrequency: 'monthly' },
  ];

  const legal = [
    '/terms',
    '/privacy',
    '/aml-policy',
    '/refund-policy',
    '/acceptable-use',
    // '/firearms-compliance' deliberately ABSENT — it is the members-only
    // Regulated Items Annex now (see /members/regulated-items). A sign-in-walled
    // URL in a sitemap reads as broken to a crawler and to a bank reviewer.
    '/cookies',
    '/paia',
    '/legal',
  ].map((u) => ({ url: u, priority: 0.3, changeFrequency: 'yearly' as const }));

  // Dynamic entries — fetched from the API; fall back to the static set if
  // the backend is unreachable at build/revalidate time.
  const [listings, categories, brands] = await Promise.all([
    // Anonymous by design — see the file header.
    apiFetch<{ id: string; updatedAt: string }[]>('/listings/sitemap', {
      next: { revalidate: 3600 },
    } as RequestInit).catch(() => [] as { id: string; updatedAt: string }[]),
    apiFetch<Category[]>('/categories', {
      next: { revalidate: 3600 },
    } as RequestInit).catch(() => [] as Category[]),
    // P5.7 — only brands that clear the min-listings gate get a page + entry.
    apiFetch<BrandSummary[]>('/listings/brand-index', {
      next: { revalidate: 3600 },
    } as RequestInit).catch(() => [] as BrandSummary[]),
  ]);

  const staticEntries: MetadataRoute.Sitemap = [...top, ...legal].map(
    ({ url, priority, changeFrequency }) => ({
      url: `${SITE_URL}${url}`,
      lastModified: now,
      changeFrequency,
      priority,
    }),
  );

  const categoryEntries: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${SITE_URL}/category/${c.slug}`,
    lastModified: now,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  const listingEntries: MetadataRoute.Sitemap = listings.map((l) => ({
    url: `${SITE_URL}/listings/${l.id}`,
    lastModified: l.updatedAt ? new Date(l.updatedAt) : now,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  const brandEntries: MetadataRoute.Sitemap = brands.map((b) => ({
    url: `${SITE_URL}/brand/${b.slug}`,
    lastModified: now,
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }));

  return [
    ...staticEntries,
    ...categoryEntries,
    ...listingEntries,
    ...brandEntries,
  ];
}
