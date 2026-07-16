'use client';

// Supplier directory admin page (DD-F1). Fetches every supplier once, then
// hands the list to the client table which does the create / edit / deactivate
// modals entirely client-side (deals-page pattern: reloadKey bumps re-fetch
// via the onChanged callback). Suppliers are the JIT-fulfilment warehouses a
// Daily Deal is drop-shipped from — everything here is INERT until deals go
// live.

import { useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';
import SuppliersTable, { Supplier } from './suppliers-table';

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch('/admin/suppliers');
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          // Tolerate either a plain array or a { rows, count } envelope.
          setSuppliers(Array.isArray(data) ? data : (data.rows ?? []));
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

  const activeCount = suppliers.filter((s) => s.active).length;

  return (
    <div>
      <AdminPageHeader
        title="Suppliers"
        meta={
          <>
            {suppliers.length} {suppliers.length === 1 ? 'supplier' : 'suppliers'} · {activeCount} active
          </>
        }
        description={
          <>
            Warehouses a{' '}
            <strong style={{ color: 'var(--text-primary)' }}>Daily Deal</strong> is fulfilled from. When a house deal
            sells out, a purchase order is cut against the supplier and The Courier Guy collects the stock from this
            warehouse address. Keep the contact and address accurate before assigning a supplier to a deal.
          </>
        }
      />
      {loaded && (
        <SuppliersTable initialSuppliers={suppliers} onChanged={() => setReloadKey((k) => k + 1)} />
      )}
    </div>
  );
}
