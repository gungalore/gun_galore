import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Listing {
  id: string;
  title: string;
  price: number;
  status: string;
  createdAt: string;
  seller: { firstName: string | null; lastName: string | null; email: string };
  category: { name: string; isFirearm: boolean };
}

interface ListingsResponse {
  listings: Listing[];
  total: number;
  page: number;
  limit: number;
}

import ReviewActions from './review-actions';

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status = 'PENDING_REVIEW', page = '1' } = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  const res = await fetch(
    `${API_URL}/admin/listings?status=${status}&page=${page}&limit=20`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );
  const data: ListingsResponse | null = res.ok ? await res.json() : null;

  const tabs = ['PENDING_REVIEW', 'ACTIVE', 'CANCELLED'];

  return (
    <div>
      <h1 className="text-lg font-medium mb-5" style={{ color: 'var(--text-primary)' }}>
        Listings
      </h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {tabs.map((t) => (
          <a
            key={t}
            href={`/admin/listings?status=${t}`}
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={{
              background: status === t ? 'var(--red)' : 'var(--bg-card)',
              color: status === t ? '#fff' : 'var(--text-secondary)',
              border: `0.5px solid ${status === t ? 'transparent' : 'var(--border)'}`,
              textDecoration: 'none',
            }}
          >
            {t.replace('_', ' ')}
          </a>
        ))}
      </div>

      {!data ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Failed to load listings.</p>
      ) : data.listings.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No listings in this queue.</p>
      ) : (
        <>
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-inset)' }}>
                  {['Title', 'Seller', 'Category', 'Price', 'Submitted', ''].map((h) => (
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
                {data.listings.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '0.5px solid var(--border-divider)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                      <div className="font-medium">{l.title}</div>
                      {l.category.isFirearm && (
                        <span className="text-xs" style={{ color: 'var(--red)' }}>🔒 Firearm</span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                      <div>{[l.seller.firstName, l.seller.lastName].filter(Boolean).join(' ') || '—'}</div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{l.seller.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {l.category.name}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                      R{l.price.toLocaleString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(l.createdAt).toLocaleDateString('en-ZA')}
                    </td>
                    <td className="px-4 py-3">
                      {status === 'PENDING_REVIEW' && (
                        <ReviewActions listingId={l.id} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex justify-between items-center mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>{data.total} total</span>
            <div className="flex gap-2">
              {Number(page) > 1 && (
                <a
                  href={`/admin/listings?status=${status}&page=${Number(page) - 1}`}
                  style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  ← Prev
                </a>
              )}
              {Number(page) * data.limit < data.total && (
                <a
                  href={`/admin/listings?status=${status}&page=${Number(page) + 1}`}
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
