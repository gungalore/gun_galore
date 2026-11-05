'use client';

import type {
  PaymentMethodOption,
  PaymentProvider,
} from '@/lib/payment-methods';

function CardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function EftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 10h18" />
      <path d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
      <path d="M7 15h4" />
    </svg>
  );
}

export function PaymentMethodSection({
  methods,
  value,
  onChange,
  disabled = false,
}: {
  methods: PaymentMethodOption[];
  value: PaymentProvider;
  onChange: (provider: PaymentProvider) => void;
  disabled?: boolean;
}) {
  if (methods.length === 0) return null;

  return (
    <div className="mb-3">
      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
        Payment method
      </p>
      <div className="space-y-2">
        {methods.map((method) => {
          const selected = method.provider === value;
          return (
            <label
              key={method.provider}
              className="flex gap-3 items-start rounded-[8px] p-4 cursor-pointer"
              style={{
                background: 'var(--bg-card)',
                border: `0.5px solid ${selected ? 'var(--red)' : 'var(--border)'}`,
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <input
                type="radio"
                name="payment-provider"
                value={method.provider}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(method.provider)}
                className="mt-0.5"
              />
              <span style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
                {method.provider === 'PEACH' ? <CardIcon /> : <EftIcon />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="block text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {method.label}
                </span>
                <span className="block text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  {method.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
