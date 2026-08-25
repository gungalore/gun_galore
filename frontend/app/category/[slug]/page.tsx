import Link from 'next/link';
import { BrowseRailShell } from '@/components/browse-rail-shell';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { viewerFetch } from '@/lib/api-viewer';
import { browseMetaDescription } from '@/lib/seo';
import { BrowseResponse, Category, SoldComps } from '@/lib/types';
import { Fragment } from 'react';
import { ListingCard } from '@/components/listing-card';
import { FeaturedInFeedCard } from '@/components/featured-in-feed';
import { Pagination } from '@/components/pagination';
import { SoldCompsStrip } from '@/components/sold-comps';

interface CategoryTree {
  category: Category;
  parent: Category | null;
  children: Category[];
}

const PAGE_SIZE = 24;

async function getTree(slug: string): Promise<CategoryTree | null> {
  return viewerFetch<CategoryTree>(
    `/categories/${encodeURIComponent(slug)}`,
  ).catch(() => null);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tree = await getTree(slug);
  // ⚠️ notFound() HERE, NOT ONLY IN THE PAGE BODY, AND THE STATUS CODE IS WHY.
  //
  // app/loading.tsx puts a Suspense boundary above every route, so Next flushes
  // the shell as soon as rendering starts and the response status is committed
  // before the page component's own `notFound()` ever throws. Measured: an
  // unknown slug returned HTTP 200 with a "Category not found" body — a soft
  // 404. generateMetadata resolves BEFORE the shell streams, so throwing from
  // here is what actually produces a 404.
  //
  // This matters beyond tidiness. Gated categories (see the migration
  // 20260821120000_gate_meta_prohibited_categories) are invisible to anonymous
  // callers, so every one of them lands on this branch for a crawler — and a
  // gate that answers 200 has not told the crawler the page is gone.
  if (!tree) notFound();
  const { category } = tree;
  const title = `${category.name} for sale — All Outdoor`;
  // Shared blurb (lib/seo.ts) — this description is stamped onto EVERY
  // category's SERP snippet, so it must not lead with "firearms" on the
  // Fishing and Camping pages.
  const description = browseMetaDescription(
    `${category.name.toLowerCase()} listings`,
  );
  return {
    title,
    description,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: { title, description, url: `/category/${category.slug}` },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);

  const tree = await getTree(slug);
  if (!tree) notFound();
  const { category, parent, children } = tree;

  const qs = new URLSearchParams({
    categorySlug: slug,
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  const browse = await viewerFetch<BrowseResponse>(`/listings?${qs}`).catch(() => ({
    listings: [],
    total: 0,
    page,
    limit: PAGE_SIZE,
  }));

  // P5.6 — sold-price comps for this category (aggregate, POPIA-safe). Cached
  // briefly; renders nothing below the server's min-comps gate.
  const comps = await viewerFetch<SoldComps>(
    `/listings/sold-comps?categorySlug=${encodeURIComponent(slug)}`,
  ).catch(() => null);

  const totalPages = Math.max(1, Math.ceil(browse.total / PAGE_SIZE));
  const pageHref = (p: number) => `/category/${slug}?page=${p}`;

  return (
    <main className="max-w-[var(--page-max)] mx-auto px-4 py-8">
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
        {parent && (
          <>
            <Link
              href={`/category/${parent.slug}`}
              style={{ color: 'var(--text-tertiary)' }}
            >
              {parent.name}
            </Link>
            <span aria-hidden>/</span>
          </>
        )}
        <span style={{ color: 'var(--text-secondary)' }}>{category.name}</span>
      </nav>

      <h1
        className="text-2xl sm:text-3xl"
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        {category.name}
      </h1>
      <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
        {browse.total.toLocaleString('en-ZA')} listing
        {browse.total !== 1 ? 's' : ''}
      </p>

      {/* Subcategory drill-down */}
      {children.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {children.map((c) => (
            <Link
              key={c.id}
              href={`/category/${c.slug}`}
              className="text-sm rounded-full px-3 py-1.5 transition-colors"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {/* P5.6 — sold-price comps (aggregate, POPIA-safe) */}
      <SoldCompsStrip comps={comps} scopeName={category.name} />

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
          {children.length > 0
            ? 'No listings directly in this category yet — try a subcategory above.'
            : 'No listings in this category yet. Check back soon.'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-6">
          {browse.listings.map((l, i) => (
            <Fragment key={l.id}>
              <ListingCard listing={l} />
              {/* One paid card after the first row — see FeaturedInFeedCard. */}
              {i === 3 && <FeaturedInFeedCard />}
            </Fragment>
          ))}
        </div>
      )}

      {/* Pagination */}
      <Pagination currentPage={page} totalPages={totalPages} hrefFor={pageHref} />
    </BrowseRailShell>
    </main>
  );
}
