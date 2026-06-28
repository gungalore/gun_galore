'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Listing } from '@/lib/types';
import { formatPrice, CONDITION_LABELS, TIER_LABELS } from '@/lib/utils';
import { WishlistButton } from './wishlist-button';
import { useCountdown, formatCountdown } from '@/lib/use-countdown';
import { UserBadges } from './user-badges';

export function ListingCard({ listing }: { listing: Listing }) {
  // Defensive: if upstream returns a partial listing without the
  // images array (e.g. raw Meilisearch hits — see the historical
  // browseViaSearch bug), fall back to an empty array so .find()
  // doesn't crash and bubble to error.tsx. The "No photo" placeholder
  // is the user-visible signal that data is missing.
  const images = listing.images ?? [];
  const primaryImage = images.find((i) => i.isPrimary) ?? images[0];

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
          {/* Condition chip — moved to bottom-left of the image (was
              top-right) to free the top-right corner for the heart
              button. Keeps the at-a-glance "Used" / "Like new" info
              on the photo without competing with the wishlist
              affordance. */}
          <span
            className="absolute bottom-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
            style={{
              background: 'rgba(0,0,0,0.72)',
              color: 'var(--text-secondary)',
            }}
          >
            {CONDITION_LABELS[listing.condition]}
          </span>
          {/* Heart — save for later. Top-right with a subtle blurred
              dark background so it reads against any photo. Tapping
              the heart stops propagation so the parent <Link> doesn't
              navigate to the listing detail. */}
          <WishlistButton listingId={listing.id} />
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
                : listing.listingType === 'SWOP'
                  ? 'Swap'
                  : listing.price
                    ? formatPrice(listing.price)
                    : 'Make an offer'}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
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
              {/* Phase E1 — GG+ pill (MEMBER/PRO) + verified-expert
                  badge. Renders nothing for FREE non-expert sellers
                  so card density doesn't regress. */}
              <UserBadges
                subscriptionTier={listing.seller.subscriptionTier}
                isVerifiedExpert={listing.seller.isVerifiedExpert}
              />
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

// Compact "Ends in 2h 14m" chip — live 1Hz tick via useCountdown so
// the auction time doesn't go stale on long-open grid pages. Red
// when <1h to draw the eye for last-minute browsers. Renders nothing
// once the auction has ended (the card transitions out of the active
// grid in that case, but defensive).
function AuctionTimeChip({ endTime }: { endTime: string | null | undefined }) {
  const ms = useCountdown(endTime ?? null);
  if (!endTime || ms <= 0) return null;
  const label = formatCountdown(ms);
  const urgent = ms < 3600_000; // <1h
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
