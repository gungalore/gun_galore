import { cookies } from 'next/headers';
import CategoriesTree from './categories-tree';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isFirearm: boolean;
  requiresLicence: boolean;
  availableSecondhand: boolean;
  availableNewStore: boolean;
  isActive: boolean;
  sortOrder: number;
  _count: { listings: number };
}

export default async function CategoriesPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  let categories: Category[] = [];
  try {
    const res = await fetch(`${API_URL}/admin/categories`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) categories = await res.json();
  } catch {
    /* empty list will render */
  }

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

      <CategoriesTree initial={categories} />
    </div>
  );
}
