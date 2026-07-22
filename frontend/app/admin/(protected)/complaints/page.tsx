'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';

interface Complaint {
  id: string;
  referenceNumber: string;
  role: string;
  category: string;
  subject: string;
  body: string;
  status: string;
  assignedAdminId: string | null;
  outcome: string | null;
  drovePayoutHold: boolean;
  createdAt: string;
  resolvedAt: string | null;
  user?: { username: string | null; email: string };
  photos: { id: string; url: string }[];
  transaction?: {
    id: string;
    paymentStatus: string;
    listing: { title: string; referenceNumber: string | null } | null;
  } | null;
}

const STATUS_TABS = ['OPEN', 'UNDER_REVIEW', 'AWAITING_USER', 'RESOLVED', 'CLOSED'];

export default function AdminComplaintsPage() {
  const [status, setStatus] = useState('OPEN');
  const [rows, setRows] = useState<Complaint[]>([]);
  const [active, setActive] = useState<Complaint | null>(null);
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!requireAdminToken()) return;
    const res = await adminFetch(`/admin/complaints?status=${status}`);
    if (res.ok) setRows(await res.json());
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    if (!active) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await adminFetch(`/admin/complaints/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).message ?? 'Failed');
      setActive(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (active) {
    return (
      <div>
        <button
          onClick={() => setActive(null)}
          className="text-sm mb-3"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ← Back to register
        </button>
        <AdminPageHeader title={`${active.referenceNumber} · ${active.subject}`} />
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          {active.user?.username ?? active.user?.email} · {active.role} ·{' '}
          {active.category.replace(/_/g, ' ')} ·{' '}
          {new Date(active.createdAt).toLocaleString('en-ZA')}
          {active.drovePayoutHold && (
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>
              {' '}
              · PAYOUT HELD
            </span>
          )}
        </p>

        {active.transaction && (
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            Order:{' '}
            <a
              href={`/admin/transactions/${active.transaction.id}`}
              style={{ color: 'var(--red)' }}
            >
              {active.transaction.listing?.title ?? 'item'} (
              {active.transaction.listing?.referenceNumber ?? active.transaction.id.slice(-8)})
            </a>{' '}
            — payment {active.transaction.paymentStatus}
          </p>
        )}

        <div
          className="rounded-lg p-3 text-sm mb-4 max-w-2xl whitespace-pre-wrap"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        >
          {active.body}
        </div>

        {active.photos.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-4">
            {active.photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img
                  src={p.url}
                  alt="evidence"
                  style={{
                    width: 110,
                    height: 110,
                    objectFit: 'cover',
                    borderRadius: 8,
                    border: '0.5px solid var(--border)',
                  }}
                />
              </a>
            ))}
          </div>
        )}

        {err && (
          <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>
            {err}
          </p>
        )}

        <div className="max-w-2xl">
          <label
            className="text-xs block mb-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            Outcome / resolution note
          </label>
          <textarea
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            rows={3}
            placeholder="What was decided and done…"
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <div className="flex gap-2 mt-2 flex-wrap">
            <button
              onClick={() => patch({ status: 'UNDER_REVIEW' })}
              disabled={busy}
              className="px-4 py-2 rounded text-sm"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Assign to me · review
            </button>
            <button
              onClick={() => patch({ status: 'AWAITING_USER', outcome: outcome || undefined })}
              disabled={busy}
              className="px-4 py-2 rounded text-sm"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Await user
            </button>
            <button
              onClick={() => patch({ status: 'RESOLVED', outcome: outcome || undefined })}
              disabled={busy || !outcome.trim()}
              className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--red)' }}
            >
              {busy ? 'Saving…' : 'Resolve + record outcome'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader title="Complaints register" />
      <div className="flex gap-2 mb-5 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setStatus(t)}
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={{
              background: status === t ? 'var(--red)' : 'var(--bg-card)',
              color: status === t ? '#fff' : 'var(--text-secondary)',
              border: `0.5px solid ${status === t ? 'transparent' : 'var(--border)'}`,
            }}
          >
            {t.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No complaints in this status.
          </p>
        )}
        {rows.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setActive(c);
              setOutcome(c.outcome ?? '');
            }}
            className="w-full text-left rounded-lg p-3"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="text-sm font-medium truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                <span style={{ color: 'var(--red)' }}>{c.referenceNumber}</span>{' '}
                · {c.subject}
              </span>
              <span className="text-xs shrink-0 flex gap-2 items-center">
                {c.drovePayoutHold && (
                  <span style={{ color: 'var(--red)', fontWeight: 600 }}>HELD</span>
                )}
                {c.photos.length > 0 && (
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    📎{c.photos.length}
                  </span>
                )}
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {c.user?.username ?? c.user?.email} · {c.category.replace(/_/g, ' ')} ·{' '}
              {new Date(c.createdAt).toLocaleDateString('en-ZA')}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
