'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'payment', label: 'Payment' },
  { value: 'shipping', label: 'Shipping / delivery' },
  { value: 'account', label: 'Account' },
  { value: 'listing', label: 'A listing' },
  { value: 'other', label: 'Other' },
];

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
  replies: Reply[];
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  AWAITING_USER: 'Reply needed',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export default function SupportPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [active, setActive] = useState<Ticket | null>(null);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [bodyText, setBodyText] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authed = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? `Error ${res.status}`);
      }
      return res.json();
    },
    [getToken],
  );

  const loadList = useCallback(async () => {
    try {
      setTickets(await authed('/support'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [authed]);

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadList();
  }, [isLoaded, isSignedIn, loadList]);

  async function openTicket(id: string) {
    setError(null);
    try {
      setActive(await authed(`/support/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open');
    }
  }

  async function submitNew() {
    setBusy(true);
    setError(null);
    try {
      const t = await authed('/support', {
        method: 'POST',
        body: JSON.stringify({ subject, category, body: bodyText }),
      });
      setCreating(false);
      setSubject('');
      setBodyText('');
      setCategory('general');
      await loadList();
      setActive(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create ticket');
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!active || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const t = await authed(`/support/${active.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body: reply }),
      });
      setReply('');
      setActive(t);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send reply');
    } finally {
      setBusy(false);
    }
  }

  if (isLoaded && !isSignedIn) {
    return <p className="p-6 text-[var(--text-secondary)]">Please sign in to contact support.</p>;
  }

  // ── Thread view ──
  if (active) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <button
          onClick={() => { setActive(null); void loadList(); }}
          className="text-sm text-[var(--text-tertiary)] mb-4"
        >
          ← Back to tickets
        </button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">{active.subject}</h1>
        <p className="text-xs text-[var(--text-tertiary)] mb-4">
          {STATUS_LABEL[active.status] ?? active.status} · {active.category}
        </p>
        <div className="space-y-3 mb-4">
          {active.replies.map((r) => (
            <div
              key={r.id}
              className="rounded-lg p-3 text-sm"
              style={{
                background: r.fromAdmin ? 'var(--bg-card)' : 'var(--bg-inset)',
                border: `0.5px solid ${r.fromAdmin ? 'var(--accent, #2563eb)' : 'var(--border)'}`,
              }}
            >
              <p className="text-xs mb-1" style={{ color: r.fromAdmin ? 'var(--accent, #2563eb)' : 'var(--text-tertiary)' }}>
                {r.fromAdmin ? 'Gun Galore support' : 'You'} · {new Date(r.createdAt).toLocaleString('en-ZA')}
              </p>
              <p className="text-[var(--text-primary)] whitespace-pre-wrap">{r.body}</p>
            </div>
          ))}
        </div>
        {error && <p className="text-xs text-[var(--red)] mb-2">{error}</p>}
        {active.status !== 'CLOSED' && (
          <div>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
              placeholder="Type a reply…"
              className="w-full px-3 py-2 rounded text-sm bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)] outline-none"
            />
            <button
              onClick={sendReply}
              disabled={busy || !reply.trim()}
              className="mt-2 px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent, #2563eb)' }}
            >
              {busy ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── List + create ──
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Support</h1>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 rounded-md text-sm font-medium text-white"
            style={{ background: 'var(--accent, #2563eb)' }}
          >
            New ticket
          </button>
        )}
      </div>

      {creating && (
        <div className="rounded-lg border border-[var(--border)] p-4 mb-5 space-y-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full px-3 py-2 rounded text-sm bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)] outline-none"
          />
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={4}
            placeholder="How can we help?"
            className="w-full px-3 py-2 rounded text-sm bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)] outline-none"
          />
          {error && <p className="text-xs text-[var(--red)]">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setCreating(false); setError(null); }} className="flex-1 py-2 rounded text-sm border border-[var(--border)] text-[var(--text-secondary)]">
              Cancel
            </button>
            <button
              onClick={submitNew}
              disabled={busy || subject.trim().length < 3 || bodyText.trim().length < 5}
              className="flex-1 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent, #2563eb)' }}
            >
              {busy ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}

      {error && !creating && <p className="text-xs text-[var(--red)] mb-2">{error}</p>}

      <div className="space-y-2">
        {tickets.length === 0 && !creating && (
          <p className="text-sm text-[var(--text-tertiary)]">
            No tickets yet. Have a question or a problem? Open a ticket and we&apos;ll help.
          </p>
        )}
        {tickets.map((t) => (
          <button
            key={t.id}
            onClick={() => openTicket(t.id)}
            className="w-full text-left rounded-lg border border-[var(--border)] p-3 hover:bg-[var(--bg-card)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)] truncate">{t.subject}</span>
              <span
                className="text-xs px-2 py-0.5 rounded-full shrink-0"
                style={{
                  background: t.status === 'AWAITING_USER' ? 'var(--accent, #2563eb)' : 'var(--bg-inset)',
                  color: t.status === 'AWAITING_USER' ? '#fff' : 'var(--text-tertiary)',
                }}
              >
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              {t.category} · updated {new Date(t.updatedAt).toLocaleDateString('en-ZA')}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
