import type { ValuationComp } from '../../lib/valuation-api';

function zar(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
}

/**
 * The comparable listings the research found and opened. Third-party data is
 * reduced to price, model, condition, date and URL by design.
 */
export function CompsTable({ comps }: { comps: ValuationComp[] }) {
  if (!comps.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        No comparable listings were found.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
            <th className="py-2 pr-3 font-medium">Item</th>
            <th className="py-2 pr-3 font-medium">Condition</th>
            <th className="py-2 pr-3 font-medium">Price</th>
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {comps.map((c, i) => (
            <tr
              key={`${c.url}-${i}`}
              style={{ borderTop: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
            >
              <td className="py-2 pr-3">
                {c.model ?? (c.kind === 'RETAIL_ANCHOR' ? 'New retail anchor' : 'Listing')}
                {c.kind === 'RETAIL_ANCHOR' && (
                  <span className="ml-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    anchor
                  </span>
                )}
                {c.kind === 'ACCESSORY' && (
                  <span className="ml-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    accessory
                  </span>
                )}
                {c.kind === 'USED_COMP' && (c.match?.diffs?.length ?? 0) > 0 && (
                  <span
                    className="ml-1 text-[10px] px-1 py-0.5 rounded"
                    style={{ background: 'rgba(178,106,0,0.12)', color: '#b26a00' }}
                    title={c.match!.diffs
                      .map(
                        (d) =>
                          `${d.dimension}: ${d.compValue ?? '?'}${d.itemValue ? ` vs yours ${d.itemValue}` : ''}`,
                      )
                      .join('; ')}
                  >
                    different spec
                  </span>
                )}
                {c.kind === 'USED_COMP' && !(c.match?.diffs?.length ?? 0) && (
                  <span className="ml-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    same spec
                  </span>
                )}
              </td>
              <td className="py-2 pr-3">{c.condition ?? '-'}</td>
              <td className="py-2 pr-3">{zar(c.priceZar * 100)}</td>
              <td className="py-2 pr-3">{c.listedDate ?? '-'}</td>
              <td className="py-2">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: c.pageOpened ? 'var(--red)' : 'var(--text-tertiary)' }}
                >
                  {c.pageOpened ? 'opened' : 'unverified'}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
