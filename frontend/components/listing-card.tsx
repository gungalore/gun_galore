'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Listing } from '@/lib/types';
import { formatPrice, CONDITION_LABELS, TIER_LABELS, discountPercent } from '@/lib/utils';
import { vicinityLabel } from '@/lib/vicinity';
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
  // See the fade note on the <Image> below.
  const [imgLoaded, setImgLoaded] = useState(false);
  // Seeds the fade from the element itself. A cached image can finish loading
  // BEFORE React attaches onLoad — without this the photo would sit at
  // opacity 0 permanently on every second page view.
  const imgRef = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete) setImgLoaded(true);
  }, []);
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
    // ⚠️ NOT A LINK ANY MORE. The whole card used to be one <Link>; the
    // action row below is itself a link, and an anchor inside an anchor is
    // invalid HTML and a screen-reader trap. The card is a container now,
    // the photo and text are the link, and the action is its sibling.
    <div
      className="gg-tile gg-tile-lift rounded-[6px] overflow-hidden flex flex-col h-full"
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
      <Link
        href={`/listings/${listing.id}`}
        className="block group gg-press flex-1"
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
              ref={imgRef}
              onLoad={() => setImgLoaded(true)}
              // A failed image must still reveal its alt text rather than
              // leaving a blank box: the fade fails to "no fade", never to
              // "no photo".
              onError={() => setImgLoaded(true)}
              // Fade in on load. Photos used to pop to full opacity the instant
              // each finished downloading, so a grid filled in as a series of
              // jolts — the most visible jank on the site. Opacity only: the
              // 4:3 frame already reserves the box, so nothing reflows and
              // nothing else has to move.
              style={{
                opacity: imgLoaded ? 1 : 0,
                transition: 'opacity var(--dur-fast) var(--ease-out)',
              }}
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-xs"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
            >
              No photo
            </div>
          )}
          {/* Mode badge — top-left, AUCTIONS ONLY. The pack marks the MODE
              here, not the category: in a mixed feed "fixed price or bid?" is
              what a browser needs answered at a glance, and the category is
              usually the filter they arrived through. Buy Now carries no badge
              at all, so the gold reads as the exception it is. */}
          {listing.listingType === 'AUCTION' && (
            <span
              className="absolute top-2 left-2 px-[7px] py-[3px] rounded-[3px] leading-none"
              style={{
                background: 'var(--gold-tag-fill)',
                color: 'var(--gold-tag-ink)',
                fontFamily: 'var(--font-head)',
                fontWeight: 800,
                fontSize: '9.5px',
                letterSpacing: '0.7px',
              }}
            >
              AUCTION
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
          <div className="flex items-center justify-between">
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
              <span
                style={{
                  // Gold on auctions, ink on Buy Now — the pack's own
                  // split, and the only thing telling the two modes apart at a
                  // glance in a mixed feed. Every price used to be red.
                  color:
                    listing.listingType === 'AUCTION'
                      ? 'var(--gold)'
                      : 'var(--text-primary)',
                  fontWeight: 700,
                  fontFamily: 'var(--font-head)',
                  fontSize: 19,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {/* For auctions, show the current bid (or starting bid if no bids yet). */}
                {listing.listingType === 'AUCTION'
                  ? formatPrice(listing.currentBid ?? listing.price ?? 0)
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

          {/* Title, now BELOW the price. min-height reserves two lines
              whether the title needs them or not, so the meta and action rows
              land on the same baseline right across a row of cards — without
              it they jitter as titles wrap. */}
          <p
            className="text-[12.5px] leading-[1.35] line-clamp-2 mt-[5px]"
            style={{ color: 'var(--text-secondary)', minHeight: 34 }}
          >
            {listing.title}
          </p>

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

          {/* Town, not province — matches listing detail, cart and checkout,
              which all read this through the same vicinityLabel() helper.
              It falls back to province (or "the seller's area") on its own,
              so this line is never blank. */}
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
            {vicinityLabel(listing)}
          </p>
        </div>
      </Link>

      {/* Action row — pinned to the foot of the card so every one across a
          row lands on the same baseline (the title's min-height above does
          the other half of that job).

          Both controls are LINKS to the listing's buy panel, not buttons: a
          card has no price lock, no quantity and no auth context, so
          anything that looked like it committed you from here would be
          lying about what it does. */}
      <div className="px-3 pb-3 flex items-center justify-between gap-2">
        <Link
          href={`/listings/${listing.id}#buy-panel`}
          className="gg-press inline-flex items-center shrink-0"
          style={{
            height: 28,
            padding: '0 13px',
            borderRadius: 5,
            fontFamily: 'var(--font-head)',
            fontWeight: 700,
            fontSize: 12,
            textDecoration: 'none',
            ...(listing.listingType === 'AUCTION'
              ? {
                  border: '1px solid var(--gold)',
                  color: 'var(--gold)',
                }
              : {
                  background: 'var(--red)',
                  color: '#fff',
                }),
          }}
        >
          {listing.listingType === 'AUCTION' ? 'Place bid' : 'Buy now'}
        </Link>

        {/* Auctions put their live state on this side — the pack's own
            layout. Buy Now has nothing to say here: the pack shows a "Take
            a shot" link, but that flow exists only on TAKE_A_SHOT
            listings, so offering it on a Buy Now card would be a promise
            the listing page cannot keep. */}
        {listing.listingType === 'AUCTION' && (
          <span
            className="flex items-center gap-1.5 text-[11px] min-w-0"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <span className="truncate">
              {listing.bidCount > 0
                ? `${listing.bidCount} bid${listing.bidCount === 1 ? '' : 's'}`
                : 'Starting bid'}
            </span>
            <AuctionTimeChip endTime={listing.endTime} />
          </span>
        )}
      </div>
    </div>
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
