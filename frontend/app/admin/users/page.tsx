import { cookies } from 'next/headers';
import UserActions from './user-actions';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface User {
  id: string;
  email: string;
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
  searchParams: Promise<{ search?: string; page?: string }>;
}) {
  const { search = '', page = '1' } = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  const params = new URLSearchParams({ page, limit: '30' });
  if (search) params.set('search', search);

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
          <div className="rounded-[8px] overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-inset)' }}>
                  {['User', 'Tier', 'KYC', 'Sales', 'Score', 'Rating', 'Joined', ''].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-2.5 text-xs font-medium"
                      style={{ color: 'var(--text-tertiary)', borderBottom: '0.5px solid var(--border)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr
                    key={u.id}
                    style={{
                      borderBottom: '0.5px solid var(--border-divider)',
                      background: u.isBanned ? 'var(--red)08' : undefined,
                    }}
                  >
                    <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                      <div className="font-medium">
                        {[u.firstName, u.lastName].filter(Boolean).join(' ') || '(no name)'}
                        {u.isBanned && (
                          <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--red)20', color: 'var(--red)' }}>
                            banned
                          </span>
                        )}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {u.sellerTier}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: u.kycStatus === 'VERIFIED' ? '#22c55e' : 'var(--text-tertiary)' }}>
                      {u.kycStatus}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {u.totalSales}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {u.trustScore}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {u.averageRating ? `${u.averageRating.toFixed(1)} ★` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(u.createdAt).toLocaleDateString('en-ZA')}
                    </td>
                    <td className="px-4 py-3">
                      <UserActions
                        userId={u.id}
                        isBanned={u.isBanned}
                        sellerTier={u.sellerTier}
                        kycStatus={u.kycStatus}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
