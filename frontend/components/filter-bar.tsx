'use client';

import { useRouter } from 'next/navigation';
import { Category } from '@/lib/types';
import { PROVINCE_LABELS, CONDITION_LABELS } from '@/lib/utils';
import { LiveSearch } from '@/components/live-search';

interface FilterParams {
  q?: string;
  categoryId?: string;
  listingType?: string;
  condition?: string;
  province?: string;
  sort?: string;
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-secondary)',
  borderRadius: '6px',
  padding: '7px 10px',
  fontSize: '13px',
  outline: 'none',
  cursor: 'pointer',
};

export function FilterBar({
  categories,
  currentParams,
}: {
  categories: Category[];
  currentParams: FilterParams;
}) {
  const router = useRouter();

  function push(updates: Partial<FilterParams>) {
    const next = new URLSearchParams();
    const merged = { ...currentParams, ...updates };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) next.set(k, v);
    });
    router.push(`/?${next}`);
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* Live typeahead — talks to /listings?q=…, Meilisearch handles
          typo tolerance (1 typo for 5–8 char terms, 2 for ≥9). Selecting
          a hit navigates to its listing; pressing Enter falls through to
          the full results page at /?q=…, same as the old input. */}
      <LiveSearch
        placeholder="Search listings…"
        className="flex-1 min-w-[200px]"
      />

      <select
        aria-label="Filter by category"
        value={currentParams.categoryId ?? ''}
        onChange={(e) => push({ categoryId: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by province"
        value={currentParams.province ?? ''}
        onChange={(e) => push({ province: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">All provinces</option>
        {Object.entries(PROVINCE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by condition"
        value={currentParams.condition ?? ''}
        onChange={(e) => push({ condition: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">All conditions</option>
        {Object.entries(CONDITION_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by listing type"
        value={currentParams.listingType ?? ''}
        onChange={(e) => push({ listingType: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">All types</option>
        <option value="BUY_NOW">Marketplace</option>
        <option value="AUCTION">Auction</option>
        <option value="TAKE_A_SHOT">Take a Shot</option>
      </select>

      <select
        aria-label="Sort results"
        value={currentParams.sort ?? ''}
        onChange={(e) => push({ sort: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">Newest first</option>
        <option value="price_asc">Price: low → high</option>
        <option value="price_desc">Price: high → low</option>
      </select>
    </div>
  );
}
