import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { BrowseResponse, Category } from '@/lib/types';
import { ListingCard } from '@/components/listing-card';
import { FilterBar } from '@/components/filter-bar';
import { SaveSearchButton } from '@/components/save-search-button';
import { Hero } from '@/components/hero';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { FeaturedRail } from '@/components/featured-rail';
import { FeaturedAvailabilityBar } from '@/components/featured-availability-bar';
import { DraggableMarquee } from '@/components/draggable-marquee';
import { SignedInWelcome } from '@/components/signed-in-welcome';
import { RecentlyViewedRail } from '@/components/recently-viewed-rail';
import { CrossSellRow } from '@/components/cross-sell-row';
import { Pagination } from '@/components/pagination';

interface SearchParams {
  q?: string;
  categoryId?: string;
  listingType?: string;
  condition?: string;
  province?: string;
  make?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
  // Per-category attribute filters (P4.3a) — URL-encoded JSON string of
  // { key: value } (SELECT/BOOLEAN equality) and { key: { min, max } }
  // (NUMBER range). Only present when a single category is in scope and the
  // buyer has set at least one attribute filter. Passed straight through to
  // the listings endpoint, which understands the same `attrs` param.
  attrs?: string;
}

// Map a listingType URL param to the user-facing surface name.
const SURFACE_TITLES: Record<string, { title: string; subtitle: string }> = {
  BUY_NOW: {
    // "Marketplace" is the user-facing label for the BUY_NOW surface — these
    // are used-gear listings priced and ready to ship.
    title: 'Marketplace',
    subtitle: 'Gear, optics & outdoor kit — pay the listed price and go',
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

// The "All listings" entry from the Shop sheet routes here with a
// sort param set (default sort=newest). Different copy from
// DEFAULT_SURFACE because the user has actively asked to see
// everything chronologically rather than a curated landing.
const ALL_LISTINGS_SURFACE = {
  title: 'All listings',
  subtitle: 'Everything on the marketplace — Marketplace, Auctions and Take a Shot combined',
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
      : 'Gun Galore — Outdoor, Hunting & Sport Marketplace',
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Pick the header copy that matches the current view:
  //   * listingType param → that surface's copy (Marketplace / Auctions / Take a Shot)
  //   * sort param without listingType → ALL_LISTINGS_SURFACE
  //     (user came from Shop → "All listings" — explicit cross-surface browse)
  //   * everything else → DEFAULT_SURFACE
  const surface = params.listingType
    ? (SURFACE_TITLES[params.listingType] ?? DEFAULT_SURFACE)
    : params.sort
      ? ALL_LISTINGS_SURFACE
      : DEFAULT_SURFACE;

  // Only show the hero on the bare homepage. As soon as the user has
  // picked a surface, sort, search query, or category, hide the hero —
  // they've committed to browsing and want to see results.
  const showHero =
    !params.listingType && !params.q && !params.categoryId && !params.sort;

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
  if (params.make) qs.set('make', params.make);
  if (params.minPrice) qs.set('minPrice', params.minPrice);
  if (params.maxPrice) qs.set('maxPrice', params.maxPrice);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', params.page);
  // Per-category attribute filters (P4.3a) — pass the already-encoded JSON
  // string straight through. The listings endpoint parses it; when absent
  // browse behaves exactly as before.
  if (params.attrs) qs.set('attrs', params.attrs);
  qs.set('limit', '24');

  // On the bare landing page (showHero) we replace the browse grid
  // with the FEATURED grid. On every other surface we keep the
  // standard browse. Both queries fire in parallel so the slower
  // doesn't block the other.
  const [browse, categories, featuredListings, brands, facetData] =
    await Promise.all([
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
    // Brand/make facet values for the FilterBar (most-listed first).
    apiFetch<string[]>('/listings/brands', {
      next: { revalidate: 3600 },
    } as RequestInit).catch(() => [] as string[]),
    // P4-polish — FilterBar facet counts ("Toyota (12)"). Only meaningful when
    // a category is scoped (the surface that renders attr facets); the backend
    // returns {} otherwise, so skip the call entirely on non-category surfaces.
    // On failure the FilterBar just renders options without counts.
    params.categoryId
      ? apiFetch<{ facets: Record<string, Record<string, number>> }>(
          `/listings/facets?${qs}`,
          { cache: 'no-store' },
        ).catch(() => ({ facets: {} }))
      : Promise.resolve({
          facets: {} as Record<string, Record<string, number>>,
        }),
  ]);

  const currentPage = browse.page;

  // Cross-sell context — a SECONDARY "you might also need…" row shown below
  // the results on a real search/filter (never the bare landing page).
  // Drawn from the dominant category of the current results (or the active
  // category filter), narrowed by the search query for the calibre signal.
  const crossSellExcludeIds = browse.listings.map((l) => l.id).join(',');

  // Featured slots with a real listing bound. Unsold slots COLLAPSE on the
  // landing page — a wall of "Featured spot available" placeholders reads
  // as a dead site to buyers; sellers get one compact bid link instead.
  const occupiedFeatured = featuredListings.filter((s) => s.listing);
  const crossSellFromCategoryId =
    params.categoryId ??
    (() => {
      const counts = new Map<string, number>();
      for (const l of browse.listings) {
        const cid = l.category?.id;
        if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1);
      }
      let best: string | undefined;
      let bestN = 0;
      for (const [cid, n] of counts) {
        if (n > bestN) {
          best = cid;
          bestN = n;
        }
      }
      return best;
    })();
  const showCrossSell =
    !showHero &&
    (Boolean(params.q) || Boolean(params.categoryId)) &&
    browse.listings.length > 0 &&
    Boolean(crossSellFromCategoryId);

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

      {/* Hero now carries the trust card on its right, so the competitive
          "why Gun Galore" proof lives inside <Hero /> — no separate banner. */}
      {showHero && <Hero />}
      {showHero && <SignedInWelcome />}

      {/* ─── Bare landing page: featured-only grid, no rail, no filter ───
          When the user lands on "/" with no filters, the main grid
          shows the 10 featured listings (the same ones promoted in
          the rail on every other surface). No FilterBar, no
          pagination — the landing page is intentionally curated.
          The FeaturedRail sidebar is dropped from this surface only;
          it stays on Marketplace / Auctions / Take a Shot / listing
          detail. */}
      {showHero ? (
        <section
          data-featured-home-section
          className="max-w-[1280px] mx-auto px-4 py-10"
        >
          {/* Centered "Featured" header with red→gold gradient fill
              + warm drop-shadow glow (matches the card glow). Hairline
              gradient rules on either side give it a premium catalog
              feel — they fade in toward the text from outer transparent
              so the eye is drawn to the heading. The WHOLE Featured
              block (header + marquee) collapses when no slot carries a
              listing — see occupiedFeatured. */}
          {occupiedFeatured.length > 0 && (<>
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
          <DraggableMarquee
            axis="x"
            speed={60}
            className="featured-home-track"
            style={{
              position: 'relative',
              marginTop: 24,
              WebkitMaskImage:
                'linear-gradient(to right, transparent 0%, black 4%, black 96%, transparent 100%)',
              maskImage:
                'linear-gradient(to right, transparent 0%, black 4%, black 96%, transparent 100%)',
            }}
            innerStyle={{
              gap: 16,
              // Padding so card glow has room to breathe at the
              // track's top/bottom + left/right edges.
              paddingTop: 28,
              paddingBottom: 28,
              paddingLeft: 12,
              paddingRight: 12,
            }}
          >
            {[...occupiedFeatured, ...occupiedFeatured].map((slot, i) => (
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
          </DraggableMarquee>
          {/* Availability indicator + bid entry, below the featured
              slots: "X of N spots open" + a "Bid for a spot" CTA. */}
          <FeaturedAvailabilityBar />
          </>)}
          {occupiedFeatured.length === 0 && (
            // Cold-start state: no slot is occupied, so the featured grid
            // is collapsed and THIS is the only featured entry point on
            // the homepage — on an empty site it's the one sellers see.
            // Vibrant banner treatment (operator 2026-07-20 "easy to
            // miss"): shared .gg-bid-spot gold glow + star + red CTA pill.
            <div className="text-center mb-8" data-reveal>
              <Link
                href="/featured/bid"
                className="gg-bid-spot inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-[10px] px-6 py-4"
                style={{
                  background:
                    'radial-gradient(130% 160% at 50% 0%, rgba(232, 181, 58, 0.16) 0%, transparent 70%), var(--bg-card)',
                  textDecoration: 'none',
                  maxWidth: 640,
                }}
              >
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="#e8b53a"
                  aria-hidden="true"
                  style={{ filter: 'drop-shadow(0 0 8px rgba(232,181,58,0.55))', flexShrink: 0 }}
                >
                  <path d="M12 2l2.9 6.26L21.5 9.3l-4.9 4.46 1.3 6.74L12 17.2l-5.9 3.3 1.3-6.74L2.5 9.3l6.6-1.04Z" />
                </svg>
                <span className="text-left">
                  <span
                    className="block text-[11px] uppercase"
                    style={{ color: '#e8b53a', letterSpacing: '0.12em', fontWeight: 700 }}
                  >
                    Featured spots open
                  </span>
                  <span
                    className="block text-sm"
                    style={{ color: 'var(--text-primary)', fontWeight: 600 }}
                  >
                    Sellers — put your listing right here, seen first by every visitor
                  </span>
                </span>
                <span
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                  style={{ background: 'var(--red)', color: '#fff', fontWeight: 600, flexShrink: 0 }}
                >
                  <i className="gg-bid-dot" aria-hidden="true" />
                  Bid or Buy Now →
                </span>
              </Link>
            </div>
          )}
          {/* Recently viewed — self-hides if the user has < 2 entries
              on this device, so cold-start visitors don't see an empty
              rail. Sits below the featured marquee so returning users
              get a quick re-entry into things they were looking at. */}
          <RecentlyViewedRail />

          {/* Latest listings — the landing page previously ended here with
              NO product grid at all: real ads were only reachable via the
              nav. `browse` (24 newest, no filters) was already fetched for
              this surface; render it. */}
          {browse.listings.length > 0 && (
            <div className="mt-10">
              <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
                <h2
                  className="text-2xl sm:text-3xl m-0"
                  style={{
                    color: 'var(--text-primary)',
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                  }}
                >
                  Latest listings
                </h2>
                <Link
                  href="/?sort=newest"
                  className="text-sm"
                  style={{ color: 'var(--red)' }}
                >
                  Browse everything →
                </Link>
              </div>
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns:
                    'repeat(auto-fill, minmax(240px, 1fr))',
                }}
              >
                {browse.listings.map((l) => (
                  <ListingCard key={l.id} listing={l} />
                ))}
              </div>
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
          <FilterBar
            categories={categories}
            currentParams={params}
            brands={brands}
            facets={facetData.facets}
          />
          {/* P5.1 — save the active filters to get alerted on new matches. */}
          <div className="mt-2">
            <SaveSearchButton params={params} />
          </div>
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
                ? 'Try clearing some filters — or save this search and we’ll alert you the moment something matches.'
                : 'Nothing listed here yet — got one lying in the safe or the garage? Yours could be the first.'}
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
                href="/listings/new"
                className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                Sell yours →
              </a>
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

            <div data-reveal>
              <Pagination
                currentPage={currentPage}
                totalPages={Math.max(
                  1,
                  Math.ceil(browse.total / browse.limit),
                )}
                hrefFor={pageHref}
              />
            </div>

            {showCrossSell && crossSellFromCategoryId && (
              <CrossSellRow
                fromCategoryId={crossSellFromCategoryId}
                q={params.q}
                excludeIds={crossSellExcludeIds}
              />
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
// 4-up grid stays aligned. Vibrant treatment (operator 2026-07-20 —
// "easy to miss"): warm-gold pulsing glow + shine sweep (shared
// .gg-bid-spot rig in globals.css), gold star, live-dot CTA pill.
// These cards SELL a paid product — they must not whisper.
function EmptyFeaturedSlotCard({ slotNumber }: { slotNumber: number }) {
  return (
    <a
      href="/featured/bid"
      className="gg-bid-spot rounded-[8px]"
      style={{
        display: 'block',
        background:
          'radial-gradient(120% 90% at 50% 0%, rgba(232, 181, 58, 0.18) 0%, rgba(232, 181, 58, 0.04) 55%, transparent 100%), var(--bg-card)',
        textDecoration: 'none',
        height: '100%',
      }}
    >
      {/* Same 4:3 box ListingCard uses (52.5% padding-bottom) — keeps
          the placeholder card the exact same height as a real one. */}
      <div className="relative" style={{ paddingBottom: '52.5%' }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          {/* Gold star — the universal "featured" glyph */}
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="#e8b53a"
            aria-hidden="true"
            style={{ filter: 'drop-shadow(0 0 8px rgba(232,181,58,0.55))' }}
          >
            <path d="M12 2l2.9 6.26L21.5 9.3l-4.9 4.46 1.3 6.74L12 17.2l-5.9 3.3 1.3-6.74L2.5 9.3l6.6-1.04Z" />
          </svg>
          <span
            className="text-[11px] uppercase"
            style={{
              letterSpacing: '0.12em',
              color: '#e8b53a',
              fontWeight: 700,
            }}
          >
            Spot #{slotNumber} open
          </span>
        </div>
      </div>
      <div className="p-3">
        <p
          className="text-sm leading-snug mb-2"
          style={{ color: 'var(--text-primary)', fontWeight: 600 }}
        >
          Your listing here — seen first by every visitor
        </p>
        <span
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full"
          style={{
            background: 'var(--red)',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          <i className="gg-bid-dot" aria-hidden="true" />
          Bid or Buy Now →
        </span>
      </div>
    </a>
  );
}
