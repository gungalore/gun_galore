'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { DealPublic } from '@/lib/types';
import { formatPrice, discountPercent, CONDITION_LABELS } from '@/lib/utils';
import { DealCountdown } from './deal-countdown';
import { UrgencyChip } from './urgency-chip';
import { CARD_PHOTO_ASPECT } from './listing-card';

// Daily Deals storefront card (DD-3). Deliberately mirrors ListingCard's
// geometry (shared CARD_PHOTO_ASPECT image box, same next/image sizes, same body layout) so
// the /deals grid sits visually flush with the rest of the marketplace — but
// it's deal-native: it links to the deal-chrome PDP (/deals/[id]), always
// shows the was/now/save chrome (a deal always has a was-price), a live
// "Ends in" countdown, and a sold-out / low-stock scarcity signal. Uses the
// shared discountPercent helper so the displayed save% inherits the site's
// 70% CPA-s41 anti-anchoring cap.
export function DealCard({ deal }: { deal: DealPublic }) {
  const images = deal.images ?? [];
  const primaryImage = images.find((i) => i.isPrimary) ?? images[0];
  const savePct = discountPercent(deal.dealPriceCents, deal.wasPriceCents);
  const sellable = deal.trackInventory ? deal.quantityAvailable : null;

  return (
    <Link href={`/deals/${deal.id}`} className="block group">
      <div
        className="gg-tile gg-tile-lift rounded-[6px] overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-hover)';
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card-hover)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)';
        }}
      >
        <div className="relative" style={{ paddingBottom: CARD_PHOTO_ASPECT }}>
          {primaryImage ? (
            <Image
              src={primaryImage.url}
              alt={deal.title}
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
          {/* Save% flag — top-left, the deal's headline pull. */}
          {savePct != null && (
            <span
              className="absolute top-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
              style={{ background: 'var(--red)', color: '#fff', fontWeight: 600 }}
            >
              −{savePct}%
            </span>
          )}
          {/* Condition chip — bottom-left, matching ListingCard. */}
          <span
            className="absolute bottom-2 left-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
            style={{ background: 'rgba(0,0,0,0.72)', color: 'var(--text-secondary)' }}
          >
            {CONDITION_LABELS[deal.condition] ?? deal.condition}
          </span>
          {/* Scarcity — bottom-right. Sold out overrides the low-stock chip. */}
          {deal.soldOut ? (
            <span
              className="absolute bottom-2 right-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
              style={{ background: 'rgba(0,0,0,0.8)', color: '#fff', fontWeight: 600 }}
            >
              Sold out
            </span>
          ) : (
            sellable != null &&
            sellable >= 1 &&
            sellable <= 5 && (
              <UrgencyChip
                left={sellable}
                className="absolute bottom-2 right-2 text-xs px-1.5 py-0.5 rounded-[4px] leading-none"
              />
            )
          )}
        </div>

        <div className="p-3">
          <p
            className="text-sm leading-snug line-clamp-2 mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {deal.title}
          </p>

          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-base" style={{ color: 'var(--red)', fontWeight: 600 }}>
              {formatPrice(deal.dealPriceCents)}
            </span>
            {deal.wasPriceCents > deal.dealPriceCents && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  textDecoration: 'line-through',
                }}
              >
                {formatPrice(deal.wasPriceCents)}
              </span>
            )}
          </div>

          {/* Countdown + province row. Only a buyable deal shows the live
              "Ends in"; an ended/sold-out card shows a neutral status. */}
          <div
            className="flex items-center justify-between text-xs mt-1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <span>
              {deal.province
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
            {deal.buyable ? (
              <DealCountdown endsAt={deal.endsAt} variant="chip" />
            ) : deal.soldOut ? (
              <span style={{ color: 'var(--text-secondary)' }}>Sold out</span>
            ) : (
              <span style={{ color: 'var(--text-secondary)' }}>Ended</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
