'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Listing } from '@/lib/types';
import { formatPrice, CONDITION_LABELS, TIER_LABELS } from '@/lib/utils';

export function ListingCard({ listing }: { listing: Listing }) {
  const primaryImage = listing.images.find((i) => i.isPrimary) ?? listing.images[0];

  return (
    <Link href={`/listings/${listing.id}`} className="block group">
      <div
        className="rounded-[6px] overflow-hidden transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-hover)';
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card-hover)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)';
        }}
      >
        {/* Photo. Aspect tightened to ~70% of the original 4:3 box
            so card height shrinks (75% × 0.7 = 52.5%). Frees up
            vertical real estate that the FeaturedRail uses on the
            left of the grid without making cards-per-row change. */}
        <div className="relative" style={{ paddingBottom: '52.5%' }}>
          {primaryImage ? (
            <Image
              src={primaryImage.url}
              alt={listing.title}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-xs"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
            >
              No photo
            </div>
          )}
          {/* Category badge — top-left */}
          <span
            className="absolute top-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
            style={{
              background: 'rgba(0,0,0,0.72)',
              color: 'var(--text-secondary)',
            }}
          >
            {listing.category.name}
          </span>
          {/* Condition badge — top-right */}
          <span
            className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
            style={{
              background: 'rgba(0,0,0,0.72)',
              color: 'var(--text-secondary)',
            }}
          >
            {CONDITION_LABELS[listing.condition]}
          </span>
        </div>

        {/* Card body */}
        <div className="p-3">
          <p
            className="text-sm leading-snug line-clamp-2 mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {listing.title}
          </p>

          <div className="flex items-center justify-between">
            <span
              className="text-base"
              style={{ color: 'var(--red)', fontWeight: 500 }}
            >
              {/* For auctions, show the current bid (or starting bid if no bids yet). */}
              {listing.listingType === 'AUCTION'
                ? formatPrice(listing.currentBid ?? listing.price ?? 0)
                : listing.price
                  ? formatPrice(listing.price)
                  : 'Make an offer'}
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-[3px]"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border)',
              }}
            >
              {TIER_LABELS[listing.seller.sellerTier]}
            </span>
          </div>

          {/* Auction-specific meta — bid count + time remaining.
              Snipe-protection extension means endTime can change, but
              the card refreshes when the page re-fetches; we compute
              "time remaining" relative to render and let the user click
              into the listing for the live countdown. The chip turns
              red when <1h so browsers can spot the urgent auctions
              without expanding every card. */}
          {listing.listingType === 'AUCTION' && (
            <div
              className="flex items-center justify-between text-xs mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <span>
                {listing.bidCount > 0
                  ? `${listing.bidCount} bid${listing.bidCount === 1 ? '' : 's'}`
                  : 'Starting bid'}
              </span>
              <AuctionTimeChip endTime={listing.endTime} />
            </div>
          )}

          <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
            {listing.province.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </p>
        </div>
      </div>
    </Link>
  );
}

// Compact "Ends in 2h 14m" chip. Red when <1h to draw the eye for
// last-minute browsers. Renders nothing if endTime is missing or the
// auction has already ended (the card itself transitions out of the
// active grid in that case, but defensive).
function AuctionTimeChip({ endTime }: { endTime: string | null | undefined }) {
  if (!endTime) return null;
  const msLeft = new Date(endTime).getTime() - Date.now();
  if (msLeft <= 0) return null;

  const hours = Math.floor(msLeft / 3600_000);
  const mins = Math.floor((msLeft % 3600_000) / 60_000);
  const days = Math.floor(hours / 24);

  let label: string;
  if (days >= 2) label = `${days}d`;
  else if (hours >= 1) label = `${hours}h ${mins}m`;
  else label = `${mins}m`;

  const urgent = msLeft < 3600_000; // <1h

  return (
    <span
      className="px-1.5 py-0.5 rounded-[3px]"
      style={{
        background: urgent ? 'rgba(200,16,46,0.10)' : 'var(--bg-inset)',
        color: urgent ? 'var(--red)' : 'var(--text-secondary)',
        fontWeight: urgent ? 500 : 400,
        border: `0.5px solid ${urgent ? 'var(--red)' : 'var(--border)'}`,
      }}
    >
      Ends in {label}
    </span>
  );
}
