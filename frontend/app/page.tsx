import { apiFetch } from '@/lib/api';
import { BrowseResponse, Category } from '@/lib/types';
import { ListingCard } from '@/components/listing-card';
import { FilterBar } from '@/components/filter-bar';
import { Hero } from '@/components/hero';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { FeaturedRail } from '@/components/featured-rail';
import { SignedInWelcome } from '@/components/signed-in-welcome';

interface SearchParams {
  q?: string;
  categoryId?: string;
  listingType?: string;
  condition?: string;
  province?: string;
  sort?: string;
  page?: string;
}

// Map a listingType URL param to the user-facing surface name.
const SURFACE_TITLES: Record<string, { title: string; subtitle: string }> = {
  BUY_NOW: {
    // "Marketplace" is the user-facing label for the BUY_NOW surface — these
    // are used-gear listings priced and ready to ship.
    title: 'Marketplace',
    subtitle: 'Used firearms and gear — pay the listed price and go',
  },
  AUCTION: {
    title: 'Auctions',
    subtitle: 'Timed bidding with proxy bids and snipe protection',
  },
  TAKE_A_SHOT: {
    title: 'Take a Shot',
    subtitle: 'Make an offer — sellers can accept, counter once, or decline',
  },
};
// Bare "/" with no listingType — landing experience with the hero.
const DEFAULT_SURFACE = {
  title: 'Live listings',
  subtitle: 'Everything on sale right now, across the four shopping surfaces',
};

// Per-page metadata so the browser tab + Open Graph reflect the surface.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { listingType } = await searchParams;
  const surface = listingType
    ? (SURFACE_TITLES[listingType] ?? DEFAULT_SURFACE)
    : DEFAULT_SURFACE;
  return {
    title: listingType
      ? `${surface.title} — Gun Galore`
      : 'Gun Galore — SA Firearms Marketplace',
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const surface = params.listingType
    ? (SURFACE_TITLES[params.listingType] ?? DEFAULT_SURFACE)
    : DEFAULT_SURFACE;

  // Only show the hero on the bare homepage. As soon as the user has
  // picked a surface (or any other filter), the hero hides — the user has
  // already committed to browsing.
  const showHero = !params.listingType && !params.q && !params.categoryId;

  // Per-surface background scenery + reveal animation.
  // Each surface that opts in gets its own photo + reveal variant so the
  // feel matches the buying mode:
  //   Marketplace = storefront photo + slide-right (cards dealt on counter)
  //   Auctions    = paddles + slide-up
  //   Take a Shot = target + scale-in (snap into focus)
  const isAuction = params.listingType === 'AUCTION';
  const isTakeAShot = params.listingType === 'TAKE_A_SHOT';
  const isMarketplace = params.listingType === 'BUY_NOW';
  const hasBackground = isAuction || isTakeAShot || isMarketplace;

  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.categoryId) qs.set('categoryId', params.categoryId);
  if (params.listingType) qs.set('listingType', params.listingType);
  if (params.condition) qs.set('condition', params.condition);
  if (params.province) qs.set('province', params.province);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', params.page);
  qs.set('limit', '24');

  // On the bare landing page (showHero) we replace the browse grid
  // with the FEATURED grid. On every other surface we keep the
  // standard browse. Both queries fire in parallel so the slower
  // doesn't block the other.
  const [browse, categories, featuredListings] = await Promise.all([
    apiFetch<BrowseResponse>(`/listings?${qs}`, { cache: 'no-store' }).catch(
      () => ({ listings: [], total: 0, page: 1, limit: 24 }),
    ),
    apiFetch<Category[]>('/categories', {
      next: { revalidate: 3600 },
    } as RequestInit).catch(() => [] as Category[]),
    showHero
      ? apiFetch<
          {
            slotNumber: number;
            status: 'VACANT' | 'AUCTION_RUNNING' | 'BIND_WINDOW' | 'OCCUPIED';
            listing: import('@/lib/types').Listing | null;
          }[]
        >('/featured/listings', { cache: 'no-store' }).catch(() => [])
      : Promise.resolve(
          [] as {
            slotNumber: number;
            status: 'VACANT' | 'AUCTION_RUNNING' | 'BIND_WINDOW' | 'OCCUPIED';
            listing: import('@/lib/types').Listing | null;
          }[],
        ),
  ]);

  const currentPage = browse.page;
  const hasNext = currentPage * browse.limit < browse.total;
  const hasPrev = currentPage > 1;

  function pageHref(p: number) {
    const next = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    );
    next.set('page', String(p));
    return `/?${next}`;
  }

  return (
    <main
      className="relative"
      style={hasBackground ? { zIndex: 1 } : undefined}
    >
      {/* Per-surface scenery. Same PageBackground component the Sell
          page uses — each photo gets the dark tint + radial vignette
          so the listing cards stay primary. */}
      {isMarketplace && (
        <PageBackground imageSrc="/marketplace.jpg" opacity={0.18} />
      )}
      {isAuction && (
        <PageBackground imageSrc="/auction.jpg" opacity={0.18} />
      )}
      {isTakeAShot && (
        <PageBackground imageSrc="/take%20shot.jpeg" opacity={0.18} />
      )}

      {showHero && <Hero />}
      {showHero && <SignedInWelcome />}

      {/* ─── Bare landing page: featured-only grid, no rail, no filter ───
          When the user lands on "/" with no filters, the main grid
          shows the 10 featured listings (the same ones promoted in
          the rail on every other surface). No FilterBar, no
          pagination — the landing page is intentionally curated.
          The FeaturedRail sidebar is dropped from this surface only;
          it stays on Marketplace / Auctions / Take a Shot / Competitions
          / listing detail. */}
      {showHero ? (
        <section
          data-featured-home-section
          className="max-w-[1280px] mx-auto px-4 py-10"
        >
          {/* Centered "Featured" header with red→gold gradient fill
              + warm drop-shadow glow (matches the card glow). Hairline
              gradient rules on either side give it a premium catalog
              feel — they fade in toward the text from outer transparent
              so the eye is drawn to the heading. */}
          <div className="flex items-center justify-center gap-5 mb-6 mt-2">
            <div
              style={{
                flex: '0 1 120px',
                height: 1,
                background:
                  'linear-gradient(to right, transparent, rgba(232, 181, 58, 0.6))',
              }}
            />
            <h2
              className="text-4xl sm:text-5xl"
              style={{
                fontWeight: 600,
                letterSpacing: '0.02em',
                background:
                  'linear-gradient(135deg, #C8102E 0%, #E8B53A 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                WebkitTextFillColor: 'transparent',
                filter:
                  'drop-shadow(0 0 18px rgba(232, 181, 58, 0.40))' +
                  ' drop-shadow(0 0 6px rgba(200, 16, 46, 0.30))',
              }}
            >
              Featured
            </h2>
            <div
              style={{
                flex: '0 1 120px',
                height: 1,
                background:
                  'linear-gradient(to right, rgba(232, 181, 58, 0.6), transparent)',
              }}
            />
          </div>
          {/* Continuously scrolling horizontal marquee — single row
              of half-size cards drifting left. Doubled track + 50%
              translateX gives a seamless loop; hover pauses. Side
              mask gradient softens the left/right edges so cards
              entering / leaving don't get hard-clipped (which would
              also chop their glow). Each card gets a warm red→gold
              glow shadow — no gradient outline, just pure glow. */}
          <style>{`
            @keyframes featuredHomeScrollH {
              from { transform: translateX(0); }
              to   { transform: translateX(-50%); }
            }
            .featured-home-track:hover .featured-home-track-inner {
              animation-play-state: paused;
            }
          `}</style>
          <div
            className="featured-home-track"
            style={{
              position: 'relative',
              overflow: 'hidden',
              marginTop: 24,
              WebkitMaskImage:
                'linear-gradient(to right, transparent 0%, black 4%, black 96%, transparent 100%)',
              maskImage:
                'linear-gradient(to right, transparent 0%, black 4%, black 96%, transparent 100%)',
            }}
          >
            <div
              className="featured-home-track-inner"
              style={{
                display: 'flex',
                gap: 16,
                width: 'max-content',
                // Padding so card glow has room to breathe at the
                // track's top/bottom + left/right edges.
                paddingTop: 28,
                paddingBottom: 28,
                paddingLeft: 12,
                paddingRight: 12,
                animation: 'featuredHomeScrollH 60s linear infinite',
              }}
            >
              {[...featuredListings, ...featuredListings].map((slot, i) => (
                <div
                  key={`${slot.slotNumber}-${i}`}
                  style={{
                    // ~50% of the previous 2-column card width.
                    width: 280,
                    flexShrink: 0,
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: 'var(--bg-card)',
                    boxShadow:
                      '0 0 28px rgba(232, 181, 58, 0.50),' +
                      ' 0 0 10px rgba(200, 16, 46, 0.45)',
                  }}
                >
                  {slot.listing ? (
                    <ListingCard listing={slot.listing} />
                  ) : (
                    <EmptyFeaturedSlotCard slotNumber={slot.slotNumber} />
                  )}
                </div>
              ))}
            </div>
          </div>
          {featuredListings.length === 0 && (
            <div
              className="text-center py-12 text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Featured slots loading…
            </div>
          )}
        </section>
      ) : hasBackground ? (
        /* Filtered surfaces (marketplace/auctions/take-a-shot) keep
           the rail + browse layout. */
        <PageReveal
          variant={
            isTakeAShot
              ? 'scale-in'
              : isMarketplace
                ? 'slide-right'
                : 'slide-up'
          }
        >
          <div className="max-w-[1280px] mx-auto px-4 py-10 flex flex-col lg:flex-row gap-6">
            <FeaturedRail />
            <section className="flex-1 min-w-0">
              {renderListingsBody()}
            </section>
          </div>
        </PageReveal>
      ) : (
        <div className="max-w-[1280px] mx-auto px-4 py-10 flex flex-col lg:flex-row gap-6">
          <FeaturedRail />
          <section className="flex-1 min-w-0">
            {renderListingsBody()}
          </section>
        </div>
      )}
    </main>
  );

  // Shared body of the listings <section>, lifted into a closure so we
  // can render it inside the conditional PageReveal wrapper without
  // duplicating ~50 lines of JSX. data-reveal attrs are present on every
  // top-level child so the PageReveal keyframe can pick them up when
  // it's mounted.
  function renderListingsBody() {
    return (
      <>
        {/* Section header — title + subtitle change per surface so the
            user always knows which slice of the marketplace they're
            looking at. */}
        <div
          data-reveal
          className="flex items-end justify-between mb-5 gap-4 flex-wrap"
        >
          <div>
            <h1
              className="text-2xl sm:text-3xl"
              style={{
                color: 'var(--text-primary)',
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              {surface.title}
            </h1>
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {surface.subtitle} ·{' '}
              {browse.total.toLocaleString('en-ZA')} item
              {browse.total !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div data-reveal>
          <FilterBar categories={categories} currentParams={params} />
        </div>

        {browse.listings.length === 0 ? (
          <div
            data-reveal
            className="rounded-[8px] py-12 px-6 text-center mt-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px dashed var(--border)',
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Nothing matches {surface.title.toLowerCase()} yet
            </p>
            <p
              className="text-sm mb-5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {Object.keys(params).filter((k) => params[k as keyof SearchParams] && k !== 'listingType').length > 0
                ? 'Try clearing some filters or browse the other shopping surfaces.'
                : 'Be the first to spot new listings here — check back soon or browse the other shopping surfaces below.'}
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              {Object.keys(params).filter((k) => params[k as keyof SearchParams] && k !== 'listingType' && k !== 'q').length > 0 && (
                /* Clear filters preserves both the listingType (the
                   shopping surface the user is on) AND the search
                   query (the term they typed). Only the constraints
                   that narrow the result set further — category,
                   province, condition, sort — get stripped. */
                <a
                  href={(() => {
                    const next = new URLSearchParams();
                    if (params.listingType) next.set('listingType', params.listingType);
                    if (params.q) next.set('q', params.q);
                    const qs = next.toString();
                    return qs ? `/?${qs}` : '/';
                  })()}
                  className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
                  style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  Clear filters →
                </a>
              )}
              <a
                href="/"
                className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  textDecoration: 'none',
                }}
              >
                Browse everything
              </a>
            </div>
          </div>
        ) : (
          <>
            <div
              data-reveal
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-4"
            >
              {browse.listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>

            {(hasPrev || hasNext) && (
              <div
                data-reveal
                className="flex justify-center gap-2 mt-10"
              >
                {hasPrev && (
                  <a
                    href={pageHref(currentPage - 1)}
                    className="px-4 py-2 rounded-[6px] text-sm"
                    style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                  >
                    ← Previous
                  </a>
                )}
                {hasNext && (
                  <a
                    href={pageHref(currentPage + 1)}
                    className="px-4 py-2 rounded-[6px] text-sm"
                    style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                  >
                    Next →
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </>
    );
  }
}

// Placeholder shown in the homepage featured grid for any slot that
// isn't currently bound to a listing (VACANT / AUCTION_RUNNING /
// BIND_WINDOW). Same outer dimensions as a real ListingCard so the
// 4-up grid stays aligned. Grey gradient interior matches the
// gradient settings used elsewhere (135deg linear, 0-100%) so the
// placeholder reads as part of the same visual family but clearly
// shows "nothing here yet — bid for this spot".
function EmptyFeaturedSlotCard({ slotNumber }: { slotNumber: number }) {
  return (
    <a
      href="/featured/bid"
      style={{
        display: 'block',
        background:
          'linear-gradient(135deg, rgba(100, 100, 100, 0.35) 0%, rgba(100, 100, 100, 0) 100%), var(--bg-card)',
        textDecoration: 'none',
        height: '100%',
      }}
    >
      {/* Same 4:3 box ListingCard uses (52.5% padding-bottom) — keeps
          the placeholder card the exact same height as a real one. */}
      <div className="relative" style={{ paddingBottom: '52.5%' }}>
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <span className="text-xs uppercase" style={{ letterSpacing: '0.08em' }}>
            Slot #{slotNumber}
          </span>
        </div>
      </div>
      <div className="p-3">
        <p
          className="text-sm leading-snug mb-2"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Featured spot available
        </p>
        <p
          className="text-xs"
          style={{ color: 'var(--red)', fontWeight: 500 }}
        >
          Place a bid →
        </p>
      </div>
    </a>
  );
}
