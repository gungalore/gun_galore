import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { apiFetch } from '@/lib/api';
import { Listing } from '@/lib/types';
import { AddToCartButton } from '@/components/add-to-cart-button';
import {
  formatPrice,
  CONDITION_LABELS,
  PROVINCE_LABELS,
  TIER_LABELS,
  LISTING_TYPE_LABELS,
} from '@/lib/utils';
import SellerControls from './seller-controls';
import OfferPanel from './offer-panel';
import AuctionPanel from './auction-panel';
import SwapPanel from './swap-panel';
import ModerationBanner from './moderation-banner';
import BackLink from './back-link';
import { QuestionsPanel } from './questions-panel';
import { ImageGallery } from './image-gallery';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { FeaturedRail } from '@/components/featured-rail';
import { HelpTip } from '@/components/help-tip';
import { HelpText } from '@/components/help-text';
import { WishlistButton } from '@/components/wishlist-button';
import { UserBadges } from '@/components/user-badges';
import { ShareListingButton } from '@/components/share-listing-button';
import { ReportButton } from '@/components/report-button';
import { SocialProofPill } from '@/components/social-proof-pill';
import { RecentlyViewedRail } from '@/components/recently-viewed-rail';
import { CrossSellRow } from '@/components/cross-sell-row';
import { RecordVisit } from '@/components/record-visit';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await apiFetch<Listing>(`/listings/${id}`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!listing) return { title: 'Listing not found — Gun Galore' };
  const url = `/listings/${id}`;
  const title = `${listing.title} — Gun Galore`;
  const description = listing.description.slice(0, 160);
  const primary =
    listing.images?.find((i) => i.isPrimary) ?? listing.images?.[0];
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      images: primary ? [{ url: primary.url }] : undefined,
    },
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const listing = await apiFetch<Listing>(`/listings/${id}`, {
    cache: 'no-store',
  }).catch(() => null);

  if (!listing) return notFound();

  // Detect "this is the seller viewing their own listing" so the
  // Buy Now CTA can swap to a non-purchase state. The backend
  // already rejects self-purchase, but the button shouldn't even
  // appear — it's confusing UX and was triggering a 400 round-trip.
  const { userId } = await auth();
  const isOwnListing = !!userId && userId === listing.seller.clerkId;

  // Product/Offer structured data so Google can show rich price/availability
  // results. Only emit an Offer when there's a fixed price (BUY_NOW /
  // AUCTION); Take-a-Shot has no listed price. `make` is deliberately left
  // out — it's hidden from buyers on this page by product decision.
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gungalore.co.za'
  ).replace(/\/$/, '');
  const ldImages = (listing.images ?? []).map((i) => i.url).slice(0, 6);
  const ldPrice = listing.price ?? listing.buyNowPrice ?? listing.currentBid;
  const productLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: listing.description.slice(0, 300),
    ...(ldImages.length ? { image: ldImages } : {}),
    ...(listing.category?.name ? { category: listing.category.name } : {}),
    ...(ldPrice != null
      ? {
          offers: {
            '@type': 'Offer',
            price: (ldPrice / 100).toFixed(2),
            priceCurrency: 'ZAR',
            availability:
              listing.status === 'ACTIVE'
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            url: `${siteUrl}/listings/${listing.id}`,
            itemCondition:
              listing.condition === 'NEW'
                ? 'https://schema.org/NewCondition'
                : 'https://schema.org/UsedCondition',
          },
        }
      : {}),
  };

  // Pre-sort by `order` so the gallery's thumbnail strip + lightbox
  // step in the seller's intended sequence (the API doesn't
  // guarantee order; sort here once).
  const allImages = [...listing.images].sort((a, b) => a.order - b.order);

  return (
    <main
      className="relative max-w-[1280px] mx-auto px-4 py-6"
      style={{ zIndex: 1 }}
    >
      {/* Product/Offer structured data for search engines (not visible). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />

      {/* House standard scenery — marketplace.jpg ties the listing
          detail to the marketplace index visually. opacity:0.18
          matches the marketplace homepage so the product photo stays
          dominant without the background washing the page out. */}
      <PageBackground imageSrc="/marketplace.jpg" opacity={0.18} />

      {/* Layout: <FeaturedRail> sits next to the listing detail
          column on desktop and stacks above it on mobile. Same
          pattern as the browse surfaces — the rail's internal
          responsive classes pick the sticky-aside vs horizontal-
          scroller variant; we just wrap both in flex. */}
      <div className="flex flex-col lg:flex-row gap-6">
        <FeaturedRail />
        <div className="flex-1 min-w-0">

      {/* Back link stays OUTSIDE PageReveal so it's clickable instantly.
          Uses router.back() so the user lands back on their previous
          filter / search state instead of being dropped on the home
          page with no context. */}
      <BackLink />

      <PageReveal>
        <div data-reveal className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        {/* Left: images — fully interactive gallery (hero swap on
            thumbnail click, lightbox on hero click, ← → navigation,
            2× zoom on click inside the lightbox). */}
        <div>
          <ImageGallery images={allImages} title={listing.title} />
        </div>

        {/* Right: details */}
        <div>
          {/* Reference number — shown above all other detail so the
              seller / buyer always knows the trackable code (UM000123,
              AU000045, TS000007). Monospace so it's easy to copy-paste
              into support emails. Falls back to a short cuid for legacy
              listings that haven't been back-filled yet. */}
          <p
            className="text-xs mb-2 inline-block"
            style={{
              fontFamily: 'ui-monospace, monospace',
              color: 'var(--text-secondary)',
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              borderRadius: 4,
              padding: '3px 8px',
              letterSpacing: '0.04em',
            }}
          >
            {listing.referenceNumber ?? `#${listing.id.slice(-8)}`}
          </p>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span
              className="text-xs px-2 py-0.5 rounded-[3px]"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border)',
              }}
            >
              {listing.category.name}
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded-[3px]"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border)',
              }}
            >
              {CONDITION_LABELS[listing.condition]}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span
                className="text-xs px-2 py-0.5 rounded-[3px]"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-tertiary)',
                  border: '0.5px solid var(--border)',
                }}
              >
                {LISTING_TYPE_LABELS[listing.listingType]}
              </span>
              <HelpTip title="Listing type" side="bottom">
                {listing.listingType === 'BUY_NOW'
                  ? 'Marketplace: pay the listed price and go. No bidding, no negotiation. Goes straight to checkout.'
                  : listing.listingType === 'AUCTION'
                    ? 'Auction: timed bidding with proxy bids and snipe protection. The highest bid at close wins, provided the reserve is met.'
                    : listing.listingType === 'SWOP'
                      ? 'Swop / Trade: the owner wants to trade this item rather than sell it. Propose a swap — your item, plus optional cash either way — and the owner can accept, counter the cash, or decline.'
                      : 'Take a Shot: make an offer below the listed price. The seller can accept, counter once, or decline. You get 48 hours to act on a counter.'}
              </HelpTip>
            </span>
          </div>

          <h1
            className="text-xl mb-3 leading-snug"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {listing.title}
          </h1>

          {/* Seller-only moderation banner — shows above the CTA. */}
          <ModerationBanner
            listingId={listing.id}
            sellerClerkId={listing.seller.clerkId}
            status={listing.status}
            decision={listing.claudeDecision}
            reasons={listing.claudeReasons}
            autoFixApplied={listing.claudeAutoFixApplied}
          />

          {/* For AUCTIONS, the AuctionPanel renders current bid + countdown,
              so we suppress the static price block. */}
          {listing.price && listing.listingType !== 'AUCTION' && (
            <div
              className="text-2xl mb-5"
              style={{ color: 'var(--red)', fontWeight: 500 }}
            >
              {formatPrice(listing.price)}
            </div>
          )}

          {/* CTA */}
          {listing.status === 'ACTIVE' && listing.listingType === 'BUY_NOW' ? (
            isOwnListing ? (
              // Self-buy guard. Backend rejects the purchase anyway,
              // but the button shouldn't be clickable in the first
              // place — confusing UX. Show a neutral chip so the
              // seller knows this is their own item.
              <div
                className="block w-full py-3 rounded-[6px] text-sm text-center mb-5"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                }}
              >
                This is your own listing
              </div>
            ) : (
              <>
                <Link
                  href={`/checkout/${listing.id}`}
                  className="block w-full py-3 rounded-[6px] text-sm text-center mb-2"
                  style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  Buy Now — {formatPrice(listing.price!)}
                </Link>
                {/* Add to cart — non-firearm only (firearms need per-item
                    dealer transfer + 18+ attestation a batched cart can't
                    collect; they stay single-item Buy Now). */}
                {!listing.isFirearm && (
                  <AddToCartButton
                    item={{
                      listingId: listing.id,
                      title: listing.title,
                      price: listing.price ?? 0,
                      imageUrl:
                        listing.images?.find((i) => i.isPrimary)?.url ??
                        listing.images?.[0]?.url,
                      sellerId: listing.seller.clerkId,
                      sellerUsername: listing.seller.username ?? 'Seller',
                    }}
                  />
                )}
                <div className="mb-5">
                  <HelpText>
                    Takes you to secure checkout. Your card is charged
                    when you confirm; funds are held until the item
                    arrives and you confirm delivery — then released to
                    the seller.
                  </HelpText>
                </div>
              </>
            )
          ) : listing.status === 'ACTIVE' && listing.listingType === 'TAKE_A_SHOT' ? (
            <OfferPanel
              listingId={listing.id}
              sellerClerkId={listing.seller.clerkId}
            />
          ) : listing.listingType === 'AUCTION' ? (
            <AuctionPanel
              listingId={listing.id}
              sellerClerkId={listing.seller.clerkId}
            />
          ) : listing.status === 'ACTIVE' && listing.listingType === 'SWOP' ? (
            <SwapPanel
              listingId={listing.id}
              sellerClerkId={listing.seller.clerkId}
              isOwnListing={isOwnListing}
            />
          ) : listing.status !== 'ACTIVE' ? (
            <div
              className="rounded-[6px] px-4 py-3 mb-5 text-sm text-center"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-tertiary)',
              }}
            >
              {listing.status === 'SOLD' ? 'Sold' : 'Not available'}
            </div>
          ) : null}

          {/* Quick-actions row — Wishlist (save for later) + Share
              (Web Share API → clipboard fallback). Sits directly under
              the buy-panel so it's the natural next-click for a buyer
              who's interested but not ready to commit. Spans both
              buttons evenly on mobile, sits inline on desktop. */}
          <div className="flex gap-2 mb-3">
            <WishlistButton listingId={listing.id} variant="inline" />
            <ShareListingButton
              title={listing.title}
              text={`Check out this listing on Gun Galore: ${listing.title}`}
            />
          </div>

          {/* Report — hidden on your own listing. */}
          {!isOwnListing && (
            <div className="mb-3">
              <ReportButton kind="listing" targetId={listing.id} />
            </div>
          )}

          {/* Social-proof pill. Self-hides below 3 saves so the
              cold-start case (first day a listing is up, nobody has
              saved it yet) doesn't render a sad "0 saves" signal.
              Auctions get a slightly different label since the same
              WatchedListing count doubles as a watcher signal. */}
          {listing.status === 'ACTIVE' && (
            <div className="mb-5">
              <SocialProofPill
                count={listing._count?.wishlistedBy ?? 0}
                label={
                  listing.listingType === 'AUCTION'
                    ? (n) => `${n} watching this auction`
                    : undefined
                }
              />
            </div>
          )}

          {/* Invisible — pushes this listing's ID into the
              recently-viewed localStorage stack so other surfaces
              (homepage rail, wishlist empty-state rail) pick it up. */}
          <RecordVisit listingId={listing.id} />

          {/* Description — moved 2026-05-26 to sit right under the CTA
              so the buyer reads what they're actually buying before the
              legal/shipping block. Reduces vertical scroll on mobile.
              Make/Model/Calibre are NOT rendered to buyers per spec — the
              fields live on Listing for search/filtering only. */}
          <div
            className="rounded-[6px] p-3 mb-4 text-sm"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <p
              className="text-xs uppercase mb-2"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.05em',
              }}
            >
              Description
            </p>
            <p
              className="leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--text-primary)' }}
            >
              {listing.description}
            </p>
          </div>

          {/* Shipping + payment protection explainer — kept compact so
              it doesn't dominate the buy panel area, but visible
              BEFORE checkout so buyers (especially first-time buyers
              on firearm listings) understand:
                • Firearms always route through a SAPS-licensed dealer
                  (no courier, no locker, no meet-up). This is the
                  default and there's no opt-out.
                • Non-firearms ship via Pudo or The Courier Guy with
                  payment held until delivery is confirmed.
                • PRIVATE_ARRANGE exists as an explicit opt-out at
                  checkout (firearm-only) — the buyer waives payment
                  protection and the seller is paid directly. The copy
                  branches on listing.isFirearm + shippingMethods so
                  non-firearm listings don't see the opt-out paragraph
                  at all. */}
          {listing.status === 'ACTIVE' && (
            <div
              className="rounded-[6px] p-3 mb-4 text-xs"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
              }}
            >
              <p
                className="uppercase mb-2"
                style={{
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.05em',
                }}
              >
                Shipping & payment
              </p>
              {listing.isFirearm ? (
                <>
                  <p className="mb-1.5">
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Payment held by Gun Galore
                    </strong>{' '}
                    until the firearm is stocked at a licensed dealer
                    and verified — funds release automatically once
                    verification passes. Neither side can pull out
                    unilaterally before then.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Dealer-stocked transfer:
                    </strong>{' '}
                    seller drops the firearm at their nearest
                    SAPS-licensed dealer. We verify the SAPS 534 +
                    stock-in document + photos, release the funds, and
                    send you the dealer&apos;s contact details. You
                    collect from the same dealer with your own licence.
                  </p>
                  {listing.shippingMethods.includes('PRIVATE_ARRANGE') && (
                    <p
                      className="mt-1.5"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      <strong>Private arrangement</strong> is also
                      offered — you and the seller pick a dealer
                      together and do the licence transfer in person.
                      You waive Gun Galore&apos;s payment protection
                      (no platform-held funds, no dispute or refund
                      via us). Use only if you know the seller.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mb-1.5">
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Payment held by Gun Galore
                    </strong>{' '}
                    until you confirm the item arrived. If anything goes
                    wrong before delivery, we hold the funds — neither
                    side can pull out unilaterally.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Shipping:
                    </strong>{' '}
                    Pudo locker-to-locker or The Courier Guy door
                    delivery — both quoted at checkout.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Q&A — Claude-moderated, product-only. Replaces buyer-seller
              messaging entirely; sellers reply from /dashboard. */}
          <QuestionsPanel
            listingId={listing.id}
            sellerClerkId={listing.seller.clerkId}
          />

          {/* Province */}
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            {PROVINCE_LABELS[listing.province]}
          </p>

          {/* Phase M dealer-lock — surface the seller's optional
              planned-dealer-stock hint so buyers near that dealer
              know their collection drive's shorter. Only renders
              for firearm listings where the seller filled it in. */}
          {listing.isFirearm && listing.plannedDealerLocation && (
            <div
              className="mb-4 rounded-[6px] px-3 py-2 text-xs"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              <span
                style={{
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontSize: 10,
                  fontWeight: 600,
                  marginRight: 6,
                }}
              >
                Planned dealer-stock
              </span>
              <span style={{ color: 'var(--text-primary)' }}>
                {listing.plannedDealerLocation}
              </span>
              <p
                className="mt-1"
                style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.4 }}
              >
                Seller&apos;s indication only — the actual stocking dealer
                is confirmed after purchase.
              </p>
            </div>
          )}

          {/* Seller card — must NOT wrap SellerControls in this Link
              because SellerControls renders its own Link (edit) + button
              (cancel), which would create an invalid nested-<a> tree
              and bubble clicks to the wrong target. We render the card
              as a Link and the controls as a sibling. */}
          <Link
            href={`/sellers/${listing.seller.clerkId}`}
            className="block rounded-[6px] p-3 text-sm"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', textDecoration: 'none' }}
          >
            <div className="flex items-center justify-between">
              <div>
                {/* Platform policy: public listings show the seller's
                    username, never their real name. firstName/lastName
                    are still in the payload for internal flows (KYC,
                    order chips) but the listing surface is username-only. */}
                <p style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {listing.seller.username ?? 'Anonymous seller'}
                  {/* Phase E1 — GG+ pill + verified-expert badge. The
                      badge tooltip surfaces the public rationale the
                      admin entered at grant time. */}
                  <UserBadges
                    subscriptionTier={listing.seller.subscriptionTier}
                    isVerifiedExpert={listing.seller.isVerifiedExpert}
                    expertBadgeReason={listing.seller.expertBadgeReason}
                    size="md"
                  />
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {listing.seller.totalSales} sale
                  {listing.seller.totalSales !== 1 ? 's' : ''}
                </p>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span
                  className="text-xs px-2 py-0.5 rounded-[3px]"
                  style={{
                    background: 'var(--bg-inset)',
                    color: 'var(--text-tertiary)',
                    border: '0.5px solid var(--border)',
                  }}
                >
                  {TIER_LABELS[listing.seller.sellerTier]}
                </span>
                <HelpTip title="Seller tier" side="left">
                  Tiers reflect the seller&apos;s track record on Gun
                  Galore: how many sales they&apos;ve completed, how
                  long they&apos;ve been active, and whether they&apos;re
                  a verified dealer. Higher tiers earn buyer-protection
                  perks like faster payout disputes.
                </HelpTip>
              </span>
            </div>
          </Link>

          {/* Seller controls live OUTSIDE the seller Link — these are
              only rendered for the listing's owner anyway (the component
              gates on clerkId match), and they need their own click
              targets (Edit / Cancel) that don't navigate to the seller
              profile page. */}
          <SellerControls
            listingId={listing.id}
            sellerClerkId={listing.seller.clerkId}
            status={listing.status}
          />
        </div>
      </div>
      </PageReveal>
        </div>
      </div>

      {/* Cross-sell — "Complete your kit". Complements for THIS listing's
          category, calibre-matched where relevant (uses the listing's
          structured calibre). Self-hides when nothing eligible to show. */}
      <div style={{ padding: '0 16px' }}>
        <CrossSellRow listingId={listing.id} title="Complete your kit" />
      </div>

      {/* Recently-viewed rail — "More from your recent views". Self-
          hides if the user has fewer than 2 entries (excluding this
          listing) or if the fetch returns nothing. */}
      <RecentlyViewedRail
        title="More from your recent views"
        excludeId={listing.id}
      />
    </main>
  );
}
