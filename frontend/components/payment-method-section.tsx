'use client';

// UX-8 — payment-method section shell (replaces the single "coming soon"
// banner). Gateway-neutral: today it shows Instant EFT as the one active,
// selected method, with a disabled "Card & digital wallets — coming soon" card
// beside it so the paygate PR (P8e) just flips that card on. Purely
// informational for now — payment is the manual-EFT rail (PAYMENT_MODE=manual),
// so this binds no state and does NOT change any checkout payload. No vendor
// names (Peach/Stitch/Nedbank) — neutral by design.

function BankIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9l9-5 9 5M4 9v10h16V9" />
      <line x1="7" y1="12" x2="7" y2="16" />
      <line x1="12" y1="12" x2="12" y2="16" />
      <line x1="17" y1="12" x2="17" y2="16" />
      <line x1="3" y1="19" x2="21" y2="19" />
    </svg>
  );
}
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
      <div style={{ display: 'grid', gap: 8 }}>
        {/* Active method today — Instant EFT */}
        <div
          className="flex gap-3 items-start rounded-[8px] p-4"
          style={{ background: 'rgba(200,16,46,0.06)', border: '1.5px solid var(--red)' }}
        >
          <span style={{ flexShrink: 0, color: 'var(--red)' }}>
            <BankIcon />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="block text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              Bank transfer (EFT)
            </span>
            <span className="block text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Pay by bank transfer. Payment held until you confirm delivery.
            </span>
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 500 }}
          >
            Active
          </span>
        </div>

        {/* Coming soon — card & wallets (paygate seam) */}
        <div
          className="flex gap-3 items-start rounded-[8px] p-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', opacity: 0.6 }}
        >
          <span style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
            <CardIcon />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="block text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              Card &amp; digital wallets
            </span>
            <span className="block text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Visa, Mastercard, Apple Pay, Google Pay
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
    </div>
  );
}
