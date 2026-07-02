import type { SoldComps } from '@/lib/types';

// P5.6 — "recently sold for…" price-comps strip. POPIA-safe: renders only the
// AGGREGATE range (low/high/median) over the min-comps sample — never any
// individual sale's price or date, so no seller's realised take can be read
// back. Renders nothing below the server's min-comps gate (price fields absent).

function rand(cents: number): string {
  return `R${Math.round(cents / 100).toLocaleString('en-ZA')}`;
}

export function SoldCompsStrip({
  comps,
  scopeName,
}: {
  comps: SoldComps | null;
  scopeName: string;
}) {
  if (
    !comps ||
    comps.low == null ||
    comps.high == null ||
    comps.median == null
  ) {
    return null;
  }

  const rangeIsFlat = comps.low === comps.high;

  return (
    <section
      className="mt-6 rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2
          className="text-sm"
          style={{ color: 'var(--text-primary)', fontWeight: 600 }}
        >
          Recently sold
        </h2>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Based on {comps.count.toLocaleString('en-ZA')} recent sale
          {comps.count !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-sm mt-1.5" style={{ color: 'var(--text-secondary)' }}>
        Similar {scopeName.toLowerCase()} items{' '}
        {rangeIsFlat ? (
          <>
            sold for around{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {rand(comps.median)}
            </strong>
            .
          </>
        ) : (
          <>
            sold for{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {rand(comps.low)}–{rand(comps.high)}
            </strong>
            , typically around{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {rand(comps.median)}
            </strong>
            .
          </>
        )}
      </p>
      <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
        A guide only — actual prices vary with condition, age and demand.
      </p>
    </section>
  );
}
