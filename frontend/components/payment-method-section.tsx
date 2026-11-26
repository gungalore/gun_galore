'use client';

import { useState } from 'react';
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

function MethodIcon({ provider }: { provider: PaymentProvider }) {
  return provider === 'PEACH' ? <CardIcon /> : <EftIcon />;
}

/**
 * Payment method block.
 *
 * WARNING: WITH ONE RAIL THIS RENDERS NOTHING. In the Peach-only launch state the
 * rail is already chosen for the checkout and Peach's own hosted page presents
 * the real pay options (card, Instant EFT, etc.), so a single tile here only
 * duplicated that choice. The buyer sees the Pay button alone.
 *
 * When the server offers MORE THAN ONE rail (e.g. Ozow re-enabled) the block
 * appears as a compact review row with a Change control that expands the radio
 * cards, so the buyer can see and switch the captured rail.
 *
 * Presentational only: the host owns the selected provider and the payload.
 */
export function PaymentMethodSection({
  methods,
  value,
  onChange,
  disabled = false,
}: {
  methods: PaymentMethodOption[];
  value: PaymentProvider | null;
  onChange: (provider: PaymentProvider) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Zero rails or one rail = nothing to choose (Peach's hosted page presents
  // the actual card/EFT options), so the block hides and the buyer only sees Pay.
  if (methods.length <= 1) return null;

  const selected = methods.find((m) => m.provider === value) ?? methods[0];
  const multiple = methods.length > 1;
  const showCards = multiple && expanded && !disabled;

  return (
    <div className="mb-3">
      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
        Payment method
      </p>

      {/* Selected-rail review row — always visible, one row for one rail. */}
      <div
        className="flex items-start gap-3 rounded-[8px] p-4"
        style={{
          background: 'var(--action-option-selected-bg)',
          border: '1.5px solid var(--action-option-selected-edge)',
          color: 'var(--action-option-selected-ink)',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
          <MethodIcon provider={selected.provider} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            className="block text-sm"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {selected.label}
          </span>
          <span
            className="block text-xs"
            style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
          >
            {selected.description}
          </span>
        </span>
        {multiple && !disabled && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={showCards}
            className="flex-shrink-0 px-3 py-2 rounded-[6px] text-xs"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-visible)',
              color: 'var(--text-primary)',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {showCards ? 'Done' : 'Change'}
          </button>
        )}
      </div>

      {/* Expanded choice — only when the server offers 2+ rails. */}
      {showCards && (
        <div className="space-y-2 mt-2">
          {methods.map((method) => {
            const active = method.provider === selected.provider;
            return (
              <label
                key={method.provider}
                className="flex gap-3 items-start rounded-[8px] p-4 cursor-pointer"
                style={{
                  background: active
                    ? 'var(--action-option-selected-bg)'
                    : 'transparent',
                  border: `1.5px solid ${
                    active
                      ? 'var(--action-option-selected-edge)'
                      : 'var(--action-option-edge)'
                  }`,
                  color: active
                    ? 'var(--action-option-selected-ink)'
                    : 'var(--text-primary)',
                }}
              >
                <input
                  type="radio"
                  name="payment-provider"
                  value={method.provider}
                  checked={active}
                  onChange={() => {
                    onChange(method.provider);
                    setExpanded(false);
                  }}
                  className="mt-0.5"
                />
                <span style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
                  <MethodIcon provider={method.provider} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    className="block text-sm"
                    style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                  >
                    {method.label}
                  </span>
                  <span
                    className="block text-xs"
                    style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
                  >
                    {method.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
