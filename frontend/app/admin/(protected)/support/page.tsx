'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';

interface Reply {
  id: string;
  body: string;
  fromAdmin: boolean;
  createdAt: string;
}
interface Ticket {
  id: string;
  subject: string;
  category: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  user?: { username: string | null; email: string };
  replies: Reply[];
  _count?: { replies: number };
}

const STATUS_TABS = ['OPEN', 'AWAITING_USER', 'RESOLVED', 'CLOSED'];

export default function AdminSupportPage() {
  const [status, setStatus] = useState('OPEN');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [active, setActive] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!requireAdminToken()) return;
    const res = await adminFetch(`/admin/support?status=${status}`);
    if (res.ok) setTickets(await res.json());
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function open(id: string) {
    const res = await adminFetch(`/admin/support/${id}`);
    if (res.ok) setActive(await res.json());
  }

  async function send() {
    if (!active || !reply.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await adminFetch(`/admin/support/${active.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: reply }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Failed');
      setReply('');
      setActive(await res.json());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  async function resolve() {
    if (!active) return;
    setBusy(true); setErr(null);
    try {
      const res = await adminFetch(`/admin/support/${active.id}/resolve`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      setActive(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  if (active) {
    return (
      <div>
        <button onClick={() => { setActive(null); void load(); }} className="text-sm mb-3" style={{ color: 'var(--text-tertiary)' }}>
          ← Back to queue
        </button>
        <AdminPageHeader title={active.subject} />
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
          {active.user?.username ?? active.user?.email} · {active.category} · {active.status}
        </p>
        <div className="space-y-3 mb-4 max-w-2xl">
          {active.replies.map((r) => (
            <div key={r.id} className="rounded-lg p-3 text-sm" style={{
              background: r.fromAdmin ? 'var(--bg-card)' : 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
            }}>
              <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
                {r.fromAdmin ? 'Admin' : 'User'} · {new Date(r.createdAt).toLocaleString('en-ZA')}
              </p>
              <p className="whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{r.body}</p>
            </div>
          ))}
        </div>
        {err && <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>{err}</p>}
        <div className="max-w-2xl">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Reply to the user…"
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <div className="flex gap-2 mt-2">
            <button onClick={send} disabled={busy || !reply.trim()} className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent, #2563eb)' }}>
              {busy ? 'Sending…' : 'Send reply'}
            </button>
            <button onClick={resolve} disabled={busy} className="px-4 py-2 rounded text-sm" style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}>
              Mark resolved
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader title="Support tickets" />
      <div className="flex gap-2 mb-5 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button key={t} onClick={() => setStatus(t)} className="px-3 py-1 rounded-full text-xs font-medium" style={{
            background: status === t ? 'var(--red)' : 'var(--bg-card)',
            color: status === t ? '#fff' : 'var(--text-secondary)',
            border: `0.5px solid ${status === t ? 'transparent' : 'var(--border)'}`,
          }}>
            {t.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {tickets.length === 0 && <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No tickets in this status.</p>}
        {tickets.map((t) => (
          <button key={t.id} onClick={() => open(t.id)} className="w-full text-left rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{t.subject}</span>
              <span className="text-xs shrink-0" style={{ color: 'var(--text-tertiary)' }}>{t._count?.replies ?? 0} msg</span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {t.user?.username ?? t.user?.email} · {t.category} · {new Date(t.updatedAt).toLocaleDateString('en-ZA')}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
