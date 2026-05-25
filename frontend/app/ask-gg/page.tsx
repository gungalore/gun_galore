'use client';

// /ask-gg — Ask GG chat surface.
//
// Three top-level states, in order of precedence:
//
//   1. SIGNED-OUT → SignInRequiredCard. The chat backend is
//      Clerk-guarded; nothing to talk to without an auth token.
//      Friendlier than letting the user type into a dead box.
//
//   2. SIGNED-IN + FREE-TIER QUOTA EXHAUSTED (with no live chat
//      to read) → UpgradeCard. Once the user has used all 5 of
//      their monthly free messages they see the upgrade CTA.
//      If they have an existing thread, we still let them scroll
//      back through it — the inline nudge over the composer
//      handles that case.
//
//   3. SIGNED-IN otherwise → chat. Messages scroll above the
//      composer. FREE users see a "N free messages left this
//      month" pill so they're never surprised by the cap.
//      MEMBER / PRO users see no pill but can hit a fair-use
//      pause (20/hr or 60/hr per spec OD3) — a friendly
//      countdown card replaces the composer for the duration.
//
// The visible "informational not advisory" disclaimer chip at the
// top of every state is REQUIRED per the locked spec — not buried
// in the ToS.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useUser, SignInButton } from '@clerk/nextjs';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useAskGg,
  type AskGgUiMessage,
  type AskGgQuota,
  type AskGgFairUseCoolOff,
  type AskGgCitation,
} from '@/lib/use-ask-gg';

function IconSparkles({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4 L13.6 9.4 L19 11 L13.6 12.6 L12 18 L10.4 12.6 L5 11 L10.4 9.4 Z" />
      <path d="M18.5 4 L19 5.5 L20.5 6 L19 6.5 L18.5 8 L18 6.5 L16.5 6 L18 5.5 Z" />
      <path d="M18.5 16 L19 17.2 L20.2 17.7 L19 18.2 L18.5 19.4 L18 18.2 L16.8 17.7 L18 17.2 Z" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 4 21 10 15 10" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

export default function AskGgPage() {
  const { isSignedIn, isLoaded } = useUser();
  const ag = useAskGg();
  const [composerValue, setComposerValue] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [ag.messages.length, ag.sending]);

  const showSignInCard = isLoaded && !isSignedIn;
  // FREE user with zero history AND quota exhausted → big hero.
  // If they have history we keep the chat visible and only swap the
  // composer for an inline nudge.
  const showUpgradeHero =
    isLoaded && isSignedIn && ag.tierGated && ag.messages.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!composerValue.trim()) return;
    const v = composerValue;
    setComposerValue('');
    await ag.send(v);
  }

  async function handleEscalate(originalContent: string) {
    // "Try again with deeper thinking" — re-asks the same question
    // with the Opus model. The new turn appends; the previous user
    // + assistant pair stays in the history so the user can compare.
    await ag.send(originalContent, true);
  }

  return (
    <main
      className="max-w-[860px] mx-auto"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100dvh - 140px)',
        padding: '0 14px',
      }}
    >
      {/* Header — sparkles + name + disclaimer chip. Always visible
          regardless of which body card renders below. */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: '16px 0 12px',
          borderBottom: '0.5px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'rgba(200,16,46,0.15)',
              color: 'var(--red)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconSparkles />
          </span>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
              }}
            >
              Ask <span style={{ color: 'var(--red)' }}>GG</span>
            </h1>
            <p
              style={{
                margin: '2px 0 0',
                fontSize: 11,
                color: 'var(--text-tertiary)',
              }}
            >
              Your firearms-knowledgeable assistant
            </p>
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '5px 10px',
            borderRadius: 999,
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
            fontSize: 11,
            lineHeight: 1.3,
          }}
        >
          Informational, not advisory
        </span>
      </header>

      {showSignInCard ? (
        <SignInRequiredCard />
      ) : showUpgradeHero ? (
        <UpgradeCard />
      ) : (
        <>
          {/* Messages scroll. flex: 1 → fills the space between
              header + composer. */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 0 12px',
            }}
          >
            {ag.messages.length === 0 && <EmptyState quota={ag.quota} />}
            {ag.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onEscalate={handleEscalate}
                priorUserContent={priorUserContent(ag.messages, m.id)}
              />
            ))}
            {ag.sending && (
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
            {ag.error && (
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
                {ag.error}
              </div>
            )}
          </div>

          {/* Pre-composer chrome: fair-use cool-off > upgrade nudge >
              free-tier quota pill. At most one shows. */}
          {ag.fairUseCoolOff ? (
            <FairUseCard coolOff={ag.fairUseCoolOff} />
          ) : ag.tierGated ? (
            <UpgradeInlineNudge />
          ) : ag.quota?.tier === 'FREE' && ag.quota.remaining > 0 ? (
            <QuotaPill quota={ag.quota} />
          ) : null}

          {/* Composer — pinned to the bottom of the chat area. */}
          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              gap: 8,
              padding: '12px 0 16px',
              borderTop: '0.5px solid var(--border)',
              background: 'var(--bg)',
              alignItems: 'flex-end',
              paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
            }}
          >
            <textarea
              value={composerValue}
              onChange={(e) => setComposerValue(e.target.value)}
              placeholder={
                ag.tierGated
                  ? 'Upgrade to keep chatting…'
                  : ag.fairUseCoolOff
                    ? 'Quick break — back in a moment…'
                    : 'Ask about firearms, ammo, optics, hunting…'
              }
              aria-label="Type your question"
              rows={1}
              disabled={ag.tierGated || !!ag.fairUseCoolOff}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit(e as unknown as React.FormEvent);
                }
              }}
              style={{
                flex: 1,
                minHeight: 44,
                maxHeight: 140,
                padding: '11px 14px',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                border: '0.5px solid var(--border)',
                borderRadius: 10,
                resize: 'none',
                outline: 'none',
                fontSize: 14,
                lineHeight: 1.4,
                fontFamily: 'inherit',
                opacity: ag.tierGated || ag.fairUseCoolOff ? 0.5 : 1,
              }}
            />
            <button
              type="submit"
              disabled={
                ag.sending ||
                !composerValue.trim() ||
                ag.tierGated ||
                !!ag.fairUseCoolOff
              }
              aria-label="Send"
              style={{
                width: 44,
                height: 44,
                flexShrink: 0,
                borderRadius: 10,
                background:
                  ag.sending ||
                  !composerValue.trim() ||
                  ag.tierGated ||
                  ag.fairUseCoolOff
                    ? 'var(--bg-inset)'
                    : 'var(--red)',
                color:
                  ag.sending ||
                  !composerValue.trim() ||
                  ag.tierGated ||
                  ag.fairUseCoolOff
                    ? 'var(--text-tertiary)'
                    : '#fff',
                border: 'none',
                cursor: ag.sending ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 140ms',
              }}
            >
              <IconSend />
            </button>
          </form>
        </>
      )}
    </main>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function MessageBubble({
  message,
  onEscalate,
  priorUserContent,
}: {
  message: AskGgUiMessage;
  onEscalate: (content: string) => void;
  priorUserContent: string | null;
}) {
  const isUser = message.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 10,
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '10px 14px',
          borderRadius: 14,
          background: isUser ? 'var(--red)' : 'var(--bg-card)',
          color: isUser ? '#fff' : 'var(--text-primary)',
          border: isUser ? 'none' : '0.5px solid var(--border)',
          opacity: message.pending ? 0.6 : 1,
          fontSize: 14,
          lineHeight: 1.5,
          // User bubbles keep simple pre-wrap (no markdown rendered for
          // user input). Assistant bubbles render markdown via
          // ReactMarkdown — the component takes over whitespace handling
          // so we DON'T set pre-wrap on the container.
          whiteSpace: isUser ? 'pre-wrap' : 'normal',
          wordBreak: 'break-word',
        }}
      >
        {isUser ? (
          message.content
        ) : (
          <AssistantMarkdown content={message.content} />
        )}
        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationsRow citations={message.citations} />
        )}
        {!isUser && priorUserContent && (
          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: '0.5px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={() => onEscalate(priorUserContent)}
              title="Re-ask with a deeper model"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--text-tertiary)',
                border: '0.5px solid var(--border)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <IconRefresh />
              Try again with deeper thinking
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders assistant-message content as Markdown. Claude's answers
 *  use `**bold**`, `## headers`, `- bullet lists`, fenced code, and
 *  inline `code` — without proper rendering they show as literals.
 *  Custom components apply Gun Galore's text-tertiary/primary
 *  colour tokens + tight spacing so the chat bubble doesn't bloat.
 *  GFM enabled for tables (load-data tables benefit) + autolinks. */
function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="ask-gg-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Cap heading sizes — assistant occasionally emits H1; keep
          // every heading visually subordinate to the page chrome.
          h1: ({ children }) => (
            <p style={mdHeadingStyle(16)}>{children}</p>
          ),
          h2: ({ children }) => (
            <p style={mdHeadingStyle(15)}>{children}</p>
          ),
          h3: ({ children }) => (
            <p style={mdHeadingStyle(14)}>{children}</p>
          ),
          h4: ({ children }) => (
            <p style={mdHeadingStyle(14)}>{children}</p>
          ),
          p: ({ children }) => (
            <p style={{ margin: '0 0 8px', lineHeight: 1.55 }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {children}
            </strong>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ marginBottom: 3, lineHeight: 1.5 }}>{children}</li>
          ),
          code: ({ children, ...props }) => {
            const isInline = !(props as { className?: string }).className;
            return isInline ? (
              <code
                style={{
                  background: 'var(--bg-inset)',
                  padding: '1px 5px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {children}
              </code>
            ) : (
              <code>{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                overflowX: 'auto',
                margin: '0 0 8px',
              }}
            >
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--red)', textDecoration: 'underline' }}
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: '0 0 8px',
                paddingLeft: 10,
                borderLeft: '2px solid var(--border-hover)',
                color: 'var(--text-secondary)',
              }}
            >
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: '0 0 8px' }}>
              <table
                style={{
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  width: '100%',
                }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              style={{
                border: '0.5px solid var(--border)',
                padding: '4px 8px',
                background: 'var(--bg-inset)',
                textAlign: 'left',
                fontWeight: 600,
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                border: '0.5px solid var(--border)',
                padding: '4px 8px',
              }}
            >
              {children}
            </td>
          ),
          hr: () => (
            <hr
              style={{
                border: 'none',
                borderTop: '0.5px solid var(--border)',
                margin: '10px 0',
              }}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function mdHeadingStyle(fontSize: number): React.CSSProperties {
  return {
    margin: '8px 0 4px',
    fontSize,
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.35,
  };
}

/** Citation chips rendered below an assistant message. Each chip
 *  shows the manual + page(s) Claude actually read while answering.
 *  Plain visible footer — no hyperlinks (PDFs are admin-only). The
 *  manual name is enough proof that the answer came from a real
 *  manufacturer source. */
function CitationsRow({ citations }: { citations: AskGgCitation[] }) {
  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '0.5px solid var(--border)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--text-tertiary)',
          alignSelf: 'center',
          marginRight: 4,
        }}
      >
        Sources
      </span>
      {citations.map((c, i) => (
        <span
          key={`${c.manualId}-${i}`}
          title={`${c.manufacturer} — ${c.title}${
            c.edition ? ` (${c.edition})` : ''
          }, page${c.pages.length > 1 ? 's' : ''} ${c.pages.join(', ')}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 9px',
            borderRadius: 999,
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 11,
            lineHeight: 1.3,
          }}
        >
          {c.manufacturer} {c.title}
          {c.edition ? ` (${c.edition})` : ''} ·{' '}
          p.{c.pages.length === 1 ? c.pages[0] : c.pages.join(',')}
        </span>
      ))}
    </div>
  );
}

function EmptyState({ quota }: { quota: AskGgQuota | null }) {
  // FREE users see the trial allowance up-front so they know what
  // they're getting. MEMBER / PRO see the standard "ask me anything"
  // line. Signed-in but quota-not-yet-loaded falls back to the same.
  const isFreeWithRemaining =
    quota?.tier === 'FREE' && quota.remaining > 0;
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '40px 0',
        color: 'var(--text-tertiary)',
      }}
    >
      <p style={{ margin: 0, fontSize: 14 }}>
        Ask me anything firearms-related.
      </p>
      <p
        style={{
          margin: '8px 0 0',
          fontSize: 12,
          color: 'var(--text-tertiary)',
        }}
      >
        Identifying a part · troubleshooting · ammo questions · gear
        comparison · SA-law overview
      </p>
      {isFreeWithRemaining && quota && (
        <p
          style={{
            margin: '14px 0 0',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            fontStyle: 'italic',
          }}
        >
          {quota.remaining} of {quota.cap} free messages left this month
        </p>
      )}
    </div>
  );
}

/** Pill rendered above the composer for FREE users. Pure counter —
 *  no CTA — so it doesn't fight with the composer for attention.
 *  Turns warm-coloured at ≤2 remaining so the cap doesn't surprise. */
function QuotaPill({ quota }: { quota: AskGgQuota }) {
  const warm = quota.remaining <= 2;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '4px 0',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          background: warm
            ? 'rgba(200,16,46,0.10)'
            : 'var(--bg-inset)',
          border: `0.5px solid ${warm ? 'rgba(200,16,46,0.40)' : 'var(--border)'}`,
          color: warm ? 'var(--red)' : 'var(--text-tertiary)',
          fontSize: 11,
          lineHeight: 1.2,
        }}
        aria-label={`${quota.remaining} of ${quota.cap} free messages remaining this month`}
      >
        {quota.remaining} / {quota.cap} free messages this month
      </span>
    </div>
  );
}

/** Inline upgrade nudge that takes the QuotaPill slot once the
 *  FREE user has used their last message — but kept compact so the
 *  composer (disabled) still shows below for context. */
function UpgradeInlineNudge() {
  return (
    <div
      style={{
        marginTop: 8,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'rgba(200,16,46,0.08)',
        border: '0.5px solid rgba(200,16,46,0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      role="status"
    >
      <span
        style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          lineHeight: 1.4,
        }}
      >
        You&rsquo;ve used your 5 free messages this month. Upgrade to
        Member or Pro for unlimited firearms questions, photo
        identification, and more.
      </span>
      <span
        style={{
          padding: '8px 14px',
          background: 'var(--bg-inset)',
          color: 'var(--text-secondary)',
          border: '0.5px solid var(--border-hover)',
          borderRadius: 8,
          fontSize: 12,
          alignSelf: 'flex-start',
        }}
      >
        Subscription launching soon — we&rsquo;ll email you when it&rsquo;s live.
      </span>
    </div>
  );
}

/** Replaces the composer when a MEMBER / PRO user has hit their
 *  hourly fair-use cap. Live-countdown so the wait is honest, not
 *  vague. Composer is disabled while this is on-screen. */
function FairUseCard({ coolOff }: { coolOff: AskGgFairUseCoolOff }) {
  const [remainingSec, setRemainingSec] = useState(() =>
    secondsUntil(coolOff.windowResetsAt),
  );
  useEffect(() => {
    const t = setInterval(() => {
      setRemainingSec(secondsUntil(coolOff.windowResetsAt));
    }, 1000);
    return () => clearInterval(t);
  }, [coolOff.windowResetsAt]);

  const min = Math.floor(remainingSec / 60);
  const sec = remainingSec % 60;
  return (
    <div
      style={{
        marginTop: 8,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
      role="status"
      aria-live="polite"
    >
      <span style={{ color: 'var(--text-tertiary)' }}>
        <IconClock />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
          }}
        >
          Quick break — fair-use cap hit
        </p>
        <p
          style={{
            margin: '2px 0 0',
            fontSize: 11,
            color: 'var(--text-tertiary)',
          }}
        >
          Back in {min}:{sec.toString().padStart(2, '0')}
        </p>
      </div>
    </div>
  );
}

/** 3-column FREE / MEMBER / PRO perks comparison. Rendered on the
 *  signed-out + FREE-tier-exhausted cards so prospects (and capped
 *  free users) can see exactly what they'd get by signing up /
 *  upgrading. Prices are deliberately shown as "Launching soon"
 *  because the self-serve subscription flow is gated on Peach card
 *  tokenisation — operator sets the rand amounts once Peach lands.
 *
 *  Perks come from the locked spec (OD1 + OD3 + the Phase E
 *  marketplace perks). The `current` prop visually highlights the
 *  user's current tier so they can see what they'd gain by upgrading.
 */
function TierPerksTable({
  current,
}: {
  current: 'FREE' | 'MEMBER' | 'PRO' | null;
}) {
  type Perk = { free: string; member: string; pro: string };
  const ROWS: Array<{ label: string; perk: Perk }> = [
    {
      label: 'Ask GG chat',
      perk: {
        free: '5 messages / month',
        member: '20 messages / hour',
        pro: '60 messages / hour',
      },
    },
    {
      label: 'Photo identification',
      perk: {
        free: '5 photos / month',
        member: 'Unlimited (5/query)',
        pro: 'Unlimited (20/query)',
      },
    },
    {
      label: 'Reloading-manual lookup',
      perk: { free: '✓', member: '✓', pro: '✓ priority' },
    },
    {
      label: 'Username badge',
      perk: { free: '—', member: 'GG+ pill', pro: 'Verified-expert' },
    },
    {
      label: 'Featured-listing bid discount',
      perk: { free: '—', member: '25% off', pro: '50% off' },
    },
    {
      label: 'Prime Ad reserve discount',
      perk: { free: '—', member: '—', pro: '25% off' },
    },
    {
      label: 'Business / VAT receipts',
      perk: { free: '—', member: '—', pro: '✓' },
    },
  ];

  const tiers: Array<{
    key: 'FREE' | 'MEMBER' | 'PRO';
    label: string;
    price: string;
    accent: boolean;
  }> = [
    { key: 'FREE', label: 'Free', price: 'R0', accent: false },
    { key: 'MEMBER', label: 'Member', price: 'Launching soon', accent: false },
    { key: 'PRO', label: 'Pro', price: 'Launching soon', accent: true },
  ];

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 720,
        marginBottom: 28,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10,
      }}
    >
      {tiers.map((t) => {
        const isCurrent = current === t.key;
        return (
          <div
            key={t.key}
            style={{
              background: isCurrent
                ? 'rgba(200,16,46,0.06)'
                : 'var(--bg-card)',
              border: `0.5px solid ${
                isCurrent
                  ? 'rgba(200,16,46,0.40)'
                  : t.accent
                    ? 'rgba(200,16,46,0.25)'
                    : 'var(--border)'
              }`,
              borderRadius: 10,
              padding: '14px 12px',
              textAlign: 'left',
              position: 'relative',
            }}
          >
            {/* Tier header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                {t.label}
              </h3>
              {isCurrent && (
                <span
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                    color: 'var(--red)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(200,16,46,0.12)',
                    fontWeight: 600,
                  }}
                >
                  Current
                </span>
              )}
              {!isCurrent && t.accent && (
                <span
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                    color: 'var(--red)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(200,16,46,0.12)',
                    fontWeight: 600,
                  }}
                >
                  Most value
                </span>
              )}
            </div>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 12,
                color: 'var(--text-tertiary)',
              }}
            >
              {t.price}
            </p>

            {/* Perk rows */}
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              {ROWS.map((r) => {
                const value = r.perk[t.key === 'FREE' ? 'free' : t.key === 'MEMBER' ? 'member' : 'pro'];
                const isDash = value === '—';
                return (
                  <li
                    key={r.label}
                    style={{
                      padding: '5px 0',
                      borderTop: '0.5px solid var(--border-divider)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      {r.label}
                    </span>
                    <span
                      style={{
                        color: isDash ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        fontSize: 12,
                        fontWeight: isDash ? 400 : 500,
                      }}
                    >
                      {value}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function SignInRequiredCard() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 16px',
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at center, rgba(200,16,46,0.20), rgba(200,16,46,0) 70%)',
          color: 'var(--red)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <IconSparkles size={44} />
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color: 'var(--red)',
          fontWeight: 600,
        }}
      >
        Sign in to start
      </p>
      <h2
        style={{
          margin: '10px 0 14px',
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--text-primary)',
        }}
      >
        Ask GG is your firearms assistant
      </h2>
      <p
        style={{
          margin: '0 0 24px',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--text-secondary)',
          maxWidth: 520,
        }}
      >
        Identify parts from photos, get gear recommendations,
        understand SA gun-law basics, and unstick yourself on the
        platform. Sign in to use 5 free messages per month — then
        upgrade for unlimited.
      </p>
      <TierPerksTable current={null} />
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <SignInButton mode="modal">
          <button
            type="button"
            style={{
              padding: '11px 20px',
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign in
          </button>
        </SignInButton>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            padding: '11px 20px',
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Browse marketplace
        </Link>
      </div>
    </div>
  );
}

function UpgradeCard() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 16px',
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at center, rgba(200,16,46,0.20), rgba(200,16,46,0) 70%)',
          color: 'var(--red)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <IconSparkles size={44} />
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color: 'var(--red)',
          fontWeight: 600,
        }}
      >
        Free messages used
      </p>
      <h2
        style={{
          margin: '10px 0 14px',
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--text-primary)',
        }}
      >
        Upgrade to keep chatting
      </h2>
      <p
        style={{
          margin: '0 0 24px',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--text-secondary)',
          maxWidth: 520,
        }}
      >
        You&rsquo;ve used your 5 free Ask GG messages this month.
        Here&rsquo;s what you get by upgrading:
      </p>
      <TierPerksTable current="FREE" />
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        {/* Subscription self-serve lands in a future drop. Until
            then this is informational + the operator grants tiers
            manually from /admin/users/[id]. */}
        <span
          style={{
            padding: '11px 20px',
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border-hover)',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          Subscription launching soon
        </span>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            padding: '11px 20px',
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Browse marketplace
        </Link>
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

function priorUserContent(
  messages: AskGgUiMessage[],
  assistantId: string,
): string | null {
  const idx = messages.findIndex((m) => m.id === assistantId);
  if (idx < 1) return null;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return null;
}

function secondsUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 1000));
}
