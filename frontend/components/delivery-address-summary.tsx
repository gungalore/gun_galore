// Shared collapsed delivery-address row.
//
// 2026-11-25 operator: "there should only be the default address and select
// different address on the checkout", extended to every delivery surface
// (standard checkout, auction checkout, accepted-offer checkout, the cart and
// the motivation print-delivery step). Takealot parity (2026-11-26): the row
// is titled "Delivery to" once an address exists (Change is the control), and
// "Select Delivery Address" with a "Select" control when there is none.
//
// The address DRAWER is each surface's own; this is presentation only.

import type { Ref } from 'react';

export interface DeliveryAddressSummaryProps {
  /** "Delivery to" when chosen, "Select Delivery Address" when there is none. */
  label: string;
  /** Full single-line address, already assembled by the caller. Empty = none. */
  address: string;
  /** Shows the amber warning and warning border when true. */
  incomplete?: boolean;
  incompleteMessage?: string;
  /** "Change" when chosen, "Select" when there is none. */
  changeLabel?: string;
  onChange: () => void;
  /**
   * The change control, so a host can hand it to the address drawer as the
   * element focus returns to on close (Safari does not focus a button on
   * click, so the trap's "whatever had focus" fallback would be the body).
   */
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
}

export function DeliveryAddressSummary({
  label,
  address,
  incomplete = false,
  incompleteMessage,
  changeLabel = 'Change',
  onChange,
  buttonRef,
  disabled = false,
}: DeliveryAddressSummaryProps) {
  const hasAddress = Boolean(address.trim());
  return (
    <div
      className="rounded-[6px] px-3 py-2.5"
      style={{
        background: 'var(--bg-card)',
        border: incomplete
          ? '1px solid var(--warning)'
          : '1px solid var(--border-visible)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-xs"
            style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}
          >
            {label}
          </p>
          {hasAddress && (
            <p
              className="text-sm mt-0.5"
              style={{
                color: 'var(--text-primary)',
                lineHeight: 1.45,
                wordBreak: 'break-word',
              }}
            >
              {address}
            </p>
          )}
        </div>
        <button
          ref={buttonRef}
          type="button"
          onClick={onChange}
          disabled={disabled}
          className="flex-shrink-0 px-3 py-2 rounded-[6px] text-xs"
          style={{
            background: 'transparent',
            border: '1px solid var(--border-visible)',
            color: 'var(--text-primary)',
            fontWeight: 500,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {changeLabel}
        </button>
      </div>
      {incomplete && (
        <p
          className="text-[11px] mt-1.5"
          style={{ color: 'var(--warning)', lineHeight: 1.4 }}
        >
          {incompleteMessage ??
            'Your saved address looks incomplete — select a different address so the parcel reaches you.'}
        </p>
      )}
    </div>
  );
}
