'use client';

// /admin/ask-gg/experts — Phase E1 verified-expert grant queue (OD2).
//
// Two tabs:
//   QUEUE     → users with ≥5 verified KB entries who don't yet hold
//               the badge. Admin clicks Grant, enters mandatory
//               reason → AdminAuditEvent (USER_VERIFIED_EXPERT_AWARDED)
//   GRANTED   → currently-badged users; admin can Revoke with
//               mandatory reason → AdminAuditEvent
//                                       (USER_VERIFIED_EXPERT_REVOKED)
//
// Mirrors the /admin/ask-gg/kb queue layout so the operator's mental
// model carries over (tabs + reason-required actions + audit trail).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { useReasonModal } from '@/components/admin/reason-modal';

type Tab = 'QUEUE' | 'GRANTED';

interface QueueRow {
  userId: string;
  verifiedKbCount: number;
  mostRecentVerifiedAt: string | null;
  user: {
    id: string;
    username: string | null;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

interface GrantedRow {
  userId: string;
  verifiedKbCount: number;
  verifiedExpertAt: string | null;
  expertBadgeReason: string | null;
  user: {
    id: string;
    username: string | null;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

interface QueueResponse {
  rows: QueueRow[];
  total: number;
}

interface GrantedResponse {
  rows: GrantedRow[];
  total: number;
}

export default function ExpertQueuePage() {
  const [tab, setTab] = useState<Tab>('QUEUE');
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [granted, setGranted] = useState<GrantedResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, modal } = useReasonModal();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [qRes, gRes] = await Promise.all([
        adminFetch('/admin/ask-gg/experts/queue?limit=100'),
        adminFetch('/admin/ask-gg/experts/granted?limit=100'),
      ]);
      if (qRes.ok) setQueue((await qRes.json()) as QueueResponse);
      else setError(`Failed to load queue (${qRes.status}).`);
      if (gRes.ok) setGranted((await gRes.json()) as GrantedResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }, []);

  useEffect(() => {
    if (!requireAdminToken()) return;
    void (async () => {
      await refresh();
      setLoaded(true);
    })();
  }, [refresh]);

  const onGrant = async (userId: string, verifiedKbCount: number) => {
    const reason = await ask({
      title: 'Grant verified-expert badge?',
      message: `This user has ${verifiedKbCount} verified KB contributions. Your reason is recorded to the audit log AND shown publicly on their seller profile — write something users can read.`,
      placeholder: 'Reason (shown on their public profile)…',
      confirmLabel: 'Grant badge',
    });
    if (!reason || !reason.trim()) return;
    try {
      const res = await adminFetch(
        `/admin/users/${userId}/verified-expert/grant`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!res.ok) {
        setError(`Grant failed (${res.status}).`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  };

  const onRevoke = async (userId: string, username: string | null) => {
    const reason = await ask({
      title: `Revoke badge from ${username ?? 'this user'}?`,
      message: 'Reason is required and logged to the audit trail.',
      confirmLabel: 'Revoke badge',
      danger: true,
    });
    if (!reason || !reason.trim()) return;
    try {
      const res = await adminFetch(
        `/admin/users/${userId}/verified-expert/revoke`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!res.ok) {
        setError(`Revoke failed (${res.status}).`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  };

  if (!loaded) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Loading expert queue…
      </p>
    );
  }

  return (
    <div>
      {modal}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1
            className="text-xl mb-1"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            Verified-Expert badges
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Users who&apos;ve contributed 5+ verified KB entries are
            eligible. Grant + revoke require a mandatory reason →
            AdminAuditEvent.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-1 mb-4 p-1 rounded-[6px] w-fit"
        style={{ background: 'var(--bg-inset)' }}
      >
        <TabButton
          active={tab === 'QUEUE'}
          onClick={() => setTab('QUEUE')}
          label={`Queue (${queue?.total ?? 0})`}
        />
        <TabButton
          active={tab === 'GRANTED'}
          onClick={() => setTab('GRANTED')}
          label={`Granted (${granted?.total ?? 0})`}
        />
      </div>

      {error && (
        <p
          className="text-xs mb-3 px-3 py-2 rounded-[4px]"
          style={{
            color: 'var(--red)',
            background: 'rgba(200,16,46,0.08)',
            border: '0.5px solid rgba(200,16,46,0.40)',
          }}
        >
          {error}
        </p>
      )}

      {tab === 'QUEUE' ? (
        <QueueTable rows={queue?.rows ?? []} onGrant={onGrant} />
      ) : (
        <GrantedTable rows={granted?.rows ?? []} onRevoke={onRevoke} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-3 py-1.5 rounded-[4px]"
      style={{
        background: active ? 'var(--bg-card)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: active ? 500 : 400,
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function QueueTable({
  rows,
  onGrant,
}: {
  rows: QueueRow[];
  onGrant: (userId: string, verifiedKbCount: number) => void;
}) {
  if (rows.length === 0) {
    return (
      <p
        className="text-sm py-8 text-center"
        style={{ color: 'var(--text-tertiary)' }}
      >
        No one in the queue. Once a user reaches 5 verified KB
        contributions they&apos;ll show up here.
      </p>
    );
  }
  return (
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
            <Th>User</Th>
            <Th>Verified KB</Th>
            <Th>Most recent</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.userId}
              style={{ borderTop: '0.5px solid var(--border-divider)' }}
            >
              <Td>
                <Link
                  href={`/admin/users/${r.userId}`}
                  style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                >
                  {r.user.username ?? r.user.email}
                </Link>
                <div
                  className="text-[11px]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {r.user.email}
                </div>
              </Td>
              <Td>
                <span
                  className="px-1.5 py-0.5 rounded-[3px] text-xs"
                  style={{
                    background: 'rgba(34,197,94,0.10)',
                    color: '#22c55e',
                    border: '0.5px solid rgba(34,197,94,0.40)',
                    fontWeight: 500,
                  }}
                >
                  {r.verifiedKbCount}
                </span>
              </Td>
              <Td>
                <span
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {r.mostRecentVerifiedAt
                    ? new Date(r.mostRecentVerifiedAt).toLocaleDateString(
                        'en-ZA',
                        { day: 'numeric', month: 'short', year: 'numeric' },
                      )
                    : '—'}
                </span>
              </Td>
              <Td align="right">
                <button
                  type="button"
                  onClick={() => onGrant(r.userId, r.verifiedKbCount)}
                  className="text-xs px-2 py-1 rounded-[4px]"
                  style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Grant
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GrantedTable({
  rows,
  onRevoke,
}: {
  rows: GrantedRow[];
  onRevoke: (userId: string, username: string | null) => void;
}) {
  if (rows.length === 0) {
    return (
      <p
        className="text-sm py-8 text-center"
        style={{ color: 'var(--text-tertiary)' }}
      >
        No verified experts yet.
      </p>
    );
  }
  return (
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
            <Th>User</Th>
            <Th>Granted</Th>
            <Th>Public reason</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.userId}
              style={{ borderTop: '0.5px solid var(--border-divider)' }}
            >
              <Td>
                <Link
                  href={`/admin/users/${r.userId}`}
                  style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                >
                  {r.user.username ?? r.user.email}
                </Link>
                <div
                  className="text-[11px]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {r.verifiedKbCount} verified KB
                </div>
              </Td>
              <Td>
                <span
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {r.verifiedExpertAt
                    ? new Date(r.verifiedExpertAt).toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : '—'}
                </span>
              </Td>
              <Td>
                <span
                  className="text-xs leading-snug"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {r.expertBadgeReason ?? '—'}
                </span>
              </Td>
              <Td align="right">
                <button
                  type="button"
                  onClick={() => onRevoke(r.userId, r.user.username)}
                  className="text-xs px-2 py-1 rounded-[4px]"
                  style={{
                    background: 'transparent',
                    color: 'var(--red)',
                    fontWeight: 500,
                    border: '0.5px solid var(--red)',
                    cursor: 'pointer',
                  }}
                >
                  Revoke
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className="text-xs uppercase px-3 py-2"
      style={{
        textAlign: align,
        color: 'var(--text-tertiary)',
        letterSpacing: '0.05em',
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <td className="px-3 py-2" style={{ textAlign: align, verticalAlign: 'top' }}>
      {children}
    </td>
  );
}
