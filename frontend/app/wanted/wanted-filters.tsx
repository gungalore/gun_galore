'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Category } from '@/lib/types';
import { PROVINCE_LABELS } from '@/lib/utils';

// Category + province filter strip for the Wanted board. Pushes the
// selection into the URL so the server page refetches — same contract
// as the backend browse endpoint (categoryId includes its children).
export function WantedFilters({
  categoryId,
  province,
}: {
  categoryId: string;
  province: string;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Category[]>('/categories')
      .then((cats) => {
        if (!cancelled) setCategories(cats);
      })
      .catch(() => {
        /* filter strip degrades to province-only */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function apply(nextCategoryId: string, nextProvince: string) {
    const qs = new URLSearchParams();
    if (nextCategoryId) qs.set('categoryId', nextCategoryId);
    if (nextProvince) qs.set('province', nextProvince);
    const s = qs.toString();
    router.push(s ? `/wanted?${s}` : '/wanted');
  }

  // Top-level categories first, children indented under their parent —
  // only categories a wanted ad can actually target (secondhand-tradable).
  const roots = categories
    .filter((c) => !c.parentId && c.availableSecondhand)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (id: string) =>
    categories
      .filter((c) => c.parentId === id && c.availableSecondhand)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
  };

  return (
    <div className="flex flex-wrap gap-2">
      <select
        aria-label="Filter by category"
        value={categoryId}
        onChange={(e) => apply(e.target.value, province)}
        style={selectStyle}
      >
        <option value="">All categories</option>
        {roots.map((root) => (
          <optgroup key={root.id} label={root.name}>
            <option value={root.id}>{root.name} (all)</option>
            {childrenOf(root.id).map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        aria-label="Filter by province"
        value={province}
        onChange={(e) => apply(categoryId, e.target.value)}
        style={selectStyle}
      >
        <option value="">All provinces</option>
        {Object.entries(PROVINCE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      {(categoryId || province) && (
        <button
          type="button"
          onClick={() => apply('', '')}
          className="px-3 py-2 rounded-[6px] text-[13px]"
          style={{
            background: 'transparent',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
