import Link from 'next/link';
import { BrowseRailShell } from '@/components/browse-rail-shell';
import type { Metadata } from 'next';
import { apiFetch } from '@/lib/api';
import { browseMetaDescription } from '@/lib/seo';
import type { BrandSummary } from '@/lib/types';

// P5.7 — brand index. Lists every brand that clears the min-listings gate so
// both shoppers and crawlers can reach the per-brand landing pages.

export const metadata: Metadata = {
  title: 'Shop by brand — Gun Galore',
  // Shared blurb (lib/seo.ts) so the brand index, brand pages and category
  // pages all describe the marketplace the same outdoor-first way.
  description: browseMetaDescription('gear by brand'),
  alternates: { canonical: '/brands' },
};

export default async function BrandsPage() {
  const brands = await apiFetch<BrandSummary[]>('/listings/brand-index', {
    next: { revalidate: 600 },
  } as RequestInit).catch(() => [] as BrandSummary[]);

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-8">
      <BrowseRailShell>
      <nav
        aria-label="Breadcrumb"
        className="text-sm mb-4 flex flex-wrap items-center gap-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <Link href="/" style={{ color: 'var(--text-tertiary)' }}>
          Home
        </Link>
        <span aria-hidden>/</span>
        <span style={{ color: 'var(--text-secondary)' }}>Brands</span>
      </nav>

      <h1
        className="text-2xl sm:text-3xl"
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        Shop by brand
      </h1>
      <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
        {brands.length.toLocaleString('en-ZA')} brand
        {brands.length !== 1 ? 's' : ''} with listings right now
      </p>

      {brands.length === 0 ? (
        <div
          className="mt-8 rounded-[8px] p-8 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          No brands to show yet. Check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-6">
          {brands.map((b) => (
            <Link
              key={b.slug}
              href={`/brand/${b.slug}`}
              className="rounded-[8px] px-4 py-3 flex items-center justify-between gap-2 transition-colors"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              <span
                className="text-sm truncate"
                style={{ color: 'var(--text-primary)', fontWeight: 500 }}
              >
                {b.label}
              </span>
              <span
                className="text-xs shrink-0"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {b.count.toLocaleString('en-ZA')}
              </span>
            </Link>
          ))}
        </div>
      )}
    </BrowseRailShell>
    </main>
  );
}
