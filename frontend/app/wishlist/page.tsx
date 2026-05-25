import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { auth } from '@clerk/nextjs/server';
import { ListingCard } from '@/components/listing-card';
import { PageReveal } from '@/components/page-reveal';
import { Listing } from '@/lib/types';
import { WishlistRemoveButton } from './wishlist-remove-button';

// /wishlist — the saved-for-later index page.
//
// Server-fetches the user's saved listings via /wishlist (full Listing
// payload) and renders a grid. Live listings reuse the existing
// ListingCard component (so hearts hydrate from the WishlistProvider
// and toggling here removes the row on the next navigation back).
//
// Terminal-state listings (SOLD / CANCELLED / EXPIRED / REMOVED /
// AUCTION_ENDED_*) render greyed-out tombstones with an explicit
// "Remove" link — we don't silently drop them because the user
// otherwise wonders "where did my saved item go".

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const TERMINAL_STATUSES = new Set<string>([
  'SOLD',
  'CANCELLED',
  'EXPIRED',
  'REMOVED',
  'AUCTION_ENDED_NO_RESERVE',
  'AUCTION_ENDED_NO_BIDS',
]);

const TERMINAL_LABEL: Record<string, string> = {
  SOLD: 'Sold',
  CANCELLED: 'No longer available',
  EXPIRED: 'Expired',
  REMOVED: 'Removed',
  AUCTION_ENDED_NO_RESERVE: 'Reserve not met',
  AUCTION_ENDED_NO_BIDS: 'No bids',
};

interface WishlistRow {
  savedAt: string;
  listing: Listing;
}

export const metadata = {
  title: 'Wishlist — Gun Galore',
};

export default async function WishlistPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/wishlist');

  const token = await getToken();
  const res = await fetch(`${API_URL}/wishlist`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const rows: WishlistRow[] = res.ok ? await res.json() : [];

  // Partition for display order: live first, then tombstones at the bottom.
  const live = rows.filter((r) => !TERMINAL_STATUSES.has(r.listing.status));
  const tombstones = rows.filter((r) => TERMINAL_STATUSES.has(r.listing.status));

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <PageReveal variant="slide-up">
      <header data-reveal className="mb-6">
        <h1
          className="text-xl font-medium mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          Wishlist
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {rows.length === 0
            ? 'Nothing saved yet.'
            : `${rows.length} listing${rows.length === 1 ? '' : 's'} saved`}
        </p>
      </header>

      {rows.length === 0 ? (
        /* Empty state — actionable CTAs into the two highest-volume
           shopping surfaces. Avoids the dead-end "nothing here" UX. */
        <div
          data-reveal
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
            Nothing saved yet
          </p>
          <p
            className="text-sm mb-5 max-w-md mx-auto"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Tap the heart on any listing to save it for later. Saves
            are private — only you can see your wishlist.
          </p>
          <div className="flex gap-2 justify-center flex-wrap">
            <Link
              href="/?listingType=BUY_NOW"
              className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Browse the marketplace →
            </Link>
            <Link
              href="/?listingType=AUCTION"
              className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                textDecoration: 'none',
              }}
            >
              View auctions
            </Link>
          </div>
        </div>
      ) : (
        <>
          {live.length > 0 && (
            <div
              data-reveal
              className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-8"
            >
              {live.map((r) => (
                <ListingCard key={r.listing.id} listing={r.listing} />
              ))}
            </div>
          )}

          {tombstones.length > 0 && (
            <div data-reveal>
              <p
                className="text-xs uppercase tracking-wider mb-3"
                style={{ color: 'var(--text-tertiary)' }}
              >
                No longer available ({tombstones.length})
              </p>
              <div className="space-y-2">
                {tombstones.map((r) => {
                  const img =
                    r.listing.images.find((i) => i.isPrimary) ??
                    r.listing.images[0];
                  const label =
                    TERMINAL_LABEL[r.listing.status] ?? 'Unavailable';
                  return (
                    <div
                      key={r.listing.id}
                      className="flex items-center gap-3 p-3 rounded-[8px]"
                      style={{
                        background: 'var(--bg-card)',
                        border: '0.5px solid var(--border)',
                        opacity: 0.7,
                      }}
                    >
                      {img && (
                        <Image
                          src={img.url}
                          alt={r.listing.title}
                          width={56}
                          height={56}
                          sizes="56px"
                          className="w-14 h-14 rounded-[6px] object-cover shrink-0"
                          style={{ filter: 'grayscale(1)' }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-medium truncate"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {r.listing.title}
                        </p>
                        <p
                          className="text-xs mt-0.5"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {label}
                        </p>
                      </div>
                      <WishlistRemoveButton listingId={r.listing.id} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Browse-more CTA at the bottom of the wishlist — makes the
              page feel less like a dead-end. */}
          <div data-reveal className="mt-8 text-center">
            <Link
              href="/?listingType=BUY_NOW"
              prefetch
              className="inline-block py-2 px-4 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                textDecoration: 'none',
              }}
            >
              Browse more listings →
            </Link>
          </div>
        </>
      )}
      </PageReveal>
    </main>
  );
}
