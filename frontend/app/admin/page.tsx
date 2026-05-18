import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Stats {
  pendingListings: number;
  pendingPayments: number;
  totalUsers: number;
  bannedUsers: number;
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className="rounded-[8px] p-5"
      style={{ background: 'var(--bg-card)', border: `0.5px solid ${accent ? 'var(--red)' : 'var(--border)'}` }}
    >
      <p className="text-3xl font-medium" style={{ color: accent ? 'var(--red)' : 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        {value}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </p>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  const res = await fetch(`${API_URL}/admin/stats`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const stats: Stats | null = res.ok ? await res.json() : null;

  return (
    <div>
      <h1 className="text-lg font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
        Overview
      </h1>

      {!stats ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Could not load stats.
        </p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Pending listings" value={stats.pendingListings} accent={stats.pendingListings > 0} />
          <StatCard label="Pending payments" value={stats.pendingPayments} accent={stats.pendingPayments > 0} />
          <StatCard label="Total users" value={stats.totalUsers} />
          <StatCard label="Banned users" value={stats.bannedUsers} />
        </div>
      )}
    </div>
  );
}
