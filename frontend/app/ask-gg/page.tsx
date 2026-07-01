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
import { useRouter } from 'next/navigation';
import { useUser, SignInButton } from '@clerk/nextjs';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useAskGg,
  type AskGgUiMessage,
  type AskGgQuota,
  type AskGgFairUseCoolOff,
  type AskGgCitation,
  type AskGgKbHit,
} from '@/lib/use-ask-gg';
import { SubscriberRaffleWidget } from '@/components/subscriber-raffle-widget';
import { LoadLabPanel } from './load-lab/LoadLabPanel';

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

function IconPaperclip() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function IconX() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
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

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v5h5" />
      <path d="M3.05 13a9 9 0 1 0 2.6-6.4L3 8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Compact relative time for the history picker (e.g. "5m ago", "2d ago"). */
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AskGgPage() {
  const { isSignedIn, isLoaded } = useUser();
  const ag = useAskGg();
  const [composerValue, setComposerValue] = useState('');
  // Phase B — photos staged but not yet uploaded. On Send: upload
  // first, then call ag.send with the returned URLs.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Phase C — KB hits surfaced as the user types in the composer.
  // Debounced 400ms after the last keystroke. Cleared when the user
  // sends, or when they dismiss the helper.
  const [kbHits, setKbHits] = useState<AskGgKbHit[]>([]);
  const [kbDismissed, setKbDismissed] = useState(false);
  // Phase C — resolve-prompt state. Reset whenever a new assistant
  // turn lands so the user gets one bite at the apple per answer.
  const [resolvedThisTurn, setResolvedThisTurn] = useState(false);
  // Load Lab — PRO-gated internal/external ballistics panel. Toggled from
  // the header; renders at the top of the messages-scroll region without
  // touching the chat or composer.
  // Top-level mode: the chat thread vs the Load Lab. Switched with the
  // prominent segmented toggle below the header (not a tucked-away button).
  const [mode, setMode] = useState<'chat' | 'loadlab'>('chat');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const router = useRouter();

  // First-visit gate: an 18+ / liability disclaimer that must be accepted
  // before Ask GG is usable. Persisted in localStorage so it shows once.
  // null = not yet determined (avoids a flash before we read storage).
  const [disclaimerAccepted, setDisclaimerAccepted] = useState<boolean | null>(
    null,
  );
  useEffect(() => {
    try {
      setDisclaimerAccepted(
        localStorage.getItem('askgg:disclaimer:v1') === 'yes',
      );
    } catch {
      setDisclaimerAccepted(true); // storage blocked — don't hard-block the page
    }
  }, []);
  function acceptDisclaimer() {
    try {
      localStorage.setItem('askgg:disclaimer:v1', 'yes');
    } catch {
      /* ignore */
    }
    setDisclaimerAccepted(true);
  }
  function declineDisclaimer() {
    router.push('/');
  }
  function startChat() {
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ block: 'center' });
  }

  // Last-10 chat history picker (opens from the header). Opening a fresh
  // Ask GG always starts a new thread; past chats are reachable here.
  const [historyOpen, setHistoryOpen] = useState(false);
  function newChat() {
    ag.reset();
    setComposerValue('');
    setPendingFiles([]);
    setPhotoError(null);
    setKbHits([]);
    setKbDismissed(false);
    setResolvedThisTurn(false);
    setHistoryOpen(false);
    setMode('chat');
    composerRef.current?.focus();
  }
  async function openConversation(id: string) {
    setHistoryOpen(false);
    setMode('chat');
    await ag.loadConversation(id);
  }

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [ag.messages.length, ag.sending]);

  // Phase C — debounced KB search as the user types. Triggers
  // 400ms after the last keystroke. Skips while a send is in
  // flight (results would be stale by the time they render).
  useEffect(() => {
    if (kbDismissed) return;
    if (ag.sending) return;
    const trimmed = composerValue.trim();
    if (trimmed.length < 5) {
      setKbHits([]);
      return;
    }
    const t = setTimeout(() => {
      void ag.searchKb(trimmed).then(setKbHits);
    }, 400);
    return () => clearTimeout(t);
  }, [composerValue, kbDismissed, ag.sending, ag.searchKb]);

  // Phase C — reset the resolve-prompt state every time a NEW
  // assistant message arrives. The user gets one fresh prompt per
  // answer instead of a one-shot for the whole conversation.
  const latestAssistantId = [...ag.messages]
    .reverse()
    .find((m) => m.role === 'assistant')?.id;
  useEffect(() => {
    setResolvedThisTurn(false);
  }, [latestAssistantId]);

  const showSignInCard = isLoaded && !isSignedIn;
  // FREE user with zero history AND quota exhausted → big hero.
  // If they have history we keep the chat visible and only swap the
  // composer for an inline nudge.
  const showUpgradeHero =
    isLoaded &&
    isSignedIn &&
    ag.tierGated &&
    ag.messages.length === 0 &&
    !ag.historyLoading;

  // Once the streaming assistant bubble starts filling, drop the
  // standalone "Thinking…" indicator so the streamed answer carries the
  // UX (no spinner alongside live text).
  const lastMsg = ag.messages[ag.messages.length - 1];
  const answerHasStarted =
    lastMsg?.role === 'assistant' && lastMsg.content.length > 0;

  function handlePickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setPhotoError(null);
    const list = e.target.files ? Array.from(e.target.files) : [];
    if (list.length === 0) return;
    // Cap at 5 total (existing + new).
    const merged = [...pendingFiles, ...list].slice(0, 5);
    if (pendingFiles.length + list.length > 5) {
      setPhotoError('Up to 5 photos per message.');
    }
    // Client-side validation — keeps the picker responsive instead
    // of round-tripping to the server.
    const bad = merged.find(
      (f) =>
        !/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 10 * 1024 * 1024,
    );
    if (bad) {
      setPhotoError(`${bad.name}: JPG/PNG/WebP only, ≤10 MB.`);
      // Reset the file input so the same file can be re-picked after
      // the user fixes whatever's wrong.
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setPendingFiles(merged);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removePendingFile(idx: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!composerValue.trim() && pendingFiles.length === 0) return;
    const v = composerValue;
    const files = pendingFiles;

    // Upload photos first (if any). On upload failure, surface the
    // error and DON'T clear the composer — user can retry without
    // re-typing.
    let imageUrls: string[] = [];
    if (files.length > 0) {
      setUploadingPhotos(true);
      setPhotoError(null);
      try {
        imageUrls = await ag.uploadPhotos(files);
      } catch (err) {
        setPhotoError(err instanceof Error ? err.message : 'Upload failed.');
        setUploadingPhotos(false);
        return;
      }
      setUploadingPhotos(false);
    }

    setComposerValue('');
    setPendingFiles([]);
    // Phase C — sending clears the staged KB hits AND resets the
    // dismissed flag so future typing surfaces fresh suggestions.
    setKbHits([]);
    setKbDismissed(false);
    await ag.send(v, imageUrls.length > 0 ? { imageUrls } : undefined);
  }

  function handleKbHelpful(entryId: string) {
    void ag.markKbHelpful(entryId);
    // Optimistic dismiss — user got what they came for, no need
    // to keep the cards visible.
    setKbHits([]);
    setKbDismissed(true);
  }

  async function handleEscalate(originalContent: string) {
    // "Try again with deeper thinking" — re-asks the same question
    // with the Opus model. The new turn appends; the previous user
    // + assistant pair stays in the history so the user can compare.
    // Photos from the original turn are NOT re-attached — the deeper
    // model reads the existing history (including image content blocks
    // from earlier turns).
    await ag.send(originalContent, { escalate: true });
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
      {/* First-visit 18+ / liability gate. Must be accepted before use;
          declining returns the user to the homepage. */}
      {disclaimerAccepted === false && (
        <AskGgDisclaimer onAccept={acceptDisclaimer} onDecline={declineDisclaimer} />
      )}

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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {/* Mode is switched via the prominent segmented toggle below
              the header (see ModeToggle), not a button up here. */}
          {isSignedIn && mode === 'chat' && (
            <>
              <button
                type="button"
                onClick={newChat}
                title="Start a new chat"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 999,
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <IconPlus /> New chat
              </button>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!historyOpen) void ag.refreshHistory();
                    setHistoryOpen((o) => !o);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={historyOpen}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    borderRadius: 999,
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-secondary)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  <IconHistory /> History
                </button>
                {historyOpen && (
                  <>
                    <div
                      onClick={() => setHistoryOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                    />
                    <div
                      role="menu"
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 'calc(100% + 6px)',
                        zIndex: 50,
                        width: 280,
                        maxHeight: 340,
                        overflowY: 'auto',
                        background: 'var(--bg-card)',
                        border: '0.5px solid var(--border)',
                        borderRadius: 12,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                        padding: 6,
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '6px 8px 4px' }}>
                        Last {Math.min(ag.history.length || 10, 10)} chats
                      </div>
                      {ag.history.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 8px 10px' }}>
                          No past chats yet.
                        </div>
                      ) : (
                        ag.history.map((h) => (
                          <button
                            key={h.id}
                            type="button"
                            role="menuitem"
                            onClick={() => openConversation(h.id)}
                            style={{
                              display: 'block',
                              width: '100%',
                              textAlign: 'left',
                              padding: '8px',
                              borderRadius: 8,
                              border: 'none',
                              background:
                                h.id === ag.conversationId ? 'var(--bg-inset)' : 'transparent',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                            }}
                          >
                            <span
                              style={{
                                display: 'block',
                                fontSize: 13,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {h.title || 'Untitled chat'}
                            </span>
                            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                              {relTime(h.updatedAt)}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
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
        </div>
      </header>

      {showSignInCard ? (
        <SignInRequiredCard />
      ) : showUpgradeHero ? (
        <UpgradeCard />
      ) : (
        <>
          {/* Prominent segmented toggle — switches the whole view between
              the AI chat and the Load Lab. */}
          <ModeToggle mode={mode} onChange={setMode} />

          {mode === 'loadlab' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 16px' }}>
              <LoadLabPanel />
            </div>
          )}

          {mode === 'chat' && (
            <>
          {/* Phase E3 — subscriber raffle widget. Sits above the
              messages scroll so subscribers see their auto-entered
              raffle on every visit. FREE users see an upsell card
              here; non-signed-in users see nothing (handled inside
              the widget). */}
          <div style={{ padding: '4px 0 0' }}>
            <SubscriberRaffleWidget />
          </div>

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
            {ag.messages.length === 0 && !ag.historyLoading && (
              <EmptyState
                quota={ag.quota}
                onOpenLoadLab={() => setMode('loadlab')}
                onStartChat={startChat}
              />
            )}
            {ag.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onEscalate={handleEscalate}
                priorUserContent={priorUserContent(ag.messages, m.id)}
              />
            ))}
            {ag.sending && !answerHasStarted && (
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

          {/* Phase C — "Did this solve it?" prompt on the latest
              assistant turn. Shows once per turn; dismisses on
              resolve OR when the user sends a new message. Skipped
              when there's no assistant message yet OR when a send
              is in flight (the answer might be about to change). */}
          {latestAssistantId && !resolvedThisTurn && !ag.sending && (
            <ResolvePrompt
              onResolve={(outcome) => {
                void ag.markResolved(outcome);
                setResolvedThisTurn(true);
              }}
            />
          )}

          {/* Phase C — KB search-first hits. Surface above the
              composer as the user types; one click skips Claude
              entirely and saves the cost. */}
          {kbHits.length > 0 && !kbDismissed && (
            <KbHitsRow
              hits={kbHits}
              onHelpful={(id) => handleKbHelpful(id)}
              onDismiss={() => setKbDismissed(true)}
            />
          )}

          {/* Pre-composer chrome: fair-use cool-off > upgrade nudge >
              free-tier quota pill. At most one shows. */}
          {ag.fairUseCoolOff ? (
            <FairUseCard coolOff={ag.fairUseCoolOff} />
          ) : ag.tierGated ? (
            <UpgradeInlineNudge />
          ) : ag.quota?.tier === 'FREE' && ag.quota.remaining > 0 ? (
            <QuotaPill quota={ag.quota} />
          ) : null}

          {/* Photo preview row — shown only when files are staged. */}
          {pendingFiles.length > 0 && (
            <PhotoPreviewRow
              files={pendingFiles}
              onRemove={removePendingFile}
              uploading={uploadingPhotos}
            />
          )}

          {/* Photo-specific error (size, type, upload failure). */}
          {photoError && (
            <p
              role="alert"
              style={{
                margin: '4px 0 0',
                padding: '7px 10px',
                fontSize: 12,
                color: 'var(--red)',
                background: 'rgba(200,16,46,0.10)',
                border: '0.5px solid var(--red)',
                borderRadius: 6,
              }}
            >
              {photoError}
            </p>
          )}

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
            {/* Hidden file input — triggered by the paperclip button.
                Multiple, capture=environment opens the rear camera on
                iOS / Android for fast in-the-shop snapshots. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              multiple
              onChange={handlePickFiles}
              disabled={
                ag.tierGated ||
                !!ag.fairUseCoolOff ||
                pendingFiles.length >= 5
              }
              style={{ display: 'none' }}
            />
            {/* Paperclip / camera button — opens the file picker. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={
                ag.tierGated ||
                !!ag.fairUseCoolOff ||
                uploadingPhotos ||
                pendingFiles.length >= 5
              }
              aria-label={
                pendingFiles.length >= 5
                  ? '5 photo limit reached'
                  : `Attach photo${
                      ag.quota?.photos.tier === 'FREE' &&
                      !ag.quota.photos.unlimited
                        ? ` (${ag.quota.photos.remaining} left this month)`
                        : ''
                    }`
              }
              title={
                pendingFiles.length >= 5
                  ? '5 photo limit reached'
                  : 'Attach photo(s)'
              }
              style={{
                width: 44,
                height: 44,
                flexShrink: 0,
                borderRadius: 10,
                background: 'var(--bg-card)',
                color:
                  ag.tierGated ||
                  ag.fairUseCoolOff ||
                  uploadingPhotos ||
                  pendingFiles.length >= 5
                    ? 'var(--text-tertiary)'
                    : 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                cursor:
                  ag.tierGated ||
                  ag.fairUseCoolOff ||
                  uploadingPhotos ||
                  pendingFiles.length >= 5
                    ? 'not-allowed'
                    : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconPaperclip />
            </button>
            <textarea
              ref={composerRef}
              value={composerValue}
              onChange={(e) => setComposerValue(e.target.value)}
              placeholder={
                ag.tierGated
                  ? 'Upgrade to keep chatting…'
                  : ag.fairUseCoolOff
                    ? 'Quick break — back in a moment…'
                    : pendingFiles.length > 0
                      ? 'Add a note about these photos (optional)…'
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
                uploadingPhotos ||
                (!composerValue.trim() && pendingFiles.length === 0) ||
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
                  uploadingPhotos ||
                  (!composerValue.trim() && pendingFiles.length === 0) ||
                  ag.tierGated ||
                  ag.fairUseCoolOff
                    ? 'var(--bg-inset)'
                    : 'var(--red)',
                color:
                  ag.sending ||
                  uploadingPhotos ||
                  (!composerValue.trim() && pendingFiles.length === 0) ||
                  ag.tierGated ||
                  ag.fairUseCoolOff
                    ? 'var(--text-tertiary)'
                    : '#fff',
                border: 'none',
                cursor: ag.sending || uploadingPhotos ? 'wait' : 'pointer',
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
        </>
      )}
    </main>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

/** Prominent two-segment toggle switching the whole Ask GG view between
 *  the AI chat and the Load Lab. Replaces the old tucked-away pill. */
function ModeToggle({
  mode,
  onChange,
}: {
  mode: 'chat' | 'loadlab';
  onChange: (m: 'chat' | 'loadlab') => void;
}) {
  const seg = (m: 'chat' | 'loadlab', label: string) => {
    const active = mode === m;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onChange(m)}
        style={{
          flex: 1,
          padding: '11px 12px',
          borderRadius: 9,
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600,
          background: active ? 'var(--red)' : 'transparent',
          color: active ? '#fff' : 'var(--text-secondary)',
          transition: 'background 140ms, color 140ms',
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div
      role="tablist"
      aria-label="Ask GG mode"
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        marginTop: 12,
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 12,
      }}
    >
      {seg('chat', 'AI Chat')}
      {seg('loadlab', 'Load Lab')}
    </div>
  );
}

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
        {/* User-attached photos render as thumbnails ABOVE the text
            content so the visual context is clear before reading the
            question. Assistant messages never carry imageUrls. */}
        {isUser && message.imageUrls && message.imageUrls.length > 0 && (
          <UserPhotosRow urls={message.imageUrls} />
        )}
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

/** Thumbnail strip of photos a user attached to their message.
 *  Each thumbnail is clickable — opens the full image in a new tab.
 *  Caps visual height so a 5-photo message doesn't dwarf the text. */
function UserPhotosRow({ urls }: { urls: string[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: urls.length > 0 ? 8 : 0,
      }}
    >
      {urls.map((url, i) => (
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            width: 80,
            height: 80,
            borderRadius: 8,
            overflow: 'hidden',
            border: '0.5px solid rgba(255,255,255,0.20)',
            background: 'rgba(0,0,0,0.3)',
          }}
          aria-label={`Open photo ${i + 1} in new tab`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Attached photo ${i + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </a>
      ))}
    </div>
  );
}

/** Staged-photo preview row above the composer (before send). Each
 *  thumbnail has an X to remove. Dimmed during upload so the user
 *  knows something's happening. */
function PhotoPreviewRow({
  files,
  onRemove,
  uploading,
}: {
  files: File[];
  onRemove: (idx: number) => void;
  uploading: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: '8px 0',
        opacity: uploading ? 0.6 : 1,
      }}
    >
      {files.map((file, i) => {
        // Create a stable object URL per file render — revoked when
        // the file is removed or component unmounts.
        const url = URL.createObjectURL(file);
        return (
          <div
            key={`${file.name}-${file.size}-${i}`}
            style={{
              position: 'relative',
              width: 64,
              height: 64,
              borderRadius: 8,
              overflow: 'hidden',
              border: '0.5px solid var(--border)',
              background: 'var(--bg-card)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={file.name}
              onLoad={() => URL.revokeObjectURL(url)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              disabled={uploading}
              aria-label={`Remove ${file.name}`}
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                border: 'none',
                cursor: uploading ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <IconX />
            </button>
          </div>
        );
      })}
      {uploading && (
        <span
          style={{
            alignSelf: 'center',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            fontStyle: 'italic',
            marginLeft: 4,
          }}
        >
          Uploading…
        </span>
      )}
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
      {citations.map((c, i) => {
        const chipStyle = {
          display: 'inline-flex' as const,
          alignItems: 'center' as const,
          gap: 4,
          padding: '3px 9px',
          borderRadius: 999,
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          fontSize: 11,
          lineHeight: 1.3,
        };
        // Web (forum/maker) source → clickable link chip.
        if (c.sourceType === 'web' && c.url) {
          let host = c.url;
          try {
            host = new URL(c.url).hostname.replace(/^www\./, '');
          } catch {
            /* leave host as the raw url */
          }
          const label =
            c.title.length > 46 ? `${c.title.slice(0, 46)}…` : c.title;
          return (
            <a
              key={`web-${i}`}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${c.title} — ${c.url}`}
              style={{ ...chipStyle, textDecoration: 'none' }}
            >
              💬 {label} · {host} ↗
            </a>
          );
        }
        // Manual source → plain (non-link) chip.
        const pages = c.pages ?? [];
        return (
          <span
            key={`man-${c.manualId ?? i}`}
            title={`${c.manufacturer ?? ''} — ${c.title}${
              c.edition ? ` (${c.edition})` : ''
            }${
              pages.length
                ? `, page${pages.length > 1 ? 's' : ''} ${pages.join(', ')}`
                : ''
            }`}
            style={chipStyle}
          >
            {c.manufacturer ? `${c.manufacturer} ` : ''}
            {c.title}
            {c.edition ? ` (${c.edition})` : ''}
            {pages.length
              ? ` · p.${pages.length === 1 ? pages[0] : pages.join(',')}`
              : ''}
          </span>
        );
      })}
    </div>
  );
}

/** Phase C — "Did this solve it?" pill rendered after the latest
 *  assistant turn. Yes triggers a backend RESOLVED → spawns a DRAFT
 *  KB entry the admin can verify, growing the search-first corpus.
 *  No / Skip both dismiss; No marks UNRESOLVED so the analytics
 *  dashboard can spot frequently-failing question patterns. */
function ResolvePrompt({
  onResolve,
}: {
  onResolve: (outcome: 'RESOLVED' | 'UNRESOLVED' | 'ABANDONED') => void;
}) {
  return (
    <div
      style={{
        marginTop: 4,
        padding: '8px 12px',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
        color: 'var(--text-secondary)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontStyle: 'italic' }}>Did that solve it?</span>
      <button
        type="button"
        onClick={() => onResolve('RESOLVED')}
        style={{
          padding: '3px 12px',
          borderRadius: 999,
          background: 'rgba(120,180,90,0.12)',
          border: '0.5px solid rgba(120,180,90,0.40)',
          color: '#7eb45c',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onResolve('UNRESOLVED')}
        style={{
          padding: '3px 12px',
          borderRadius: 999,
          background: 'rgba(200,16,46,0.08)',
          border: '0.5px solid rgba(200,16,46,0.30)',
          color: 'var(--red)',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        No
      </button>
      <button
        type="button"
        onClick={() => onResolve('ABANDONED')}
        style={{
          padding: '3px 12px',
          borderRadius: 999,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-tertiary)',
          fontSize: 11,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Skip
      </button>
    </div>
  );
}

/** Phase C — KB hit cards rendered above the composer. Each card is
 *  collapsed by default (title + snippet + actions); clicking the
 *  title expands to the full answer. "This helped" bumps usefulCount
 *  + dismisses (user got their answer, no Claude call). "Ask anyway"
 *  is implicit — they just hit Send. The X dismisses the whole row. */
function KbHitsRow({
  hits,
  onHelpful,
  onDismiss,
}: {
  hits: AskGgKbHit[];
  onHelpful: (entryId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 12px',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: 'var(--text-tertiary)',
            fontWeight: 600,
          }}
        >
          Others asked something similar
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestions"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            fontSize: 14,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hits.map((hit) => (
          <KbHitCard key={hit.id} hit={hit} onHelpful={() => onHelpful(hit.id)} />
        ))}
      </div>
    </div>
  );
}

function KbHitCard({
  hit,
  onHelpful,
}: {
  hit: AskGgKbHit;
  onHelpful: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: '8px 10px',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text-primary)',
          fontSize: 13,
          fontWeight: 500,
          fontFamily: 'inherit',
        }}
      >
        {hit.title}
      </button>
      {!expanded && (
        <p
          style={{
            margin: '4px 0 6px',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}
          // Snippet contains ts_headline output without HTML markup.
          // Safe to render as plain text.
        >
          {hit.snippet}
        </p>
      )}
      {expanded && (
        <p
          style={{
            margin: '6px 0',
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
          }}
        >
          {hit.answer}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onHelpful}
          style={{
            padding: '3px 10px',
            borderRadius: 6,
            background: 'rgba(120,180,90,0.12)',
            border: '0.5px solid rgba(120,180,90,0.40)',
            color: '#7eb45c',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          This helped
        </button>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              padding: '3px 10px',
              borderRadius: 6,
              background: 'transparent',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Read full answer
          </button>
        )}
        {hit.category && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            {hit.category}
          </span>
        )}
      </div>
    </div>
  );
}

/** First-visit modal: 18+ confirmation + liability waiver. Declining
 *  returns the user to the homepage (handled by the parent). */
function AskGgDisclaimer({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Before you start"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          padding: 22,
          boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}
        >
          Before you continue
        </h2>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
          }}
        >
          Ask GG gives <strong>general information only</strong> — it is not
          professional, legal, or safety advice. Firearms, ammunition and
          reloading are inherently dangerous; you alone are responsible for how
          you use anything you read here, and you must verify it against the
          manufacturer&rsquo;s official data and applicable law before acting.
        </p>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
          }}
        >
          To the fullest extent permitted by law, <strong>Gun Galore accepts
          no liability</strong> for any loss, injury or damage arising from use
          of Ask GG. By continuing you confirm that you are{' '}
          <strong>18 years or older</strong> and that you accept these terms.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 20,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={onAccept}
            style={{
              flex: '1 1 200px',
              padding: '11px 16px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--red)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            I&rsquo;m 18+ and I agree
          </button>
          <button
            type="button"
            onClick={onDecline}
            style={{
              flex: '1 1 120px',
              padding: '11px 16px',
              borderRadius: 10,
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  quota,
  onOpenLoadLab,
  onStartChat,
}: {
  quota: AskGgQuota | null;
  onOpenLoadLab: () => void;
  onStartChat: () => void;
}) {
  const isFreeWithRemaining = quota?.tier === 'FREE' && quota.remaining > 0;
  const USES = [
    ['Identify it', 'Snap a photo of a part, firearm or headstamp and ask what it is.'],
    ['Ammo & optics', 'Calibre, bullet and powder questions, zeroing, scope and gear comparisons.'],
    ['Hunting & field', 'Species, shot placement, ranging and ethical-range guidance.'],
    ['Reloading data', 'Look up published manual loads by cartridge, bullet and powder.'],
    ['Sell smarter', 'Turn a few photos into a ready-to-post listing description.'],
    ['SA firearms law', 'Plain-language overview of licensing, transport and transfers.'],
  ];
  return (
    <div style={{ padding: '12px 0 8px', color: 'var(--text-secondary)' }}>
      <div style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto' }}>
        <h2
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}
        >
          Welcome to Ask <span style={{ color: 'var(--red)' }}>GG</span>
        </h2>
        <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.55 }}>
          Your firearms-knowledgeable assistant for South African shooters,
          hunters and reloaders. Ask in plain language, attach photos, and get
          clear answers — plus a PRO <strong>Load Lab</strong> for internal
          ballistics, downrange trajectory and published load lookups.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
          margin: '20px auto 0',
          maxWidth: 700,
        }}
      >
        {USES.map(([title, desc]) => (
          <div
            key={title}
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              borderRadius: 10,
              padding: '11px 13px',
            }}
          >
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.45,
                color: 'var(--text-tertiary)',
                marginTop: 2,
              }}
            >
              {desc}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginTop: 22,
        }}
      >
        <button
          type="button"
          onClick={onOpenLoadLab}
          style={{
            padding: '11px 22px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--red)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Open Load Lab
        </button>
        <button
          type="button"
          onClick={onStartChat}
          style={{
            padding: '11px 22px',
            borderRadius: 10,
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          AI assistance
        </button>
      </div>

      {isFreeWithRemaining && quota && (
        <p
          style={{
            margin: '16px 0 0',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            fontStyle: 'italic',
            textAlign: 'center',
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
        pro: 'Unlimited (10/query)',
      },
    },
    {
      label: 'Reloading-manual lookup',
      perk: { free: '✓', member: '✓', pro: '✓' },
    },
    {
      label: 'Ballistic calculator',
      perk: { free: '—', member: '✓', pro: '✓' },
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
      label: 'Weekly Ask GG raffle entry',
      perk: { free: '—', member: 'Member raffle', pro: 'Pro raffle' },
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
