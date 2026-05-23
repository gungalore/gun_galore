'use client';

// Small segmented-control toggle for switching list sort order.
//
// Two options:
//   * Latest first   (sort=newest, also the URL-empty default)
//   * Cheapest first (sort=price_asc)
//
// Lives above the FilterBar on browse pages. FilterBar still has its
// own 3-option sort <select> (it includes price_desc); the toggle is
// a more visible, thumb-friendly shortcut for the two sort modes the
// vast majority of buyers actually use. The two surfaces stay in
// sync because both write to the same `?sort=` URL param.
//
// Click → router.push with current search params preserved + the new
// sort value written. Toggling either button updates immediately;
// the visual active state is derived from the URL on the next render.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type SortValue = 'newest' | 'price_asc';

export function SortToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Treat an empty/missing sort param as 'newest' so the toggle's
  // visual default matches the backend default (BrowseListingsDto
  // sort defaults to 'newest').
  const currentRaw = searchParams.get('sort');
  const current: SortValue =
    currentRaw === 'price_asc' ? 'price_asc' : 'newest';

  function setSort(value: SortValue) {
    if (value === current) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('sort', value);
    // Reset the paginator on sort change — page 2 of the old sort
    // is a different slice than page 2 of the new sort, so it's
    // confusing to keep the page number.
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Sort listings"
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 3,
        borderRadius: 8,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <ToggleButton
        label="Latest first"
        active={current === 'newest'}
        onClick={() => setSort('newest')}
      />
      <ToggleButton
        label="Cheapest first"
        active={current === 'price_asc'}
        onClick={() => setSort('price_asc')}
      />
    </div>
  );
}

function ToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      style={{
        padding: '7px 14px',
        borderRadius: 6,
        border: 'none',
        background: active ? 'var(--red)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 120ms, color 120ms',
      }}
    >
      {label}
    </button>
  );
}
