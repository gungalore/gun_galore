import { Fragment } from 'react';
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { viewerFetch } from '@/lib/api-viewer';
import { BrowseResponse, Category } from '@/lib/types';
import { CARD_PHOTO_ASPECT, ListingCard } from '@/components/listing-card';
import { FilterBar } from '@/components/filter-bar';
import { SaveSearchButton } from '@/components/save-search-button';
import { Hero } from '@/components/hero';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { FeaturedRail } from '@/components/featured-rail';
import { FeaturedInFeedCard } from '@/components/featured-in-feed';
import { FeaturedAvailabilityBar } from '@/components/featured-availability-bar';
import { HomeInfoPanel } from '@/components/home-info-panel';
import { DraggableMarquee } from '@/components/draggable-marquee';
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
    title: 'Buy Now',
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
  subtitle: 'Everything in stock — Buy Now, Auctions and Take a Shot combined',
};

// Per-page metadata so the browser tab + Open Graph reflect the surface.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { listingType, q } = await searchParams;
  const surface = listingType
    ? (SURFACE_TITLES[listingType] ?? DEFAULT_SURFACE)
    : DEFAULT_SURFACE;
  // Search results title takes priority — the tab should say what was
  // searched, scoped to the surface when one is active.
  if (q) {
    return {
      title: listingType
        ? `“${q}” in ${surface.title} — All Outdoor`
        : `Results for “${q}” — All Outdoor`,
    };
  }
  return {
    title: listingType
      ? `${surface.title} — ${BRAND_NAME}`
      : `${BRAND_NAME} — New & Secondhand Outdoor Gear`,
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

  // Which URL params actually NARROW the result set — the only ones a
  // "Clear filters" button can meaningfully remove. listingType is the
  // shopping surface itself, q is the search term (it gets its own Clear
  // search button), and sort/page change ordering and paging rather than
  // matching. Computed once so the empty-state COPY and the empty-state
  // BUTTON can never disagree again: they used to use two different
  // expressions, so "?q=teleskoop" alone said "try clearing some filters"
  // while rendering no such button.
  const NON_FILTER_PARAMS = new Set(['listingType', 'q', 'sort', 'page']);
  const hasNonQFilters = Object.entries(params).some(
    ([k, v]) => Boolean(v) && !NON_FILTER_PARAMS.has(k),
  );

  // Per-surface background scenery + reveal animation.
  // Each surface that opts in gets its own photo + reveal variant so the
  // feel matches the buying mode:
  //   Marketplace = storefront photo + slide-right (cards dealt on counter)
  //   Auctions    = paddles + slide-up
  //   Take a Shot = target + scale-in (snap into focus)
  const isAuction = params.listingType === 'AUCTION';
  const isTakeAShot = params.listingType === 'TAKE_A_SHOT';
  const isMarketplace = params.listingType === 'BUY_NOW';
  const isSwop = params.listingType === 'SWOP';
  const hasBackground = isAuction || isTakeAShot || isMarketplace || isSwop;

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
  const [
    browseRaw,
    categories,
    featuredListings,
    brands,
    facetData,
  ] = await Promise.all([
    // Sentinel on failure (null) — a backend hiccup must NOT render the
    // genuine-empty "nothing listed yet" copy; the two states get
    // different UI below (retry card vs empty-marketplace nudge).
    viewerFetch<BrowseResponse>(`/listings?${qs}`).catch(() => null),
    // viewerFetch, NOT a revalidated apiFetch: the category list now varies by
    // viewer (members see the regulated trees), and Next's data cache is shared
    // across users — a cached member response would leak into anonymous pages.
    viewerFetch<Category[]>('/categories').catch(() => [] as Category[]),
    showHero
      ? viewerFetch<
          {
            slotNumber: number;
            status: 'VACANT' | 'AUCTION_RUNNING' | 'BIND_WINDOW' | 'OCCUPIED';
            listing: import('@/lib/types').Listing | null;
          }[]
        >('/featured/listings').catch(() => [])
      : Promise.resolve(
          [] as {
            slotNumber: number;
            status: 'VACANT' | 'AUCTION_RUNNING' | 'BIND_WINDOW' | 'OCCUPIED';
            listing: import('@/lib/types').Listing | null;
          }[],
        ),
    // Brand/make facet values for the FilterBar (most-listed first).
    viewerFetch<string[]>('/listings/brands').catch(() => [] as string[]),
    // P4-polish — FilterBar facet counts ("Toyota (12)"). Only meaningful when
    // a category is scoped (the surface that renders attr facets); the backend
    // returns {} otherwise, so skip the call entirely on non-category surfaces.
    // On failure the FilterBar just renders options without counts.
    params.categoryId
      ? viewerFetch<{ facets: Record<string, Record<string, number>> }>(
          `/listings/facets?${qs}`,
        ).catch(() => ({ facets: {} }))
      : Promise.resolve({
          facets: {} as Record<string, Record<string, number>>,
        }),
  ]);

  // null = the listings API call FAILED (network/backend) — distinct from a
  // legitimately empty result set. Downstream consumers keep the empty shape
  // so they all work; the render sites branch on browseFailed.
  const browseFailed = browseRaw === null;
  const browse: BrowseResponse =
    browseRaw ?? { listings: [], total: 0, page: 1, limit: 24 };

  const currentPage = browse.page;

  // Empty page N of a non-empty result set — a bookmarked deep page whose
  // items have all sold, or a hand-edited ?page=. The generic "nothing
  // matches" copy is a lie here (there ARE matches, just not on this page),
  // and with no pagination rendered below an empty grid it's a dead end.
  const stalePage = currentPage > 1 && browse.total > 0;

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
    <main className="relative">
      {/* Per-surface scenery. Same PageBackground component the Sell
          page uses — each photo gets the dark tint + radial vignette
          so the listing cards stay primary. */}
      {/* Buy Now runs LIGHTER than the house default (0.18 / tint 0.55 /
          vignette 0.85). marketplace.jpg is operator brand art — a gear
          flat-lay shot with a deliberately empty centre for the cards to sit
          in — and at the house settings it rendered as very nearly solid
          black. The old plate was a stock handgun photo that wanted burying;
          this one is meant to be seen. Only this surface is lifted: Auctions,
          Take a Shot, Sell, dashboard and profile keep the defaults, since
          those are stock photos with no dead centre to sit content in. */}
      {isMarketplace && (
        <PageBackground imageSrc="/marketplace.jpg" />
      )}
      {isAuction && (
        <PageBackground imageSrc="/auction.jpg" />
      )}
      {isTakeAShot && (
        <PageBackground imageSrc="/take-a-shot.jpg" />
      )}
      {isSwop && (
        <PageBackground imageSrc="/swop.jpg" />
      )}

      {/* Hero now carries the trust card on its right, so the competitive
          "why All Outdoor" proof lives inside <Hero /> — no separate banner. */}
      {showHero && <Hero />}

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
          className="max-w-[var(--page-max)] mx-auto px-4 py-10"
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
                  'linear-gradient(135deg, #C8102E 0%, var(--gold) 100%)',
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
          </>)}
          {/* Featured availability — "X of N spots open" + the bid entry.
              Sits directly under the marquee it belongs to, and self-hides
              when the summary can't load or no slots exist.

              The seller pitch that used to live here (headline, paragraph,
              two CTAs and a numbered three-step explainer) has moved to the
              disclosure panel near the foot of the page — operator, 2026-08-16:
              it pushed the paid featured placements down the page and made the
              landing view read as a recruitment pitch instead of a storefront.
              Nothing was dropped; see components/home-info-panel.tsx. */}
          <FeaturedAvailabilityBar />

          {/* "Shop by category" curtain REMOVED (operator, 2026-08-15).
              It was the fallback breadth entry while Featured was dark, but
              the category tree already lives in the nav's Categories flyout
              and the mobile drawer, and on the landing page the grid pushed
              the sell-side content down while every tile led to an empty
              shelf. Featured + the cold-start band own this stretch now.
              The component (components/category-curtain.tsx) is kept for
              reuse elsewhere; only the homepage stopped rendering it. */}

          {/* Good to know — the selling / buying / fees / featured answers,
              folded away behind disclosure rows so the page above stays a
              storefront. No JavaScript; native <details>. */}
          <HomeInfoPanel />

          {/* Recently viewed — self-hides if the user has < 2 entries
              on this device, so cold-start visitors don't see an empty
              rail. Sits below the featured marquee so returning users
              get a quick re-entry into things they were looking at. */}
          <RecentlyViewedRail />

          {/* Latest listings — the landing page previously ended here with
              NO product grid at all: real ads were only reachable via the
              nav. `browse` (24 newest, no filters) was already fetched for
              this surface; render it. */}
          {browseFailed && (
            /* API failure on the landing page — without this the "Latest
               listings" grid silently vanishes and a live site reads dead. */
            <div
              className="mt-10 rounded-[8px] py-8 px-6 text-center"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p className="text-sm mb-3" style={{ color: 'var(--text-tertiary)' }}>
                We couldn&apos;t load the latest listings right now.
              </p>
              <a
                href="/"
                className="inline-block text-sm px-4 py-2 rounded-[6px]"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
              >
                Try again
              </a>
            </div>
          )}
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
                {browse.listings.map((l, i) => (
                  <Fragment key={l.id}>
                    <ListingCard listing={l} />
                  {/* ⚠️ AFTER THE FIRST ROW, NOT BEFORE IT. A paid card in
                      slot one reads as an advert wall; after four real
                      results it reads as more stock, which is the whole
                      reason in-feed beats a banner. Renders nothing when no
                      slot is sold. */}
                    {i === 3 && <FeaturedInFeedCard />}
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Cold-start featured pitch: no slot is occupied, so the grid
              above is collapsed and this is the only featured entry point
              on the homepage. It is an ad aimed at SELLERS, so it sits
              last — a first-time buyer has to be shown the categories and
              the actual stock before being asked to bid for placement.
              Gated on the store having stock at all: nobody buys a shop
              window in an empty shop, and the pitch only makes the
              emptiness louder. `browse.total`, not `listings.length` —
              a deep ?page= still counts as showHero and would otherwise
              hide the pitch on a well-stocked store.
              Vibrant banner treatment (operator 2026-07-20 "easy to
              miss"): shared .gg-bid-spot gold glow + star + red CTA pill. */}
          {occupiedFeatured.length === 0 && browse.total > 0 && (
            <div className="text-center mt-10" data-reveal>
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
                  fill="var(--gold)"
                  aria-hidden="true"
                  style={{ filter: 'drop-shadow(0 0 8px rgba(232,181,58,0.55))', flexShrink: 0 }}
                >
                  <path d="M12 2l2.9 6.26L21.5 9.3l-4.9 4.46 1.3 6.74L12 17.2l-5.9 3.3 1.3-6.74L2.5 9.3l6.6-1.04Z" />
                </svg>
                <span className="text-left">
                  <span
                    className="block text-[11px] uppercase"
                    style={{ color: 'var(--gold-strong)', letterSpacing: '0.12em', fontWeight: 700 }}
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
          <div className="max-w-[var(--page-max)] mx-auto px-4 py-10 flex flex-col lg:flex-row gap-6">
            <FeaturedRail />
            <section className="flex-1 min-w-0">
              {renderListingsBody()}
            </section>
          </div>
        </PageReveal>
      ) : (
        <div className="max-w-[var(--page-max)] mx-auto px-4 py-10 flex flex-col lg:flex-row gap-6">
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
              {/* Search results lead with the QUERY so the user sees what
                  they searched (the box is also seeded via FilterBar). */}
              {params.q
                ? `Results for “${params.q}”`
                : surface.title}
            </h1>
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {params.q
                ? `${params.listingType ? `In ${surface.title.toLowerCase()} · ` : ''}${browse.total.toLocaleString('en-ZA')} result${browse.total !== 1 ? 's' : ''}`
                : `${surface.subtitle} · ${browse.total.toLocaleString('en-ZA')} item${browse.total !== 1 ? 's' : ''}`}
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

        {browseFailed ? (
          /* API failure — NOT an empty marketplace. Offer a retry (same
             URL) instead of the "nothing listed yet" nudge. */
          <div
            data-reveal
            className="rounded-[8px] py-12 px-6 text-center mt-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              We couldn&apos;t load listings right now
            </p>
            <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
              Something hiccuped on our side — your search and filters are
              safe, just try again.
            </p>
            <a
              href={(() => {
                const next = new URLSearchParams();
                for (const [k, v] of Object.entries(params)) {
                  if (typeof v === 'string' && v) next.set(k, v);
                }
                const s = next.toString();
                return s ? `/?${s}` : '/';
              })()}
              className="inline-block text-sm px-5 py-2.5 rounded-[6px]"
              style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
            >
              Try again
            </a>
          </div>
        ) : browse.listings.length === 0 ? (
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
              {/* Lead with the thing that came up empty. A searcher who
                  sees "Nothing matches live listings yet" can't tell
                  whether the term or the whole site is the problem. */}
              {stalePage
                ? `Nothing left on page ${currentPage}`
                : params.q
                  ? `No results for “${params.q}”${params.listingType ? ` in ${surface.title}` : ''}`
                  : `Nothing matches ${surface.title.toLowerCase()} yet`}
            </p>
            <p
              className="text-sm mb-5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {/* Every branch below must describe an action the buttons
                  underneath actually offer — the old copy told a
                  search-only visitor to "clear some filters" while
                  rendering no Clear-filters button at all. */}
              {stalePage
                ? `There are still ${browse.total.toLocaleString('en-ZA')} matches — items on this page have just sold or been pulled.`
                : params.q && hasNonQFilters
                  ? 'Your filters may be too tight for that search — clear them, or drop the search term and browse the rest.'
                  : params.q
                    ? 'Check the spelling or try a broader term — or save this search and we’ll alert you the moment something matches.'
                    : hasNonQFilters
                      ? 'Try clearing some filters — or save this search and we’ll alert you the moment something matches.'
                      : // "in the safe" read as a gun safe — a firearm cue on
                        // the public, deliberately non-firearm storefront, and
                        // this copy shows to signed-out visitors and crawlers.
                        'Nothing listed here yet — got good gear sitting in the garage? Yours could be the first.'}
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              {stalePage && (
                /* A bookmarked / stale ?page=N whose items have all sold
                   is a hard dead end otherwise: the results exist, the
                   user just can't see them from here. */
                <a
                  href={pageHref(1)}
                  className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
                  style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  Back to page 1 →
                </a>
              )}
              {hasNonQFilters && (
                /* Clear filters preserves both the listingType (the
                   shopping surface the user is on) AND the search
                   query (the term they typed). Only the constraints
                   that narrow the result set further — category,
                   province, condition, attributes — get stripped.
                   Gated on the SAME hasNonQFilters the copy uses, so the
                   promise and the button can't drift apart. */
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
              {params.q && (
                /* The button the search-only dead end was missing. Drops
                   the term (and any stale page cursor) but keeps the
                   surface AND every filter the user deliberately set —
                   the label says "clear search", so it must clear only
                   the search. */
                <a
                  href={(() => {
                    const next = new URLSearchParams();
                    for (const [k, v] of Object.entries(params)) {
                      if (k === 'q' || k === 'page') continue;
                      if (typeof v === 'string' && v) next.set(k, v);
                    }
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
                  Clear search →
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
              {browse.listings.map((listing, i) => (
                <Fragment key={listing.id}>
                  <ListingCard listing={listing} />
                  {i === 3 && <FeaturedInFeedCard />}
                </Fragment>
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
      {/* Same photo box ListingCard uses (CARD_PHOTO_ASPECT) — keeps
          the placeholder card the exact same height as a real one. */}
      <div className="relative" style={{ paddingBottom: CARD_PHOTO_ASPECT }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          {/* Gold star — the universal "featured" glyph */}
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="var(--gold)"
            aria-hidden="true"
            style={{ filter: 'drop-shadow(0 0 8px rgba(232,181,58,0.55))' }}
          >
            <path d="M12 2l2.9 6.26L21.5 9.3l-4.9 4.46 1.3 6.74L12 17.2l-5.9 3.3 1.3-6.74L2.5 9.3l6.6-1.04Z" />
          </svg>
          <span
            className="text-[11px] uppercase"
            style={{
              letterSpacing: '0.12em',
              color: 'var(--gold-strong)',
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
