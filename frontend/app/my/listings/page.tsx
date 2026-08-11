import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import CancelButton from './cancel-button';
import RenewButton from './renew-button';
import { LISTING_STATUS, resolveStatus, toneColor } from '@/lib/status-labels';
import { PageReveal } from '@/components/page-reveal';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface MyListing {
  id: string;
  title: string;
  price: number;
  status: string;
  listingType: string;
  condition: string;
  createdAt: string;
  // Stale-listing clock. Seeded from createdAt, advanced only by an explicit
  // "Still for sale" renew — the daily sweep nudges at 75d and expires at 90d.
  lastRenewedAt?: string | null;
  category: { name: string };
  images: { url: string }[];
  // P5.2 — how many buyers have wishlisted this listing (seller nudge).
  _count?: { wishlistedBy?: number };
}

// Show the renew affordance once a listing enters the ageing window, so the
// button appears exactly when the seller can act on the nudge email — not as
// permanent chrome on every fresh listing.
const RENEW_PROMPT_AFTER_DAYS = 60;

function daysSince(iso?: string | null): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((Date.now() - then) / 86_400_000);
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
      <PageReveal variant="slide-up">
      <div data-reveal className="flex items-center justify-between mb-6">
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
        <div data-reveal className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {listings.map((l) => {
            const status = resolveStatus(LISTING_STATUS, l.status);
            const color = toneColor(status.tone);
            const saved = l._count?.wishlistedBy ?? 0;
            // Auctions end on their own endTime and are never swept.
            const ageDays = daysSince(l.lastRenewedAt ?? l.createdAt);
            const showRenew =
              l.status === 'ACTIVE' &&
              l.listingType !== 'AUCTION' &&
              ageDays >= RENEW_PROMPT_AFTER_DAYS;
            return (
              <div
                key={l.id}
                className="rounded-[8px] p-4 flex gap-3 items-start"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                }}
              >
                {l.images[0] && (
                  <Image
                    src={l.images[0].url}
                    alt={l.title}
                    width={64}
                    height={64}
                    sizes="64px"
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
                      title={status.hint ?? status.label}
                      style={{
                        color,
                        background: `${color}18`,
                        border: `0.5px solid ${color}40`,
                      }}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {l.category.name} · {new Date(l.createdAt).toLocaleDateString('en-ZA')}
                  </p>
                  {/* P5.2 — saved-count nudge. Once a few buyers have saved an
                      ACTIVE listing without buying, prompt the seller to drop
                      the price, deep-linking to the edit form. */}
                  {saved > 0 && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      <span aria-hidden>❤ </span>
                      {saved} {saved === 1 ? 'buyer has' : 'buyers have'} saved this
                      {l.status === 'ACTIVE' && saved >= 3 && (
                        <>
                          {' — '}
                          <Link
                            href={`/listings/${l.id}/edit`}
                            style={{ color: 'var(--red)', fontWeight: 500 }}
                          >
                            consider a price drop
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-2 gap-2">
                    <span
                      className="text-sm font-medium"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      R{(l.price / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                    </span>
                    <div className="flex gap-2 items-center">
                      {/* Edit — the card previously offered only Cancel/
                          Relist; sellers wanting to fix a typo or drop the
                          price had no visible way in. The edit page itself
                          handles the bid/offer lock with a friendly card. */}
                      {(l.status === 'ACTIVE' || l.status === 'PENDING_REVIEW') && (
                        <Link
                          href={`/listings/${l.id}/edit`}
                          className="text-xs px-2 py-1 rounded-[6px]"
                          style={{
                            background: 'var(--bg-inset)',
                            color: 'var(--text-secondary)',
                            border: '0.5px solid var(--border)',
                            textDecoration: 'none',
                            fontWeight: 500,
                          }}
                        >
                          Edit
                        </Link>
                      )}
                      {showRenew && (
                        <RenewButton listingId={l.id} daysOld={ageDays} />
                      )}
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
            );
          })}
        </div>
      )}
      </PageReveal>
    </main>
  );
}
