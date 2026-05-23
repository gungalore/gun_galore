import { cookies } from 'next/headers';
import { FeaturedTabs } from '../tabs';
import { BanForm } from './ban-form';
import { UnbanButton } from './unban-button';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface BannedBidder {
  id: string;
  userId: string;
  reason: string;
  bannedByAdminId: string | null;
  createdAt: string;
}

export default async function AdminFeaturedBannedPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  const res = await fetch(`${API_URL}/admin/featured/banned-bidders`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const banned: BannedBidder[] = res.ok ? await res.json() : [];

  return (
    <div>
      <h1
        className="text-xl mb-4"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Featured Slots
      </h1>
      <FeaturedTabs current="banned" />

      <BanForm />

      <div
        className="rounded-[8px] overflow-hidden mt-6"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <div
          className="px-4 py-3"
          style={{ borderBottom: '0.5px solid var(--border)' }}
        >
          <p
            className="text-xs uppercase"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.05em',
              fontWeight: 500,
            }}
          >
            Currently banned bidders ({banned.length})
          </p>
        </div>
        {banned.length === 0 ? (
          <p
            className="p-4 text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            No bidders are currently banned.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-inset)' }}>
                <Th>User ID</Th>
                <Th>Reason</Th>
                <Th>Banned at</Th>
                <Th>Banned by</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {banned.map((b) => (
                <tr
                  key={b.id}
                  style={{ borderTop: '0.5px solid var(--border)' }}
                >
                  <Td>
                    <span
                      className="text-xs"
                      style={{
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {b.userId}
                    </span>
                  </Td>
                  <Td>{b.reason}</Td>
                  <Td>
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(b.createdAt).toLocaleString('en-ZA')}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="text-xs"
                      style={{
                        color: 'var(--text-tertiary)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {b.bannedByAdminId
                        ? b.bannedByAdminId.slice(0, 8) + '…'
                        : 'system'}
                    </span>
                  </Td>
                  <Td>
                    <UnbanButton userId={b.userId} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left text-xs uppercase px-3 py-2"
      style={{
        color: 'var(--text-tertiary)',
        letterSpacing: '0.05em',
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      className="px-3 py-2.5 align-top"
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </td>
  );
}
