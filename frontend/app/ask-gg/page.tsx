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
import {
  type AskGgQuota,
  type AskGgKbHit,
} from '@/lib/use-ask-gg';
import { useAskGgChat } from '@/lib/use-ask-gg-widget';
import { SubscriberRaffleWidget } from '@/components/subscriber-raffle-widget';
import { LoadLabPanel } from './load-lab/LoadLabPanel';
import {
  IconSparkles,
  IconPlus,
  IconHistory,
} from '@/components/ask-gg/icons';
import { ChatThread } from '@/components/ask-gg/chat-thread';
import { Composer, type ComposerHandle } from '@/components/ask-gg/composer';
import { KbHitsRow } from '@/components/ask-gg/kb-hits';
import { ResolvePrompt } from '@/components/ask-gg/resolve-prompt';
import {
  QuotaPill,
  UpgradeInlineNudge,
  FairUseCard,
} from '@/components/ask-gg/quota-chrome';
import {
  AskGgDisclaimer,
  useAskGgDisclaimer,
} from '@/components/ask-gg/disclaimer';
import { GENERIC_STARTER_PROMPTS } from '@/components/ask-gg/starter-prompts';

// P1.1 — live tier pricing for the perks table (public endpoint).
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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
  // Shared instance from AskGgProvider — the SAME conversation state the
  // site-wide panel (W3) uses, so a thread started anywhere continues here.
  const ag = useAskGgChat();
  const [composerValue, setComposerValue] = useState('');
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerApiRef = useRef<ComposerHandle | null>(null);
  const router = useRouter();

  // First-visit gate: an 18+ / liability disclaimer that must be accepted
  // before Ask GG is usable (localStorage-persisted; see useAskGgDisclaimer).
  const { accepted: disclaimerAccepted, accept: acceptDisclaimer } =
    useAskGgDisclaimer();

  // Expand-from-panel deep link (?c=<conversationId>) — load that thread on
  // mount when it isn't already the active one. Reads window.location.search
  // directly (not useSearchParams) so this page needs no Suspense boundary.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    try {
      const c = new URLSearchParams(window.location.search).get('c');
      if (c && c !== ag.conversationId) void ag.loadConversation(c);
    } catch {
      // malformed URL — ignore, fresh thread stands
    }
    // Run once per signed-in mount; conversationId is deliberately not a
    // dep (it changes as the user chats and must not re-trigger the load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);
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
    composerApiRef.current?.resetStaging();
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
              Your outdoor &amp; firearms assistant
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
          <ChatThread
            messages={ag.messages}
            sending={ag.sending}
            error={ag.error}
            onEscalate={handleEscalate}
            emptySlot={
              !ag.historyLoading ? (
                <EmptyState
                  quota={ag.quota}
                  onPickPrompt={(text) => {
                    setComposerValue(text);
                    startChat();
                  }}
                />
              ) : undefined
            }
          />

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
              canMarkHelpful
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

          {/* Composer — pinned to the bottom of the chat area. Photo
              staging + the upload-then-send orchestration live inside
              the component; the page supplies the hook functions and
              gating state. */}
          <Composer
            ref={composerApiRef}
            composerRef={composerRef}
            value={composerValue}
            onValueChange={setComposerValue}
            sending={ag.sending}
            tierGated={ag.tierGated}
            fairUseCoolOff={ag.fairUseCoolOff}
            quota={ag.quota}
            uploadPhotos={ag.uploadPhotos}
            send={ag.send}
            onBeforeSend={() => {
              // Phase C — sending clears the staged KB hits AND resets
              // the dismissed flag so future typing surfaces fresh
              // suggestions.
              setKbHits([]);
              setKbDismissed(false);
            }}
          />
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

function EmptyState({
  quota,
  onPickPrompt,
}: {
  quota: AskGgQuota | null;
  onPickPrompt: (text: string) => void;
}) {
  const isFreeWithRemaining = quota?.tier === 'FREE' && quota.remaining > 0;
  const [hovered, setHovered] = useState<number | null>(null);
  // Tile data lives in components/ask-gg/starter-prompts.ts (shared
  // with the future site-wide chat panel).
  const USES = GENERIC_STARTER_PROMPTS;
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

      <p
        style={{
          textAlign: 'center',
          margin: '18px 0 0',
          fontSize: 11,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Tap a topic to start — or just type below
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
          margin: '10px auto 0',
          maxWidth: 700,
        }}
      >
        {USES.map((u, i) => {
          const hot = hovered === i;
          return (
            <button
              key={u.title}
              type="button"
              onClick={() => onPickPrompt(u.prompt)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              style={{
                textAlign: 'left',
                background: hot ? 'var(--bg-card)' : 'var(--bg-inset)',
                border: `0.5px solid ${hot ? 'var(--red)' : 'var(--border)'}`,
                borderRadius: 10,
                padding: '11px 13px',
                cursor: 'pointer',
                transition:
                  'background 120ms, border-color 120ms, transform 120ms',
                transform: hot ? 'translateY(-1px)' : 'none',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  {u.title}
                </span>
                <span
                  aria-hidden
                  style={{
                    fontSize: 13,
                    color: hot ? 'var(--red)' : 'var(--text-tertiary)',
                    transition: 'color 120ms, transform 120ms',
                    transform: hot ? 'translateX(2px)' : 'none',
                  }}
                >
                  →
                </span>
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color: 'var(--text-tertiary)',
                  marginTop: 2,
                }}
              >
                {u.desc}
              </div>
            </button>
          );
        })}
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

/** 3-column FREE / MEMBER / PRO perks comparison. Rendered on the
 *  signed-out + FREE-tier-exhausted cards so prospects (and capped
 *  free users) can see exactly what they'd get by signing up /
 *  upgrading. Prices are fetched live from /subscriptions/pricing
 *  (P1.1 — self-serve prepaid EFT subscriptions are LIVE); each paid
 *  tier links to /subscribe.
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
  const [prices, setPrices] = useState<{
    memberCents: number;
    proCents: number;
  } | null>(null);
  const [pricesFailed, setPricesFailed] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/subscriptions/pricing`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { memberCents: number; proCents: number } | null) =>
        p ? setPrices(p) : setPricesFailed(true),
      )
      .catch(() => setPricesFailed(true));
  }, []);
  const rand = (cents: number) => `R${Math.round(cents / 100)}/mo`;
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
    {
      key: 'MEMBER',
      label: 'Member',
      price: prices ? rand(prices.memberCents) : pricesFailed ? 'See /subscribe' : '…',
      accent: false,
    },
    {
      key: 'PRO',
      label: 'Pro',
      price: prices ? rand(prices.proCents) : pricesFailed ? 'See /subscribe' : '…',
      accent: true,
    },
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

            {/* P1.1 — paid tiers are self-serve now (prepaid EFT). */}
            {t.key !== 'FREE' && !isCurrent && (
              <Link
                href="/subscribe"
                style={{
                  display: 'block',
                  marginTop: 12,
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: t.accent ? 'var(--red)' : 'transparent',
                  color: t.accent ? '#fff' : 'var(--red)',
                  border: t.accent
                    ? 'none'
                    : '0.5px solid rgba(200,16,46,0.40)',
                }}
              >
                Get {t.label}
              </Link>
            )}
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

