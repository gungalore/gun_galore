'use client';

import { useState } from 'react';
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
  make?: string;
  // Price is carried in the URL as ZAR cents (matches the API); the inputs
  // below display Rands.
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
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

const priceInputStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-secondary)',
  borderRadius: '6px',
  padding: '7px 8px',
  fontSize: '13px',
  outline: 'none',
  width: '92px',
};

export function FilterBar({
  categories,
  currentParams,
  brands = [],
}: {
  categories: Category[];
  currentParams: FilterParams;
  brands?: string[];
}) {
  const router = useRouter();

  // Price is held locally (in Rands) so typing doesn't fire a navigation per
  // keystroke; we apply on blur / Enter. Seed from the URL's cents value.
  const centsToRand = (c?: string) =>
    c && Number.isFinite(Number(c)) ? String(Number(c) / 100) : '';
  const [minR, setMinR] = useState(centsToRand(currentParams.minPrice));
  const [maxR, setMaxR] = useState(centsToRand(currentParams.maxPrice));

  function push(updates: Partial<FilterParams>) {
    const merged = { ...currentParams, ...updates };
    // Any filter change returns to page 1 — otherwise a narrower result set
    // can land the user on an empty deep page. (Explicit page changes pass
    // `page` in updates and are respected.)
    if (!('page' in updates)) delete merged.page;
    const next = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v) next.set(k, String(v));
    });
    router.push(`/?${next}`);
  }

  function applyPrice() {
    const toCents = (r: string): string | undefined => {
      const n = parseFloat(r);
      return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 100)) : undefined;
    };
    push({ minPrice: toCents(minR), maxPrice: toCents(maxR) });
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

      {brands.length > 0 && (
        <select
          aria-label="Filter by brand"
          value={currentParams.make ?? ''}
          onChange={(e) => push({ make: e.target.value || undefined })}
          style={selectStyle}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      )}

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
        <option value="SWOP">Swop / Trade</option>
      </select>

      {/* Price range (Rands). Applies on blur or Enter so we don't navigate
          on every keystroke. */}
      <div className="flex items-center gap-1">
        <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>R</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          aria-label="Minimum price (Rands)"
          placeholder="Min"
          value={minR}
          onChange={(e) => setMinR(e.target.value)}
          onBlur={applyPrice}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyPrice();
          }}
          style={priceInputStyle}
        />
        <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>–</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          aria-label="Maximum price (Rands)"
          placeholder="Max"
          value={maxR}
          onChange={(e) => setMaxR(e.target.value)}
          onBlur={applyPrice}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyPrice();
          }}
          style={priceInputStyle}
        />
      </div>

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
