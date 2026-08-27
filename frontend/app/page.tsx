import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { viewerFetch } from '@/lib/api-viewer';
import { BrowseResponse, Category } from '@/lib/types';
import { ListingCard } from '@/components/listing-card';
import { FilterBar } from '@/components/filter-bar';
import { SaveSearchButton } from '@/components/save-search-button';
import { Hero } from '@/components/hero';
import { ShopModeTiles } from '@/components/shop-mode-tiles';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { HomeInfoPanel } from '@/components/home-info-panel';
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

  // Multiple independent data fetches for this page — run them in
  // parallel so the slowest doesn't block the others.
  const [
    browseRaw,
    categories,
    brands,
    facetData,
    modeCounts,
  ] = await Promise.all([
    // Sentinel on failure (null) — a backend hiccup must NOT render the
    // genuine-empty "nothing listed yet" copy; the two states get
    // different UI below (retry card vs empty-marketplace nudge).
    viewerFetch<BrowseResponse>(`/listings?${qs}`).catch(() => null),
    // viewerFetch, NOT a revalidated apiFetch: the category list now varies by
    // viewer (members see the regulated trees), and Next's data cache is shared
    // across users — a cached member response would leak into anonymous pages.
    viewerFetch<Category[]>('/categories').catch(() => [] as Category[]),
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
    // Counts for the two "Shop by mode" tiles. Two limit=1 calls wanted purely
    // for their `total`, and only on the bare landing page where the tiles
    // actually render — every other surface skips them entirely. A failure
    // resolves null, which the tile reads as "say nothing" rather than "0".
    showHero
      ? Promise.all([
          viewerFetch<BrowseResponse>(
            '/listings?limit=1&listingType=BUY_NOW',
          ).catch(() => null),
          viewerFetch<BrowseResponse>(
            '/listings?limit=1&listingType=AUCTION',
          ).catch(() => null),
        ])
      : Promise.resolve([null, null] as [null, null]),
  ]);

  const buyNowCount = modeCounts[0]?.total ?? null;
  const auctionCount = modeCounts[1]?.total ?? null;

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

      {/* Hero now carries the trust card on its right, so the competitive
          "why All Outdoor" proof lives inside <Hero /> — no separate banner. */}
      {showHero && <Hero />}

      {/* The storefront's primary fork, and the first thing under the hero.
          Until this existed the landing page went hero → "Good to know" with
          nothing shopping-shaped in between, which is most of why it read as a
          help page with products underneath. */}
      {showHero && (
        <ShopModeTiles buyNowCount={buyNowCount} auctionCount={auctionCount} />
      )}

      {/* ─── Bare landing page: no filter, no pagination ───
          When the user lands on "/" with no filters, the page shows the
          "Good to know" panel, the recently-viewed rail, then the 24
          newest listings — intentionally curated, not a filtered browse. */}
      {showHero ? (
        <section
          className="max-w-[var(--page-max)] mx-auto px-4 py-10"
        >
          {/* "Shop by category" curtain REMOVED (operator, 2026-08-15).
              It was the fallback breadth entry, but the category tree
              already lives in the nav's Categories flyout and the mobile
              drawer, and on the landing page the grid pushed the
              sell-side content down while every tile led to an empty
              shelf. The component (components/category-curtain.tsx) is
              kept for reuse elsewhere; only the homepage stopped
              rendering it. */}


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
                {browse.listings.map((l) => (
                  <ListingCard key={l.id} listing={l} />
                ))}
              </div>
            </div>
          )}
          {/* Good to know — the selling / buying / fees answers, folded
              away behind disclosure rows so the page above stays a
              storefront. No JavaScript; native <details>. */}
          <HomeInfoPanel />

          {/* Recently viewed — self-hides if the user has < 2 entries
              on this device, so cold-start visitors don't see an empty
              rail. Sits below the "Good to know" panel so returning
              users get a quick re-entry into things they were looking
              at. */}
          <RecentlyViewedRail />
        </section>
      ) : hasBackground ? (
        /* Filtered surfaces (marketplace/auctions/take-a-shot) keep
           this layout. */
        <PageReveal
          variant={
            isTakeAShot
              ? 'scale-in'
              : isMarketplace
                ? 'slide-right'
                : 'slide-up'
          }
        >
          <div className="max-w-[var(--page-max)] mx-auto px-4 py-10">
            <section>{renderListingsBody()}</section>
          </div>
        </PageReveal>
      ) : (
        <div className="max-w-[var(--page-max)] mx-auto px-4 py-10">
          <section>{renderListingsBody()}</section>
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
