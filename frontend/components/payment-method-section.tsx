'use client';

// Phase-1 payment gate — manual EFT pay-in is retired and the card paygate
// isn't live yet, so there's no active buyer payment method to select. This
// shell simply signals that card payments are on the way; it binds no state
// and does NOT change any checkout payload. No vendor names (Peach/Stitch/
// Nedbank) — neutral by design. The paygate PR flips this card to "Active".

function CardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

export function PaymentMethodSection() {
  return (
    <div className="mb-3">
      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
        Payment method
      </p>
      <div
        className="flex gap-3 items-start rounded-[8px] p-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <span style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
          <CardIcon />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="block text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            Card &amp; digital wallets
          </span>
          <span className="block text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Visa, Mastercard, Apple Pay, Google Pay — launching soon.
          </span>
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)', fontWeight: 500 }}
        >
          Coming soon
        </span>
      </div>
    </div>
  );
}
