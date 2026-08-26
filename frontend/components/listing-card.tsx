'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Listing } from '@/lib/types';
import { formatPrice, CONDITION_LABELS, TIER_LABELS, discountPercent } from '@/lib/utils';
import { WishlistButton } from './wishlist-button';
import { useCountdown, formatCountdown } from '@/lib/use-countdown';
import { UserBadges } from './user-badges';
import { UrgencyChip } from './urgency-chip';
import { SellerRating } from './seller-rating';

/**
 * The height of a card's photograph, as a percentage of its width.
 *
 * ⚠️ ONE PLACE, BECAUSE FOUR COMPONENTS HAVE TO AGREE. The deal card, the
 * empty-featured-slot placeholder and the loading skeleton all exist to sit
 * flush in the same grid as a real listing, and all three had `52.5%` typed
 * into them by hand with a comment saying "same as ListingCard". Changing the
 * card's aspect therefore silently misaligned every grid that mixes them.
 * Import this instead.
 */
export const CARD_PHOTO_ASPECT = '75%';

export function ListingCard({ listing }: { listing: Listing }) {
  // Defensive: if upstream returns a partial listing without the
  // images array (e.g. raw Meilisearch hits — see the historical
  // browseViaSearch bug), fall back to an empty array so .find()
  // doesn't crash and bubble to error.tsx. The "No photo" placeholder
  // is the user-visible signal that data is missing.
  const images = listing.images ?? [];
  const primaryImage = images.find((i) => i.isPrimary) ?? images[0];
  // UX-7 — compare-at ("was") price discount, BUY_NOW only.
  const compareAtPct =
    listing.listingType === 'BUY_NOW'
      ? discountPercent(listing.price, listing.compareAtPriceZarCents)
      : null;

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
        {/* Photo — 4:3.
            ⚠️ IT WAS 52.5%, AND THAT WAS TOO SHORT TO BUY FROM. The squeeze
            was made to free vertical room for the FeaturedRail beside the
            grid, which is a desktop concern; the cost landed on the phone,
            where a two-column grid at 390pt gives a 178pt-wide card and 52.5%
            of that is a 93pt-tall letterbox. On a marketplace that is mostly
            SECONDHAND, the photograph is not decoration — judging condition
            from it IS the buying decision, and 93pt is not enough to judge
            anything. 4:3 takes it to 133pt. */}
        <div className="relative" style={{ paddingBottom: CARD_PHOTO_ASPECT }}>
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
          {/* Category badge — top-left. For an experience (hunting package)
              we swap in a distinct "Experience · on-site" badge so browsers
              can tell at a glance it's a booking, not a shippable item. */}
          {listing.isExperience ? (
            <span
              className="absolute top-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
              style={{
                background: 'rgba(168,123,20,0.85)',
                color: 'var(--gold-tag-ink)',
                fontWeight: 600,
              }}
            >
              Experience · on-site
            </span>
          ) : (
            <span
              className="absolute top-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
              style={{
                background: 'rgba(0,0,0,0.72)',
                // On the photo scrim, not the card — see --text-on-dark.
                color: 'var(--text-on-dark-muted)',
              }}
            >
              {listing.category.name}
            </span>
          )}
          {/* Condition chip — moved to bottom-left of the image (was
              top-right) to free the top-right corner for the heart
              button. Keeps the at-a-glance "Used" / "Like new" info
              on the photo without competing with the wishlist
              affordance. */}
          <span
            className="absolute bottom-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
            style={{
              background: 'rgba(0,0,0,0.72)',
              // On the photo scrim, not the card — see --text-on-dark.
              color: 'var(--text-on-dark-muted)',
            }}
          >
            {CONDITION_LABELS[listing.condition]}
          </span>
          {/* UX-1a — low-stock urgency chip. Bottom-right so it clears the
              condition chip (bottom-left) and the heart (top-right). Only
              for inventory-tracked listings at ≤5 sellable units; the
              threshold guard keeps it honest (no fake scarcity). */}
          {listing.trackInventory &&
            (() => {
              const sellable =
                (listing.quantityAvailable ?? 0) -
                (listing.quantityReserved ?? 0);
              return sellable >= 1 && sellable <= 5 ? (
                <UrgencyChip
                  left={sellable}
                  className="absolute bottom-2 right-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
                />
              ) : null;
            })()}
          {/* Heart — save for later. Top-right with a subtle blurred
              dark background so it reads against any photo. Tapping
              the heart stops propagation so the parent <Link> doesn't
              navigate to the listing detail. */}
          <WishlistButton listingId={listing.id} />
        </div>

        {/* Card body.
            ⚠️ THE PRICE GETS ITS OWN LINE. It used to share a row with the
            seller-tier chip and the badges, at the same 16px as the title
            above it — so the two things a browser actually scans for, the
            picture and the number, were the two things competing hardest with
            their neighbours. Title drops to secondary; price sits alone in
            Archivo at 17px. */}
        <div className="p-3">
          <p
            className="text-[13px] leading-snug line-clamp-2"
            style={{ color: 'var(--text-secondary)', fontWeight: 400 }}
          >
            {listing.title}
          </p>

          <div className="flex items-center justify-between mt-1.5">
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
              <span
                style={{
                  color: 'var(--red)',
                  fontWeight: 600,
                  fontFamily: 'var(--font-head)',
                  fontSize: 17,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                }}
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
              {/* UX-7 — "was" price + % off (BUY_NOW only). */}
              {compareAtPct != null && (
                <>
                  <span
                    style={{ fontSize: 11, color: 'var(--text-tertiary)', textDecoration: 'line-through' }}
                  >
                    {formatPrice(listing.compareAtPriceZarCents!)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>
                    −{compareAtPct}%
                  </span>
                </>
              )}
            </span>
            {/* Phase E1 — GG+ pill (MEMBER/PRO) + verified-expert badge.
                Renders nothing for FREE non-expert sellers so card density
                doesn't regress. Kept on the price line because it is a
                per-SELLER mark rather than seller reputation. */}
            <UserBadges
              subscriptionTier={listing.seller.subscriptionTier}
              isVerifiedExpert={listing.seller.isVerifiedExpert}
            />
          </div>

          {/* ⚠️ ONE SELLER LINE, NOT TWO. The tier chip used to sit on the
              price row and the rating on a row of its own beneath it — so
              reputation was split across two lines while the price shared its
              line with a chip. Both are the same claim ("who is selling this,
              and are they any good"), so they read as one line: rating first,
              because a number people understand outranks a tier name only we
              use. */}
          <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
            {listing.seller.averageRating != null &&
              (listing.seller._count?.ratingsReceived ?? 0) > 0 && (
                <>
                  <SellerRating
                    rating={listing.seller.averageRating}
                    count={listing.seller._count?.ratingsReceived}
                    compact
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      width: 2,
                      height: 2,
                      borderRadius: 99,
                      background: 'var(--text-tertiary)',
                      flex: '0 0 auto',
                    }}
                  />
                </>
              )}
            <span
              className="text-[11px] truncate"
              style={{ color: 'var(--text-tertiary-on-card)' }}
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
