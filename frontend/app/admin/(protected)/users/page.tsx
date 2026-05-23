import { cookies } from 'next/headers';
import Link from 'next/link';
import UserActions from './user-actions';
import BulkUsersTable from './bulk-users';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface User {
  id: string;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  sellerTier: string;
  kycStatus: string;
  isBanned: boolean;
  totalSales: number;
  trustScore: number;
  averageRating: number | null;
  createdAt: string;
}

interface UsersResponse {
  users: User[];
  total: number;
  page: number;
  limit: number;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; kyc?: string; filter?: string }>;
}) {
  const { search = '', page = '1', kyc, filter } = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get('gg_admin_sess')?.value ?? '';

  const params = new URLSearchParams({ page, limit: '30' });
  if (search) params.set('search', search);
  if (kyc) params.set('kyc', kyc);
  if (filter) params.set('filter', filter);

  // Active filter label for the empty-state + chip strip. Only one
  // active at a time today; refactor when we add multi-filter.
  const activeFilter =
    kyc === 'stalled' || filter === 'kyc-stalled'
      ? { key: 'kyc-stalled', label: 'KYC stalled (>24h)' }
      : filter === 'banned'
        ? { key: 'banned', label: 'Banned users' }
        : filter === 'dealers'
          ? { key: 'dealers', label: 'Dealers' }
          : null;

  const res = await fetch(`${API_URL}/admin/users?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data: UsersResponse | null = res.ok ? await res.json() : null;

  return (
    <div>
      <h1 className="text-lg font-medium mb-5" style={{ color: 'var(--text-primary)' }}>
        Users
      </h1>

      {/* Active filter chip — appears when arriving via a command-center
          deep-link (e.g. /admin/users?kyc=stalled). Clicking the X
          drops the filter without losing the search term. */}
      {activeFilter && (
        <div className="mb-4 flex items-center gap-2">
          <span
            className="text-xs px-2 py-1 rounded-full"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--red)',
              color: 'var(--red)',
              fontWeight: 500,
            }}
          >
            Filter: {activeFilter.label}
          </span>
          <a
            href={search ? `/admin/users?search=${encodeURIComponent(search)}` : '/admin/users'}
            className="text-xs"
            style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
          >
            Clear filter ×
          </a>
        </div>
      )}

      {/* Search */}
      <form method="GET" className="mb-5 flex gap-2">
        <input
          name="search"
          defaultValue={search}
          placeholder="Search by name or email…"
          className="px-3 py-1.5 rounded-[6px] text-sm outline-none w-64"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
        />
        <button
          type="submit"
          className="px-3 py-1.5 rounded-[6px] text-sm"
          style={{ background: 'var(--red)', color: '#fff' }}
        >
          Search
        </button>
        {search && (
          <a
            href="/admin/users"
            className="px-3 py-1.5 rounded-[6px] text-sm"
            style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            Clear
          </a>
        )}
      </form>

      {!data ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Failed to load users.</p>
      ) : data.users.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No users found.</p>
      ) : (
        <>
          {/* Client-side wrapper renders the same table + adds the
              bulk-ban toolbar. Per-row tier/KYC/single-ban controls
              still ship via the existing UserActions component inside
              the rightmost cell. */}
          <BulkUsersTable users={data.users} />

          <div className="flex justify-between items-center mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>{data.total} total</span>
            <div className="flex gap-2">
              {Number(page) > 1 && (
                <a
                  href={`/admin/users?search=${search}&page=${Number(page) - 1}`}
                  style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  ← Prev
                </a>
              )}
              {Number(page) * data.limit < data.total && (
                <a
                  href={`/admin/users?search=${search}&page=${Number(page) + 1}`}
                  style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  Next →
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
