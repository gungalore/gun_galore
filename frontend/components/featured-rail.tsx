'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ─── Types ────────────────────────────────────────────────────────────
// Mirrors the shape returned by GET /api/featured/rail. Kept inline
// (not in lib/types) because no other component reads this — the rail
// is a leaf component used by 5 surface pages.
interface RailSlot {
  id: string;
  slotNumber: number;
  status: 'VACANT' | 'AUCTION_RUNNING' | 'BIND_WINDOW' | 'OCCUPIED';
  featuredUntil: string | null;
  currentListing: null | {
    id: string;
    title: string;
    price: number | null;
    listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT' | 'SWOP';
    currentBid: number | null;
    buyNowPrice: number | null;
    seller: { username: string | null };
    images: { url: string }[];
    category: { name: string };
  };
  currentAuction: null | {
    id: string;
    kind: 'SCHEDULED' | 'AD_HOC';
    status: 'OPEN' | 'CLOSED_AWARDED' | 'CLOSED_NO_BIDS' | 'CANCELLED_BY_ADMIN';
    openedAt: string;
    closesAt: string | null;
  };
}

function formatRand(cents: number | null): string {
  if (cents == null) return '—';
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatRemaining(closesAt: string): string {
  const ms = new Date(closesAt).getTime() - Date.now();
  if (ms <= 0) return 'closing';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m left`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
}

// Pick the right price to show on a featured card. AUCTION → current
// bid (or starting bid). TAKE_A_SHOT → "Make an offer". BUY_NOW → price.
function listingHeadline(l: NonNullable<RailSlot['currentListing']>): string {
  if (l.listingType === 'AUCTION') {
    return formatRand(l.currentBid ?? l.price);
  }
  if (l.listingType === 'TAKE_A_SHOT') {
    return 'Make an offer';
  }
  if (l.listingType === 'SWOP') {
    return 'Swap';
  }
  return formatRand(l.price);
}

// ─── The rail ─────────────────────────────────────────────────────────
// Sticky left sidebar on desktop, horizontal pinned scroller on mobile.
// All 10 slots are rendered. Occupied slots show the bound listing as
// a clickable card; auction-running / vacant slots show a "bid now"
// nudge linking to /featured/bid.
//
// Continuous CSS keyframe scroll on desktop — slow, hover-paused. To
// make the loop seamless we render the slot list TWICE inside an
// animated wrapper that translates from 0 to -50%; when the wrapper
// reaches -50% it visually matches its starting state and the
// animation can repeat without a jump cut. This is the standard
// "doubled track" technique for infinite marquees.
export function FeaturedRail() {
  const [slots, setSlots] = useState<RailSlot[] | null>(null);

  // Initial fetch + revalidate every 60s so the rail reflects new
  // winners + sold listings within a minute. We DON'T poll faster
  // because the rail is decorative — buyers click into a card and
  // see the live listing detail (which has its own polling).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_URL}/featured/rail`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as RailSlot[];
        if (!cancelled) setSlots(data);
      } catch {
        // Decorative — keep the last good snapshot on network blip.
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!slots) {
    // First-paint: don't reserve space. The grid the rail sits next
    // to has its own min-height so layout doesn't jump when the rail
    // populates a second later.
    return null;
  }

  return (
    <>
      {/* ─── Desktop: sticky left sidebar ──────────────────────── */}
      <aside
        className="hidden lg:block"
        style={{
          width: 260,
          flexShrink: 0,
          position: 'sticky',
          top: 88, // clears the site nav + a comfortable gap
          alignSelf: 'flex-start',
          maxHeight: 'calc(100vh - 120px)',
          borderRight: '0.5px solid var(--border)',
          paddingRight: 12,
          paddingLeft: 12,
          // Standard CSS "full-bleed escape" — pulls the aside out
          // of the centred 1280px wrapper so its left edge sits 15px
          // from the viewport. Math holds at every viewport width
          // because 50% references the flex container's content box.
          // Width stays at 260px; only position moves. The flex
          // layout downstream (the section beside us) is unaffected
          // because margins don't change the flex slot's reserved width.
          marginLeft: 'calc(-50vw + 50% + 15px)',
          // Neutral grey wash fading right to transparent — same
          // gradient shape as before, just grey at 50% opacity with
          // no dark tint layer. Cards do the eye-catching with their
          // own glow now, so the rail background can stay calm.
          background:
            'linear-gradient(to right, rgba(120, 120, 120, 0.5), rgba(120, 120, 120, 0))',
        }}
      >
        <div
          className="text-[10px] uppercase mb-3"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            fontWeight: 500,
          }}
        >
          Featured
        </div>

        <style>{`
          @keyframes featuredScroll {
            from { transform: translateY(0); }
            to   { transform: translateY(-50%); }
          }
          .featured-track:hover .featured-track-inner {
            animation-play-state: paused;
          }
        `}</style>

        <div
          className="featured-track"
          style={{
            position: 'relative',
            height: 'calc(100vh - 160px)',
            overflow: 'hidden',
            // Soft top/bottom fade so cards entering/leaving the
            // visible area don't get hard-clipped (which would also
            // chop the card glow). Mask uses 8% on each end so the
            // glow has room to fade gracefully.
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
            maskImage:
              'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
            // Extra horizontal padding so card glows aren't clipped
            // by the aside's right edge.
            paddingLeft: 4,
            paddingRight: 4,
          }}
        >
          <div
            className="featured-track-inner"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              animation:
                // 90s for a full cycle — 9s per card on the 10-card
                // track. Doubled (track is rendered twice), so the
                // visual cadence at any point in the viewport is one
                // card every ~4.5s, which reads as "drifting" rather
                // than "scrolling".
                'featuredScroll 90s linear infinite',
              animationPlayState: 'running',
            }}
          >
            {[...slots, ...slots].map((slot, i) => (
              <RailCard
                key={`${slot.id}-${i}`}
                slot={slot}
                variant="desktop"
              />
            ))}
          </div>
        </div>

        <Link
          href="/featured/bid"
          className="block text-xs text-center mt-3 py-2 rounded-[6px]"
          style={{
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Bid for a featured spot →
        </Link>
      </aside>

      {/* ─── Mobile: horizontal pinned scroller at top ───────────
          Sits inside the main flow above the page content. Same
          loop technique but rotated horizontal.
          Hidden in standalone-PWA mode — there the StickyFeaturedStrip
          (mounted in the layout) hugs the bottom tab bar instead, so
          rendering this inline rail too would surface the same
          featured slots twice on the homepage. CSS rule lives in
          globals.css: `html[data-standalone='true'] [data-featured-rail-inline] { display: none }`. */}
      <div
        data-featured-rail-inline
        className="lg:hidden mb-6"
        style={{
          borderTop: '0.5px solid var(--border)',
          borderBottom: '0.5px solid var(--border)',
          paddingTop: 10,
          paddingBottom: 10,
        }}
      >
        <div className="flex items-baseline justify-between px-4 mb-2">
          <div
            className="text-[10px] uppercase"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.08em',
              fontWeight: 500,
            }}
          >
            Featured
          </div>
          <Link
            href="/featured/bid"
            className="text-[11px]"
            style={{ color: 'var(--red)', textDecoration: 'none' }}
          >
            Bid for a spot →
          </Link>
        </div>

        <style>{`
          @keyframes featuredScrollH {
            from { transform: translateX(0); }
            to   { transform: translateX(-50%); }
          }
          .featured-track-h:hover .featured-track-inner-h {
            animation-play-state: paused;
          }
        `}</style>

        <div
          className="featured-track-h"
          style={{ overflow: 'hidden' }}
        >
          <div
            className="featured-track-inner-h"
            style={{
              display: 'flex',
              gap: 10,
              paddingLeft: 16,
              paddingRight: 16,
              width: 'max-content',
              animation: 'featuredScrollH 90s linear infinite',
            }}
          >
            {[...slots, ...slots].map((slot, i) => (
              <RailCard
                key={`m-${slot.id}-${i}`}
                slot={slot}
                variant="mobile"
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── One card ─────────────────────────────────────────────────────────
function RailCard({
  slot,
  variant,
}: {
  slot: RailSlot;
  variant: 'desktop' | 'mobile';
}) {
  // Desktop cards are full-width-of-rail (260px-ish) and short. Mobile
  // cards are narrow (180px-ish) horizontal tiles. Both variants share
  // the same warm red→gold glow so the rail reads as a band of paid
  // placements (matched on the homepage featured grid).
  const featuredGlow =
    '0 0 18px rgba(232, 181, 58, 0.45),' +
    ' 0 0 6px rgba(200, 16, 46, 0.40)';
  const cardStyle: React.CSSProperties =
    variant === 'desktop'
      ? {
          width: '100%',
          minHeight: 110,
          padding: 10,
          borderRadius: 6,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          boxShadow: featuredGlow,
          textDecoration: 'none',
          display: 'flex',
          gap: 10,
          flexShrink: 0,
        }
      : {
          width: 200,
          minHeight: 100,
          padding: 10,
          borderRadius: 6,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          boxShadow: featuredGlow,
          textDecoration: 'none',
          display: 'flex',
          gap: 10,
          flexShrink: 0,
        };

  // If the slot has a bound listing, the card is a clickable Link
  // straight to that listing. Otherwise it's a "bid for this slot"
  // nudge linking to /featured/bid.
  if (slot.currentListing) {
    const l = slot.currentListing;
    const cover = l.images[0]?.url;
    return (
      <Link href={`/listings/${l.id}`} style={cardStyle}>
        <div
          style={{
            width: 60,
            height: 60,
            flexShrink: 0,
            borderRadius: 4,
            overflow: 'hidden',
            background: 'var(--bg-inset)',
            position: 'relative',
          }}
        >
          {cover ? (
            <Image
              src={cover}
              alt={l.title}
              fill
              className="object-cover"
              sizes="60px"
            />
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="text-[10px] uppercase mb-1"
            style={{
              color: 'var(--red)',
              letterSpacing: '0.08em',
              fontWeight: 500,
            }}
          >
            #{slot.slotNumber} · Featured
          </div>
          <div
            className="text-[12px] leading-snug line-clamp-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {l.title}
          </div>
          <div
            className="text-[11px] mt-1"
            style={{ color: 'var(--red)', fontWeight: 500 }}
          >
            {listingHeadline(l)}
          </div>
          {l.seller.username && (
            <div
              className="text-[10px] mt-0.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              @{l.seller.username}
            </div>
          )}
        </div>
      </Link>
    );
  }

  // Auction in progress OR vacant — show a "bid now" nudge. Slot
  // status determines the copy.
  const isAuctionOpen =
    slot.currentAuction && slot.currentAuction.status === 'OPEN';
  return (
    <Link
      href="/featured/bid"
      style={{
        ...cardStyle,
        background: 'var(--bg-inset)',
        borderStyle: 'dashed',
      }}
    >
      <div style={{ flex: 1, alignSelf: 'center', textAlign: 'center' }}>
        <div
          className="text-[10px] uppercase mb-1"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            fontWeight: 500,
          }}
        >
          #{slot.slotNumber} · {isAuctionOpen ? 'Auction open' : 'Slot opening'}
        </div>
        <div
          className="text-[12px] leading-snug"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          {/* closesAt=null means the auction is open but no first bid
              yet. Display "Waiting for first bid" instead of a
              countdown — the timer only starts on the first bid. */}
          {isAuctionOpen && slot.currentAuction?.closesAt
            ? `Closing in ${formatRemaining(slot.currentAuction.closesAt)}`
            : isAuctionOpen
              ? 'Waiting for first bid'
              : 'Just opened — bid now'}
        </div>
        <div
          className="text-[11px] mt-1"
          style={{ color: 'var(--red)' }}
        >
          Place a bid →
        </div>
      </div>
    </Link>
  );
}
