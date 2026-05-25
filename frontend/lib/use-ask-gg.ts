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

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type AskGgRole = 'user' | 'assistant';

/** A reloading-manual page-fetch Claude performed while answering.
 *  Rendered as a citation chip below the assistant message so the
 *  user can verify the answer against the source PDF. */
export interface AskGgCitation {
  manualId: string;
  manufacturer: string;
  title: string;
  edition: string | null;
  pages: number[];
}

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
  /** When true, this message is the optimistic pre-post placeholder
   *  for the user's just-typed input. Rendered with a subtle muted
   *  state until the server confirms it. */
  pending?: boolean;
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
}

export interface AskGgFairUseCoolOff {
  retryAfterSec: number;
  windowResetsAt: string;
  cap: number;
}

interface SendResponse {
  conversationId: string;
  isNew: boolean;
  userMessage: { id: string; role: 'user'; content: string };
  assistantMessage: {
    id: string;
    role: 'assistant';
    content: string;
    model: string | null;
    citations?: AskGgCitation[] | null;
  };
}

export interface UseAskGg {
  /** Current conversation's messages (oldest → newest). */
  messages: AskGgUiMessage[];
  /** ID of the active conversation. Null until the first send. */
  conversationId: string | null;
  /** True while a send is in flight (button spinner). */
  sending: boolean;
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
  send: (content: string, escalate?: boolean) => Promise<void>;
  /** Wipe local conversation state and start a fresh thread. Does
   *  NOT clear quota / tierGated / coolOff (those are server-truth). */
  reset: () => void;
}

interface QuotaResponseBody {
  tier: 'FREE' | 'MEMBER' | 'PRO';
  used: number;
  cap: number;
  remaining: number;
  windowResetsAt: string;
  windowLengthMs: number;
}

interface QuotaExhaustedBody {
  message?: string;
  code?: string;
  windowResetsAt?: string;
  cap?: number;
  used?: number;
  retryAfterSec?: number;
}

export function useAskGg(): UseAskGg {
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
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void refreshQuota();
  }, [isLoaded, isSignedIn, refreshQuota]);

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

  const send = useCallback(
    async (content: string, escalate?: boolean) => {
      const trimmed = content.trim();
      if (!trimmed || sending || tierGated || fairUseCoolOff) return;
      setError(null);

      // Optimistic user message — shows immediately, gets replaced
      // when the server confirms.
      const optimisticId = `local-${Date.now()}`;
      const optimisticUser: AskGgUiMessage = {
        id: optimisticId,
        role: 'user',
        content: trimmed,
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
        const r = await fetch(`${API_URL}/ask-gg/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            conversationId,
            content: trimmed,
            escalate: escalate ?? false,
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
        const data = (await r.json()) as SendResponse;
        setConversationId(data.conversationId);
        // Replace the optimistic user with the confirmed user +
        // append the assistant reply.
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          {
            id: data.userMessage.id,
            role: 'user',
            content: data.userMessage.content,
          },
          {
            id: data.assistantMessage.id,
            role: 'assistant',
            content: data.assistantMessage.content,
            model: data.assistantMessage.model ?? undefined,
            citations: data.assistantMessage.citations ?? undefined,
          },
        ]);
        // Refresh the quota so the "N left" pill updates immediately
        // for FREE users. Best-effort — silent on failure.
        void refreshQuota();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
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
    // tierGated / quota / fairUseCoolOff are intentionally NOT reset
    // — they reflect server state, not conversation state.
  }, []);

  return {
    messages,
    conversationId,
    sending,
    tierGated,
    quota,
    quotaLoading,
    fairUseCoolOff,
    error,
    send,
    reset,
  };
}
