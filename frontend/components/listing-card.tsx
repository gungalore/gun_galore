import Image from 'next/image';
import Link from 'next/link';
import { Listing } from '@/lib/types';
import { formatPrice, CONDITION_LABELS, TIER_LABELS } from '@/lib/utils';

export function ListingCard({ listing }: { listing: Listing }) {
  const primaryImage = listing.images.find((i) => i.isPrimary) ?? listing.images[0];

  return (
    <Link href={`/listings/${listing.id}`} className="block group">
      <div
        className="rounded-[6px] overflow-hidden transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-hover)';
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card-hover)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)';
        }}
      >
        {/* 4:3 photo */}
        <div className="relative" style={{ paddingBottom: '75%' }}>
          {primaryImage ? (
            <Image
              src={primaryImage.url}
              alt={listing.title}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-xs"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
            >
              No photo
            </div>
          )}
          {/* Category badge — top-left */}
          <span
            className="absolute top-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
            style={{
              background: 'rgba(0,0,0,0.72)',
              color: 'var(--text-secondary)',
            }}
          >
            {listing.category.name}
          </span>
          {/* Condition badge — top-right */}
          <span
            className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
            style={{
              background: 'rgba(0,0,0,0.72)',
              color: 'var(--text-secondary)',
            }}
          >
            {CONDITION_LABELS[listing.condition]}
          </span>
        </div>

        {/* Card body */}
        <div className="p-3">
          <p
            className="text-sm leading-snug line-clamp-2 mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {listing.title}
          </p>

          <div className="flex items-center justify-between">
            <span
              className="text-base"
              style={{ color: 'var(--red)', fontWeight: 500 }}
            >
              {formatPrice(listing.price)}
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-[3px]"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border)',
              }}
            >
              {TIER_LABELS[listing.seller.sellerTier]}
            </span>
          </div>

          <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
            {listing.province.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </p>
        </div>
      </div>
    </Link>
  );
}
