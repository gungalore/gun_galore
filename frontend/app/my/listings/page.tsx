import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import CancelButton from './cancel-button';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#22c55e',
  PENDING_REVIEW: '#f59e0b',
  DRAFT: 'var(--text-tertiary)',
  SOLD: '#6366f1',
  PAYMENT_PENDING: '#f59e0b',
  CANCELLED: 'var(--text-tertiary)',
  EXPIRED: 'var(--text-tertiary)',
};

interface MyListing {
  id: string;
  title: string;
  price: number;
  status: string;
  listingType: string;
  condition: string;
  createdAt: string;
  category: { name: string };
  images: { url: string }[];
}

export default async function MyListingsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/listings');

  const token = await getToken();
  const res = await fetch(`${API_URL}/listings/mine`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const listings: MyListing[] = res.ok ? await res.json() : [];

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
          My Listings
        </h1>
        <Link
          href="/listings/new"
          className="px-3 py-1.5 rounded-[6px] text-sm font-medium"
          style={{ background: 'var(--red)', color: '#fff' }}
        >
          + New listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <div
          className="rounded-[8px] py-12 px-6 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
          }}
        >
          <p
            className="text-base mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            You haven&apos;t listed anything yet
          </p>
          <p
            className="text-sm mb-5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Create your first listing in under 5 minutes — photos,
            price, shipping. We&apos;ll guide you through each step.
          </p>
          <Link
            href="/listings/new"
            className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Create your first listing →
          </Link>
        </div>
      ) : (
        /* Card layout — works on mobile (single column) and desktop
           (grid widens to 2 columns >= md). The previous 6-column
           HTML table overflowed horizontally below 640px with no
           responsive collapse, matching the orders + sales card
           pattern they were already using. */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {listings.map((l) => (
            <div
              key={l.id}
              className="rounded-[8px] p-4 flex gap-3 items-start"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              {l.images[0] && (
                <img
                  src={l.images[0].url}
                  alt={l.title}
                  className="w-16 h-16 rounded-[6px] object-cover shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <Link
                    href={`/listings/${l.id}`}
                    className="font-medium truncate"
                    style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                  >
                    {l.title}
                  </Link>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      color: STATUS_COLOR[l.status] ?? 'var(--text-tertiary)',
                      background: `${STATUS_COLOR[l.status] ?? 'var(--text-tertiary)'}18`,
                      border: `0.5px solid ${STATUS_COLOR[l.status] ?? 'var(--text-tertiary)'}40`,
                    }}
                  >
                    {l.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {l.category.name} · {new Date(l.createdAt).toLocaleDateString('en-ZA')}
                </p>
                <div className="flex items-center justify-between mt-2 gap-2">
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    R{(l.price / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                  </span>
                  <div className="flex gap-2 items-center">
                    {l.status === 'ACTIVE' && <CancelButton listingId={l.id} />}
                    {/* Relist CTA for terminal-no-sale auction
                        outcomes — gives the seller a clear next
                        step instead of leaving them to figure out
                        they should create a fresh listing. */}
                    {(l.status === 'EXPIRED' ||
                      l.status === 'AUCTION_ENDED_NO_RESERVE' ||
                      l.status === 'AUCTION_ENDED_NO_BIDS') && (
                      <Link
                        href={`/listings/new?relistFrom=${l.id}`}
                        className="text-xs px-2 py-1 rounded-[6px]"
                        style={{
                          background: 'var(--bg-inset)',
                          color: 'var(--red)',
                          border: '0.5px solid var(--red)',
                          textDecoration: 'none',
                          fontWeight: 500,
                        }}
                      >
                        Relist
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
