'use client';

// UX-8 — delivery/transfer method as option cards (icon + title + one-liner +
// price) instead of button pills. Presentation only: the card's onClick still
// calls the SAME setMethod(m) the pills did, so every downstream effect (quote
// fetch, address reveal, consent gate) and the checkout payload are unchanged.
// Only applicable methods are passed in (per listing flags), so firearm vs
// courier vs collection each render just their valid options.

import type { ReactNode } from 'react';
import type { ShippingMethod } from '@/lib/types';
import { formatPrice } from '@/lib/utils';

function LockerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <circle cx="16" cy="6" r="0.6" fill="currentColor" />
      <circle cx="16" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}
function TruckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17.5" cy="18" r="1.6" />
    </svg>
  );
}
function DealerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9l9-5 9 5M4 9v11h16V9" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}
function HandshakeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 12l3-3 3 3 3-3M3 10l4-4 5 5-2 2-3-3M21 10l-4-4" />
    </svg>
  );
}

const META: Record<string, { title: string; subtitle: string; icon: ReactNode }> = {
  PUDO: { title: 'Pudo locker', subtitle: 'Collect from a nearby locker', icon: <LockerIcon /> },
  TCG: { title: 'Door delivery', subtitle: 'The Courier Guy, to your address', icon: <TruckIcon /> },
  // Firearms have exactly TWO hand-over options and both go through a licensed
  // dealer. Never describe either as a "private collection" — a firearm is
  // never simply handed over, and copy that implies otherwise misdescribes what
  // the platform does.
  DEALER_TRANSFER: { title: 'Dealer stock', subtitle: 'Seller books it in at their dealer, you collect from yours', icon: <DealerIcon /> },
  PRIVATE_ARRANGE: { title: 'Arrange privately', subtitle: 'Meet at a dealer to do the licence transfer', icon: <HandshakeIcon /> },
};

export function DeliveryMethodCards({
  methods,
  selected,
  onSelect,
  isFirearm,
  quotePriceCents,
}: {
  methods: ShippingMethod[];
  selected: ShippingMethod | null;
  onSelect: (m: ShippingMethod) => void;
  isFirearm: boolean;
  /** Live courier quote (PUDO/TCG only), shown on the card when ready. */
  quotePriceCents?: number | null;
}) {
  return (
    <div>
      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
        {isFirearm ? 'Transfer method' : 'Delivery method'}
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {methods.map((m) => {
          const meta = META[m] ?? { title: m, subtitle: '', icon: null };
          const active = selected === m;
          // The quote in state belongs to the SELECTED method only (the parent
          // refetches per method), so only show it on the active courier card —
          // otherwise the unselected courier would show the wrong price.
          const price =
            active && (m === 'PUDO' || m === 'TCG') && quotePriceCents != null
              ? quotePriceCents
              : undefined;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onSelect(m)}
              aria-pressed={active}
              className="flex gap-3 items-start text-left rounded-[8px] p-4"
              style={{
                background: active ? 'rgba(200,16,46,0.06)' : 'var(--bg-card)',
                border: `${active ? '1.5px' : '0.5px'} solid ${active ? 'var(--red)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}
            >
              <span style={{ flexShrink: 0, color: active ? 'var(--red)' : 'var(--text-tertiary)' }}>
                {meta.icon}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="block text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {meta.title}
                </span>
                <span className="block text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  {meta.subtitle}
                </span>
              </span>
              {price != null && (
                <span
                  className="text-sm"
                  style={{ color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}
                >
                  {formatPrice(price)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
