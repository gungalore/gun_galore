'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Listing } from '@/lib/types';
import { formatPrice, CONDITION_LABELS, TIER_LABELS, discountPercent } from '@/lib/utils';
import { vicinityLabel } from '@/lib/vicinity';
import { WishlistButton } from './wishlist-button';
import { useCountdown, formatCountdown } from '@/lib/use-countdown';
import { UserBadges } from './user-badges';
import { VerificationBadges } from './verification-badges';
import { UrgencyChip } from './urgency-chip';
import { SellerRating } from './seller-rating';
import { SavedCount } from './saved-count';

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

/** A compact, neutral label for the listing's commercial mode. */
function ModePill({
  href,
  label,
  title,
}: {
  href: string;
  label: string;
  title: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${title}`}
      className="gg-press"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 26,
        padding: '0 10px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: 'var(--bg-inset)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-head)',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '0.01em',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Link>
  );
}

export function ListingCard({ listing }: { listing: Listing }) {
  // See the fade note on the <Image> below.
  const [imgLoaded, setImgLoaded] = useState(false);
  // Social-proof count. The server is the source of truth, but the viewer's
  // own heart press must move the number immediately - waiting for the next
  // catalogue refresh to add 1 would make the card look broken at the exact
  // moment the buyer interacted with it. The delta is reset whenever the
  // server hands us a new count, so a refresh can never leave a stale +1.
  const serverSaved = listing._count?.wishlistedBy ?? 0;
  const [savedDelta, setSavedDelta] = useState(0);
  useEffect(() => {
    setSavedDelta(0);
  }, [serverSaved]);
  const savedCount = Math.max(0, serverSaved + savedDelta);
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
  // Only a seller-ticked video replaces the cover. It is muted and plays when
  // the card is on screen, so the grid stays calm and data-light off-screen.
  const heroVideo = listing.video?.isHero ? listing.video : null;
  // UX-7 — compare-at ("was") price discount, BUY_NOW only.
  const compareAtPct =
    listing.listingType === 'BUY_NOW'
      ? discountPercent(listing.price, listing.compareAtPriceZarCents)
      : null;
  const isAuction = listing.listingType === 'AUCTION';

  return (
    // ⚠️ NOT A LINK. The card is a container; the photo and title are their own
    // links and the price-pill is an explicit sibling link. An anchor wrapping
    // anchors is invalid HTML and a screen-reader trap.
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
        className="block group gg-press"
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
          {heroVideo ? (
            <CardVideo
              src={heroVideo.playbackUrl || heroVideo.url}
              poster={heroVideo.thumbnailUrl}
              title={listing.title}
            />
          ) : primaryImage ? (
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
                objectPosition: 'center center',
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

          {/* Inner keyline. The frame is the photo itself, so the line sits
              INSIDE the image instead of adding a box around it. --hairline
              is white/10 on the dark theme and ink/10 on the light one — a
              literal white/10 would vanish on the light shop. */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              border: '1px solid var(--hairline)',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />

          {/* Mode badge — top-left, AUCTIONS ONLY. The pack marks the MODE
              here, not the category: in a mixed feed "fixed price or bid?" is
              what a browser needs answered at a glance, and the category is
              usually the filter they arrived through. Marketplace carries no badge
              at all, so the gold reads as the exception it is. */}
          {isAuction && (
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
          {/* Condition chip — bottom-left of the image, clear of the heart.
              A crisp dark scrim rather than a theme-coloured chip: it must
              read the same over a white studio shot and a dark outdoor one. */}
          <span
            className="absolute bottom-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
            style={{
              background: 'rgba(0,0,0,0.72)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              fontWeight: 600,
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
              // Model A — quantityAvailable already nets out in-flight
              // reservations, so it IS sellable; subtracting quantityReserved
              // again would double-count.
              const sellable = listing.quantityAvailable ?? 0;
              return sellable >= 1 && sellable <= 5 ? (
                <UrgencyChip
                  left={sellable}
                  className="absolute bottom-2 right-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
                />
              ) : null;
            })()}
          {/* Heart — save for later. Top-right, frosted dark glass so it reads
              against any photo. Tapping the heart stops propagation so the
              parent <Link> doesn't navigate to the listing detail. */}
          <WishlistButton
            listingId={listing.id}
            onChange={(saved) =>
              setSavedDelta((d) => d + (saved ? 1 : -1))
            }
          />
        </div>
      </Link>

      {/* Card body. Title first, then price + explicit mode pill, then seller
          proof and the location. Every row is in the same order on every card,
          so a row of cards reads as a table rather than a pile. */}
      <div className="p-3 flex flex-col flex-1">
        <Link
          href={`/listings/${listing.id}`}
          className="gg-press"
          style={{ textDecoration: 'none', display: 'block' }}
        >
          <p
            className="text-[13px] leading-[1.35] line-clamp-2"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              minHeight: 35,
              margin: 0,
            }}
          >
            {listing.title}
          </p>
        </Link>

        <div className="flex items-center gap-2 flex-wrap mt-1.5">
          <span
            style={{
              color: 'var(--text-primary)',
              fontWeight: 700,
              fontFamily: 'var(--font-head)',
              fontSize: 19,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
              // On a 2-column phone card the seller verification chips used
              // to squeeze this span until the browser broke "R 10" across two
              // lines. A price is one token; it may not wrap.
              whiteSpace: 'nowrap',
            }}
          >
            {/* For auctions, show the current bid (or starting bid if no bids yet). */}
            {isAuction
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
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                −{compareAtPct}%
              </span>
            </>
          )}
          <ModePill
            href={`/listings/${listing.id}#buy-panel`}
            label={isAuction ? 'Auction' : 'Marketplace'}
            title={listing.title}
          />
          {/* Phase E1 — GG+ pill (MEMBER/PRO) + verified-expert badge.
              Renders nothing for FREE non-expert sellers so card density
              doesn't regress. Kept on the price line because it is a
              per-SELLER mark rather than seller reputation. */}
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <UserBadges
              subscriptionTier={listing.seller.subscriptionTier}
              isVerifiedExpert={listing.seller.isVerifiedExpert}
            />
            <VerificationBadges verification={listing.seller.verification} />
          </span>
        </div>

        {/* Town, not province — matches listing detail, cart and checkout,
            which all read this through the same vicinityLabel() helper.
            It falls back to province (or "the seller's area") on its own,
            so this line is never blank. The save count shares the line so
            the card gains urgency without gaining another row. */}
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <p
            className="text-xs min-w-0 truncate"
            style={{
              color: 'var(--text-tertiary-on-card)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{ flexShrink: 0 }}
            >
              <path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10Z" />
              <circle cx="12" cy="11" r="2.2" />
            </svg>
            <span className="truncate">{vicinityLabel(listing)}</span>
          </p>
          <SavedCount count={savedCount} />
        </div>

        {/* ⚠️ ONE SELLER LINE, NOT TWO, AND IT SITS UNDER THE LOCATION. The
            required reading order is title → price + mode pill → location;
            reputation is supporting detail, so it comes after. Rating first,
            because a number people understand outranks a tier name only we
            use. */}
        <div className="flex items-center gap-1.5 mt-1 min-w-0">
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

        {/* Auctions put their live state at the foot of the card. Marketplace has
            nothing to say here: the price-pill is the action and the card's
            photo/title are the links. */}
        {isAuction && (
          <span
            className="flex items-center gap-1.5 text-[11px] min-w-0 mt-1.5"
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
      // ⚠️ nowrap AND shrink-0. "Ends in 2h 31m" is one fact and breaking it
      // across lines inside its own bordered chip reads as a rendering fault,
      // which is exactly how it looked on the operator's phone. Let the bid
      // count beside it give way instead — it already truncates.
      className="px-1.5 py-0.5 rounded-[3px] whitespace-nowrap shrink-0"
      style={{
        background: urgent ? 'var(--red-wash)' : 'var(--bg-inset)',
        // Audit L18 — urgent ink was var(--red), which in dark mode is the
        // night-sky blue (#0967F5, ~3.1:1 on the wash) and failed AA for 11px
        // text. The chip keeps its red identity through the wash and border;
        // the text itself takes the theme's own high-contrast ink.
        color: urgent ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: urgent ? 500 : 400,
        border: `0.5px solid ${urgent ? 'var(--red)' : 'var(--border)'}`,
      }}
    >
      Ends in {label}
    </span>
  );
}

function CardVideo({
  src,
  poster,
  title,
}: {
  src: string;
  poster?: string | null;
  title: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const play = () => {
      void el.play().catch(() => undefined);
    };
    const pause = () => el.pause();

    if (typeof IntersectionObserver === 'undefined') {
      el.preload = 'auto';
      play();
      return () => pause();
    }

    // Load roughly one screen ahead so the next card is already buffered when
    // it scrolls in, but do NOT play it until 35% is visible.
    const preloadObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || el.preload === 'auto') return;
        el.preload = 'auto';
        if (el.readyState === 0) el.load();
      },
      { rootMargin: '600px 0px', threshold: 0 },
    );

    const playObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) play();
        else pause();
      },
      { threshold: [0, 0.35, 1] },
    );

    preloadObserver.observe(el);
    playObserver.observe(el);
    return () => {
      preloadObserver.disconnect();
      playObserver.disconnect();
      pause();
    };
  }, []);

  // Do NOT set autoPlay. It starts fetching/playing every hero video as soon
  // as the element mounts, including cards far below the fold. Instead the
  // preload observer only buffers a card within 600px of the viewport, and the
  // play observer starts it at 35% visibility.
  return (
    <video
      ref={ref}
      src={src}
      poster={poster ?? undefined}
      aria-label={`${title} video`}
      muted
      loop
      playsInline
      preload="none"
      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
    />
  );
}
