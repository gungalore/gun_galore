import Link from 'next/link';
import type { Metadata } from 'next';
import { WantedBrowseResult } from '@/lib/types';
import { PageReveal } from '@/components/page-reveal';
import { WantedFilters } from './wanted-filters';
import { WantedCard } from './wanted-card';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

export const metadata: Metadata = {
  title: 'Wanted — tell sellers what you’re looking for | Gun Galore',
  description:
    'Post a free Wanted ad and let South Africa’s outdoor community come to you. No upfront fees — sellers respond with their live listings.',
};

// Demand-capture board: buyers post what they're LOOKING FOR, sellers
// respond with their own live listings. The actual purchase happens on
// the responder's listing through the normal protected checkout.
export default async function WantedBrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ categoryId?: string; province?: string; page?: string }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (params.categoryId) qs.set('categoryId', params.categoryId);
  if (params.province) qs.set('province', params.province);
  if (params.page) qs.set('page', params.page);

  const res = await fetch(`${API_URL}/wanted?${qs.toString()}`, {
    cache: 'no-store',
  }).catch(() => null);
  const data: WantedBrowseResult = res?.ok
    ? await res.json()
    : { total: 0, page: 1, pageSize: 24, items: [] };

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const pageHref = (page: number) => {
    const p = new URLSearchParams(qs);
    p.set('page', String(page));
    return `/wanted?${p.toString()}`;
  };

  return (
    <main className="relative max-w-[1280px] mx-auto px-4 py-8" style={{ zIndex: 1 }}>
      <PageReveal variant="blur-in">
        <header data-reveal className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h1
                className="text-2xl mb-1"
                style={{ color: 'var(--text-primary)', fontWeight: 500 }}
              >
                Wanted
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Tell sellers what you&rsquo;re after — they come to you.
              </p>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-1">
              <Link
                href="/wanted/new"
                className="px-4 py-2 rounded-[6px] text-sm font-medium"
                style={{ background: 'var(--red)', color: '#fff' }}
              >
                + Post a wanted ad
              </Link>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Free to post — no upfront fees.
              </span>
            </div>
          </div>
        </header>

        <div data-reveal className="mb-6">
          <WantedFilters
            categoryId={params.categoryId ?? ''}
            province={params.province ?? ''}
          />
        </div>

        {data.items.length === 0 ? (
          <div
            data-reveal
            className="rounded-[8px] px-4 py-12 text-center"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px dashed var(--border)',
            }}
          >
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              No open wanted ads here yet.
            </p>
            <Link
              href="/wanted/new"
              className="inline-block px-4 py-2 rounded-[6px] text-sm font-medium"
              style={{ background: 'var(--red)', color: '#fff' }}
            >
              Be the first — post what you&rsquo;re looking for
            </Link>
          </div>
        ) : (
          <div
            data-reveal
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {data.items.map((ad) => (
              <WantedCard key={ad.id} ad={ad} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <nav
            data-reveal
            className="flex items-center justify-center gap-3 mt-8 text-sm"
            aria-label="Wanted ads pagination"
          >
            {data.page > 1 && (
              <Link
                href={pageHref(data.page - 1)}
                className="px-3 py-1.5 rounded-[6px]"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-secondary)',
                }}
              >
                ← Previous
              </Link>
            )}
            <span style={{ color: 'var(--text-tertiary)' }}>
              Page {data.page} of {totalPages}
            </span>
            {data.page < totalPages && (
              <Link
                href={pageHref(data.page + 1)}
                className="px-3 py-1.5 rounded-[6px]"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-secondary)',
                }}
              >
                Next →
              </Link>
            )}
          </nav>
        )}
      </PageReveal>
    </main>
  );
}
