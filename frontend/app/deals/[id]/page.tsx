import { notFound } from 'next/navigation';
import { BrowseRailShell } from '@/components/browse-rail-shell';
import Link from 'next/link';
import type { Metadata } from 'next';
import { apiFetch } from '@/lib/api';
import type { DealPublic } from '@/lib/types';
import { formatPrice, discountPercent, CONDITION_LABELS, PROVINCE_LABELS } from '@/lib/utils';
import { AddToCartButton } from '@/components/add-to-cart-button';
import { ImageGallery } from '@/app/listings/[id]/image-gallery';
import { DealCountdown } from '@/components/deal-countdown';
import { PageReveal } from '@/components/page-reveal';

// ── Daily Deal product page (DD-3) ────────────────────────────────────
// The deal-chrome PDP for a single first-party house deal. Mirrors the
// marketplace listing PDP's two-column shell (gallery left, buy column right)
// but is deal-native: was/now price + save%, a live "ends in" banner,
// scarcity, per-customer limit, and a "sold & shipped by Gun Galore"
// first-party trust block. The MONEY path is unchanged — the Buy Now link and
// AddToCartButton feed the exact same /checkout/[listingId] + cart rails the
// rest of the site uses; DD-2 already zeroes commission/payout + auto-accepts
// for a house deal. Gated on `deals_enabled` inside the API (404 when off).

async function loadDeal(idOrRef: string): Promise<DealPublic | null> {
  return apiFetch<DealPublic>(`/deals/${idOrRef}`, { cache: 'no-store' }).catch(
    () => null,
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const deal = await loadDeal(id);
  if (!deal) return { title: 'Deal not found — Gun Galore' };
  const title = `${deal.title} — Daily Deal — Gun Galore`;
  const description = deal.description.slice(0, 160);
  const primary = deal.images?.find((i) => i.isPrimary) ?? deal.images?.[0];
  return {
    title,
    description,
    alternates: { canonical: `/deals/${deal.id}` },
    // Only index a live, buyable deal — an ended/sold-out deal page stays out.
    robots: deal.buyable ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: `/deals/${deal.id}`,
      type: 'website',
      images: primary ? [{ url: primary.url }] : undefined,
    },
  };
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await loadDeal(id);
  if (!deal) return notFound();

  const images = [...(deal.images ?? [])].map((img) => ({
    id: img.id,
    url: img.url,
    isPrimary: img.isPrimary,
  }));
  const savePct = discountPercent(deal.dealPriceCents, deal.wasPriceCents);
  const collectionOnly = deal.shippingMethods?.includes('COLLECTION');
  const provinceLabel =
    PROVINCE_LABELS[deal.province] ??
    deal.province.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const shipsIn =
    deal.shipsInDaysMin === deal.shipsInDaysMax
      ? `${deal.shipsInDaysMin}`
      : `${deal.shipsInDaysMin}–${deal.shipsInDaysMax}`;

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <BrowseRailShell>
      <div className="mb-4">
        <Link href="/deals" className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          ← All deals
        </Link>
      </div>

      <PageReveal>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-reveal>
          {/* Gallery */}
          <div>
            {images.length > 0 ? (
              <ImageGallery images={images} title={deal.title} />
            ) : (
              <div
                className="rounded-[8px] flex items-center justify-center"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-tertiary)',
                  aspectRatio: '4 / 3',
                }}
              >
                No photo
              </div>
            )}
          </div>

          {/* Deal + buy column */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-xs px-2 py-0.5 rounded-[4px]"
                style={{
                  background: 'rgba(200,16,46,0.10)',
                  color: 'var(--red)',
                  border: '0.5px solid var(--red)',
                  fontWeight: 600,
                }}
              >
                Daily Deal
              </span>
              {deal.category && (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {deal.category.name}
                </span>
              )}
            </div>

            <h1
              className="text-xl leading-snug mb-3"
              style={{ color: 'var(--text-primary)', fontWeight: 600 }}
            >
              {deal.title}
            </h1>

            {/* Price block */}
            <div className="flex items-baseline gap-3 flex-wrap mb-1">
              <span className="text-2xl" style={{ color: 'var(--red)', fontWeight: 700 }}>
                {formatPrice(deal.dealPriceCents)}
              </span>
              {deal.wasPriceCents > deal.dealPriceCents && (
                <span
                  className="text-base"
                  style={{ color: 'var(--text-tertiary)', textDecoration: 'line-through' }}
                >
                  {formatPrice(deal.wasPriceCents)}
                </span>
              )}
              {savePct != null && (
                <span
                  className="text-sm px-1.5 py-0.5 rounded-[4px]"
                  style={{ background: 'var(--red)', color: '#fff', fontWeight: 600 }}
                >
                  Save {savePct}%
                </span>
              )}
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Price includes VAT. Shipping calculated at checkout.
            </p>

            {/* Countdown — only while the deal is buyable. */}
            {deal.buyable && deal.endsAt && (
              <DealCountdown endsAt={deal.endsAt} variant="banner" label="Deal ends in" />
            )}

            {/* Buy CTA — reuses the standard checkout + cart rails. */}
            {deal.buyable ? (
              <>
                {deal.trackInventory &&
                  deal.quantityAvailable > 0 &&
                  deal.quantityAvailable <= 10 && (
                    <p className="text-sm mb-2" style={{ color: 'var(--red)', fontWeight: 500 }}>
                      Only {deal.quantityAvailable} left
                    </p>
                  )}
                <Link
                  href={`/checkout/${deal.listingId}`}
                  className="block w-full py-3 rounded-[6px] text-sm text-center mb-2"
                  style={{ background: 'var(--red)', color: '#fff', fontWeight: 500, textDecoration: 'none' }}
                >
                  Buy Now — {formatPrice(deal.dealPriceCents)}
                </Link>
                {collectionOnly ? (
                  <div
                    className="block w-full py-3 rounded-[6px] text-xs text-center mb-3"
                    style={{
                      background: 'var(--bg-inset)',
                      color: 'var(--text-secondary)',
                      border: '0.5px solid var(--border)',
                      lineHeight: 1.5,
                    }}
                  >
                    Collection only — use Buy Now to arrange collection.
                  </div>
                ) : (
                  <AddToCartButton
                    item={{
                      listingId: deal.listingId,
                      title: deal.title,
                      price: deal.dealPriceCents,
                      imageUrl:
                        deal.images?.find((i) => i.isPrimary)?.url ??
                        deal.images?.[0]?.url,
                      // First-party: the seller is the house account. Username
                      // only — never the house seller's real identity.
                      sellerId: deal.seller?.clerkId ?? '',
                      sellerUsername: deal.seller?.username ?? 'Gun Galore',
                      isFirearm: false, // deals never include firearms
                      shippingMethods: deal.shippingMethods,
                    }}
                  />
                )}
                {deal.perCustomerCap > 0 && (
                  <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                    Limit {deal.perCustomerCap} per customer.
                  </p>
                )}
                <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Secure checkout — your payment is held until the item ships.
                </p>
              </>
            ) : (
              <div
                className="rounded-[6px] px-4 py-4 mb-3 text-center"
                style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
              >
                <p className="text-base mb-1" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  {deal.soldOut ? 'Sold out' : 'This deal has ended'}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {deal.soldOut
                    ? 'This deal sold out. Fresh deals drop regularly — '
                    : 'This deal has closed. Fresh deals drop regularly — '}
                  <Link href="/deals" style={{ color: 'var(--red)' }}>
                    see what&apos;s live now
                  </Link>
                  .
                </p>
              </div>
            )}

            {/* First-party trust block */}
            <div
              className="rounded-[6px] px-3 py-3 mt-4 mb-4 text-xs"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)', lineHeight: 1.6 }}
            >
              <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>
                Sold &amp; shipped by Gun Galore
              </p>
              <p style={{ margin: 0 }}>
                Ships in {shipsIn} working day{deal.shipsInDaysMax === 1 ? '' : 's'} ·
                {' '}buyer protection applies · 6-month CPA warranty and a 7-day
                right to return. See our{' '}
                <Link href="/refund-policy" style={{ color: 'var(--red)' }}>
                  refund policy
                </Link>
                .
              </p>
            </div>

            {/* Specs */}
            <dl className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              <div className="flex justify-between py-1.5" style={{ borderTop: '0.5px solid var(--border)' }}>
                <dt style={{ color: 'var(--text-tertiary)' }}>Condition</dt>
                <dd style={{ color: 'var(--text-primary)' }}>
                  {CONDITION_LABELS[deal.condition] ?? deal.condition}
                </dd>
              </div>
              {deal.make && (
                <div className="flex justify-between py-1.5" style={{ borderTop: '0.5px solid var(--border)' }}>
                  <dt style={{ color: 'var(--text-tertiary)' }}>Make</dt>
                  <dd style={{ color: 'var(--text-primary)' }}>{deal.make}</dd>
                </div>
              )}
              {deal.model && (
                <div className="flex justify-between py-1.5" style={{ borderTop: '0.5px solid var(--border)' }}>
                  <dt style={{ color: 'var(--text-tertiary)' }}>Model</dt>
                  <dd style={{ color: 'var(--text-primary)' }}>{deal.model}</dd>
                </div>
              )}
              <div className="flex justify-between py-1.5" style={{ borderTop: '0.5px solid var(--border)', borderBottom: '0.5px solid var(--border)' }}>
                <dt style={{ color: 'var(--text-tertiary)' }}>Ships from</dt>
                <dd style={{ color: 'var(--text-primary)' }}>{provinceLabel}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Description — full width below the fold */}
        <section className="mt-8 max-w-[720px]" data-reveal>
          <h2 className="text-base mb-2" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            About this deal
          </h2>
          <p
            className="text-sm whitespace-pre-wrap"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
          >
            {deal.description}
          </p>
        </section>
      </PageReveal>
    </BrowseRailShell>
    </main>
  );
}
