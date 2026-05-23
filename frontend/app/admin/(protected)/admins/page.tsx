'use client';

import { useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import CreateAdminForm from './create-admin-form';
import AdminRow from './admin-row';

// Mirror of AdminUser select shape returned by GET /admin/admins.
export interface AdminRecord {
  id: string;
  email: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'MONITORING_ADMIN';
  firstName: string | null;
  lastName: string | null;
  clerkId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface MeResponse {
  id: string;
  email: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'MONITORING_ADMIN';
  firstName: string | null;
  lastName: string | null;
}

export default function AdminAdminsPage() {
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      // Fetch the admin list AND the current admin's identity in parallel.
      // We need /me to decide whether to render the "Create admin" form
      // (only SUPERADMIN sees it). The list is open to all admins so they
      // can audit who else has access.
      const [adminsRes, meRes] = await Promise.all([
        adminFetch('/admin/admins'),
        adminFetch('/admin/auth/me'),
      ]);
      if (cancelled) return;
      if (adminsRes.ok) setAdmins(await adminsRes.json());
      if (meRes.ok) setMe(await meRes.json());
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canManage = me?.role === 'SUPERADMIN';

  return (
    <div>
      <h1
        className="text-lg font-medium mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        Admin access
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Two tiers of admin: <span style={{ color: 'var(--text-secondary)' }}>Full admin</span>
        {' '}can manage other admins, listings, transactions and KYC overrides.{' '}
        <span style={{ color: 'var(--text-secondary)' }}>Monitoring admin</span>{' '}
        can view the dashboard but cannot take destructive actions. New admins
        must first sign up via the public site so we can pull their phone and
        email from Clerk.
      </p>

      {canManage && <CreateAdminForm />}

      <div
        className="rounded-[8px] overflow-hidden mt-6"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <div
          className="grid items-center gap-3 px-5 py-3 text-xs uppercase"
          style={{
            gridTemplateColumns: '1fr 1fr 160px 140px 100px',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.05em',
            borderBottom: '0.5px solid var(--border)',
            fontWeight: 500,
          }}
        >
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Last login</span>
          <span style={{ textAlign: 'right' }}>Status</span>
        </div>

        {loaded && admins.length === 0 ? (
          <div
            className="px-5 py-6 text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            No admins yet.
          </div>
        ) : (
          admins.map((a) => (
            <AdminRow
              key={a.id}
              admin={a}
              canManage={canManage}
              isSelf={me?.id === a.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
