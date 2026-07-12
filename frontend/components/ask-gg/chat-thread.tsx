'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { AskGgUiMessage } from '@/lib/use-ask-gg';
import { MessageBubble, priorUserContent } from './message-bubble';

/** The messages scroll region: message list, "Thinking…" indicator and
 *  error row. Owns the auto-scroll-to-bottom effect. `emptySlot` renders
 *  when there are no messages (the page passes its EmptyState hero). */
export function ChatThread({
  messages,
  sending,
  error,
  onEscalate,
  emptySlot,
}: {
  messages: AskGgUiMessage[];
  sending: boolean;
  error: string | null;
  onEscalate: (content: string) => void;
  emptySlot?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, sending]);

  // Once the streaming assistant bubble starts filling, drop the
  // standalone "Thinking…" indicator so the streamed answer carries the
  // UX (no spinner alongside live text).
  const lastMsg = messages[messages.length - 1];
  const answerHasStarted =
    lastMsg?.role === 'assistant' && lastMsg.content.length > 0;

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 0 12px',
      }}
    >
      {messages.length === 0 && emptySlot}
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          onEscalate={onEscalate}
          priorUserContent={priorUserContent(messages, m.id)}
        />
      ))}
      {sending && !answerHasStarted && (
        <div
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            marginBottom: 6,
            color: 'var(--text-tertiary)',
            fontSize: 13,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--red)',
              animation: 'ag-pulse 1s ease-in-out infinite',
            }}
          />
          <span>Thinking…</span>
          <style>{`
            @keyframes ag-pulse {
              0%, 100% { opacity: 0.3; }
              50% { opacity: 1; }
            }
          `}</style>
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            margin: '6px 0',
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid var(--red)',
            color: 'var(--red)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
