'use client';

// Ozow redirect checkout: the buyer chooses from the payment methods enabled
// on the merchant account on Ozow's hosted payment page. Keep this state shell
// until payments are activated; it does not change the checkout payload.

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
            Ozow hosted checkout
          </span>
          <span className="block text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Choose an available payment method on Ozow’s hosted payment page.
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
