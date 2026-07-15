'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useAskGgChat, useAskGgWidget } from '@/lib/use-ask-gg-widget';
import type { AskGgKbHit } from '@/lib/use-ask-gg';
import { IconPlus, IconX } from './icons';
import { AskGgMascot } from './ask-gg-mascot';
import { ChatThread } from './chat-thread';
import { Composer, type ComposerHandle } from './composer';
import { KbHitsRow } from './kb-hits';
import { ResolvePrompt } from './resolve-prompt';
import { QuotaPill, UpgradeInlineNudge, FairUseCard } from './quota-chrome';
import { AskGgDisclaimer, useAskGgDisclaimer } from './disclaimer';
import { GENERIC_STARTER_PROMPTS } from './starter-prompts';
import { AskGgSignedOut } from './ask-gg-signed-out';
import { GuideView } from './guide-view';
import {
  derivePageContext,
  CONTEXTUAL_STARTER_PROMPTS,
} from '@/lib/ask-gg-context';

// Ask GG Everywhere — the site-wide chat panel (the LAZY chunk).
//
// Loaded via next/dynamic on first open (AskGgHost) and kept mounted
// thereafter — `open` only toggles visibility, so the conversation
// survives close/reopen and navigation. Consumes the SAME shared chat
// instance as /ask-gg (AskGgProvider), so "Expand" is just a route
// change with ?c= for refresh-resilience.
//
// Geometry = the added-to-cart-drawer recipe: bottom sheet <md (88dvh,
// rounded top, safe-area padding), 420px right drawer ≥md. Backdrop
// z-[74], panel z-[75] — above the cart drawer (71) + nav drawers (70),
// below the offline banner (80) and the disclaimer modal (1000).

export default function AskGgPanel() {
  const { open, setOpen, takePrefill } = useAskGgWidget();
  const ag = useAskGgChat();
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  const [entered, setEntered] = useState(false);
  // G2 — 'guide' shows the server-driven page playbook ($0 AI); 'chat' is the
  // Claude conversation. Opening picks the sensible default (guide-first).
  const [tab, setTab] = useState<'chat' | 'guide'>('guide');
  const [composerValue, setComposerValue] = useState('');
  const [kbHits, setKbHits] = useState<AskGgKbHit[]>([]);
  const [kbDismissed, setKbDismissed] = useState(false);
  const [resolvedThisTurn, setResolvedThisTurn] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerApiRef = useRef<ComposerHandle | null>(null);
  const kbDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { accepted: disclaimerAccepted, accept: acceptDisclaimer } =
    useAskGgDisclaimer();

  // Enter/exit animation — two frames so the transform transitions.
  // The rAF chain MUST be cancellable: if `open` flips back to false
  // before the frames land (e.g. an immediate close), a stray
  // setEntered(true) would strand a visible-but-inert ghost overlay —
  // the "PWA freeze".
  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    let cancelled = false;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled) setEntered(true);
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [open]);

  // W5.5 — a nudge (or future CTA) staged a question: put it in the
  // composer and focus, so the user just hits Send (or edits first). Also
  // picks the opening tab (G2): a staged question or an in-progress chat opens
  // to Chat; a fresh open lands on the Guide (guide-first).
  useEffect(() => {
    if (!open) return;
    const prefill = takePrefill();
    if (prefill) {
      setTab('chat');
      setComposerValue(prefill);
      requestAnimationFrame(() => composerRef.current?.focus());
    } else {
      setTab(ag.messages.length > 0 ? 'chat' : 'guide');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Body-scroll lock + Escape while open (cart-drawer idiom).
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  // Close (hide, never unmount) on navigation — but ONLY on a real
  // route change. This effect used to run on FIRST MOUNT too, which
  // cancelled the very first open (tab/FAB tap arms + opens → panel
  // mounts → mount-run closed it again), leaving the enter-animation
  // frames to strand the ghost overlay users saw as a frozen app.
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current === pathname) return;
    prevPathnameRef.current = pathname;
    setOpen(false);
  }, [pathname, setOpen]);

  // KB search-first: debounced lookup while the user types (Phase C UX,
  // mirrored from the /ask-gg page wiring).
  useEffect(() => {
    if (kbDebounceRef.current) clearTimeout(kbDebounceRef.current);
    const q = composerValue.trim();
    if (!isSignedIn || kbDismissed || q.length < 5) {
      if (q.length < 5) setKbHits([]);
      return;
    }
    kbDebounceRef.current = setTimeout(async () => {
      const hits = await ag.searchKb(q);
      setKbHits(hits);
    }, 400);
    return () => {
      if (kbDebounceRef.current) clearTimeout(kbDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerValue, kbDismissed, isSignedIn]);

  // New assistant turn → re-arm the resolve prompt.
  const assistantCount = ag.messages.filter((m) => m.role === 'assistant').length;
  useEffect(() => {
    setResolvedThisTurn(false);
  }, [assistantCount]);

  // Sparkie mood: 'think' while a reply streams, a 'happy' beat when a
  // new answer lands, otherwise idle.
  const [happyPulse, setHappyPulse] = useState(false);
  const prevAssistantRef = useRef(0);
  useEffect(() => {
    const grew = assistantCount > prevAssistantRef.current;
    prevAssistantRef.current = assistantCount;
    if (!grew) return;
    setHappyPulse(true);
    const t = setTimeout(() => setHappyPulse(false), 1500);
    return () => clearTimeout(t);
  }, [assistantCount]);
  const mascotMood = ag.sending ? 'think' : happyPulse ? 'happy' : 'idle';

  // W4 — page context. Derived from the URL only; the backend treats
  // the ids as untrusted hints and re-fetches with ownership checks.
  // Attached to every send from the panel (the /ask-gg page keeps its
  // context-free sends — the panel is suppressed there anyway).
  const { kind: pageKind, ctx: pageCtx } = useMemo(
    () => derivePageContext(pathname),
    [pathname],
  );
  const send = useCallback<typeof ag.send>(
    (content, opts) => ag.send(content, { ...opts, pageContext: pageCtx }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ag.send, pageCtx],
  );

  function newChat() {
    ag.reset();
    setComposerValue('');
    setKbHits([]);
    setKbDismissed(false);
    setResolvedThisTurn(false);
    composerApiRef.current?.resetStaging();
    composerRef.current?.focus();
  }

  function expand() {
    const target = ag.conversationId
      ? `/ask-gg?c=${encodeURIComponent(ag.conversationId)}`
      : '/ask-gg';
    setOpen(false);
    router.push(target);
  }

  // Guide-tab CTA → stage the question in the composer and switch to Chat
  // (nothing sends until the user does). Empty prompt = just open the chat.
  function guideAsk(prompt: string) {
    setTab('chat');
    if (prompt) setComposerValue(prompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  // Guide-tab deep-link → close the panel and navigate. Internal paths only.
  function guideNavigate(href: string) {
    if (!href.startsWith('/')) return;
    setOpen(false);
    router.push(href);
  }

  const lastMsg = ag.messages[ag.messages.length - 1];
  const showResolvePrompt =
    isSignedIn === true &&
    !ag.sending &&
    !resolvedThisTurn &&
    lastMsg?.role === 'assistant' &&
    lastMsg.content.length > 0;

  // Compact starter chips — contextual by page kind (W4), generic trio
  // everywhere else.
  const starterChips = (
    CONTEXTUAL_STARTER_PROMPTS[pageKind] ?? GENERIC_STARTER_PROMPTS
  ).slice(0, 3);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className="fixed inset-0 z-[74] transition-opacity duration-200 motion-reduce:transition-none"
        style={{
          background: 'rgba(0,0,0,0.55)',
          opacity: entered ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          visibility: open || entered ? 'visible' : 'hidden',
        }}
      />
      {/* Panel — bottom sheet on mobile, right drawer on desktop */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Ask GG assistant"
        className={[
          'fixed z-[75] bg-[var(--bg-card)] flex flex-col',
          'left-0 right-0 bottom-0 max-h-[88dvh] rounded-t-[16px]',
          'md:left-auto md:top-0 md:right-0 md:bottom-0 md:h-full md:w-[420px] md:max-h-none md:rounded-none',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          entered
            ? 'translate-y-0 md:translate-x-0'
            : 'translate-y-full md:translate-y-0 md:translate-x-full',
        ].join(' ')}
        style={{
          borderLeft: '0.5px solid var(--border)',
          borderTop: '0.5px solid var(--border)',
          visibility: open || entered ? 'visible' : 'hidden',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {/* Header */}
        <div
          className="app-chrome flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}
        >
          <span
            className="flex items-center gap-2 text-sm"
            style={{ color: 'var(--text-primary)', fontWeight: 600 }}
          >
            <span style={{ color: 'var(--red)', display: 'inline-flex' }}>
              <AskGgMascot size={22} mood={mascotMood} />
            </span>
            Ask GG
          </span>
          <span className="flex items-center gap-1">
            {isSignedIn && ag.messages.length > 0 && (
              <button
                type="button"
                onClick={newChat}
                aria-label="New chat"
                title="New chat"
                style={headerBtnStyle}
              >
                <IconPlus />
              </button>
            )}
            <button
              type="button"
              onClick={expand}
              aria-label="Open full Ask GG page"
              title="Open full page (Load Lab, history)"
              style={{ ...headerBtnStyle, fontSize: 13, width: 'auto', padding: '4px 8px' }}
            >
              Expand ↗
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Ask GG"
              style={headerBtnStyle}
            >
              <IconX />
            </button>
          </span>
        </div>

        {/* Tab bar — Guide (server-driven, $0 AI) vs Chat */}
        <div
          className="app-chrome flex"
          style={{ borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}
        >
          {(['guide', 'chat'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-selected={tab === t}
              style={{
                flex: 1,
                padding: '9px 0',
                background: 'none',
                border: 'none',
                borderBottom:
                  tab === t ? '2px solid var(--red)' : '2px solid transparent',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontWeight: tab === t ? 600 : 500,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t === 'guide' ? 'Guide' : 'Chat'}
            </button>
          ))}
        </div>

        {tab === 'guide' && (
          <GuideView
            path={pathname}
            listingId={pageCtx.listingId}
            active={open}
            onAsk={guideAsk}
            onNavigate={guideNavigate}
          />
        )}

        {/* Body — Chat tab */}
        {tab === 'chat' &&
          (!isLoaded ? null : !isSignedIn ? (
          <div style={{ overflowY: 'auto' }}>
            <AskGgSignedOut />
          </div>
        ) : (
          <>
            {!disclaimerAccepted && open && (
              <AskGgDisclaimer
                onAccept={acceptDisclaimer}
                onDecline={() => setOpen(false)}
              />
            )}
            <ChatThread
              messages={ag.messages}
              sending={ag.sending}
              error={ag.error}
              onEscalate={(content) => void send(content, { escalate: true })}
              emptySlot={
                <div style={{ padding: '18px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Ask me anything — the site, your orders, or the outdoors.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {starterChips.map((s) => (
                      <button
                        key={s.title}
                        type="button"
                        onClick={() => {
                          setComposerValue(s.prompt);
                          composerRef.current?.focus();
                        }}
                        style={{
                          padding: '7px 12px',
                          fontSize: 12,
                          background: 'var(--bg-card)',
                          color: 'var(--text-secondary)',
                          border: '0.5px solid var(--border)',
                          borderRadius: 999,
                          cursor: 'pointer',
                        }}
                      >
                        {s.title}
                      </button>
                    ))}
                  </div>
                </div>
              }
            />

            {/* Footer chrome: resolve prompt, KB hits, quota, composer */}
            <div style={{ padding: '0 12px 12px', flexShrink: 0 }}>
              {showResolvePrompt && (
                <ResolvePrompt
                  onResolve={(outcome) => {
                    setResolvedThisTurn(true);
                    void ag.markResolved(outcome);
                  }}
                />
              )}
              {kbHits.length > 0 && !kbDismissed && (
                <KbHitsRow
                  hits={kbHits}
                  onHelpful={(id) => void ag.markKbHelpful(id)}
                  onDismiss={() => {
                    setKbDismissed(true);
                    setKbHits([]);
                  }}
                />
              )}
              {ag.fairUseCoolOff ? (
                <FairUseCard coolOff={ag.fairUseCoolOff} />
              ) : ag.tierGated ? (
                <UpgradeInlineNudge />
              ) : (
                <>
                  {ag.quota && ag.quota.tier === 'FREE' && (
                    <QuotaPill quota={ag.quota} />
                  )}
                  <Composer
                    ref={composerApiRef}
                    value={composerValue}
                    onValueChange={setComposerValue}
                    composerRef={composerRef}
                    sending={ag.sending}
                    tierGated={ag.tierGated}
                    fairUseCoolOff={ag.fairUseCoolOff}
                    quota={ag.quota}
                    uploadPhotos={ag.uploadPhotos}
                    send={send}
                    onBeforeSend={() => {
                      setKbHits([]);
                      setKbDismissed(false);
                    }}
                  />
                </>
              )}
            </div>
          </>
          ))}
        {/* Safe-area spacer for the mobile sheet */}
        <div style={{ height: 'env(safe-area-inset-bottom)', flexShrink: 0 }} />
      </aside>
    </>
  );
}

const headerBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-tertiary)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 8,
};
