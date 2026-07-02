import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { auth } from '@clerk/nextjs/server';
import { apiFetch } from '@/lib/api';
import { Listing } from '@/lib/types';
import { formatPrice, CONDITION_LABELS } from '@/lib/utils';
import { CheckoutForm } from './checkout-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  const listing = await apiFetch<Listing>(`/listings/${listingId}`, { cache: 'no-store' }).catch(() => null);
  if (!listing) return { title: 'Checkout — Gun Galore' };
  return { title: `Buy ${listing.title} — Gun Galore` };
}

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;

  const listing = await apiFetch<Listing>(`/listings/${listingId}`, { cache: 'no-store' }).catch(
    () => null,
  );

  if (!listing) return notFound();
  // P0.2 — auction winners land here from the "you won" SMS/token link.
  // finalizeAuction has already flipped the listing to PAYMENT_PENDING, so
  // the ACTIVE/BUY_NOW gate would 404 every won auction. The backend
  // enforces winner-only + the 24h window at POST time; here we render the
  // checkout with the WINNING BID as the price.
  const isAuctionWin =
    listing.listingType === 'AUCTION' && listing.status === 'PAYMENT_PENDING';
  if (!isAuctionWin) {
    if (listing.status !== 'ACTIVE') return notFound();
    if (listing.listingType !== 'BUY_NOW') return notFound();
  }

  // Self-buy guard. Backend rejects with 400 anyway, but landing
  // here at all is confusing — kick them back to the listing detail
  // so they see the "this is your own listing" chip instead.
  const { userId } = await auth();
  if (userId && userId === listing.seller.clerkId) {
    redirect(`/listings/${listing.id}`);
  }

  // For an auction win the settled price is the winning bid — override the
  // (starting-bid) price so the summary + form show what the winner pays.
  const effectiveListing = isAuctionWin
    ? { ...listing, price: listing.currentBid ?? listing.price }
    : listing;

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <Link href={`/listings/${listing.id}`} className="text-sm inline-block mb-6" style={{ color: 'var(--text-tertiary)' }}>
        ← Back to listing
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start">
        {/* Left: listing summary */}
        <div
          className="rounded-[8px] p-5"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <h2 className="text-xs uppercase mb-4" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
            You&apos;re buying
          </h2>

          <div className="flex gap-4">
            {listing.images[0] && (
              <Image
                src={listing.images.find((i) => i.isPrimary)?.url ?? listing.images[0].url}
                alt={listing.title}
                width={80}
                height={80}
                sizes="80px"
                className="w-20 h-20 rounded-[6px] object-cover flex-shrink-0"
                style={{ background: 'var(--bg-inset)' }}
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug mb-1" style={{ color: 'var(--text-primary)' }}>
                {listing.title}
              </p>
              <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                {CONDITION_LABELS[listing.condition]} · {listing.category.name}
              </p>
              <p className="text-lg font-medium" style={{ color: 'var(--red)' }}>
                {effectiveListing.price
                  ? formatPrice(effectiveListing.price)
                  : 'Make an offer'}
              </p>
              {isAuctionWin && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  🏆 You won this auction — complete payment within 24 hours of
                  the auction ending or the sale is cancelled.
                </p>
              )}
            </div>
          </div>

          {(listing.make || listing.model || listing.calibre) && (
            <dl className="mt-4 pt-4 space-y-1 text-sm" style={{ borderTop: '0.5px solid var(--border-divider)' }}>
              {listing.make && (
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--text-tertiary)' }}>Make</dt>
                  <dd style={{ color: 'var(--text-primary)' }}>{listing.make}</dd>
                </div>
              )}
              {listing.model && (
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--text-tertiary)' }}>Model</dt>
                  <dd style={{ color: 'var(--text-primary)' }}>{listing.model}</dd>
                </div>
              )}
              {listing.calibre && (
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--text-tertiary)' }}>Calibre</dt>
                  <dd style={{ color: 'var(--text-primary)' }}>{listing.calibre}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="mt-4 pt-4 text-sm" style={{ borderTop: '0.5px solid var(--border-divider)' }}>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Seller</span>
              <span style={{ color: 'var(--text-primary)' }}>
                {/* Platform policy — public-facing surfaces show the
                    seller's username only, no @ prefix, never the
                    real name. */}
                {listing.seller.username ?? 'Anonymous seller'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: checkout form */}
        <div
          className="rounded-[8px] p-5"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <h1 className="text-base font-medium mb-5" style={{ color: 'var(--text-primary)' }}>
            Checkout
          </h1>
          <CheckoutForm listing={effectiveListing} />
        </div>
      </div>
    </main>
  );
}
