import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ListingCard } from '@/components/listing-card';
import { BrowseResponse } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const TIER_COLOR: Record<string, string> = {
  NEW: 'var(--text-tertiary)',
  ESTABLISHED: '#6366f1',
  TRUSTED: '#0ea5e9',
  TOP_SELLER: '#f59e0b',
  DEALER: 'var(--red)',
};

interface SellerRating {
  id: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  // Public-facing reviews — username only per platform policy.
  rater: { username: string | null };
  transaction: { listing: { title: string } };
}

export default async function SellerProfilePage({
  params,
}: {
  params: Promise<{ clerkId: string }>;
}) {
  const { clerkId } = await params;

  const [ratingsRes, listingsRes] = await Promise.all([
    fetch(`${API_URL}/ratings/seller/${clerkId}`, { cache: 'no-store' }),
    // Scope by sellerClerkId so we only show THIS seller's active
    // listings, not the platform's first-8 (which was the original
    // bug — every seller profile showed the same global feed).
    fetch(
      `${API_URL}/listings?sellerClerkId=${encodeURIComponent(clerkId)}&limit=8`,
      { cache: 'no-store' },
    ),
  ]);

  if (!ratingsRes.ok) notFound();

  const ratings: SellerRating[] = await ratingsRes.json();
  const browse: BrowseResponse = listingsRes.ok
    ? await listingsRes.json()
    : { listings: [], total: 0, page: 1, limit: 8 };

  const avgRating =
    ratings.length > 0
      ? ratings.reduce((s, r) => s + r.stars, 0) / ratings.length
      : null;

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      {/* Profile header */}
      <div
        className="rounded-[10px] p-6 mb-6"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
              Seller Profile
            </p>
            {avgRating && (
              <div className="flex items-center gap-2 mt-1">
                <span style={{ color: '#f59e0b' }}>
                  {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}
                </span>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {avgRating.toFixed(1)} · {ratings.length} review{ratings.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Active listings */}
        <div>
          <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Active listings
          </p>
          {browse.listings.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No active listings.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {browse.listings.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          )}
        </div>

        {/* Reviews */}
        <div
          className="rounded-[8px] p-5"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p className="text-xs uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
            Reviews ({ratings.length})
          </p>

          {ratings.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No reviews yet.
            </p>
          ) : (
            <div className="space-y-4">
              {ratings.slice(0, 10).map((r) => (
                <div key={r.id}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {r.rater.username ?? 'Anonymous'} · {r.transaction.listing.title.slice(0, 28)}
                    </span>
                    <span style={{ color: '#f59e0b', fontSize: '12px' }}>
                      {'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}
                    </span>
                  </div>
                  {r.comment && (
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {r.comment}
                    </p>
                  )}
                  <div className="mt-3" style={{ borderTop: '0.5px solid var(--border-divider)' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
