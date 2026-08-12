import type { Metadata } from 'next';
import { BrowseRailShell } from '@/components/browse-rail-shell';
import { apiFetch } from '@/lib/api';
import type { DealsResponse } from '@/lib/types';
import { DealCard } from '@/components/deal-card';
import { PageReveal } from '@/components/page-reveal';

// ── Daily Deals storefront (DD-3) ─────────────────────────────────────
// The public buyer surface for first-party "OneDayOnly-style" house deals.
// Gated end-to-end on the `deals_enabled` Setting: while the switch is off the
// backend returns { enabled:false, deals:[] }, so this page renders its
// "no live deals" state and is noindex'd — the whole surface ships INERT and
// flips live the instant the operator toggles the flag (no deploy). Deal
// listings are swept out of every normal browse/search query, so this reads
// the dedicated GET /deals endpoint, never the marketplace rails.

async function loadDeals(): Promise<DealsResponse> {
  return apiFetch<DealsResponse>('/deals', { cache: 'no-store' }).catch(
    () => ({ enabled: false, deals: [] }),
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { enabled, deals } = await loadDeals();
  const live = enabled && deals.length > 0;
  return {
    title: 'Daily Deals — All Outdoor',
    description:
      'Hand-picked outdoor & sport gear sold directly by All Outdoor at a deal price — limited stock, limited time.',
    alternates: { canonical: '/deals' },
    // Keep the inert storefront out of the index; let crawlers in only once
    // real deals are live so we never surface an empty "Daily Deals" page.
    robots: live ? undefined : { index: false, follow: true },
    openGraph: {
      title: 'Daily Deals — All Outdoor',
      description:
        'Hand-picked outdoor & sport gear sold directly by All Outdoor at a deal price — limited stock, limited time.',
      url: '/deals',
      type: 'website',
    },
  };
}

export default async function DealsPage() {
  const { enabled, deals } = await loadDeals();
  const liveDeals = enabled ? deals : [];

  return (
    <main className="max-w-[var(--page-max)] mx-auto px-4 py-8">
      <BrowseRailShell>
      <PageReveal>
        <header className="mb-6" data-reveal>
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-2xl" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Daily Deals
            </h1>
            <span
              className="text-xs px-2 py-0.5 rounded-[4px]"
              style={{
                background: 'rgba(200,16,46,0.10)',
                color: 'var(--red)',
                border: '0.5px solid var(--red)',
                fontWeight: 600,
              }}
            >
              Sold by All Outdoor
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)', maxWidth: 640 }}>
            Hand-picked outdoor &amp; sport gear, sold directly by us at a deal
            price. Limited stock, limited time — when it&apos;s gone, it&apos;s
            gone. Every deal ships from All Outdoor with the same buyer
            protection as the rest of the marketplace.
          </p>
        </header>

        {liveDeals.length > 0 ? (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
            data-reveal
          >
            {liveDeals.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        ) : (
          <div
            className="rounded-[8px] px-6 py-16 text-center"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            data-reveal
          >
            <p className="text-base mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              No live deals right now
            </p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Fresh deals drop regularly — check back soon, or browse the full{' '}
              <a href="/" style={{ color: 'var(--red)' }}>
                marketplace
              </a>{' '}
              in the meantime.
            </p>
          </div>
        )}
      </PageReveal>
    </BrowseRailShell>
    </main>
  );
}
