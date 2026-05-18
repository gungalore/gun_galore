import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import CancelButton from './cancel-button';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#22c55e',
  PENDING_REVIEW: '#f59e0b',
  DRAFT: 'var(--text-tertiary)',
  SOLD: '#6366f1',
  PAYMENT_PENDING: '#f59e0b',
  CANCELLED: 'var(--text-tertiary)',
  EXPIRED: 'var(--text-tertiary)',
};

interface MyListing {
  id: string;
  title: string;
  price: number;
  status: string;
  listingType: string;
  condition: string;
  createdAt: string;
  category: { name: string };
  images: { url: string }[];
}

export default async function MyListingsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/listings');

  const token = await getToken();
  const res = await fetch(`${API_URL}/listings/mine`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const listings: MyListing[] = res.ok ? await res.json() : [];

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
          My Listings
        </h1>
        <Link
          href="/listings/new"
          className="px-3 py-1.5 rounded-[6px] text-sm font-medium"
          style={{ background: 'var(--red)', color: '#fff' }}
        >
          + New listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="text-center py-20 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No listings yet.{' '}
          <Link href="/listings/new" style={{ color: 'var(--red)' }}>
            Create one →
          </Link>
        </div>
      ) : (
        <div
          className="rounded-[8px] overflow-hidden"
          style={{ border: '0.5px solid var(--border)' }}
        >
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-inset)' }}>
                {['Item', 'Category', 'Price', 'Status', 'Listed', ''].map((h) => (
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
              {listings.map((l) => (
                <tr key={l.id} style={{ borderBottom: '0.5px solid var(--border-divider)' }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {l.images[0] && (
                        <img
                          src={l.images[0].url}
                          alt=""
                          className="w-10 h-10 rounded-[4px] object-cover shrink-0"
                        />
                      )}
                      <Link
                        href={`/listings/${l.id}`}
                        className="font-medium hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {l.title}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {l.category.name}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    R{(l.price / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        color: STATUS_COLOR[l.status] ?? 'var(--text-tertiary)',
                        background: `${STATUS_COLOR[l.status] ?? 'var(--text-tertiary)'}18`,
                        border: `0.5px solid ${STATUS_COLOR[l.status] ?? 'var(--text-tertiary)'}40`,
                      }}
                    >
                      {l.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(l.createdAt).toLocaleDateString('en-ZA')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {l.status === 'ACTIVE' && (
                        <CancelButton listingId={l.id} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
