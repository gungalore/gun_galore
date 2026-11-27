'use client';

// UX-8 — transfer method as option cards (icon + title + one-liner) instead of
// button pills. Presentation only: the card's onClick still calls the SAME
// setMethod(m) the pills did, so every downstream effect (address reveal,
// consent gate) and the checkout payload are unchanged.
//
// ⚠️ THE TWO LABELS ARE THE SHARED ONES. Courier / Private / Dealer Stock, from
// lib/delivery-methods.ts — the same words the listing toggle and the sell form
// use. The old copy said "Dealer stock", "Arrange privately" and "Meet in
// person" in different places; those were three names for two choices.

import type { ReactNode } from 'react';
import type { ShippingMethod } from '@/lib/types';
import { deliveryLabel, type DeliveryLabel } from '@/lib/delivery-methods';

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
function CourierIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

const ICONS: Record<DeliveryLabel, ReactNode> = {
  Courier: <CourierIcon />,
  Private: <HandshakeIcon />,
  'Dealer Stock': <DealerIcon />,
};

export function DeliveryMethodCards({
  methods,
  selected,
  onSelect,
  isFirearm,
  dealerName,
  dealerLocation,
}: {
  methods: ShippingMethod[];
  selected: ShippingMethod | null;
  onSelect: (m: ShippingMethod) => void;
  isFirearm: boolean;
  dealerName?: string | null;
  dealerLocation?: string | null;
}) {
  return (
    <div>
      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
        {isFirearm ? 'Transfer method' : 'Delivery method'}
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {methods.map((m) => {
          const label = deliveryLabel(m) as DeliveryLabel;
          const dealerLine = (() => {
            if (label !== 'Dealer Stock') return null;
            const name = dealerName?.trim();
            const location = dealerLocation?.trim();
            if (name && location) {
              // plannedDealerLocation is already "Name - Area, Province".
              return location.toLowerCase().startsWith(name.toLowerCase())
                ? location
                : `${name} - ${location}`;
            }
            return name || location || null;
          })();
          const subtitle =
            label === 'Courier'
              ? 'Door-to-door, tracked, with a delivery estimate at payment'
              : label === 'Dealer Stock'
                ? (dealerLine ??
                  'Seller books it in at their dealer, you collect from yours')
                : isFirearm
                  ? 'Meet at a dealer to do the licence transfer'
                  : 'Meet the seller in person. Payment is held until you confirm; the Platform Fee is non-refundable.';
          const active = selected === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onSelect(m)}
              aria-pressed={active}
              className="flex gap-3 items-start text-left rounded-[8px] p-3"
              style={{
                background: active ? 'var(--red-wash)' : 'var(--bg-card)',
                border: `${active ? '1.5px' : '0.5px'} solid ${active ? 'var(--red)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}
            >
              <span style={{ flexShrink: 0, color: active ? 'var(--red)' : 'var(--text-tertiary)' }}>
                {ICONS[label]}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="block text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {label}
                </span>
                <span className="block text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  {subtitle}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
