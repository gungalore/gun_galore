'use client';

// Daily Deals admin cockpit (DD-1). Fetches every deal + the category
// tree once, then hands both to the client table which does status-tab
// filtering, the deal builder, lifecycle actions and photo management
// entirely client-side. The whole surface is INERT — no public storefront,
// no money path, no drop cron yet (see DAILY-DEALS-PLAN.md DD-2/DD-4).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';
import DealsTable, { Deal, CategoryOption } from './deals-table';

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const [dealsRes, catsRes] = await Promise.all([
          adminFetch('/admin/deals'),
          adminFetch('/admin/categories'),
        ]);
        if (cancelled) return;
        if (dealsRes.ok) setDeals(await dealsRes.json());
        if (catsRes.ok) {
          const raw = (await catsRes.json()) as Array<{
            id: string;
            name: string;
            parentId: string | null;
            isActive: boolean;
            isFirearm: boolean;
            requiresPapers: boolean;
            isExperience: boolean;
          }>;
          // A category is licensed (unusable for a house deal) if it is a
          // firearm / papers-required / experience category. Leaf-only:
          // listings are always filed on leaves, so hide parents.
          const parentIds = new Set(
            raw.map((c) => c.parentId).filter(Boolean) as string[],
          );
          const options: CategoryOption[] = raw
            .filter((c) => c.isActive && !parentIds.has(c.id))
            .map((c) => ({
              id: c.id,
              name: c.name,
              licensed: c.isFirearm || c.requiresPapers || c.isExperience,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          setCategories(options);
        }
      } catch {
        // empty state renders
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const liveCount = deals.filter(
    (d) => d.status === 'LIVE' || d.status === 'EXTENDED',
  ).length;

  return (
    <div>
      <AdminPageHeader
        title="Daily Deals"
        meta={
          <>
            {deals.length} {deals.length === 1 ? 'deal' : 'deals'} · {liveCount} live
          </>
        }
        actions={
          <Link href="/admin/deals/pnl" className="text-sm" style={{ color: 'var(--red)' }}>
            P&amp;L →
          </Link>
        }
        description={
          <>
            First-party <strong style={{ color: 'var(--text-primary)' }}>Gun Galore</strong>{' '}
            deals — you create every listing, buyers purchase on the normal rails.
            Deals never appear in the public marketplace and the storefront isn&apos;t
            live yet, so everything here is safe to draft and stage.
          </>
        }
      />
      {loaded && (
        <DealsTable
          initialDeals={deals}
          categories={categories}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
