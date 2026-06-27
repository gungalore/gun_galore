import type { MetadataRoute } from 'next';
import { apiFetch } from '@/lib/api';
import type { Category } from '@/lib/types';

// Emits a real sitemap: the static top-of-funnel + legal routes PLUS every
// ACTIVE listing and every category landing page, so Google can crawl the
// money pages directly instead of relying on internal links alone.

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
    { url: '/competitions', priority: 0.8, changeFrequency: 'weekly' },
    { url: '/faq', priority: 0.5, changeFrequency: 'monthly' },
    { url: '/wishlist', priority: 0.4, changeFrequency: 'weekly' },
  ];

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

  // Dynamic entries — fetched from the API; fall back to the static set if
  // the backend is unreachable at build/revalidate time.
  const [listings, categories] = await Promise.all([
    apiFetch<{ id: string; updatedAt: string }[]>('/listings/sitemap', {
      next: { revalidate: 3600 },
    } as RequestInit).catch(() => [] as { id: string; updatedAt: string }[]),
    apiFetch<Category[]>('/categories', {
      next: { revalidate: 3600 },
    } as RequestInit).catch(() => [] as Category[]),
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

  return [...staticEntries, ...categoryEntries, ...listingEntries];
}
