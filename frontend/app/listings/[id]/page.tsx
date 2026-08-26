import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { apiFetch } from '@/lib/api';
import { BRAND_NAME } from '@/lib/brand';
import { Listing, CategoryAttributeDef } from '@/lib/types';
import { AddToCartButton } from '@/components/add-to-cart-button';
import {
  formatPrice,
  CONDITION_LABELS,
  PROVINCE_LABELS,
  TIER_LABELS,
  LISTING_TYPE_LABELS,
  discountPercent,
} from '@/lib/utils';
import { vicinityLabel } from '@/lib/vicinity';
import SellerControls from './seller-controls';
import OfferPanel from './offer-panel';
import AuctionPanel from './auction-panel';
import ModerationBanner from './moderation-banner';
import BackLink from './back-link';
import { QuestionsPanel } from './questions-panel';
import { ImageGallery } from './image-gallery';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { HelpTip } from '@/components/help-tip';
import { ClickableAvatar } from '@/components/avatar-lightbox';
import { HelpText } from '@/components/help-text';
import { WishlistButton } from '@/components/wishlist-button';
import { UserBadges } from '@/components/user-badges';
import { ShareListingButton } from '@/components/share-listing-button';
import { ReportButton } from '@/components/report-button';
import { SocialProofPill } from '@/components/social-proof-pill';
import { RecentlyViewedRail } from '@/components/recently-viewed-rail';
import { CrossSellRow } from '@/components/cross-sell-row';
import { RecordVisit } from '@/components/record-visit';
import { UrgencyChip } from '@/components/urgency-chip';
import { SellerRating } from '@/components/seller-rating';
import { TrustBullets } from '@/components/trust-bullets';
import { ListingDescription } from '@/components/listing-description';
import {
  getListingDeliveryEstimate,
  getCollectionMode,
} from '@/lib/delivery-estimate';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Forward the seller's token so their own not-yet-public listing still
  // resolves a real title (the owner-aware endpoint 404s non-public statuses
  // for everyone else). Anonymous callers send no token → public projection.
  const { getToken } = await auth();
  const token = await getToken().catch(() => null);
  const listing = await apiFetch<Listing>(`/listings/${id}`, {
    cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }).catch(() => null);
  if (!listing) return { title: `Listing not found — ${BRAND_NAME}` };
  const url = `/listings/${id}`;

  // Members-only stock. An ANONYMOUS caller never reaches this branch — the
  // API 404s the listing and `listing` is null above — so getting here means a
  // signed-in member is viewing it. Emit nothing indexable anyway: this is the
  // page whose OG tags used to publish the seller's raw title, 160 characters
  // of their description and the photograph of the item itself to anything
  // that fetched the URL. Defence in depth costs one branch.
  if (listing.publicVisible === false) {
    return {
      title: `Members-only listing — ${BRAND_NAME}`,
      robots: { index: false, follow: false },
      alternates: { canonical: url },
    };
  }

  const title = `${listing.title} — ${BRAND_NAME}`;
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

  // Forward the caller's Clerk session token to the (owner-aware) detail
  // endpoint. The seller viewing their own listing gets the extra fields the
  // moderation banner needs + access to their own non-active listing; every
  // other viewer gets the public projection. Anonymous → no token → public.
  const { userId, getToken } = await auth();
  const token = await getToken().catch(() => null);

  const listing = await apiFetch<Listing>(`/listings/${id}`, {
    cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }).catch(() => null);

  if (!listing) return notFound();

  // DD-3 — a first-party Daily Deal listing has its own deal-chrome page at
  // /deals/[id] (countdown, was/save, per-customer limit, "sold by Gun
  // Galore"). Send buyers + crawlers to that canonical page instead of the
  // plain listing view. Only reachable once a deal is live (ACTIVE); while
  // Daily Deals is inert the underlying listing is DRAFT and 404s above. The
  // house-seller account is the only "owner", so this never traps a buyer.
  if (listing.isDealListing) {
    redirect(`/deals/${listing.id}`);
  }

  // Detect "this is the seller viewing their own listing" so the
  // Buy Now CTA can swap to a non-purchase state. The backend
  // already rejects self-purchase, but the button shouldn't even
  // appear — it's confusing UX and was triggering a 400 round-trip.
  const isOwnListing = !!userId && userId === listing.seller.clerkId;

  // UX-1a — sellable units for the low-stock urgency chip beside the price.
  // Only inventory-tracked (multi-unit BUY_NOW) listings carry this; null
  // otherwise so the chip never renders for single-item / firearm / auction
  // listings.
  const trackedSellable = listing.trackInventory
    ? (listing.quantityAvailable ?? 0) - (listing.quantityReserved ?? 0)
    : null;
  const showUrgencyChip =
    trackedSellable !== null && trackedSellable >= 1 && trackedSellable <= 5;

  // UX-1c — pre-purchase delivery estimate line (computed from the listing's
  // shipping shape; no extra fetch).
  const deliveryEstimate = getListingDeliveryEstimate(listing);

  // Bulky-goods copy interim (audit Big-4). "Collection only" reads to buyers
  // as "same city only", which is what caps trailers / off-road caravans at
  // whoever will drive to fetch them. It isn't true: the buyer may send their
  // own transporter and the payment still stays held until THEY confirm they
  // have the item. FREIGHT_OK licenses that extra sentence; IN_PERSON_ONLY is
  // the dangerous-goods battery case where no carrier may take it at all.
  // No new shipping method, no booked/insured freight — copy only.
  const collectionMode = getCollectionMode(listing);

  // UX-28 — sticky mobile buy bar. On a phone the price + CTA live in the
  // right-hand column, which stacks BELOW the gallery, badges, title, rating
  // and moderation block; by the time a buyer has read the description, Q&A
  // and shipping they have no way to act without scrolling all the way back
  // up. The bar is suppressed in exactly the cases where the inline CTA is
  // also suppressed, so it can never offer an action the page refuses:
  //   • the seller viewing their own listing (self-buy is rejected anyway),
  //   • anything not ACTIVE (sold / cancelled / expired / payment-pending),
  //   • sold-out inventory-tracked listings (wishlist is the only CTA there).
  const soldOut = trackedSellable !== null && trackedSellable <= 0;
  const showBuyBar =
    listing.status === 'ACTIVE' &&
    !isOwnListing &&
    !soldOut;
  // The bar stays DUMB for auctions: the live figure comes from the polled
  // auction state, not listing.price (which is only the starting bid), so it
  // shows a label and scrolls to the panel rather than quoting a stale number.
  const buyBarPrice =
    listing.listingType === 'AUCTION'
      ? 'Live auction'
      : listing.price != null
        ? formatPrice(listing.price)
        : LISTING_TYPE_LABELS[listing.listingType];
  const buyBarLabel =
    listing.listingType === 'BUY_NOW'
      ? 'Buy Now'
      : listing.listingType === 'TAKE_A_SHOT'
        ? 'Make an offer'
        : listing.listingType === 'AUCTION'
          ? 'Place a bid'
          : 'Propose a swap';

  // UX-7 — compare-at ("was") price discount, BUY_NOW only. Display-only.
  const compareAtPct =
    listing.listingType === 'BUY_NOW'
      ? discountPercent(listing.price, listing.compareAtPriceZarCents)
      : null;

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
              listing.status === 'ACTIVE' &&
              !(trackedSellable !== null && trackedSellable <= 0)
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

  // Specifications (P4.2) — the listing carries structured per-category
  // attributes keyed by attribute-def key. To render human labels + units
  // we fetch the category's attribute definitions and JOIN: for each def
  // that has a value on the listing, build one { label, value } row in the
  // definition's order. Progressive enhancement — if the fetch fails, or
  // no attribute has a value, we render nothing.
  const listingAttrs = listing.attributes ?? null;
  const specRows: { label: string; display: string }[] = [];
  if (listingAttrs && Object.keys(listingAttrs).length > 0) {
    const attrDefs = await apiFetch<CategoryAttributeDef[]>(
      `/categories/${listing.category.id}/attributes`,
      { cache: 'no-store' },
    ).catch(() => [] as CategoryAttributeDef[]);
    for (const def of attrDefs) {
      const raw = listingAttrs[def.key];
      // Skip attributes the seller didn't fill (absent, null, or empty).
      if (raw === undefined || raw === null || raw === '') continue;
      let display: string;
      if (def.type === 'BOOLEAN') {
        display = raw ? 'Yes' : 'No';
      } else if (def.type === 'NUMBER') {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) continue;
        display = def.unit ? `${n} ${def.unit}` : `${n}`;
      } else {
        // SELECT / TEXT — render the string as-is.
        display = String(raw);
      }
      specRows.push({ label: def.label, display });
    }
  }

  return (
    <main
      className="relative max-w-[var(--page-max)] mx-auto px-4 py-6"
    >
      {/* Product/Offer structured data for search engines (not visible).
          Suppressed for members-only stock: the schema publishes name,
          description, up to six photos and the CATEGORY ("Pistols",
          "Centerfire Rifles") as machine-readable product data. A crawler can
          never reach this page anonymously (the API 404s it), but emitting
          rich-result markup for something the public cannot buy is pointless
          at best and a signal we do not want at worst. */}
      {listing.publicVisible !== false && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
        />
      )}

      {/* House standard scenery — marketplace.jpg ties the listing
          detail to the marketplace index visually. opacity:0.18
          matches the marketplace homepage so the product photo stays
          dominant without the background washing the page out. */}
      <PageBackground imageSrc="/marketplace.jpg" opacity={0.36} />

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
            {/* Category chip — links to the category landing page so the
                crawler (and the reader) can reach /category/[slug]. Kept
                visually identical to the other chips; just wrapped in a
                next/link. */}
            <Link
              href={`/category/${listing.category.slug}`}
              className="text-xs px-2 py-0.5 rounded-[3px] transition-colors"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border)',
                textDecoration: 'none',
              }}
            >
              {listing.category.name}
            </Link>
            {/* Condition links to the grading rubric. The grade is a promise
                the seller is held to, and until /condition-guide existed
                nothing on the site defined what any of these words meant —
                which is exactly how "Good" becomes a dispute. */}
            <Link
              href="/condition-guide"
              title="What do these condition grades mean?"
              className="text-xs px-2 py-0.5 rounded-[3px]"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border)',
                textDecoration: 'none',
              }}
            >
              {CONDITION_LABELS[listing.condition]}
              <span aria-hidden> ⓘ</span>
            </Link>
            {/* Collection-only badge — trailers / caravans are collected
                in person, no courier. Sits alongside category/condition. */}
            {listing.collectionOnly && (
              <span
                className="text-xs px-2 py-0.5 rounded-[3px]"
                style={{
                  background: 'rgba(245,158,11,0.10)',
                  color: 'var(--warning)',
                  border: '0.5px solid rgba(245,158,11,0.45)',
                }}
              >
                Collection only
              </span>
            )}
            {/* P5.4 — the SELLER'S own "tested & working" claim, never a Gun
                Galore certification (CPA s41). Wording leads with "Seller
                attests:" and the tooltip makes the source explicit. */}
            {listing.testedWorkingAttestedAt && (
              <span
                title="This is the seller's own statement, not a All Outdoor test or guarantee."
                className="text-xs px-2 py-0.5 rounded-[3px]"
                style={{
                  background: 'rgba(0,160,60,0.10)',
                  color: 'var(--success)',
                  border: '0.5px solid rgba(0,160,60,0.45)',
                }}
              >
                Seller attests: tested &amp; working
              </span>
            )}
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

          {/* UX-1b — seller rating near the title, linked to the seller
              profile. Seller-level (not item-level) — the copy says so.
              Self-hides when the seller has no ratings yet. */}
          {listing.seller.averageRating != null &&
            (listing.seller._count?.ratingsReceived ?? 0) > 0 && (
              <div className="mb-3">
                <SellerRating
                  rating={listing.seller.averageRating}
                  count={listing.seller._count?.ratingsReceived}
                  href={`/sellers/${listing.seller.clerkId}`}
                />
              </div>
            )}

          {/* Seller-only moderation banner — shows above the CTA. */}
          <ModerationBanner
            listingId={listing.id}
            sellerClerkId={listing.seller.clerkId}
            status={listing.status}
            // These moderation fields only come back from the owner-aware
            // endpoint for the seller themselves; coalesce for the public
            // payload (the banner also self-hides for non-sellers).
            decision={listing.claudeDecision ?? null}
            reasons={listing.claudeReasons ?? []}
            autoFixApplied={listing.claudeAutoFixApplied ?? false}
          />

          {/* For AUCTIONS, the AuctionPanel renders current bid + countdown,
              so we suppress the static price block. */}
          {listing.price && listing.listingType !== 'AUCTION' && (
            <div
              className={`flex items-center gap-2 flex-wrap ${
                deliveryEstimate ? 'mb-2' : 'mb-5'
              }`}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                {/* UX-7 — strikethrough "was" price (BUY_NOW only). */}
                {compareAtPct != null && (
                  <span
                    style={{ fontSize: 16, color: 'var(--text-tertiary)', textDecoration: 'line-through' }}
                  >
                    {formatPrice(listing.compareAtPriceZarCents!)}
                  </span>
                )}
                <span
                  className="text-2xl"
                  style={{ color: 'var(--red)', fontWeight: 500 }}
                >
                  {formatPrice(listing.price)}
                </span>
              </div>
              {/* UX-7 — "% off" chip + seller-stated disclaimer. */}
              {compareAtPct != null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span
                    className="text-sm px-2 py-0.5 rounded-[4px]"
                    style={{ background: 'rgba(200,16,46,0.10)', color: 'var(--red)', fontWeight: 600 }}
                  >
                    {compareAtPct}% off
                  </span>
                  <HelpTip title="Original price">
                    Original price stated by the seller — All Outdoor does not
                    verify it.
                  </HelpTip>
                </span>
              )}
              {/* UX-1a — low-stock urgency chip beside the price. */}
              {showUrgencyChip && <UrgencyChip left={trackedSellable!} />}
            </div>
          )}

          {/* UX-1c — pre-purchase delivery estimate. A range/method line,
              never a hard promise. Null (hidden) for experiences and any
              listing with no platform-estimable shipping. */}
          {deliveryEstimate && (
            <div
              className="text-sm mb-5"
              style={{ color: 'var(--text-secondary)' }}
            >
              {deliveryEstimate.kind === 'FIREARM' ? (
                <>
                  Transfer via licensed dealer —{' '}
                  <Link
                    href="/members/regulated-items"
                    style={{
                      color: 'var(--text-secondary)',
                      textDecoration: 'underline',
                    }}
                  >
                    see how it works
                  </Link>
                </>
              ) : deliveryEstimate.kind === 'COLLECTION' ? (
                <>
                  Collection from the seller in {vicinityLabel(listing)}
                  {/* Big-4 copy interim — the half-sentence that stops an
                      out-of-province buyer bouncing off "collection only".
                      Suppressed for the dangerous-goods battery case, where
                      no transporter is a legitimate option. */}
                  {collectionMode === 'FREIGHT_OK' &&
                    ' — collect yourself or send your own transporter'}
                </>
              ) : deliveryEstimate.minDays === deliveryEstimate.maxDays ? (
                <>
                  Estimated delivery: about {deliveryEstimate.maxDays} business
                  days via courier (after dispatch)
                </>
              ) : (
                <>
                  Estimated delivery: {deliveryEstimate.minDays}–
                  {deliveryEstimate.maxDays} business days via courier (after
                  dispatch)
                </>
              )}
            </div>
          )}

          {/* CTA — wrapped so the sticky mobile buy bar (UX-28) has a stable
              in-page anchor to scroll to for the non-checkout listing types.
              scrollMarginTop clears the sticky top nav on landing. */}
          <div id="buy-panel" style={{ scrollMarginTop: 88 }}>
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
              trackedSellable !== null && trackedSellable <= 0 ? (
                /* Sold out (tracked multi-unit) — no Buy Now / Add-to-cart
                   dead ends. Wishlist instead: the buyer gets alerted if the
                   seller restocks or relists. */
                <>
                  <div
                    className="block w-full py-3 rounded-[6px] text-sm text-center mb-3"
                    style={{
                      background: 'var(--bg-inset)',
                      color: 'var(--text-secondary)',
                      border: '0.5px solid var(--border)',
                      fontWeight: 500,
                    }}
                  >
                    Sold out
                  </div>
                  <div className="mb-5">
                    <HelpText>
                      Every unit has sold. Add it to your wishlist and
                      we&apos;ll alert you if it comes back.
                    </HelpText>
                  </div>
                </>
              ) : (
              <>
                {/* Stock line. The ≤5 "low stock" case is shown as the red
                    urgency chip beside the price (UX-1a), so here we only
                    surface comfortable-stock counts (sold-out is handled by
                    the dedicated branch above) to avoid duplicate messaging. */}
                {listing.trackInventory &&
                  trackedSellable !== null &&
                  trackedSellable > 5 && (
                    <p
                      className="text-sm mb-2"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {`${trackedSellable} in stock`}
                    </p>
                  )}
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
                {/* Add to cart — firearm BUY_NOW listings are now
                    allowed too; they branch to a dealer-transfer /
                    in-person route + 18+ attestation in the cart.
                    Collection-only items are the exception: the cart
                    rail only carries courier + firearm lines, so a
                    collection line can never check out from the cart
                    (M5/M8). Suppress Add-to-cart for them and point the
                    buyer at Buy Now (checkout-form handles COLLECTION). */}
                {listing.collectionOnly ||
                listing.shippingMethods?.includes('COLLECTION') ? (
                  <div
                    className="block w-full py-3 rounded-[6px] text-xs text-center mb-3"
                    style={{
                      background: 'var(--bg-inset)',
                      color: 'var(--text-secondary)',
                      border: '0.5px solid var(--border)',
                      lineHeight: 1.5,
                    }}
                  >
                    Collection only — use Buy Now to arrange collection with
                    the seller.
                  </div>
                ) : (
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
                      isFirearm: listing.isFirearm,
                      shippingMethods: listing.shippingMethods,
                    }}
                  />
                )}
                <div className="mb-5">
                  <HelpText>
                    Takes you to secure checkout. The seller is only paid
                    once the sale completes.
                  </HelpText>
                </div>
              </>
              )
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
          </div>

          {/* UX-1d — trust bullets under the CTA, on every listing type.
              Point-of-decision reassurance; house-rule-safe copy (never
              "escrow"). Firearm listings get the dealer-transfer bullet. */}
          <div className="mb-4">
            <TrustBullets isFirearm={listing.isFirearm} />
          </div>

          {/* Quick-actions row — Wishlist (save for later) + Share
              (Web Share API → clipboard fallback). Sits directly under
              the buy-panel so it's the natural next-click for a buyer
              who's interested but not ready to commit. Spans both
              buttons evenly on mobile, sits inline on desktop. */}
          <div className="flex gap-2 mb-3">
            <WishlistButton listingId={listing.id} variant="inline" />
            <ShareListingButton
              title={listing.title}
              text={`Check out this listing on All Outdoor: ${listing.title}`}
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
            <ListingDescription text={listing.description} />
          </div>

          {/* Specifications (P4.2) — structured per-category attributes,
              joined to their definitions for human labels + units. Only
              rendered when at least one attribute has a value; the rows are
              already ordered by the definition order (leaf-first). */}
          {specRows.length > 0 && (
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
                Specifications
              </p>
              <dl className="grid grid-cols-1 gap-y-1.5">
                {specRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <dt style={{ color: 'var(--text-tertiary)' }}>
                      {row.label}
                    </dt>
                    <dd
                      className="text-right"
                      style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                    >
                      {row.display}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Shipping + payment protection explainer — kept compact so
              it doesn't dominate the buy panel area, but visible
              BEFORE checkout so buyers (especially first-time buyers
              on firearm listings) understand:
                • Firearms always route through a SAPS-licensed dealer
                  (no courier, no locker, no meet-up). This is the
                  default and there's no opt-out.
                • Non-firearms ship by courier with
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
              {/* Widened from `listing.collectionOnly` alone: a listing can
                  carry COLLECTION as its only method while the snapshot flag
                  is false (older DG-battery payloads — see
                  transactions.service.ts). Those buyers were being shown the
                  courier paragraph, which quotes a Pudo/TCG rate that does
                  not exist for them. COLLECTION is only ever accepted for
                  collection-only items, so this can't mis-fire the other way. */}
              {listing.collectionOnly ||
              listing.shippingMethods?.includes('COLLECTION') ? (
                <>
                  <p className="mb-1.5">
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Collection only
                    </strong>{' '}
                    — no courier is quoted for this item. The seller is only
                    paid once you confirm you have it. After you pay, we share
                    contact details so you can arrange a time.
                  </p>
                  {/* Big-4 copy interim. The hard "same city only" wall this
                      removes is imaginary: the buyer never has to be the
                      person who arrives, and the hold releases on THEIR
                      confirmation either way. Deliberately worded as the
                      buyer's own arrangement — All Outdoor quotes, books and
                      insures nothing on that leg, and there is no freight
                      shipping method to sell them. */}
                  {collectionMode === 'FREIGHT_OK' && (
                    <p className="mb-1.5">
                      <strong style={{ color: 'var(--text-primary)' }}>
                        You don&apos;t have to drive:
                      </strong>{' '}
                      collect in person, or send your own transporter or
                      freight company to fetch it — the seller just hands it
                      over. Your payment stays held either way until you
                      confirm the item is with you. All Outdoor doesn&apos;t
                      arrange, quote or insure that transport; it&apos;s
                      between you and whoever you hire.
                    </p>
                  )}
                  {/* Dangerous goods (loose lithium >100 Wh, UN3480). Here
                      "collection only" really does mean in person — saying
                      otherwise would point the buyer at a shipment no
                      carrier may legally accept. */}
                  {collectionMode === 'IN_PERSON_ONLY' && (
                    <p className="mb-1.5">
                      This item must be collected in person — dangerous-goods
                      rules mean no courier or transporter may carry it.
                    </p>
                  )}
                  {listing.requiresPapers && (
                    <p>
                      The seller will hand over the registration and
                      roadworthy papers at collection.
                      {/* Practical consequence of the line above: NaTIS
                          papers handed to a hired driver are the one thing
                          that actually differs when you don't fetch it
                          yourself, so say it rather than let it surprise
                          someone at the gate. */}
                      {collectionMode === 'FREIGHT_OK' &&
                        ' If you send a transporter, agree with the seller up front how those papers get to you.'}
                    </p>
                  )}
                </>
              ) : listing.isFirearm ? (
                <>
                  <p className="mb-1.5">
                    <strong style={{ color: 'var(--text-primary)' }}>
                      The seller is only paid
                    </strong>{' '}
                    once the firearm is stocked at a licensed dealer
                    and verified — payment goes through automatically
                    when verification passes. Neither side can pull out
                    unilaterally before then.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Dealer-stocked transfer:
                    </strong>{' '}
                    seller drops the firearm at their nearest
                    SAPS-licensed dealer. We verify the SAPS 534 +
                    stock-in document + photos, pay the seller, and
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
                      You waive All Outdoor&apos;s payment protection
                      (the seller is paid immediately; no dispute or
                      refund via us). Use only if you know the seller.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mb-1.5">
                    <strong style={{ color: 'var(--text-primary)' }}>
                      The seller is only paid
                    </strong>{' '}
                    once you confirm the item arrived. If anything goes
                    wrong before delivery you are refunded, not the
                    seller paid — and neither side can pull out
                    unilaterally.
                  </p>
                  <p>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Shipping:
                    </strong>{' '}
                    courier delivery to your door, or to a pickup point
                    near you — the price is quoted at checkout.
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
            {vicinityLabel(listing)}
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
          <div className="flex items-center gap-3">
          {/* Seller avatar — click to enlarge (site-wide lightbox). Sits
              OUTSIDE the seller Link so its button click doesn't navigate. */}
          <ClickableAvatar
            src={listing.seller.avatarUrl}
            name={listing.seller.username}
            size={44}
          />
          <Link
            href={`/sellers/${listing.seller.clerkId}`}
            className="block flex-1 min-w-0 rounded-[6px] p-3 text-sm"
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
                  Tiers reflect the seller&apos;s track record on All
                  Outdoor: how many sales they&apos;ve completed, how
                  long they&apos;ve been active, and whether they&apos;re
                  a verified dealer. Higher tiers earn buyer-protection
                  perks like faster payout disputes.
                </HelpTip>
              </span>
            </div>
          </Link>
          </div>

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

      {/* ── UX-28 · sticky mobile buy bar ──────────────────────────────
          Rendered inside <main> ON PURPOSE. <main> is position:relative
          z-index:1, i.e. its own stacking context, so nothing in here can
          out-paint the installed-app bottom tab bar (z-index 55, mounted in
          the root layout) whatever z-index we pick. Instead of fighting that
          we stay out of its way GEOMETRICALLY: in standalone the bar is
          offset a full tab-bar height up, so the two never overlap and the
          "renders under the tab bar" failure can't happen. Within <main> the
          bar sits at 58 — above the page content, still below the auction
          BidModal's z-[60] — and the :has() rule below hides it outright
          while any blocking overlay is mounted, since a modal inside the
          PageReveal wrapper gets its own stacking context and z-index alone
          would not be enough. */}
      {showBuyBar && (
        <>
          {/* Spacer so the last content on the page can always be scrolled
              clear of the fixed bar. lg:hidden mirrors the bar itself. */}
          <div aria-hidden className="lg:hidden" style={{ height: 84 }} />
          <style
            dangerouslySetInnerHTML={{
              __html: [
                // Browser mode: hug the bottom edge, pad past the home
                // indicator. Standalone: sit on top of the 60pt tab bar
                // (which owns the safe-area inset itself).
                `[data-listing-buy-bar]{bottom:0;padding-bottom:calc(10px + env(safe-area-inset-bottom));}`,
                `html[data-standalone='true'] [data-listing-buy-bar]{bottom:calc(60px + env(safe-area-inset-bottom));padding-bottom:10px;}`,
                // Any blocking overlay (currently the auction BidModal) wins.
                `body:has([data-blocking-overlay]) [data-listing-buy-bar]{display:none;}`,
                // Lift Boet's dock clear of the bar so the mascot never
                // covers the CTA. Same trick globals.css already uses for
                // the install prompt — and we defer to that rule when both
                // are on screen, because its lift is the taller one.
              ].join(''),
            }}
          />
          <div
            data-listing-buy-bar="true"
            className="flex items-center gap-3 lg:hidden"
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              zIndex: 58,
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 10,
              background: 'var(--bg-deep)',
              borderTop: '0.5px solid var(--border)',
            }}
          >
            <div className="min-w-0 flex-1">
              <p
                className="text-xs truncate"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {listing.title}
              </p>
              {/* Same price treatment as the cards the buyer arrived from —
                  Archivo 600 with tabular figures — so the number they tapped
                  and the number they are about to pay look like the same
                  number. */}
              <p
                style={{
                  color: 'var(--red)',
                  fontWeight: 600,
                  fontFamily: 'var(--font-head)',
                  fontSize: 19,
                  letterSpacing: '-0.03em',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.2,
                }}
              >
                {buyBarPrice}
              </p>
            </div>
            {listing.listingType === 'BUY_NOW' ? (
              <Link
                href={`/checkout/${listing.id}`}
                className="py-2.5 px-5 rounded-[6px] text-sm flex-shrink-0"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                {buyBarLabel}
              </Link>
            ) : (
              /* Plain in-page anchor — no JS, works with keyboard and with
                 the router untouched. The panel it lands on is the single
                 source of truth for price + state. */
              <a
                href="#buy-panel"
                className="py-2.5 px-5 rounded-[6px] text-sm flex-shrink-0"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                {buyBarLabel}
              </a>
            )}
          </div>
        </>
      )}
    </main>
  );
}
