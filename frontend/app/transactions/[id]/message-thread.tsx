'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Message } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
  resize: 'none',
  minHeight: '40px',
  maxHeight: '120px',
  overflowY: 'auto',
};

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

export function MessageThread({
  transactionId,
  myClerkId,
}: {
  transactionId: string;
  myClerkId: string;
}) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async () => {
    const token = await getToken();
    const res = await fetch(`${API_URL}/transactions/${transactionId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data: Message[] = await res.json();
    setMessages((prev) => {
      if (JSON.stringify(prev.map((m) => m.id)) === JSON.stringify(data.map((m) => m.id))) return prev;
      return data;
    });
  }, [getToken, transactionId]);

  useEffect(() => {
    fetchMessages();
    pollRef.current = setInterval(fetchMessages, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${transactionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: draft.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      const msg: Message = await res.json();
      setMessages((prev) => [...prev, msg]);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isMine = (msg: Message) => msg.senderClerkId === myClerkId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Message list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          minHeight: '200px',
          maxHeight: '400px',
        }}
      >
        {messages.length === 0 && (
          <p className="text-sm text-center" style={{ color: 'var(--text-tertiary)', margin: 'auto' }}>
            No messages yet. Send the first one.
          </p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isMine(msg) ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '75%',
                padding: '8px 12px',
                borderRadius: isMine(msg) ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: isMine(msg) ? 'var(--red)' : 'var(--bg-inset)',
                color: isMine(msg) ? '#fff' : 'var(--text-primary)',
                fontSize: '14px',
                lineHeight: '1.4',
                border: isMine(msg) ? 'none' : '0.5px solid var(--border)',
                wordBreak: 'break-word',
              }}
            >
              {msg.content}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                marginTop: '2px',
                display: 'flex',
                gap: '6px',
                alignItems: 'center',
              }}
            >
              {formatTime(msg.createdAt)}
              {msg.wasModerated && (
                <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                  · contact info removed
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div
          className="mx-3 mb-2 px-3 py-2 rounded-[6px] text-xs"
          style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {/* Compose */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          padding: '12px',
          borderTop: '0.5px solid var(--border-divider)',
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message… (Enter to send, Shift+Enter for new line)"
          rows={1}
          style={inputStyle}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            background: !draft.trim() || sending ? 'var(--bg-inset)' : 'var(--red)',
            color: !draft.trim() || sending ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            cursor: !draft.trim() || sending ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            alignSelf: 'flex-end',
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
