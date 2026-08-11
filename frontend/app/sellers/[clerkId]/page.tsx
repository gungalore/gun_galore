import { notFound } from 'next/navigation';
import { BrowseRailShell } from '@/components/browse-rail-shell';
import { ListingCard } from '@/components/listing-card';
import { PageReveal } from '@/components/page-reveal';
import { UserBadgesWithTooltip } from '@/components/user-badges';
import { ReportButton } from '@/components/report-button';
import { ClickableAvatar } from '@/components/avatar-lightbox';
import { FilterBar } from '@/components/filter-bar';
import { Pagination } from '@/components/pagination';
import { viewerFetch } from '@/lib/api-viewer';
import { auth } from '@clerk/nextjs/server';
import type { BrowseResponse, PublicSellerProfile, Category } from '@/lib/types';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// UX-6 — the seller storefront now takes the same browse filters as the
// homepage, scoped to this seller. Province is intentionally omitted (one
// seller ≈ one location) and search is hidden (browse runs the Prisma path
// which doesn't do text search).
interface SellerSearchParams {
  categoryId?: string;
  condition?: string;
  make?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
  attrs?: string;
}

const TIER_COLOR: Record<string, string> = {
  NEW: 'var(--text-tertiary)',
  ESTABLISHED: '#6366f1',
  TRUSTED: '#0ea5e9',
  TOP_SELLER: '#f59e0b',
  DEALER: 'var(--red)',
};

interface SellerRating {
  id: string;
  stars: number;
  comment: string | null;
  sellerResponse: string | null;
  createdAt: string;
  // Public-facing reviews — username only per platform policy.
  rater: { username: string | null };
  transaction: { listing: { title: string } };
}

export default async function SellerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ clerkId: string }>;
  searchParams: Promise<SellerSearchParams>;
}) {
  const { clerkId } = await params;
  const sp = await searchParams;
  const { userId } = await auth();
  const isOwnProfile = !!userId && userId === clerkId;

  // Seller-scoped browse query (filters + pagination). sellerClerkId lives in
  // the route, so it's added here server-side but NOT passed to the FilterBar
  // (which keeps it out of the user-facing URL). Province is omitted.
  const qs = new URLSearchParams();
  qs.set('sellerClerkId', clerkId);
  if (sp.categoryId) qs.set('categoryId', sp.categoryId);
  if (sp.condition) qs.set('condition', sp.condition);
  if (sp.make) qs.set('make', sp.make);
  if (sp.minPrice) qs.set('minPrice', sp.minPrice);
  if (sp.maxPrice) qs.set('maxPrice', sp.maxPrice);
  if (sp.sort) qs.set('sort', sp.sort);
  if (sp.page) qs.set('page', sp.page);
  if (sp.attrs) qs.set('attrs', sp.attrs);
  qs.set('limit', '24');

  // Forwarded to the reviews call below so a member still sees every review.
  const viewerToken = await (await auth()).getToken().catch(() => null);

  const [profileRes, ratingsRes, browse, categories, brands, facetData] =
    await Promise.all([
      // Phase E1 — public seller profile with badge fields. 404 here
      // is the canonical "no such seller" so we propagate it to the
      // page's notFound() below.
      fetch(`${API_URL}/sellers/${clerkId}`, { cache: 'no-store' }),
      // Reviews embed the listing TITLE, so this response varies by viewer:
      // signed out, reviews on members-only listings are withheld. Raw fetch
      // (not viewerFetch) because the page needs the Response to distinguish
      // a 404 seller from an empty review list.
      fetch(`${API_URL}/ratings/seller/${clerkId}`, {
        cache: 'no-store',
        headers: viewerToken
          ? { Authorization: `Bearer ${viewerToken}` }
          : undefined,
      }),
      // Scope by sellerClerkId + the active filters. Same browse assembly the
      // homepage uses (24/page). The backend routes sellerClerkId to the
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

  const avgRating =
    ratings.length > 0
      ? ratings.reduce((s, r) => s + r.stars, 0) / ratings.length
      : null;

  const currentPage = browse.page;
  const totalPages = Math.max(1, Math.ceil(browse.total / browse.limit));

  function pageHref(p: number) {
    const next = new URLSearchParams(
      Object.fromEntries(
        Object.entries(sp).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    );
    next.set('page', String(p));
    return `/sellers/${clerkId}?${next}`;
  }

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
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
                idVerified={profile.idVerified}
              />
            </p>
            {avgRating && (
              <div className="flex items-center gap-2 mt-1">
                <span style={{ color: '#f59e0b' }}>
                  {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}
                </span>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {avgRating.toFixed(1)} · {ratings.length} review{ratings.length !== 1 ? 's' : ''}
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
          {!isOwnProfile && (
            <ReportButton kind="seller" targetId={clerkId} label="⚑ Report" />
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
              basePath={`/sellers/${clerkId}`}
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
            Reviews ({ratings.length})
          </p>

          {ratings.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No reviews yet.
            </p>
          ) : (
            <div className="space-y-4">
              {ratings.slice(0, 10).map((r) => (
                <div key={r.id}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {r.rater.username ?? 'Anonymous'} · {r.transaction.listing.title.slice(0, 28)}
                    </span>
                    <span style={{ color: '#f59e0b', fontSize: '12px' }}>
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
