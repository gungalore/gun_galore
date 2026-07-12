'use client';

// useAskGg — client hook for the Ask GG chat surface.
//
// State machine:
//   - On mount (signed-in only): fetches /ask-gg/quota so the page
//     can pick the right empty-state and the composer can render the
//     "N free messages left" pill for FREE users.
//   - send(content, escalate?) appends a user message optimistically,
//     posts to /api/ask-gg/messages, replaces the optimistic message
//     with the persisted one + appends the assistant reply, and
//     refreshes the quota.
//   - On 403 with code 'free-quota-exhausted' (FREE tier hit 5/month):
//     flips `tierGated = true` so the page swaps the chat for the
//     upgrade card. The post is not retried.
//   - On 429 with code 'fair-use-pause' (MEMBER/PRO hit hourly cap):
//     stamps `fairUseCoolOff` with retry-after — the page shows a
//     "Quick break — back in N min" card with a live countdown.
//
// Sign-in is enforced by ClerkGuard on the backend. The hook bails
// early when there's no Clerk session.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// localStorage key holding the id of the user's most-recent active
// conversation, so a page refresh / return rehydrates the thread
// (messages + citation chips) instead of dropping it. Cleared on reset.
const LAST_CONVERSATION_KEY = 'askgg:lastConversationId';

export type AskGgRole = 'user' | 'assistant';

/** A source Ask GG used while answering, rendered as a citation chip
 *  below the assistant message so the user can verify. Two kinds:
 *   - manual (default): a reloading-manual page fetch — manualId/
 *     manufacturer/edition/pages set; rendered as a plain chip.
 *   - web: a forum/maker source from web search — url + title set;
 *     rendered as a clickable link.
 *  Manual fields are optional so web citations don't carry them; older
 *  stored rows without `sourceType` are treated as manual. */
export interface AskGgCitation {
  sourceType?: 'manual' | 'web';
  manualId?: string;
  manufacturer?: string;
  title: string;
  edition?: string | null;
  pages?: number[];
  url?: string;
}

/** P2.2 — a live marketplace listing the answer surfaced via
 *  searchMarketplace / getComplements. Rendered as a tappable card
 *  under the assistant message, linking to /listings/:id. */
export interface AskGgListingCard {
  id: string;
  referenceNumber?: string | null;
  title: string;
  priceCents?: number | null;
  listingType?: string;
  condition?: string | null;
  province?: string | null;
  categoryName?: string | null;
  isFirearm?: boolean;
  imageUrl?: string | null;
  sellerUsername?: string | null;
}

/** A verified KB entry surfaced by the search-first flow. Rendered
 *  as a card above the composer while the user is typing — clicking
 *  "This helped" expands the full answer + bumps usefulCount, no
 *  Claude call made. (Phase C search-first.) */
export interface AskGgKbHit {
  id: string;
  title: string;
  answer: string;
  snippet: string;
  category: string | null;
  usefulCount: number;
  rank: number;
}

export type AskGgConversationOutcome =
  | 'RESOLVED'
  | 'UNRESOLVED'
  | 'ABANDONED';

export interface AskGgUiMessage {
  /** Local-only ID for optimistic messages; replaced with the
   *  server-side ID once the post resolves. */
  id: string;
  role: AskGgRole;
  content: string;
  model?: string;
  /** Reloading-manual citations attached to this assistant message
   *  (always empty / undefined for user messages). */
  citations?: AskGgCitation[];
  /** P2.2 — live marketplace listings the answer surfaced. Rendered as
   *  tappable cards under the assistant bubble. */
  listingCards?: AskGgListingCard[];
  /** W6 — support-ticket DRAFT staged by the assistant. Rendered as a
   *  prefilled card; the ticket only exists once the user taps Create. */
  ticketDraft?: AskGgTicketDraft;
  /** Phase B — Cloudinary URLs of photos the user attached to this
   *  message (always empty / undefined for assistant messages).
   *  Rendered as inline thumbnails inside the user bubble. */
  imageUrls?: string[];
  /** When true, this message is the optimistic pre-post placeholder
   *  for the user's just-typed input. Rendered with a subtle muted
   *  state until the server confirms it. */
  pending?: boolean;
}

/** W6 — a support-ticket draft (never auto-sent). */
export interface AskGgTicketDraft {
  subject: string;
  category: string;
  body: string;
  transactionId?: string;
}

export interface AskGgQuota {
  tier: 'FREE' | 'MEMBER' | 'PRO';
  used: number;
  cap: number;
  remaining: number;
  /** ISO timestamp when the oldest message in the active window
   *  ages out (FREE → +30d; MEMBER/PRO → +1h). */
  windowResetsAt: string;
  /** Length of the active window in ms (30d / 1h). Lets the frontend
   *  format the right copy ("this month" vs "this hour"). */
  windowLengthMs: number;
  /** Phase B — separate photo-ID counter. FREE caps at 5/30d; MEMBER
   *  and PRO are unlimited (only the hourly message cap applies). */
  photos: AskGgPhotoQuota;
  /** W6 two-lane quota — the FREE support lane's per-day abuse meter.
   *  Optional so the UI degrades gracefully against an older backend. */
  support?: { usedToday: number; capPerDay: number; remaining: number };
}

export interface AskGgPhotoQuota {
  tier: 'FREE' | 'MEMBER' | 'PRO';
  used: number;
  cap: number;
  remaining: number;
  /** True for MEMBER + PRO — no photo cap, just the hourly message
   *  rate. Frontend uses this to hide the "N left" pill on paid tiers. */
  unlimited: boolean;
}

export interface AskGgFairUseCoolOff {
  retryAfterSec: number;
  windowResetsAt: string;
  cap: number;
}

interface SendResponse {
  conversationId: string;
  isNew: boolean;
  userMessage: {
    id: string;
    role: 'user';
    content: string;
    imageUrls?: string[];
  };
  assistantMessage: {
    id: string;
    role: 'assistant';
    content: string;
    model: string | null;
    citations?: AskGgCitation[] | null;
  };
}

/** Server-Sent-Event payloads from POST /ask-gg/messages/stream. */
type StreamEvent =
  | {
      type: 'meta';
      conversationId: string;
      isNew: boolean;
      userMessage: {
        id: string;
        role: 'user';
        content: string;
        imageUrls?: string[];
      };
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      assistantMessage: {
        id: string;
        role: 'assistant';
        content: string;
        model: string | null;
        citations?: AskGgCitation[] | null;
        listingCards?: AskGgListingCard[] | null;
        ticketDraft?: AskGgTicketDraft | null;
      };
    }
  | { type: 'error'; message?: string };

/** Shape of GET /ask-gg/conversations/:id — a conversation plus all
 *  its persisted messages (oldest → newest), used to rehydrate a thread
 *  on reload. citations come back as the raw JSON the backend stored. */
interface ConversationMessageRow {
  id: string;
  role: AskGgRole;
  content: string;
  imageUrls?: string[] | null;
  model?: string | null;
  citations?: AskGgCitation[] | null;
  listingCards?: AskGgListingCard[] | null;
  ticketDraft?: AskGgTicketDraft | null;
  createdAt?: string;
}

interface ConversationResponse {
  id: string;
  title?: string | null;
  outcome?: AskGgConversationOutcome | null;
  messages: ConversationMessageRow[];
}

/** One row in the last-10 history picker. */
export interface AskGgHistoryItem {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface UseAskGg {
  /** Current conversation's messages (oldest → newest). */
  messages: AskGgUiMessage[];
  /** ID of the active conversation. Null until the first send (or until
   *  a past conversation is rehydrated on mount). */
  conversationId: string | null;
  /** True while a send is in flight (button spinner). */
  sending: boolean;
  /** True while a past conversation is being rehydrated (on mount or
   *  via loadConversation). Lets the page suppress the empty-state so
   *  it doesn't flash "ask me anything" before history paints. */
  historyLoading: boolean;
  /** Load a past conversation by id and replace the current thread
   *  (messages + citations) with it. Returns false when it couldn't be
   *  loaded (404 / not owned / network). Used to rehydrate the last
   *  active thread on mount and by any future history picker. */
  loadConversation: (id: string) => Promise<boolean>;
  /** True if the backend says the FREE tier has hit its 5/month
   *  cap. Caller swaps the composer for an upgrade card. Sticky for
   *  the rest of the session — re-checked on mount via the quota
   *  endpoint so a fresh page-load reflects reality. */
  tierGated: boolean;
  /** Current quota snapshot for the signed-in user. Null while it
   *  hasn't loaded yet (or for signed-out users). */
  quota: AskGgQuota | null;
  /** True while the initial quota fetch is in flight. */
  quotaLoading: boolean;
  /** Non-null when a MEMBER / PRO user has hit their fair-use cap.
   *  The page renders a friendly cool-off card; cleared by the
   *  countdown when the window resets. */
  fairUseCoolOff: AskGgFairUseCoolOff | null;
  /** Last error message, if any. Cleared on next successful send. */
  error: string | null;
  send: (
    content: string,
    opts?: {
      escalate?: boolean;
      imageUrls?: string[];
      /** W4 — page context from the site-wide panel. Only leaves the
       *  browser when NEXT_PUBLIC_ASKGG_CONTEXT is on; the backend
       *  re-verifies everything server-side. */
      pageContext?: AskGgPageContext;
    },
  ) => Promise<void>;
  /** Phase B — upload 1-5 photos to Cloudinary via the backend. Used
   *  by the composer before calling send() with the returned URLs. */
  uploadPhotos: (files: File[]) => Promise<string[]>;
  /** Phase C — search the verified KB. Used by the composer's
   *  debounced search-as-you-type to surface cached answers BEFORE
   *  the user spends a message on Claude. */
  searchKb: (q: string) => Promise<AskGgKbHit[]>;
  /** Phase C — user clicked "This helped" on a KB card. Bumps the
   *  entry's usefulCount on the server (cheap counter; admin uses
   *  it to prioritise high-value entries vs archive dead weight). */
  markKbHelpful: (entryId: string) => Promise<void>;
  /** Phase C — user answered the "did this solve it?" prompt on
   *  the latest assistant turn. RESOLVED auto-creates a DRAFT KB
   *  entry for the admin queue. */
  markResolved: (outcome: AskGgConversationOutcome) => Promise<void>;
  /** Wipe local conversation state and start a fresh thread. Does
   *  NOT clear quota / tierGated / coolOff (those are server-truth). */
  reset: () => void;
  /** The user's last 10 conversations (most recent first) for the
   *  history picker. Refreshed on mount and after each send. */
  history: AskGgHistoryItem[];
  /** Re-fetch the history list from the server. */
  refreshHistory: () => Promise<void>;
}

interface QuotaResponseBody {
  tier: 'FREE' | 'MEMBER' | 'PRO';
  used: number;
  cap: number;
  remaining: number;
  windowResetsAt: string;
  windowLengthMs: number;
  photos: AskGgPhotoQuota;
}

interface QuotaExhaustedBody {
  message?: string;
  code?: string;
  windowResetsAt?: string;
  cap?: number;
  used?: number;
  retryAfterSec?: number;
}

// W4 flag — page context rides the send body only once the backend
// accepts it (older backends must never see the field). Omit, not null.
const CONTEXT_ENABLED = process.env.NEXT_PUBLIC_ASKGG_CONTEXT === 'true';

/** Client-derived page context sent (flag-gated) with each message so the
 *  assistant knows what the user is looking at. Server re-verifies and
 *  enriches — this is a hint, never trusted data. */
export interface AskGgPageContext {
  path: string;
  listingId?: string;
  transactionId?: string;
  orderId?: string;
  categorySlug?: string;
}

export function useAskGg(
  options: {
    /** Ask GG Everywhere: the provider hosts ONE hook instance globally.
     *  Until the user opens the panel (or is on /ask-gg), `enabled:false`
     *  keeps the hook INERT — no mount-time quota/history fetches on
     *  every page load site-wide. Defaults true (standalone page use). */
    enabled?: boolean;
  } = {},
): UseAskGg {
  const enabled = options.enabled !== false;
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [messages, setMessages] = useState<AskGgUiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [tierGated, setTierGated] = useState(false);
  const [quota, setQuota] = useState<AskGgQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [fairUseCoolOff, setFairUseCoolOff] =
    useState<AskGgFairUseCoolOff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Last-10 conversations for the history picker.
  const [history, setHistory] = useState<AskGgHistoryItem[]>([]);
  // Guards the once-per-mount setup (fresh thread + history fetch).
  const hydratedRef = useRef(false);
  const prevSendingRef = useRef(false);

  /** Fetch + apply the latest quota snapshot. Quietly fails if the
   *  user is signed-out, the token is unavailable, or the backend
   *  is on an older version that lacks the endpoint. */
  const refreshQuota = useCallback(async () => {
    if (!isSignedIn) return;
    setQuotaLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`${API_URL}/ask-gg/quota`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!r.ok) return; // older backend → endpoint missing, silent
      const data = (await r.json()) as QuotaResponseBody;
      setQuota(data);
      // Preemptive tier-gate: if FREE has used all 5 in the past
      // 30 days, flip the gate so the user sees the upgrade card
      // immediately rather than typing a message just to be 403'd.
      if (data.tier === 'FREE' && data.remaining === 0) {
        setTierGated(true);
      } else {
        setTierGated(false);
      }
    } catch {
      // Network blip — keep prior quota.
    } finally {
      setQuotaLoading(false);
    }
  }, [getToken, isSignedIn]);

  // Initial quota fetch once Clerk has loaded and the user is signed in.
  // Gated on `enabled` so the globally-mounted provider instance stays
  // silent until the widget is actually opened (fires on flip to true).
  useEffect(() => {
    if (!enabled || !isLoaded || !isSignedIn) return;
    void refreshQuota();
  }, [enabled, isLoaded, isSignedIn, refreshQuota]);

  // Fair-use cool-off countdown — automatically clears the cool-off
  // state when the window ends so the composer becomes usable again.
  useEffect(() => {
    if (!fairUseCoolOff) return;
    const ms = Math.max(0, fairUseCoolOff.retryAfterSec * 1000);
    const t = setTimeout(() => {
      setFairUseCoolOff(null);
      void refreshQuota();
    }, ms);
    return () => clearTimeout(t);
  }, [fairUseCoolOff, refreshQuota]);

  /** Load a past conversation by id, mapping persisted messages (and
   *  their stored citations) into the UI and making it the active
   *  thread. Returns false on 404 / not-owned / network so callers can
   *  clear a stale id. */
  const loadConversation = useCallback(
    async (id: string): Promise<boolean> => {
      if (!isSignedIn || !id) return false;
      setHistoryLoading(true);
      try {
        const token = await getToken();
        if (!token) return false;
        const r = await fetch(`${API_URL}/ask-gg/conversations/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!r.ok) return false; // 404 (deleted / not owned) etc.
        const data = (await r.json()) as ConversationResponse;
        const mapped: AskGgUiMessage[] = (data.messages ?? []).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          model: m.model ?? undefined,
          citations: Array.isArray(m.citations) ? m.citations : undefined,
          listingCards: Array.isArray(m.listingCards)
            ? m.listingCards
            : undefined,
          ticketDraft: m.ticketDraft ?? undefined,
          imageUrls:
            m.imageUrls && m.imageUrls.length > 0 ? m.imageUrls : undefined,
        }));
        setMessages(mapped);
        setConversationId(data.id);
        return true;
      } catch {
        return false;
      } finally {
        setHistoryLoading(false);
      }
    },
    [getToken, isSignedIn],
  );

  /** Re-fetch the last-10 conversation list for the history picker. */
  const refreshHistory = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`${API_URL}/ask-gg/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!r.ok) return;
      const rows = (await r.json()) as AskGgHistoryItem[];
      setHistory(Array.isArray(rows) ? rows.slice(0, 10) : []);
    } catch {
      // history is a nicety — never surface an error for it
    }
  }, [getToken, isSignedIn]);

  // Persist the active conversation id so a refresh / return can
  // rehydrate the thread. Only writes non-null ids; reset() clears it.
  useEffect(() => {
    if (typeof window === 'undefined' || !conversationId) return;
    try {
      window.localStorage.setItem(LAST_CONVERSATION_KEY, conversationId);
    } catch {
      // private mode / storage disabled — degrade to no-persistence
    }
  }, [conversationId]);

  // On first ENABLE (signed-in): open a FRESH thread — we intentionally
  // do NOT auto-restore the last conversation. The last 10 conversations are
  // reachable via the history picker instead. Just prime the history list.
  // hydratedRef makes this once-per-mount even as `enabled` toggles.
  useEffect(() => {
    if (!enabled || !isLoaded || !isSignedIn || hydratedRef.current) return;
    hydratedRef.current = true;
    void refreshHistory();
  }, [enabled, isLoaded, isSignedIn, refreshHistory]);

  // Refresh the history list each time a send completes (a new conversation
  // may have been created, or an existing one bumped to the top).
  useEffect(() => {
    if (prevSendingRef.current && !sending) void refreshHistory();
    prevSendingRef.current = sending;
  }, [sending, refreshHistory]);

  const send = useCallback(
    async (
      content: string,
      opts: {
        escalate?: boolean;
        imageUrls?: string[];
        /** W4: what page the user is on — included in the POST body only
         *  when NEXT_PUBLIC_ASKGG_CONTEXT is on AND a context is given. */
        pageContext?: AskGgPageContext;
      } = {},
    ) => {
      const trimmed = content.trim();
      const imageUrls = opts.imageUrls ?? [];
      // Allow photo-only sends (no text). Reject only when truly empty.
      if (
        (!trimmed && imageUrls.length === 0) ||
        sending ||
        tierGated ||
        fairUseCoolOff
      ) {
        return;
      }
      setError(null);

      // Optimistic user message — shows immediately, gets replaced
      // when the server confirms.
      const optimisticId = `local-${Date.now()}`;
      // The assistant bubble that fills in as tokens stream.
      const streamId = `stream-${optimisticId}`;
      const optimisticUser: AskGgUiMessage = {
        id: optimisticId,
        role: 'user',
        content: trimmed,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        pending: true,
      };
      setMessages((prev) => [...prev, optimisticUser]);
      setSending(true);

      try {
        const token = await getToken();
        if (!token) {
          setError('Sign in first.');
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          return;
        }
        const r = await fetch(`${API_URL}/ask-gg/messages/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            conversationId,
            content: trimmed,
            escalate: opts.escalate ?? false,
            imageUrls,
            // W4 flag-gated: older backends must never receive the field
            // (omitted entirely when the flag is off or no context given).
            ...(CONTEXT_ENABLED && opts.pageContext
              ? { pageContext: opts.pageContext }
              : {}),
          }),
        });

        // 403 → either the FREE-tier 5/month quota is exhausted
        // (code 'free-quota-exhausted') OR the legacy "must be
        // paid tier" gate (code 'subscription-tier-required',
        // kept for older backend versions). Both → upgrade card.
        if (r.status === 403) {
          const body = (await r.json().catch(() => null)) as
            | QuotaExhaustedBody
            | { message?: { message?: string; code?: string } }
            | null;
          // Nest wraps the ForbiddenException body in `{ message: {...} }`
          // for non-string causes; unwrap to read code/cap/etc.
          const inner =
            body && typeof (body as { message?: unknown }).message === 'object'
              ? ((body as { message: QuotaExhaustedBody }).message)
              : (body as QuotaExhaustedBody | null);
          setTierGated(true);
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          if (inner?.message && typeof inner.message === 'string') {
            // Surface the server-supplied human copy in case the
            // upgrade card has a fallback slot for it later.
            setError(null);
          }
          void refreshQuota();
          return;
        }

        // 429 → MEMBER/PRO fair-use cap. Show cool-off card with
        // live countdown; the composer is disabled until it clears.
        if (r.status === 429) {
          const body = (await r.json().catch(() => null)) as
            | QuotaExhaustedBody
            | { message?: QuotaExhaustedBody }
            | null;
          const inner =
            body && typeof (body as { message?: unknown }).message === 'object'
              ? ((body as { message: QuotaExhaustedBody }).message)
              : (body as QuotaExhaustedBody | null);
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          setFairUseCoolOff({
            retryAfterSec: inner?.retryAfterSec ?? 60,
            windowResetsAt:
              inner?.windowResetsAt ?? new Date(Date.now() + 60_000).toISOString(),
            cap: inner?.cap ?? 0,
          });
          void refreshQuota();
          return;
        }

        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as {
            message?: string;
          } | null;
          setError(body?.message ?? `Send failed (${r.status})`);
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          return;
        }
        // ── Stream the answer (SSE) ──────────────────────────────────
        // Backend streams: meta (conversation id + confirmed user
        // message) → many delta (answer text, incl. the heads-up line
        // for deep forum answers) → done (persisted assistant message +
        // citations). Tokens render live, so the experience is seamless
        // and the connection never idle-times-out.
        if (!r.body) {
          setError('Streaming not supported here — try again.');
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          return;
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamStarted = false;

        const handleEvent = (evt: StreamEvent) => {
          if (evt.type === 'meta') {
            streamStarted = true;
            setConversationId(evt.conversationId);
            // Swap the optimistic user for the confirmed one + add an
            // empty assistant bubble that fills as tokens arrive.
            setMessages((prev) => [
              ...prev.filter((m) => m.id !== optimisticId),
              {
                id: evt.userMessage.id,
                role: 'user',
                content: evt.userMessage.content,
                imageUrls:
                  evt.userMessage.imageUrls &&
                  evt.userMessage.imageUrls.length > 0
                    ? evt.userMessage.imageUrls
                    : undefined,
              },
              { id: streamId, role: 'assistant', content: '', pending: true },
            ]);
          } else if (evt.type === 'delta') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId ? { ...m, content: m.content + evt.text } : m,
              ),
            );
          } else if (evt.type === 'done') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? {
                      id: evt.assistantMessage.id,
                      role: 'assistant',
                      content: evt.assistantMessage.content,
                      model: evt.assistantMessage.model ?? undefined,
                      citations: evt.assistantMessage.citations ?? undefined,
                      listingCards:
                        evt.assistantMessage.listingCards ?? undefined,
                      ticketDraft:
                        evt.assistantMessage.ticketDraft ?? undefined,
                    }
                  : m,
              ),
            );
          } else if (evt.type === 'error') {
            setError(evt.message ?? 'Something went wrong.');
            setMessages((prev) => prev.filter((m) => m.id !== streamId));
          }
        };

        // Read the SSE stream, dispatching each `data: {json}` event
        // (events are separated by a blank line) as it arrives.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sep).trim();
            buffer = buffer.slice(sep + 2);
            if (!rawEvent.startsWith('data:')) continue;
            const json = rawEvent.slice(5).trim();
            if (!json) continue;
            try {
              handleEvent(JSON.parse(json) as StreamEvent);
            } catch {
              // skip a malformed chunk; keep streaming
            }
          }
        }

        // Stream closed before any meta (backend died at the start) —
        // clean up the optimistic bubble.
        if (!streamStarted) {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          setError((e) => e ?? 'No response — try again.');
        }
        // Refresh the quota so the "N left" pill updates immediately
        // for FREE users. Best-effort — silent on failure.
        void refreshQuota();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
        setMessages((prev) =>
          prev.filter((m) => m.id !== optimisticId && m.id !== streamId),
        );
      } finally {
        setSending(false);
      }
    },
    [
      conversationId,
      fairUseCoolOff,
      getToken,
      refreshQuota,
      sending,
      tierGated,
    ],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
    // Drop the persisted id so a fresh thread doesn't get clobbered by
    // the previous one on the next reload.
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(LAST_CONVERSATION_KEY);
      } catch {
        // ignore
      }
    }
    // tierGated / quota / fairUseCoolOff are intentionally NOT reset
    // — they reflect server state, not conversation state.
  }, []);

  /** Phase B — upload 1-5 photos to Cloudinary via POST /ask-gg/uploads.
   *  Returns the Cloudinary URLs. Caller passes them into send() via
   *  `opts.imageUrls`. Validates client-side first to avoid pointless
   *  round-trips for files the backend would reject. */
  const uploadPhotos = useCallback(
    async (files: File[]): Promise<string[]> => {
      if (files.length === 0) return [];
      if (files.length > 5) {
        throw new Error('Up to 5 photos per upload.');
      }
      for (const f of files) {
        if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
          throw new Error(`Unsupported file type: ${f.name}. JPG, PNG, WebP only.`);
        }
        if (f.size > 10 * 1024 * 1024) {
          throw new Error(`${f.name} is too large — 10 MB max per photo.`);
        }
      }
      const token = await getToken();
      if (!token) throw new Error('Sign in first.');
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const r = await fetch(`${API_URL}/ask-gg/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? `Upload failed (${r.status}).`);
      }
      const data = (await r.json()) as { urls: string[] };
      return data.urls;
    },
    [getToken],
  );

  /** Phase C — KB search. Public endpoint, no auth needed. Empty /
   *  short queries return []. Network errors swallow silently
   *  (search-as-you-type shouldn't surface error UI). */
  const searchKb = useCallback(async (q: string): Promise<AskGgKbHit[]> => {
    const trimmed = q.trim();
    if (trimmed.length < 5) return [];
    try {
      const r = await fetch(
        `${API_URL}/ask-gg/kb/search?q=${encodeURIComponent(trimmed)}`,
        { cache: 'no-store' },
      );
      if (!r.ok) return [];
      return (await r.json()) as AskGgKbHit[];
    } catch {
      return [];
    }
  }, []);

  /** Phase C — POST /ask-gg/kb/:id/helpful. Fire-and-forget. */
  const markKbHelpful = useCallback(
    async (entryId: string): Promise<void> => {
      try {
        const token = await getToken();
        if (!token) return;
        await fetch(`${API_URL}/ask-gg/kb/${entryId}/helpful`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // silent — UX continues regardless
      }
    },
    [getToken],
  );

  /** Phase C — mark the current conversation RESOLVED / UNRESOLVED
   *  / ABANDONED. RESOLVED triggers backend KB-draft creation
   *  automatically. No-op when there's no active conversation yet
   *  (you can't resolve nothing). */
  const markResolved = useCallback(
    async (outcome: AskGgConversationOutcome): Promise<void> => {
      if (!conversationId) return;
      try {
        const token = await getToken();
        if (!token) return;
        await fetch(
          `${API_URL}/ask-gg/conversations/${conversationId}/resolved`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ outcome }),
          },
        );
      } catch {
        // silent — user can mark again on next assistant turn
      }
    },
    [conversationId, getToken],
  );

  return {
    messages,
    conversationId,
    sending,
    historyLoading,
    loadConversation,
    tierGated,
    quota,
    quotaLoading,
    fairUseCoolOff,
    error,
    send,
    uploadPhotos,
    searchKb,
    markKbHelpful,
    markResolved,
    reset,
    history,
    refreshHistory,
  };
}
