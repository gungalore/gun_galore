'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { AskGgUiMessage } from '@/lib/use-ask-gg';
import { MessageBubble, priorUserContent } from './message-bubble';
import { AskGgMascot } from './ask-gg-mascot';

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
        // Sparkie "typing" bubble — a proper assistant-style bubble (not
        // a bare dot) so it reads as "Sparkie is composing", larger and
        // never clipped. Left-aligned like an assistant message; the
        // mascot's think squint + tilt come from its global CSS, the
        // three dots bounce below. overflow:visible so the tilt/bob of
        // the mascot never gets cut off inside the bubble.
        <div
          aria-live="polite"
          aria-label="Ask GG is thinking"
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
            padding: '0 14px',
            marginBottom: 8,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 9,
              padding: '9px 14px',
              borderRadius: 14,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              overflow: 'visible',
            }}
          >
            <span style={{ color: 'var(--red)', display: 'inline-flex' }}>
              <AskGgMascot size={26} mood="think" />
            </span>
            <span
              style={{ display: 'inline-flex', gap: 4 }}
              aria-hidden="true"
            >
              <i className="ag-typing-dot" />
              <i className="ag-typing-dot" />
              <i className="ag-typing-dot" />
            </span>
          </span>
          <style>{`
            .ag-typing-dot {
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: var(--text-secondary);
              display: inline-block;
              animation: ag-typing-bounce 1.2s ease-in-out infinite;
            }
            .ag-typing-dot:nth-child(2) { animation-delay: 0.16s; }
            .ag-typing-dot:nth-child(3) { animation-delay: 0.32s; }
            @keyframes ag-typing-bounce {
              0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
              40% { transform: translateY(-3px); opacity: 1; }
            }
            @media (prefers-reduced-motion: reduce) {
              .ag-typing-dot { animation: ag-pulse 1s ease-in-out infinite; }
            }
            @keyframes ag-pulse {
              0%, 100% { opacity: 0.35; }
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
