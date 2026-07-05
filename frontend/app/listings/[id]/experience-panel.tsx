'use client';

import Link from 'next/link';
import { Listing } from '@/lib/types';
import {
  formatPrice,
  PROVINCE_LABELS,
  EXPERIENCE_TYPE_LABELS,
} from '@/lib/utils';

// Hunting Packages / Experiences (Phase E) — the buyer-facing detail panel
// rendered from listings/[id]/page.tsx when listing.isExperience. It replaces
// the shipping block with an on-site notice and drives the booking:
//   • fixed-price (BUY_NOW) → a "Book" CTA into the standard checkout, where
//     the eventDate / partySize / five attestations are captured.
//   • AUCTION → the existing AuctionPanel handles bidding (rendered by
//     page.tsx); here we just show the event details.
// Public surfaces show the seller's USERNAME only (handled upstream).
export default function ExperiencePanel({
  listing,
  isOwnListing,
}: {
  listing: Listing;
  isOwnListing: boolean;
}) {
  const isHunt = listing.experienceType === 'PLAINS_GAME_HUNT';
  const isAuction = listing.listingType === 'AUCTION';

  // Format the event window. Single-day when there's no end date; otherwise
  // a "start – end" range.
  const eventWindow = (() => {
    if (!listing.eventStartDate) return null;
    const start = new Date(listing.eventStartDate).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    if (!listing.eventEndDate) return start;
    const end = new Date(listing.eventEndDate).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return `${start} – ${end}`;
  })();

  return (
    <div className="mb-5 space-y-3">
      {/* Package-type + on-site badges */}
      <div className="flex flex-wrap gap-1.5">
        {listing.experienceType && (
          <span
            className="text-xs px-2 py-0.5 rounded-[3px]"
            style={{
              background: 'rgba(232,181,58,0.12)',
              color: '#E8B53A',
              border: '0.5px solid rgba(232,181,58,0.45)',
            }}
          >
            {EXPERIENCE_TYPE_LABELS[listing.experienceType]}
          </span>
        )}
        <span
          className="text-xs px-2 py-0.5 rounded-[3px]"
          style={{
            background: 'var(--bg-inset)',
            color: 'var(--text-tertiary)',
            border: '0.5px solid var(--border)',
          }}
        >
          Experience · on-site
        </span>
      </div>

      {/* Event details card */}
      <div
        className="rounded-[8px] p-4 text-sm"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p
          className="text-xs uppercase mb-3"
          style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
        >
          Experience details
        </p>
        <dl className="space-y-2">
          {eventWindow && (
            <Row label="When" value={eventWindow} />
          )}
          {listing.durationText && (
            <Row label="Duration" value={listing.durationText} />
          )}
          {listing.eventProvince && (
            <Row
              label="Province"
              value={PROVINCE_LABELS[listing.eventProvince]}
            />
          )}
          {listing.locationText && (
            <Row label="Location" value={listing.locationText} />
          )}
          {listing.capacitySlots != null && (
            <Row
              label="Capacity"
              value={`Up to ${listing.capacitySlots} guest${
                listing.capacitySlots === 1 ? '' : 's'
              }`}
            />
          )}
          <Row
            label="Rifle"
            value={
              listing.rifleProvided
                ? 'Provided with the package'
                : 'Bring your own firearm'
            }
          />
        </dl>

        {/* Species — plains-game hunts only. */}
        {isHunt && listing.speciesList && listing.speciesList.length > 0 && (
          <div
            className="mt-3 pt-3"
            style={{ borderTop: '0.5px solid var(--border-divider)' }}
          >
            <p
              className="text-xs uppercase mb-2"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
            >
              Species
            </p>
            <div className="flex flex-wrap gap-1.5">
              {listing.speciesList.map((s) => (
                <span
                  key={s}
                  className="text-xs px-2 py-0.5 rounded-[3px]"
                  style={{
                    background: 'var(--bg-inset)',
                    color: 'var(--text-secondary)',
                    border: '0.5px solid var(--border)',
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* What's included */}
        {listing.whatsIncluded && (
          <div
            className="mt-3 pt-3"
            style={{ borderTop: '0.5px solid var(--border-divider)' }}
          >
            <p
              className="text-xs uppercase mb-2"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
            >
              What&apos;s included
            </p>
            <p
              className="whitespace-pre-wrap"
              style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}
            >
              {listing.whatsIncluded}
            </p>
          </div>
        )}
      </div>

      {/* Book CTA (fixed-price only). Auctions bid via the AuctionPanel that
          page.tsx renders separately — no Book button here. */}
      {!isAuction &&
        listing.status === 'ACTIVE' &&
        (isOwnListing ? (
          <div
            className="block w-full py-3 rounded-[6px] text-sm text-center"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
            }}
          >
            This is your own experience
          </div>
        ) : (
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
            Book — {listing.price ? formatPrice(listing.price) : 'select date'}
          </Link>
        ))}

      {/* On-site notice — replaces the standard shipping block. */}
      <div
        className="rounded-[8px] p-4 text-xs"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          lineHeight: 1.55,
        }}
      >
        <p
          className="uppercase mb-2"
          style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
        >
          On-site — no delivery
        </p>
        <p className="mb-1.5">
          <strong style={{ color: 'var(--text-primary)' }}>
            You attend on the event date
          </strong>{' '}
          — there is no courier or parcel. Once you book, your payment is held
          by Gun Galore and released to the outfitter after you confirm the
          experience happened.
        </p>
        <p style={{ color: 'var(--text-tertiary)' }}>
          Gun Galore is a payment-protection intermediary; the outfitter is the
          supplier. Bookings are covered by our{' '}
          <Link
            href="/experiences-cancellation-policy"
            style={{ color: 'var(--red)', textDecoration: 'underline' }}
          >
            experiences cancellation policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt style={{ color: 'var(--text-tertiary)' }}>{label}</dt>
      <dd
        className="text-right"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        {value}
      </dd>
    </div>
  );
}
