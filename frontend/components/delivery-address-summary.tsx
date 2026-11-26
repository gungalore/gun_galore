// Shared collapsed delivery-address row.
//
// 2026-11-25 operator: "there should only be the default address and select
// different address on the checkout", extended to every delivery surface
// (standard checkout, auction checkout, accepted-offer checkout and the
// motivation print-delivery step). Every surface renders the same row: the
// address that will be used, one control to change it, and an honest warning
// when the saved default looks incomplete. The editor (address book + manual
// fields) is each surface's own; this is presentation only.

import type { Ref } from 'react';

export interface DeliveryAddressSummaryProps {
  /** e.g. "Deliver to my default address" or "Deliver to". */
  label: string;
  /** Full single-line address, already assembled by the caller. */
  address: string;
  /** Shows the amber warning and warning border when true. */
  incomplete?: boolean;
  incompleteMessage?: string;
  changeLabel?: string;
  onChange: () => void;
  /**
   * The change control, so a host can hand it to the address dialog as the
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
  changeLabel = 'Select a different address',
  onChange,
  buttonRef,
  disabled = false,
}: DeliveryAddressSummaryProps) {
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
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-xs"
            style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}
          >
            {label}
          </p>
          <p
            className="text-sm mt-0.5"
            style={{
              color: 'var(--text-primary)',
              lineHeight: 1.45,
              wordBreak: 'break-word',
            }}
          >
            {address || 'No address on file'}
          </p>
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
