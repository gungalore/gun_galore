import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiFetch } from '@/lib/api';
import { BrowseResponse, Category } from '@/lib/types';
import { ListingCard } from '@/components/listing-card';
import { Pagination } from '@/components/pagination';

interface CategoryTree {
  category: Category;
  parent: Category | null;
  children: Category[];
}

const PAGE_SIZE = 24;

async function getTree(slug: string): Promise<CategoryTree | null> {
  return apiFetch<CategoryTree>(`/categories/${encodeURIComponent(slug)}`, {
    next: { revalidate: 600 },
  } as RequestInit).catch(() => null);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tree = await getTree(slug);
  if (!tree) return { title: 'Category not found — Gun Galore' };
  const { category } = tree;
  const title = `${category.name} for sale — Gun Galore`;
  const description = `Browse ${category.name.toLowerCase()} listings on Gun Galore — South Africa's marketplace for firearms, optics, hunting and outdoor gear. Buy, bid, or make an offer with payment held until delivery.`;
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
  const browse = await apiFetch<BrowseResponse>(`/listings?${qs}`, {
    cache: 'no-store',
  }).catch(() => ({ listings: [], total: 0, page, limit: PAGE_SIZE }));

  const totalPages = Math.max(1, Math.ceil(browse.total / PAGE_SIZE));
  const pageHref = (p: number) => `/category/${slug}?page=${p}`;

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-8">
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
          {browse.listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}

      {/* Pagination */}
      <Pagination currentPage={page} totalPages={totalPages} hrefFor={pageHref} />
    </main>
  );
}
