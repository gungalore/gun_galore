import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { apiFetch } from '@/lib/api';
import { Listing } from '@/lib/types';
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
import ModerationBanner from './moderation-banner';
import BackLink from './back-link';
import { QuestionsPanel } from './questions-panel';
import { ImageGallery } from './image-gallery';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { FeaturedRail } from '@/components/featured-rail';
import { HelpTip } from '@/components/help-tip';
import { HelpText } from '@/components/help-text';

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
  return {
    title: `${listing.title} — Gun Galore`,
    description: listing.description.slice(0, 160),
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

  // Pre-sort by `order` so the gallery's thumbnail strip + lightbox
  // step in the seller's intended sequence (the API doesn't
  // guarantee order; sort here once).
  const allImages = [...listing.images].sort((a, b) => a.order - b.order);

  return (
    <main
      className="relative max-w-[1280px] mx-auto px-4 py-6"
      style={{ zIndex: 1 }}
    >
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
                  className="block w-full py-3 rounded-[6px] text-sm text-center"
                  style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  Buy Now — {formatPrice(listing.price!)}
                </Link>
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
                  checkout — the buyer waives payment protection and
                  the seller is paid immediately. HelpTip surfaces the
                  consequence so buyers don't first hear about it on
                  the consent screen. */}
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
                {listing.category.slug === 'firearms' || /firearm/i.test(listing.category.name)
                  ? "the seller takes the firearm to their nearest SAPS-licensed dealer to be booked into stock. Once we've verified the SAPS 534 + stock register + firearm photos, we send you the dealer's contact details and release the funds. The inter-dealer transfer onwards is arranged between you and the seller."
                  : 'Pudo locker-to-locker or The Courier Guy door delivery — both quoted at checkout.'}
              </p>
              <p className="mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                <strong>Private arrangement</strong> is offered as a
                checkout opt-out — you waive payment protection in
                exchange for direct contact details with the seller.
                Once accepted, you can&apos;t dispute or get refunded
                via Gun Galore. Use only if you know the seller.
              </p>
            </div>
          )}

          {/* Description — moved up here from the bottom of the page so
              the buyer sees it immediately under the Buy Now CTA, next
              to the product photo. Make/Model/Calibre have been removed
              entirely from the public listing surface per spec — the
              fields still live on Listing for search/filtering, just
              not displayed to buyers. */}
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
    </main>
  );
}
