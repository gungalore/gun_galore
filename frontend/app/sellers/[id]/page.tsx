import { notFound } from 'next/navigation';
import { BrowseRailShell } from '@/components/browse-rail-shell';
import { ListingCard } from '@/components/listing-card';
import { PageReveal } from '@/components/page-reveal';
import { UserBadgesWithTooltip } from '@/components/user-badges';
import { VerificationBadges } from '@/components/verification-badges';
import { ReportButton } from '@/components/report-button';
import { ClickableAvatar } from '@/components/avatar-lightbox';
import { FilterBar } from '@/components/filter-bar';
import { Pagination } from '@/components/pagination';
import { viewerFetch } from '@/lib/api-viewer';
import { catalogueDeclarationToken } from '@/lib/catalogue-access';
import { serverAuth as auth } from '../../../lib/auth-server';
import type {
  BrowseResponse,
  Category,
  PublicSellerProfile,
  SellerRating,
} from '@/lib/types';
import {
  sellerApiPaths,
  sellerPageHref,
  type SellerStorefrontFilters,
} from '@/lib/seller-storefront';
import { CatalogLiveRefresh } from '@/components/catalog-live-refresh';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// UX-6 — the seller storefront now takes the same browse filters as the
// homepage, scoped to this seller. Province is intentionally omitted (one
// seller ≈ one location) and search is hidden (browse runs the Prisma path
// which doesn't do text search).
type SellerSearchParams = SellerStorefrontFilters;

const TIER_COLOR: Record<string, string> = {
  NEW: 'var(--text-tertiary)',
  ESTABLISHED: '#6366f1',
  TRUSTED: '#0ea5e9',
  TOP_SELLER: 'var(--warning)',
  DEALER: 'var(--red)',
};

export default async function SellerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SellerSearchParams>;
}) {
  // ⚠️ TWO DIFFERENT PEOPLE. `sellerId` is whose storefront this is; `userId`
  // is whoever is looking at it. They used to be different TYPES — a Clerk
  // subject in the route and a Clerk subject from the session — so conflating
  // them was impossible; now they are both User.id and only the names keep
  // them apart. The own-profile check below is what depends on it.
  const { id: sellerId } = await params;
  const sp = await searchParams;
  const { userId } = await auth();
  const isOwnProfile = !!userId && userId === sellerId;

  // Seller-scoped browse query (filters + pagination). sellerId lives in
  // the route, so it's added here server-side but NOT passed to the FilterBar
  // (which keeps it out of the user-facing URL). Province is omitted.
  const qs = new URLSearchParams();
  qs.set('sellerId', sellerId);
  if (sp.categoryId) qs.set('categoryId', sp.categoryId);
  if (sp.condition) qs.set('condition', sp.condition);
  if (sp.make) qs.set('make', sp.make);
  if (sp.minPrice) qs.set('minPrice', sp.minPrice);
  if (sp.maxPrice) qs.set('maxPrice', sp.maxPrice);
  if (sp.sort) qs.set('sort', sp.sort);
  if (sp.page) qs.set('page', sp.page);
  if (sp.attrs) qs.set('attrs', sp.attrs);
  qs.set('limit', '24');

  // Forwarded to the reviews call below so a declared 18+ visitor or a member
  // sees every review (the API's ContentAccessGuard needs one of the two).
  const viewerToken = await (await auth()).getToken().catch(() => null);
  const catalogueDeclaration = await catalogueDeclarationToken();

  /**
   * ⚠️ EVERY SELLER READ USES `sellerId`, NEVER `userId`. `userId` is the person
   * looking at this page; the profile and the reviews belong to the seller in the
   * route. Building them from the viewer showed a signed-in member their own
   * header/reviews under someone else's URL, and sent a signed-out visitor to
   * `/sellers/undefined`.
   */
  const sellerPaths = sellerApiPaths(sellerId);

  const [profileRes, ratingsRes, browse, categories, brands, facetData] =
    await Promise.all([
      // Phase E1 — public seller profile with badge fields. 404 here
      // is the canonical "no such seller" so we propagate it to the
      // page's notFound() below.
      fetch(`${API_URL}${sellerPaths.profile}`, { cache: 'no-store' }),
      // Reviews embed the listing TITLE. Content no longer varies by sign-in,
      // but the read still sits behind the 18+ gate: forward whichever
      // credential this viewer holds. Raw fetch (not viewerFetch) because the
      // page needs the Response to distinguish a 404 seller from an empty
      // review list.
      fetch(`${API_URL}${sellerPaths.ratings}`, {
        cache: 'no-store',
        headers: {
          ...(viewerToken ? { Authorization: `Bearer ${viewerToken}` } : {}),
          ...(catalogueDeclaration
            ? { Cookie: `ao_cat=${catalogueDeclaration}` }
            : {}),
        },
      }),
      // Scope by sellerId + the active filters. Same browse assembly the
      // homepage uses (24/page). The backend routes sellerId to the
      // Prisma path with every other filter applied.
      viewerFetch<BrowseResponse>(`/listings?${qs}`).catch(() => ({
        listings: [],
        total: 0,
        page: 1,
        limit: 24,
      })),
      viewerFetch<Category[]>('/categories').catch(() => [] as Category[]),
      viewerFetch<string[]>('/listings/brands').catch(() => [] as string[]),
      sp.categoryId
        ? viewerFetch<{ facets: Record<string, Record<string, number>> }>(
            `/listings/facets?${qs}`,
          ).catch(() => ({ facets: {} }))
        : Promise.resolve({ facets: {} as Record<string, Record<string, number>> }),
    ]);

  if (!profileRes.ok) notFound();
  if (!ratingsRes.ok) notFound();

  const profile: PublicSellerProfile = await profileRes.json();
  const ratings: SellerRating[] = await ratingsRes.json();

  /**
   * ⚠️ THE HEADER NUMBERS COME FROM THE PROFILE, NOT THE ARRAY. The reviews
   * endpoint serves at most the 50 most recent reviews; counting them would
   * disagree with the cached rating on every card and listing the seller
   * appears on. `totalRatings` is the seller's whole history.
   */
  const averageRating = profile.averageRating;
  const totalRatings = profile.totalRatings ?? ratings.length;
  const showingMostRecent = totalRatings > ratings.length;

  const currentPage = browse.page;
  const totalPages = Math.max(1, Math.ceil(browse.total / browse.limit));

  function pageHref(p: number) {
    // Built from the SELLER's route id — see lib/seller-storefront.ts.
    return sellerPageHref(sellerId, sp, p);
  }

  return (
    <main className="max-w-[var(--page-max)] mx-auto px-4 py-6">
      <CatalogLiveRefresh />
      <BrowseRailShell>
      <PageReveal variant="scale-in">
      {/* Profile header */}
      <div
        data-reveal
        className="rounded-[10px] p-6 mb-6"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            {/* Seller avatar — click to enlarge (site-wide lightbox). */}
            <ClickableAvatar
              src={profile.avatarUrl}
              name={profile.username}
              size={64}
            />
            <div>
            {/* Username + Phase E1 badges (GG+ pill + verified-expert
                + tooltip with admin-supplied rationale). Username
                only — platform policy forbids real names on public
                surfaces. */}
            <p
              className="text-xl font-medium flex items-center flex-wrap"
              style={{ color: 'var(--text-primary)' }}
            >
              {profile.username ?? 'Anonymous seller'}
              <UserBadgesWithTooltip
                subscriptionTier={profile.subscriptionTier}
                isVerifiedExpert={profile.isVerifiedExpert}
                expertBadgeReason={profile.expertBadgeReason}
              />
              <VerificationBadges
                verification={profile.verification}
                size="md"
              />
            </p>
            {averageRating != null && totalRatings > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <span style={{ color: 'var(--warning)' }}>
                  {'★'.repeat(Math.round(averageRating))}
                  {'☆'.repeat(5 - Math.round(averageRating))}
                </span>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {averageRating.toFixed(1)} · {totalRatings} review
                  {totalRatings !== 1 ? 's' : ''}
                </span>
              </div>
            )}
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {profile.totalSales} sale{profile.totalSales !== 1 ? 's' : ''} · joined{' '}
              {new Date(profile.createdAt).toLocaleDateString('en-ZA', {
                year: 'numeric',
                month: 'short',
              })}
            </p>
            </div>
          </div>
          {/* The SELLER is the subject of the report, not the viewer. */}
          {!isOwnProfile && (
            <ReportButton kind="seller" targetId={sellerId} label="⚑ Report" />
          )}
        </div>
      </div>

      <div data-reveal className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Active listings — filtered + paginated (UX-6) */}
        <div>
          <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
            {browse.total} active listing{browse.total !== 1 ? 's' : ''}
          </p>
          <div className="mb-4">
            <FilterBar
              categories={categories}
              currentParams={{
                categoryId: sp.categoryId,
                condition: sp.condition,
                make: sp.make,
                minPrice: sp.minPrice,
                maxPrice: sp.maxPrice,
                sort: sp.sort,
                page: sp.page,
                attrs: sp.attrs,
              }}
              brands={brands}
              facets={facetData.facets}
              basePath={`/sellers/${sellerId}`}
              hideProvinceFilter
              hideSearch
            />
          </div>
          {browse.listings.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No listings match these filters.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {browse.listings.map((l) => (
                  <ListingCard key={l.id} listing={l} />
                ))}
              </div>
              <div className="mt-6">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  hrefFor={pageHref}
                />
              </div>
            </>
          )}
        </div>

        {/* Reviews */}
        <div
          className="rounded-[8px] p-5"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p className="text-xs uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
            Reviews ({totalRatings})
          </p>
          {/* The list is capped by the API; say so rather than implying it is all. */}
          {showingMostRecent ? (
            <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Showing the most recent reviews
            </p>
          ) : null}

          {ratings.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No reviews yet.
            </p>
          ) : (
            <div className="space-y-4">
              {ratings.slice(0, 10).map((r, index) => (
                <div key={r.id ?? `${r.createdAt}-${index}`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {r.rater.username ?? 'Anonymous'}
                      <VerificationBadges verification={r.rater.verification} />
                      {' · '}
                      {r.transaction.listing.title.slice(0, 28)}
                    </span>
                    <span style={{ color: 'var(--warning)', fontSize: '12px' }}>
                      {'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}
                    </span>
                  </div>
                  {r.comment && (
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {r.comment}
                    </p>
                  )}
                  {r.sellerResponse && (
                    <div
                      className="mt-2 pl-3 py-1.5"
                      style={{ borderLeft: '2px solid var(--border)' }}
                    >
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        Seller&apos;s response
                      </p>
                      <p className="text-xs m-0" style={{ color: 'var(--text-secondary)' }}>
                        {r.sellerResponse}
                      </p>
                    </div>
                  )}
                  <div className="mt-3" style={{ borderTop: '0.5px solid var(--border-divider)' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </PageReveal>
    </BrowseRailShell>
    </main>
  );
}
