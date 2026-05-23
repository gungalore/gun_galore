import { cookies } from 'next/headers';
import CreateAdminForm from './create-admin-form';
import AdminRow from './admin-row';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

export default async function AdminAdminsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('gg_admin_sess')?.value ?? '';

  // Fetch the admin list AND the current admin's identity in parallel.
  // We need /me to decide whether to render the "Create admin" form
  // (only SUPERADMIN sees it). The list is open to all admins so they
  // can audit who else has access.
  const [adminsRes, meRes] = await Promise.all([
    fetch(`${API_URL}/admin/admins`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }),
    fetch(`${API_URL}/admin/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }),
  ]);

  const admins: AdminRecord[] = adminsRes.ok ? await adminsRes.json() : [];
  const me: MeResponse | null = meRes.ok ? await meRes.json() : null;
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

        {admins.length === 0 ? (
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
