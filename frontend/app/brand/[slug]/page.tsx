import Link from 'next/link';
import { BrowseRailShell } from '@/components/browse-rail-shell';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiFetch } from '@/lib/api';
import { BrowseResponse, BrandSummary } from '@/lib/types';
import { ListingCard } from '@/components/listing-card';
import { Pagination } from '@/components/pagination';

const PAGE_SIZE = 24;

// P5.7 — brand landing page. Mirrors /category/[slug]: SEO-indexable, gated
// server-side (the /listings/brand/:slug endpoint 404s a brand too thin to
// warrant its own page), grid fed by ?brandSlug so every casing variant folds
// into one page.

async function getBrand(slug: string): Promise<BrandSummary | null> {
  return apiFetch<BrandSummary>(`/listings/brand/${encodeURIComponent(slug)}`, {
    next: { revalidate: 600 },
  } as RequestInit).catch(() => null);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) return { title: 'Brand not found — Gun Galore' };
  const title = `${brand.label} for sale — Gun Galore`;
  const description = `Browse ${brand.label} gear for sale on Gun Galore — South Africa's marketplace for firearms, optics, hunting and outdoor equipment. Buy, bid, or make an offer with payment held until delivery.`;
  return {
    title,
    description,
    alternates: { canonical: `/brand/${brand.slug}` },
    openGraph: { title, description, url: `/brand/${brand.slug}` },
  };
}

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);

  const brand = await getBrand(slug);
  if (!brand) notFound();

  const qs = new URLSearchParams({
    brandSlug: brand.slug,
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  const browse = await apiFetch<BrowseResponse>(`/listings?${qs}`, {
    cache: 'no-store',
  }).catch(() => ({ listings: [], total: 0, page, limit: PAGE_SIZE }));

  const totalPages = Math.max(1, Math.ceil(browse.total / PAGE_SIZE));
  const pageHref = (p: number) => `/brand/${brand.slug}?page=${p}`;

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-8">
      <BrowseRailShell>
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="text-sm mb-4 flex flex-wrap items-center gap-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <Link href="/" style={{ color: 'var(--text-tertiary)' }}>
          Home
        </Link>
        <span aria-hidden>/</span>
        <Link href="/brands" style={{ color: 'var(--text-tertiary)' }}>
          Brands
        </Link>
        <span aria-hidden>/</span>
        <span style={{ color: 'var(--text-secondary)' }}>{brand.label}</span>
      </nav>

      <h1
        className="text-2xl sm:text-3xl"
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        {brand.label}
      </h1>
      <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
        {browse.total.toLocaleString('en-ZA')} listing
        {browse.total !== 1 ? 's' : ''}
      </p>

      {/* Listings */}
      {browse.listings.length === 0 ? (
        <div
          className="mt-8 rounded-[8px] p-8 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          No {brand.label} listings right now. Check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-6">
          {browse.listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}

      {/* Pagination */}
      <Pagination currentPage={page} totalPages={totalPages} hrefFor={pageHref} />
    </BrowseRailShell>
    </main>
  );
}
