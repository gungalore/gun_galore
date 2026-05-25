'use client';

// usePush — single source of truth for push-notification state +
// subscribe/unsubscribe actions.
//
// State tracked:
//   - supported:    can the browser do web push at all? (false on iOS
//                   in browser mode, false in older Firefox, etc.)
//   - standalone:   is this an installed PWA? iOS requires this for
//                   web push to work; we surface a different message
//                   when not.
//   - permission:   Notification.permission ('default' / 'granted' /
//                   'denied'). 'denied' is sticky — user has to flip
//                   it manually in browser settings.
//   - enabled:      true when there's an active subscription on this
//                   device AND the backend agrees we have one.
//   - busy:         a subscribe/unsubscribe call is in flight.
//   - vapidReady:   backend has VAPID configured (returned from
//                   /push/vapid-public-key). False → hide the opt-in
//                   UI entirely.
//
// Actions:
//   - enable():     requests permission, subscribes via pushManager,
//                   posts to backend. Returns true on success.
//   - disable():    unsubscribes locally + tells backend to drop
//                   the row.

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useStandalone } from './use-standalone';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface PushState {
  supported: boolean;
  standalone: boolean;
  permission: NotificationPermission | 'unsupported';
  enabled: boolean;
  busy: boolean;
  /** True when the backend has VAPID configured. Drives whether to
   * show the opt-in UI at all. */
  vapidReady: boolean;
  /** True once we've completed the initial state probe. UI shows a
   * placeholder until this is true to avoid flickering between
   * "Enable" and "Enabled" while we figure out which one applies. */
  ready: boolean;
  enable: () => Promise<boolean>;
  disable: () => Promise<void>;
}

// Standard Base64 (URL-safe) → Uint8Array. Required because the
// PushManager.subscribe applicationServerKey expects a raw key, not
// a base64 string. Sourced from the W3C push spec example.
//
// Returns an ArrayBuffer-backed Uint8Array (explicitly NOT a
// SharedArrayBuffer-backed one) so it satisfies the DOM lib's
// BufferSource constraint without a cast.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const norm = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(norm);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function usePush(): PushState {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const standalone = useStandalone();
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [vapidReady, setVapidReady] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  // Initial probe: fetch the VAPID key + check current permission +
  // ask the backend if it thinks we're subscribed. All three run in
  // parallel; ready flips true once they all resolve.
  useEffect(() => {
    if (!supported) {
      setPermission('unsupported');
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setPermission(Notification.permission);
      try {
        const r = await fetch(`${API_URL}/push/vapid-public-key`);
        if (r.ok) {
          const data = (await r.json()) as { publicKey: string | null; ready: boolean };
          if (!cancelled) {
            setVapidPublicKey(data.publicKey);
            setVapidReady(data.ready);
          }
        }
      } catch {
        /* backend offline — keep vapidReady false */
      }
      if (isLoaded && isSignedIn) {
        try {
          const token = await getToken();
          if (token) {
            const r = await fetch(`${API_URL}/push/me`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (r.ok) {
              const data = (await r.json()) as { subscribed: boolean };
              if (!cancelled) setEnabled(data.subscribed);
            }
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, isLoaded, isSignedIn, getToken]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!supported || busy || !vapidPublicKey || !isSignedIn) return false;
    setBusy(true);
    try {
      // 1. Prompt for permission. 'denied' is sticky — once the user
      //    declines we can't ask again without them flipping it back
      //    in browser settings.
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return false;

      // 2. Subscribe via the SW's push manager.
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      const sj = sub.toJSON();
      if (!sj.endpoint || !sj.keys?.p256dh || !sj.keys?.auth) {
        // Shouldn't happen but defend against partial keys.
        return false;
      }

      // 3. Tell the backend.
      const token = await getToken();
      if (!token) return false;
      const r = await fetch(`${API_URL}/push/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: sj.endpoint,
          keys: { p256dh: sj.keys.p256dh, auth: sj.keys.auth },
          userAgent: navigator.userAgent,
        }),
      });
      if (!r.ok) return false;
      setEnabled(true);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, busy, vapidPublicKey, isSignedIn, getToken]);

  const disable = useCallback(async (): Promise<void> => {
    if (!supported || busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => undefined);
        try {
          const token = await getToken();
          if (token) {
            await fetch(
              `${API_URL}/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              },
            );
          }
        } catch {
          /* ignore — local unsubscribe already done */
        }
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }, [supported, busy, getToken]);

  return {
    supported,
    standalone,
    permission,
    enabled,
    busy,
    vapidReady,
    ready,
    enable,
    disable,
  };
}
