'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../lib/auth';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

interface Message {
  id: string;
  senderId: string;
  content: string;
  wasModerated: boolean;
  createdAt: string;
}

// Buyer ↔ seller thread on a transaction. Every message is Jev-moderated
// server-side: contact details are auto-stripped (you'll see "[removed]"),
// abuse is blocked. Keep the conversation on ALL Outdoor.
export default function MessageThread({
  transactionId,
  viewerId,
  buyerId,
}: {
  transactionId: string;
  viewerId: string;
  buyerId: string;
}) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${transactionId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setMessages(await res.json());
    } catch {
      /* transient — next poll retries */
    }
  }, [getToken, transactionId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${transactionId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: body }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? `Error ${res.status}`);
      }
      setText('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
        Messages
      </p>
      <p className="text-xs text-[var(--text-tertiary)] mb-3">
        Keep it on ALL Outdoor — phone numbers, emails and links are removed
        automatically.
      </p>

      <div className="space-y-2 mb-3 max-h-72 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-xs text-[var(--text-tertiary)]">
            No messages yet — say hello.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.senderId === viewerId;
          const who = mine ? 'You' : m.senderId === buyerId ? 'Buyer' : 'Seller';
          return (
            <div
              key={m.id}
              className="rounded-md px-3 py-2 text-sm"
              style={{
                background: mine ? 'var(--bg-inset)' : 'var(--bg-card)',
                border: '1px solid var(--border)',
              }}
            >
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mb-0.5">
                {who}
                {m.wasModerated ? ' · edited' : ''}
              </p>
              <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                {m.content}
              </p>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {error && <p className="text-xs text-[var(--red)] mb-2">{error}</p>}
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Type a message…"
          className="flex-1 px-3 py-2 rounded text-sm bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)] outline-none resize-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !text.trim()}
          className="self-end px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--red)' }}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
