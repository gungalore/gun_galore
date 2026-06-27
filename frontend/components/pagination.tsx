import Link from 'next/link';

/**
 * Numbered paginator with a windowed page list (1 … 4 5 6 … 20) plus
 * Prev/Next. Server component — `hrefFor` is a closure provided by the page
 * that builds the URL for a given page number (preserving its own filters).
 */
export function Pagination({
  currentPage,
  totalPages,
  hrefFor,
}: {
  currentPage: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const shown = new Set<number>([1, totalPages]);
  for (let p = currentPage - 1; p <= currentPage + 1; p += 1) {
    if (p >= 1 && p <= totalPages) shown.add(p);
  }
  const sorted = [...shown].sort((a, b) => a - b);
  const items: Array<number | 'gap'> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) items.push('gap');
    items.push(p);
    prev = p;
  }

  const base: React.CSSProperties = {
    border: '0.5px solid var(--border)',
    color: 'var(--text-secondary)',
    background: 'var(--bg-inset)',
  };
  const active: React.CSSProperties = {
    border: '0.5px solid var(--red)',
    color: '#fff',
    background: 'var(--red)',
  };

  return (
    <nav
      aria-label="Pagination"
      className="flex justify-center items-center gap-1.5 mt-10 flex-wrap"
    >
      {currentPage > 1 && (
        <Link
          href={hrefFor(currentPage - 1)}
          rel="prev"
          className="px-3 py-2 rounded-[6px] text-sm"
          style={base}
        >
          ← Prev
        </Link>
      )}
      {items.map((it, i) =>
        it === 'gap' ? (
          <span
            key={`gap-${i}`}
            className="px-2 text-sm"
            style={{ color: 'var(--text-tertiary)' }}
            aria-hidden
          >
            …
          </span>
        ) : (
          <Link
            key={it}
            href={hrefFor(it)}
            aria-current={it === currentPage ? 'page' : undefined}
            className="min-w-[36px] text-center px-3 py-2 rounded-[6px] text-sm"
            style={it === currentPage ? active : base}
          >
            {it}
          </Link>
        ),
      )}
      {currentPage < totalPages && (
        <Link
          href={hrefFor(currentPage + 1)}
          rel="next"
          className="px-3 py-2 rounded-[6px] text-sm"
          style={base}
        >
          Next →
        </Link>
      )}
    </nav>
  );
}
