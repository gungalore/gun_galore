import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
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

  const primaryImage = listing.images.find((i) => i.isPrimary) ?? listing.images[0];
  const allImages = listing.images.sort((a, b) => a.order - b.order);

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <Link
        href="/"
        className="text-sm inline-block mb-6"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← Back to listings
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        {/* Left: images */}
        <div>
          <div
            className="relative rounded-[6px] overflow-hidden"
            style={{ paddingBottom: '75%', background: 'var(--bg-inset)' }}
          >
            {primaryImage ? (
              <Image
                src={primaryImage.url}
                alt={listing.title}
                fill
                className="object-contain"
                priority
                sizes="(max-width: 1024px) 100vw, 60vw"
              />
            ) : (
              <div
                className="absolute inset-0 flex items-center justify-center text-sm"
                style={{ color: 'var(--text-tertiary)' }}
              >
                No photos
              </div>
            )}
          </div>

          {allImages.length > 1 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {allImages.map((img) => (
                <div
                  key={img.id}
                  className="relative flex-shrink-0 w-20 h-20 rounded-[4px] overflow-hidden"
                  style={{ background: 'var(--bg-inset)' }}
                >
                  <Image
                    src={img.url}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="80px"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: details */}
        <div>
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
          </div>

          <h1
            className="text-xl mb-3 leading-snug"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {listing.title}
          </h1>

          <div
            className="text-2xl mb-5"
            style={{ color: 'var(--red)', fontWeight: 500 }}
          >
            {formatPrice(listing.price)}
          </div>

          {/* CTA */}
          {listing.status === 'ACTIVE' && listing.listingType === 'BUY_NOW' ? (
            <Link
              href={`/checkout/${listing.id}`}
              className="block w-full py-3 rounded-[6px] text-sm text-center mb-5"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Buy Now — {formatPrice(listing.price)}
            </Link>
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

          {/* Firearm details */}
          {(listing.make || listing.model || listing.calibre) && (
            <div
              className="rounded-[6px] p-3 mb-4 text-sm"
              style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            >
              <p
                className="text-xs uppercase mb-2"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
              >
                Firearm Details
              </p>
              <dl className="space-y-1">
                {listing.make && (
                  <div className="flex justify-between">
                    <dt style={{ color: 'var(--text-tertiary)' }}>Make</dt>
                    <dd style={{ color: 'var(--text-primary)' }}>{listing.make}</dd>
                  </div>
                )}
                {listing.model && (
                  <div className="flex justify-between">
                    <dt style={{ color: 'var(--text-tertiary)' }}>Model</dt>
                    <dd style={{ color: 'var(--text-primary)' }}>{listing.model}</dd>
                  </div>
                )}
                {listing.calibre && (
                  <div className="flex justify-between">
                    <dt style={{ color: 'var(--text-tertiary)' }}>Calibre</dt>
                    <dd style={{ color: 'var(--text-primary)' }}>{listing.calibre}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Province */}
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            {PROVINCE_LABELS[listing.province]}
          </p>

          {/* Seller */}
          <Link
            href={`/sellers/${listing.seller.clerkId}`}
            className="block rounded-[6px] p-3 text-sm"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', textDecoration: 'none' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {listing.seller.firstName ?? 'Seller'}
                  {listing.seller.lastName
                    ? ` ${listing.seller.lastName.charAt(0)}.`
                    : ''}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {listing.seller.totalSales} sale
                  {listing.seller.totalSales !== 1 ? 's' : ''}
                </p>
              </div>
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
            </div>
            <SellerControls
              listingId={listing.id}
              sellerClerkId={listing.seller.clerkId}
              status={listing.status}
            />
          </Link>
        </div>
      </div>

      {/* Description */}
      <div className="mt-8 max-w-[720px]">
        <h2
          className="text-xs uppercase mb-3"
          style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
        >
          Description
        </h2>
        <p
          className="text-sm leading-relaxed whitespace-pre-wrap"
          style={{ color: 'var(--text-primary)' }}
        >
          {listing.description}
        </p>
      </div>
    </main>
  );
}
