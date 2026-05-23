'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { RaffleAuditEvent, DrawProof } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function CompetitionAuditPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [events, setEvents] = useState<RaffleAuditEvent[]>([]);
  const [proof, setProof] = useState<DrawProof | null>(null);

  useEffect(() => {
    if (!requireAdminToken()) return;
    if (!id) return;
    let cancelled = false;
    (async () => {
      const [eventsRes, proofRes] = await Promise.all([
        adminFetch(`/admin/raffles/${id}/audit`),
        // Proof endpoint is public — use plain fetch so it doesn't get
        // an auth header it doesn't need.
        fetch(`${API_URL}/raffles/${id}/proof`, { cache: 'no-store' }),
      ]);
      if (cancelled) return;
      if (eventsRes.ok) setEvents(await eventsRes.json());
      if (proofRes.ok) setProof(await proofRes.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div>
      <Link
        href="/admin/competitions"
        className="text-sm inline-block mb-4"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← All competitions
      </Link>

      <h1
        className="text-xl mb-2"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Audit log
      </h1>
      {proof && (
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          {proof.title}
          {proof.referenceNumber && (
            <>
              {' · '}
              <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                {proof.referenceNumber}
              </span>
            </>
          )}
        </p>
      )}

      {/* Draw proof — visible once drawn */}
      {proof?.drawnAt && (
        <div
          className="rounded-[6px] p-4 mb-6"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <p
            className="text-xs uppercase mb-3"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.05em',
            }}
          >
            Verifiable draw proof
          </p>
          <Row label="Drawn at" value={new Date(proof.drawnAt).toLocaleString('en-ZA')} />
          <Row label="Seed (hex)" value={proof.drawSeed ?? '—'} mono />
          <Row label="SHA-256 of seed" value={proof.drawSeedHash ?? '—'} mono />
          <Row label="Winning ticket" value={proof.winningTicketId ?? '—'} mono />
          <Row
            label="Total entries"
            value={`${proof.ticketsSoldPaid + proof.ticketsSoldPostal} (paid: ${proof.ticketsSoldPaid}, postal: ${proof.ticketsSoldPostal})`}
          />
        </div>
      )}

      {/* Event log */}
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
              <Th>Time</Th>
              <Th>Event</Th>
              <Th>Payload</Th>
              <Th>Actor</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                <Td>
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(e.createdAt).toLocaleString('en-ZA')}
                  </span>
                </Td>
                <Td>
                  <span
                    style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                  >
                    {e.eventType}
                  </span>
                </Td>
                <Td>
                  {e.payloadJson ? (
                    <code
                      className="text-xs"
                      style={{
                        color: 'var(--text-tertiary)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {e.payloadJson}
                    </code>
                  ) : (
                    <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                  )}
                </Td>
                <Td>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {e.actorAdminId
                      ? 'admin: ' + e.actorAdminId.slice(0, 8) + '…'
                      : e.actorUserId
                        ? 'user: ' + e.actorUserId.slice(0, 8) + '…'
                        : 'system'}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 && (
          <p className="p-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No events recorded.
          </p>
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
    <td className="px-3 py-2.5 align-top" style={{ color: 'var(--text-secondary)' }}>
      {children}
    </td>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between text-xs py-1 gap-4">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span
        style={{
          color: 'var(--text-primary)',
          fontFamily: mono ? 'monospace' : undefined,
          textAlign: 'right',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
    </div>
  );
}
