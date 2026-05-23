'use client';

import { useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { FeaturedTabs } from '../tabs';

interface RevenueSummary {
  totalCents: number;
  monthCents: number;
  topBidders: { user: { username: string | null; email: string }; totalCents: number }[];
  closedAuctions: number;
  awardedAuctions: number;
  fillRate: number; // 0..1
}

function formatRand(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export default function AdminFeaturedRevenuePage() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const res = await adminFetch('/admin/featured/revenue');
      if (cancelled) return;
      if (res.ok) setSummary(await res.json());
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1
        className="text-xl mb-4"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Featured Slots
      </h1>
      <FeaturedTabs current="revenue" />

      {loaded && !summary ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Could not load revenue data.
        </p>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Total revenue"
              value={formatRand(summary.totalCents)}
              sub="All-time, from won bids"
            />
            <StatCard
              label="This month"
              value={formatRand(summary.monthCents)}
              sub="Calendar month to date"
            />
            <StatCard
              label="Auctions closed"
              value={summary.closedAuctions.toLocaleString('en-ZA')}
              sub={`${summary.awardedAuctions.toLocaleString('en-ZA')} awarded`}
            />
            <StatCard
              label="Fill rate"
              value={`${Math.round((summary.fillRate ?? 0) * 100)}%`}
              sub="Awarded / closed"
            />
          </div>

          <div
            className="rounded-[8px] overflow-hidden"
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
                Top bidders by spend
              </p>
            </div>
            {summary.topBidders.length === 0 ? (
              <p
                className="p-4 text-sm"
                style={{ color: 'var(--text-tertiary)' }}
              >
                No bidders yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-inset)' }}>
                    <Th>Rank</Th>
                    <Th>Username</Th>
                    <Th>Email</Th>
                    <Th>Total spend</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topBidders.map((b, i) => (
                    <tr
                      key={b.user.email + i}
                      style={{ borderTop: '0.5px solid var(--border)' }}
                    >
                      <Td>#{i + 1}</Td>
                      <Td>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {b.user.username ? '@' + b.user.username : '—'}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {b.user.email}
                        </span>
                      </Td>
                      <Td>
                        <span
                          style={{ color: 'var(--red)', fontWeight: 500 }}
                        >
                          {formatRand(b.totalCents)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-xs uppercase"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.05em',
          fontWeight: 500,
        }}
      >
        {label}
      </p>
      <p
        className="text-2xl mt-2"
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        {value}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
        {sub}
      </p>
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
      className="px-3 py-2.5"
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </td>
  );
}
