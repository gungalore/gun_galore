'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminRaffleRow } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { RefundAllButton } from './refund-all-button';

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'var(--text-tertiary)',
  ACTIVE: '#22c55e',
  CLOSED_AWAITING_DRAW: '#f59e0b',
  DRAWN: '#3b82f6',
  CLAIMED: '#22c55e',
  CANCELLED_MIN_NOT_MET: '#ef4444',
  CANCELLED_BY_ADMIN: '#ef4444',
  EXPIRED_UNCLAIMED: 'var(--text-tertiary)',
};

export default function AdminCompetitionsPage() {
  const [raffles, setRaffles] = useState<AdminRaffleRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const res = await adminFetch('/admin/raffles');
      if (cancelled) return;
      if (res.ok) setRaffles(await res.json());
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1
          className="text-xl"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Competitions
        </h1>
        <Link
          href="/admin/competitions/create"
          className="text-sm px-3 py-2 rounded-[6px]"
          style={{
            background: 'var(--red)',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          + Create competition
        </Link>
      </div>

      {loaded && raffles.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No competitions yet.
        </p>
      ) : (
        <div
          className="rounded-[6px] overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-inset)' }}>
                <Th>Reference</Th>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th>Sold</Th>
                <Th>Ticket price</Th>
                <Th>Value</Th>
                <Th>Created</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {raffles.map((r) => (
                <tr key={r.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                  <Td>
                    <span
                      style={{
                        color: 'var(--text-secondary)',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                      }}
                    >
                      {r.referenceNumber ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    <Link
                      href={`/competitions/${r.id}`}
                      className="hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {r.title}
                    </Link>
                    {r.relistGeneration > 0 && (
                      <span
                        className="ml-1 text-xs"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        (relist #{r.relistGeneration})
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span style={{ color: STATUS_COLOR[r.status] ?? 'var(--text-tertiary)' }}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </Td>
                  <Td>
                    {r.ticketsSoldPaid + r.ticketsSoldPostal} / {r.targetTicketCount}
                  </Td>
                  <Td>{formatPrice(r.ticketPriceCents)}</Td>
                  <Td>{formatPrice(r.itemValueCents)}</Td>
                  <Td>
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(r.createdAt).toLocaleDateString('en-ZA')}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2 items-center">
                      <Link
                        href={`/admin/competitions/${r.id}/audit`}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--red)' }}
                      >
                        Audit log
                      </Link>
                      {/* Draw proof link — only shown for drawn /
                          claimed raffles. Opens the public proof
                          page that exposes the seed + hash + winning
                          ticket so anyone can verify the draw was
                          legitimate (matches /api/raffles/:id/proof
                          response). */}
                      {(r.status === 'DRAWN' || r.status === 'CLAIMED' || r.status === 'EXPIRED_UNCLAIMED') && (
                        <Link
                          href={`/competitions/${r.id}/proof`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs hover:underline"
                          style={{ color: '#3b82f6' }}
                        >
                          Draw proof ↗
                        </Link>
                      )}
                      {r.status !== 'CANCELLED_BY_ADMIN' &&
                        r.status !== 'CANCELLED_MIN_NOT_MET' &&
                        r.status !== 'CLAIMED' &&
                        r.status !== 'EXPIRED_UNCLAIMED' && (
                          <RefundAllButton
                            raffleId={r.id}
                            referenceNumber={r.referenceNumber ?? ''}
                            title={r.title}
                          />
                        )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
