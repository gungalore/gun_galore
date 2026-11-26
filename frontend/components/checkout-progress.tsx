// Takealot-parity checkout progress (Phase B).
//
// TWO steps, and only two, because that is what actually happens: the buyer
// reviews delivery + payment on /checkout, pays on the gateway's own hosted
// page (which we neither render nor own), and lands back on
// /checkout/complete which confirms the result. Inventing a third "Payment"
// step would be claiming we host a payment screen we don't.
//
// Presentational only — no hooks — so the server-rendered checkout page can
// mount it directly.

const STEPS = [
  { n: 1, label: 'Delivery & payment' },
  { n: 2, label: 'Confirmation' },
] as const;

export function CheckoutProgress({ current }: { current: 1 | 2 }) {
  return (
    <nav aria-label="Checkout progress" className="mb-6">
      <ol
        className="flex items-center gap-2 text-xs"
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {STEPS.map((step, index) => {
          const done = step.n < current;
          const active = step.n === current;
          return (
            <li
              key={step.n}
              className="flex items-center gap-2"
              style={{ minWidth: 0 }}
            >
              {index > 0 && (
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 20,
                    height: 1,
                    background: 'var(--border-visible)',
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                aria-hidden
                className="flex items-center justify-center"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  background: active
                    ? 'var(--action-primary-bg)'
                    : done
                      ? 'var(--bg-inset)'
                      : 'var(--bg-card)',
                  color: active
                    ? 'var(--action-primary-ink)'
                    : done
                      ? 'var(--text-primary)'
                      : 'var(--text-tertiary)',
                  border: `1px solid ${
                    active ? 'var(--action-primary-bg)' : 'var(--border-visible)'
                  }`,
                }}
              >
                {done ? '✓' : step.n}
              </span>
              <span
                aria-current={active ? 'step' : undefined}
                style={{
                  color: active
                    ? 'var(--text-primary)'
                    : done
                      ? 'var(--text-secondary)'
                      : 'var(--text-tertiary)',
                  fontWeight: active ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
