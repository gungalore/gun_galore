'use client';

import { useRouter } from 'next/navigation';
import { Category } from '@/lib/types';
import { PROVINCE_LABELS, CONDITION_LABELS } from '@/lib/utils';

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
      <input
        type="search"
        placeholder="Search listings…"
        defaultValue={currentParams.q ?? ''}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            push({ q: (e.target as HTMLInputElement).value || undefined });
          }
        }}
        className="flex-1 min-w-[180px]"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
          borderRadius: '6px',
          padding: '7px 10px',
          fontSize: '13px',
          outline: 'none',
        }}
      />

      <select
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
        value={currentParams.listingType ?? ''}
        onChange={(e) => push({ listingType: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">All types</option>
        <option value="BUY_NOW">Buy Now</option>
        <option value="TAKE_A_SHOT">Take a Shot</option>
      </select>

      <select
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
