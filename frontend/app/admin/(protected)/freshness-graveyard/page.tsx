import { cookies } from 'next/headers';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Row {
  id: string;
  referenceNumber: string | null;
  title: string;
  priceCents: number | null;
  ageDays: number;
  staleScore: number;
  sellerId: string;
  sellerUsername: string | null;
  sellerEmail: string;
  categoryName: string;
  listingType: string;
}

function formatRand(cents: number | null): string {
  if (cents === null) return '—';
  return `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
}

async function fetchRows(token: string, minAgeDays: number): Promise<Row[] | null> {
  try {
    const res = await fetch(
      `${API_URL}/admin/analytics/freshness-graveyard?minAgeDays=${minAgeDays}&limit=100`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as Row[];
  } catch {
    return null;
  }
}

export default async function FreshnessGraveyardPage({
  searchParams,
}: {
  searchParams: Promise<{ minAgeDays?: string }>;
}) {
  const sp = await searchParams;
  const minAgeDays = sp.minAgeDays ? parseInt(sp.minAgeDays, 10) : 30;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';
  const rows = await fetchRows(token, Number.isFinite(minAgeDays) ? minAgeDays : 30);

  const ageOptions = [30, 60, 90, 180];

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Freshness graveyard
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          ACTIVE listings · 0 bids · 0 offers · 0 watchers
        </p>
      </div>

      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        Dead inventory ranked by <strong style={{ color: 'var(--text-primary)' }}>age × price</strong>. High-value old listings float to the top — nudge the seller (offer them advice on photos / price / category) or take the listing down with a reason.
      </p>

      {/* Min-age filter pills */}
      <div
        className="inline-flex rounded-[6px] overflow-hidden mb-5"
        style={{ border: '0.5px solid var(--border)' }}
      >
        <span
          className="px-3 py-1.5 text-xs"
          style={{
            background: 'var(--bg-inset)',
            color: 'var(--text-tertiary)',
            borderRight: '0.5px solid var(--border)',
          }}
        >
          Min age
        </span>
        {ageOptions.map((d) => {
          const active = d === minAgeDays;
          return (
            <Link
              key={d}
              href={`/admin/freshness-graveyard?minAgeDays=${d}`}
              className="px-3 py-1.5 text-xs"
              style={{
                background: active ? 'var(--red)' : 'var(--bg-card)',
                color: active ? '#fff' : 'var(--text-secondary)',
                fontWeight: active ? 500 : 400,
                borderRight: '0.5px solid var(--border)',
                textDecoration: 'none',
              }}
            >
              {d}d
            </Link>
          );
        })}
      </div>

      {!rows ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Could not load graveyard data.
        </p>
      ) : rows.length === 0 ? (
        <div
          className="rounded-[8px] p-6 text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            🎉 Nothing in the graveyard at this threshold — every old listing has at least one bid, offer, or watcher.
          </p>
        </div>
      ) : (
        <div
          className="rounded-[8px] overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                <Th>Listing</Th>
                <Th>Seller</Th>
                <Th>Category / Type</Th>
                <Th align="right">Price</Th>
                <Th align="right">Age</Th>
                <Th align="right">Stale score</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  style={
                    i < rows.length - 1
                      ? { borderBottom: '0.5px solid var(--border)' }
                      : undefined
                  }
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/listings/${r.id}`}
                      style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500 }}
                    >
                      {r.title}
                    </Link>
                    {r.referenceNumber && (
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace' }}
                      >
                        {r.referenceNumber}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <Link
                      href={`/admin/users/${r.sellerId}`}
                      style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                    >
                      @{r.sellerUsername ?? 'anon'}
                    </Link>
                    <p style={{ color: 'var(--text-tertiary)' }}>{r.sellerEmail}</p>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {r.categoryName}
                    <p style={{ color: 'var(--text-tertiary)' }}>
                      {r.listingType.replace(/_/g, ' ')}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right text-sm" style={{ color: 'var(--text-primary)' }}>
                    {formatRand(r.priceCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {r.ageDays}d
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background:
                          r.staleScore > 100000
                            ? 'var(--red)18'
                            : r.staleScore > 30000
                              ? '#f59e0b18'
                              : 'var(--bg-inset)',
                        color:
                          r.staleScore > 100000
                            ? 'var(--red)'
                            : r.staleScore > 30000
                              ? '#f59e0b'
                              : 'var(--text-tertiary)',
                        fontWeight: 500,
                      }}
                    >
                      {r.staleScore.toLocaleString('en-ZA')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs mt-4" style={{ color: 'var(--text-tertiary)' }}>
        Click into a listing's dossier to delete it (with a reason that's emailed to the seller). A nudge-seller feature is on the roadmap.
      </p>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className="text-xs uppercase px-4 py-2"
      style={{ color: 'var(--text-tertiary)', fontWeight: 500, textAlign: align }}
    >
      {children}
    </th>
  );
}
