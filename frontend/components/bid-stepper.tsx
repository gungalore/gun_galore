'use client';

/**
 * Shared bid stepper UI + tier-table helpers, used by both the
 * website's AuctionPanel and the SMS-link /a/<token> auction page.
 *
 * Keeping these in one place means the tier table can't drift
 * between the two surfaces — if the backend tier table changes
 * (defined in `INCREMENT_TIERS` in backend/src/auctions/auctions.service.ts),
 * we update `bidIncrement` here once and both places stay correct.
 */

/**
 * Returns the minimum bid step (in cents) at the given current
 * amount. MUST match `bidIncrement()` in
 * backend/src/auctions/auctions.service.ts.
 */
export function bidIncrement(currentAmount: number): number {
  if (currentAmount < 100_000) return 5_000; // <R1,000   → R50
  if (currentAmount < 500_000) return 10_000; // <R5,000   → R100
  if (currentAmount < 1_000_000) return 25_000; // <R10,000  → R250
  if (currentAmount < 5_000_000) return 50_000; // <R50,000  → R500
  return 100_000; //                                >=R50,000 → R1,000
}

/**
 * Always renders with two decimals so the stepper doesn't visually
 * wobble when crossing a whole-rand boundary (R1,000 → R1,000.00
 * looks settled; R1,000 → R1000.00 → R1,010 looks janky).
 */
export function formatRandStrict(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * +/- stepper with tier-aware increments. Decrement disabled when
 * one step below current would drop under `minCents`. Increment
 * unbounded (no upper cap — buyers can bid as high as they like).
 */
export function BidStepper({
  valueCents,
  onChange,
  minCents,
  size = 'default',
}: {
  valueCents: number;
  onChange: (cents: number) => void;
  minCents: number;
  /**
   * 'default' — used in the modal on the listing page (~40px buttons)
   * 'large'   — used on the SMS-link /a/<token> page (~56px buttons
   *             for chunky-thumb mobile tap targets)
   */
  size?: 'default' | 'large';
}) {
  const inc = bidIncrement(valueCents);
  const canDecrement = valueCents - inc >= minCents;
  const btnSize = size === 'large' ? 56 : 40;
  const fontSize = size === 'large' ? 28 : 18;
  const numberSize = size === 'large' ? 32 : 24;

  return (
    <div
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: size === 'large' ? 20 : 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={() => canDecrement && onChange(valueCents - inc)}
          disabled={!canDecrement}
          aria-label="Decrease bid"
          style={{
            width: btnSize,
            height: btnSize,
            borderRadius: '50%',
            background: canDecrement ? 'var(--bg-card)' : 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: canDecrement
              ? 'var(--text-primary)'
              : 'var(--text-tertiary)',
            cursor: canDecrement ? 'pointer' : 'not-allowed',
            fontWeight: 500,
            fontSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          −
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div
            style={{
              fontSize: numberSize,
              color: 'var(--red)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatRandStrict(valueCents)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange(valueCents + inc)}
          aria-label="Increase bid"
          style={{
            width: btnSize,
            height: btnSize,
            borderRadius: '50%',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          +
        </button>
      </div>
      <p
        style={{
          fontSize: 11,
          marginTop: 12,
          textAlign: 'center',
          color: 'var(--text-tertiary)',
        }}
      >
        Steps by {formatRandStrict(inc)} · Minimum {formatRandStrict(minCents)}
      </p>
    </div>
  );
}
