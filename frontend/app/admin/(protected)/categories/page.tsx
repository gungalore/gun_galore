'use client';

import { useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import CategoriesTree from './categories-tree';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isFirearm: boolean;
  requiresLicence: boolean;
  availableSecondhand: boolean;
  availableNewStore: boolean;
  crossSellEligible: boolean;
  isActive: boolean;
  sortOrder: number;
  crossSellTo?: { toCategoryId: string; requireExactMatch: boolean; sortOrder: number }[];
  _count: { listings: number };
}

interface DemandRow {
  fromCategoryId: string;
  fromCategoryName: string;
  calibre: string;
  count: number;
  lastSeenAt: string;
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [demand, setDemand] = useState<DemandRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch('/admin/categories');
        if (cancelled) return;
        if (res.ok) setCategories(await res.json());
        const dres = await adminFetch('/admin/categories/cross-sell-demand');
        if (!cancelled && dres.ok) setDemand(await dres.json());
      } catch {
        /* empty list will render */
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Categories
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {categories.length} total · {categories.filter((c) => c.isActive).length} active
        </p>
      </div>

      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Marketplace category tree. Deactivating a category hides it from
        the Sell form and browse filters but keeps existing listings
        intact. Renaming a category re-slugs the public URL.
      </p>

      {demand.length > 0 && (
        <div
          className="rounded-[8px] mb-5 overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <div
            className="px-4 py-3"
            style={{ borderBottom: '0.5px solid var(--border)' }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Unmet cross-sell demand
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Buyers wanted complementary items here but found none listed —
              recruit this stock to capture the sale.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--text-tertiary)' }}>
                <th className="text-left px-4 py-2 text-xs font-normal">Category</th>
                <th className="text-left px-4 py-2 text-xs font-normal">Calibre</th>
                <th className="text-right px-4 py-2 text-xs font-normal">Times wanted</th>
              </tr>
            </thead>
            <tbody>
              {demand.map((d, i) => (
                <tr
                  key={`${d.fromCategoryId}-${d.calibre}-${i}`}
                  style={{ borderTop: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  <td className="px-4 py-2">{d.fromCategoryName}</td>
                  <td className="px-4 py-2">{d.calibre || '—'}</td>
                  <td className="px-4 py-2 text-right" style={{ color: 'var(--text-primary)' }}>
                    {d.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loaded && <CategoriesTree initial={categories} />}
    </div>
  );
}
