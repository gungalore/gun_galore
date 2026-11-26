// Takealot-parity order summary (Phase B) — the right-hand sticky rail on
// /checkout/[listingId].
//
// Presentational only: the host owns listing, address, quote, payment-rail and
// submission state. This component renders those decisions back to the buyer
// beside the primary call to action, exactly as a marketplace order summary
// does. It is NOT a second source of truth — the figures come from the host's
// previewBreakdown(), which is derived from the same quote the payload uses.
//
// The mobile sticky bar reuses <CheckoutCta> so the desktop rail and the
// phone bar can never disagree about whether the buyer can pay.

import { formatPrice } from '@/lib/utils';
import { TrustBullets } from '@/components/trust-bullets';

export interface CheckoutSummaryItem {
  imageUrl?: string | null;
  title: string;
  /** Condition · category line. */
  meta?: string | null;
  sellerUsername?: string | null;
  /** UNITS, not lines. */
  quantity: number;
  /** Line total for those units. */
  priceCents: number;
  /** Optional spec rows (make / model / calibre) carried from the listing. */
  details?: { label: string; value: string }[];
}

export interface CheckoutSummaryProps {
  item: CheckoutSummaryItem;
  /** e.g. the auction-window note that used to sit inside the listing card. */
  note?: string | null;
  itemsCents: number;
  /** The delivery line as the host already words it ("Calculating…", an
   *  amount, or "Choose a delivery option"). */
  delivery: { value: string; muted?: boolean };
  platformFeeCents: number;
  totalCents: number;
  /** Courier checkout with no delivery address yet → CTA opens the drawer. */
  needsAddress: boolean;
  ready: boolean;
  submitting?: boolean;
  blockedReason?: string | null;
  onSelectAddress: () => void;
  onPay: () => void;
  isFirearm?: boolean;
}

/** The CTA label, in one place, so the sticky bar and the summary agree. */
export function checkoutCtaLabel({
  needsAddress,
  submitting,
  totalCents,
}: {
  needsAddress: boolean;
  submitting?: boolean;
  totalCents: number;
}): string {
  if (needsAddress) return 'Select Delivery Address';
  if (submitting) return 'Setting up payment…';
  return `Pay ${formatPrice(totalCents)}`;
}

/**
 * The primary action. "Select Delivery Address" when the courier rail has no
 * destination yet (it opens the drawer), then "Pay R X" — disabled with the
 * host's plain-language reason until the order is actually ready.
 */
export function CheckoutCta({
  needsAddress,
  ready,
  submitting = false,
  totalCents,
  blockedReason,
  onSelectAddress,
  onPay,
  className,
}: {
  needsAddress: boolean;
  ready: boolean;
  submitting?: boolean;
  totalCents: number;
  blockedReason?: string | null;
  onSelectAddress: () => void;
  onPay: () => void;
  className?: string;
}) {
  const disabled = !needsAddress && (submitting || !ready);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={needsAddress ? onSelectAddress : onPay}
        disabled={disabled}
        className="block w-full py-3 rounded-[6px] text-sm text-center"
        style={{
          background: disabled ? 'var(--bg-inset)' : 'var(--action-primary-bg)',
          color: disabled ? 'var(--text-tertiary)' : 'var(--action-primary-ink)',
          fontWeight: 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
          border: 'none',
        }}
      >
        {checkoutCtaLabel({ needsAddress, submitting, totalCents })}
      </button>
      {!needsAddress && !ready && blockedReason && (
        <p
          className="text-xs mt-2"
          style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
        >
          {blockedReason}
        </p>
      )}
    </div>
  );
}

export function CheckoutSummary({
  item,
  note,
  itemsCents,
  delivery,
  platformFeeCents,
  totalCents,
  needsAddress,
  ready,
  submitting = false,
  blockedReason,
  onSelectAddress,
  onPay,
  isFirearm = false,
}: CheckoutSummaryProps) {
  return (
    <div className="space-y-4">
      {/* Items for delivery — what is actually being bought, and from whom. */}
      <div
        className="rounded-[8px] p-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p
          className="text-xs uppercase mb-3"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            fontWeight: 600,
          }}
        >
          {item.quantity > 1 ? 'Items for delivery' : 'Item for delivery'}
        </p>

        <div className="flex gap-3">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={item.title}
              className="w-16 h-16 rounded-[6px] object-cover flex-shrink-0"
              style={{ background: 'var(--bg-inset)' }}
            />
          ) : (
            <div
              aria-hidden
              className="w-16 h-16 rounded-[6px] flex-shrink-0"
              style={{ background: 'var(--bg-inset)' }}
            />
          )}
          <div className="min-w-0 flex-1">
            <p
              className="text-sm"
              style={{
                color: 'var(--text-primary)',
                fontWeight: 500,
                lineHeight: 1.4,
              }}
            >
              {item.title}
            </p>
            {item.meta && (
              <p
                className="text-xs mt-0.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {item.meta}
              </p>
            )}
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {item.quantity > 1 ? `Qty ${item.quantity} · ` : ''}
              Sold by{' '}
              <span style={{ color: 'var(--text-secondary)' }}>
                {item.sellerUsername ?? 'Anonymous seller'}
              </span>
            </p>
          </div>
          <span
            className="text-sm flex-shrink-0"
            style={{
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatPrice(item.priceCents)}
          </span>
        </div>

        {item.details && item.details.length > 0 && (
          <dl
            className="mt-3 pt-3 space-y-1 text-xs"
            style={{ borderTop: '0.5px solid var(--border-divider)' }}
          >
            {item.details.map((detail) => (
              <div key={detail.label} className="flex justify-between gap-4">
                <dt style={{ color: 'var(--text-tertiary)' }}>{detail.label}</dt>
                <dd
                  style={{
                    color: 'var(--text-secondary)',
                    textAlign: 'right',
                  }}
                >
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {note && (
          <p
            className="text-xs mt-3"
            style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
          >
            {note}
          </p>
        )}
      </div>

      {/* Totals — Items / Delivery / Platform Fee / Total. */}
      <div
        className="rounded-[8px] p-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <SummaryRow label="Items" value={formatPrice(itemsCents)} />
        <SummaryRow
          label="Delivery"
          value={delivery.value}
          muted={delivery.muted}
        />
        {platformFeeCents > 0 && (
          <SummaryRow
            label="Platform Fee"
            value={formatPrice(platformFeeCents)}
            muted
          />
        )}
        <div
          className="flex justify-between items-baseline pt-2 mt-2"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <span
            className="text-sm"
            style={{ color: 'var(--text-primary)', fontWeight: 600 }}
          >
            Total
          </span>
          <span
            className="text-base"
            style={{
              color: 'var(--red)',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatPrice(totalCents)}
          </span>
        </div>
        {platformFeeCents > 0 && (
          <p
            className="text-xs mt-2"
            style={{ color: 'var(--text-tertiary)', lineHeight: 1.4 }}
          >
            Payment handling, seller checks and non-delivery protection.
          </p>
        )}
      </div>

      {/* Primary action + the reassurance that belongs beside it. */}
      <CheckoutCta
        needsAddress={needsAddress}
        ready={ready}
        submitting={submitting}
        totalCents={totalCents}
        blockedReason={blockedReason}
        onSelectAddress={onSelectAddress}
        onPay={onPay}
      />
      <p
        className="text-xs text-center"
        style={{ color: 'var(--text-tertiary)' }}
      >
        The seller is only paid once you confirm delivery.
      </p>

      <div
        className="rounded-[8px] p-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <TrustBullets isFirearm={isFirearm} />
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span
        style={{
          color: muted ? 'var(--text-secondary)' : 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}
