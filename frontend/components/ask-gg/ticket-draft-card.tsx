'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { AskGgTicketDraft } from '@/lib/use-ask-gg';

// W6 — the support-ticket DRAFT card. The assistant stages the draft;
// NOTHING exists server-side until the user taps "Create ticket" here,
// which posts to the normal support endpoint under the user's own
// session. Self-contained (own fetch) so no handler plumbing through
// ChatThread/MessageBubble is needed.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'https://gungalore.co.za/api';

export function TicketDraftCard({ draft }: { draft: AskGgTicketDraft }) {
  const { getToken } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(
    'idle',
  );

  async function create() {
    if (state === 'sending' || state === 'done') return;
    setState('sending');
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/support`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject: draft.subject,
          body: draft.body,
          category: draft.category,
          ...(draft.transactionId
            ? { transactionId: draft.transactionId }
            : {}),
        }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <div
      style={{
        marginTop: 8,
        border: '0.5px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg-deep)',
        padding: '10px 12px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          marginBottom: 6,
        }}
      >
        Support ticket draft — not sent yet
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 2,
        }}
      >
        {draft.subject}
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-tertiary)',
          marginBottom: 6,
        }}
      >
        Category: {draft.category}
        {draft.transactionId ? ' · linked to your order' : ''}
      </div>
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.5,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          marginBottom: 10,
        }}
      >
        {draft.body}
      </div>
      {state === 'done' ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          ✓ Ticket created — the team will get back to you. Track it under{' '}
          <a href="/support" style={{ color: 'var(--red)' }}>
            Support
          </a>
          .
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => void create()}
            disabled={state === 'sending'}
            style={{
              padding: '7px 14px',
              fontSize: 12.5,
              fontWeight: 600,
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: state === 'sending' ? 'wait' : 'pointer',
              opacity: state === 'sending' ? 0.7 : 1,
            }}
          >
            {state === 'sending' ? 'Creating…' : 'Create ticket'}
          </button>
          {state === 'error' && (
            <span style={{ fontSize: 12, color: 'var(--red)' }}>
              Couldn&rsquo;t create it — try again.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
