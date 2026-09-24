'use client';

// UX-8 — transfer method as option cards (icon + title + one-liner) instead of
// button pills. Presentation only: the card's onClick still calls the SAME
// setMethod(m) the pills did, so every downstream effect (address reveal,
// consent gate) and the checkout payload are unchanged. This now renders only
// the firearm hand-over routes — door courier is the single non-firearm rail
// and has no choice to present.

import type { ReactNode } from 'react';
import type { ShippingMethod } from '@/lib/types';

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
}: {
  methods: ShippingMethod[];
  selected: ShippingMethod | null;
  onSelect: (m: ShippingMethod) => void;
  isFirearm: boolean;
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
          return (
            <button
              key={m}
              type="button"
              onClick={() => onSelect(m)}
              aria-pressed={active}
              className="flex gap-3 items-start text-left rounded-[8px] p-4"
              style={{
                background: active ? 'rgba(227,6,19,0.06)' : 'var(--bg-card)',
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
