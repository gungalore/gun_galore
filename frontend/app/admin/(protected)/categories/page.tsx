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

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch('/admin/categories');
        if (cancelled) return;
        if (res.ok) setCategories(await res.json());
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

      {loaded && <CategoriesTree initial={categories} />}
    </div>
  );
}
