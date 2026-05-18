import { apiFetch } from '@/lib/api';
import { BrowseResponse, Category } from '@/lib/types';
import { ListingCard } from '@/components/listing-card';
import { FilterBar } from '@/components/filter-bar';

interface SearchParams {
  q?: string;
  categoryId?: string;
  listingType?: string;
  condition?: string;
  province?: string;
  sort?: string;
  page?: string;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.categoryId) qs.set('categoryId', params.categoryId);
  if (params.listingType) qs.set('listingType', params.listingType);
  if (params.condition) qs.set('condition', params.condition);
  if (params.province) qs.set('province', params.province);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', params.page);
  qs.set('limit', '24');

  const [browse, categories] = await Promise.all([
    apiFetch<BrowseResponse>(`/listings?${qs}`, { cache: 'no-store' }).catch(
      () => ({ listings: [], total: 0, page: 1, limit: 24 }),
    ),
    apiFetch<Category[]>('/categories', {
      next: { revalidate: 3600 },
    } as RequestInit).catch(() => [] as Category[]),
  ]);

  const currentPage = browse.page;
  const hasNext = currentPage * browse.limit < browse.total;
  const hasPrev = currentPage > 1;

  function pageHref(p: number) {
    const next = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    );
    next.set('page', String(p));
    return `/?${next}`;
  }

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <FilterBar categories={categories} currentParams={params} />

      {browse.listings.length === 0 ? (
        <div className="text-center py-24 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No listings found.
        </div>
      ) : (
        <>
          <p className="text-xs mt-4 mb-2" style={{ color: 'var(--text-tertiary)' }}>
            {browse.total.toLocaleString('en-ZA')} listing{browse.total !== 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {browse.listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>

          {(hasPrev || hasNext) && (
            <div className="flex justify-center gap-2 mt-10">
              {hasPrev && (
                <a
                  href={pageHref(currentPage - 1)}
                  className="px-4 py-2 rounded-[6px] text-sm"
                  style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  ← Previous
                </a>
              )}
              {hasNext && (
                <a
                  href={pageHref(currentPage + 1)}
                  className="px-4 py-2 rounded-[6px] text-sm"
                  style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  Next →
                </a>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
