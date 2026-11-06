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
import { useAuth, useUser } from './auth';
import { useStandalone } from './use-standalone';
import { urlBase64ToUint8Array } from './vapid-key';

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

// The Base64 → bytes conversion lives in lib/vapid-key.ts: app/sw.ts needs the
// identical conversion when it re-subscribes after the browser rotates a
// subscription, and the worker cannot import this hook. See that file.

/**
 * `/push/me` answers for the ACCOUNT, not this browser. A member can be
 * subscribed on their laptop and still have no subscription on their phone;
 * treating the account answer as "this device is enabled" hides the opt-in
 * prompt and leaves that device silent forever. The local subscription is the
 * only reliable per-device signal.
 */
async function hasLocalPushSubscription(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
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
            const [r, local] = await Promise.all([
              fetch(`${API_URL}/push/me`, {
                headers: { Authorization: `Bearer ${token}` },
              }),
              hasLocalPushSubscription(),
            ]);
            if (r.ok) {
              const data = (await r.json()) as { subscribed: boolean };
              // Both must be true: the account has a row, AND this browser
              // still holds the matching PushSubscription. A row from another
              // device (or a stale row after reinstall) must not suppress the
              // prompt on this one.
              if (!cancelled) setEnabled(data.subscribed && local);
            } else if (!cancelled) {
              setEnabled(false);
            }
          } else if (!cancelled) {
            setEnabled(false);
          }
        } catch {
          if (!cancelled) setEnabled(false);
        }
      } else if (!cancelled) {
        setEnabled(false);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, isLoaded, isSignedIn, getToken]);

  /**
   * Hand the application server key to the service worker.
   *
   * The worker needs it to re-subscribe after the browser rotates a
   * subscription (app/sw.ts's `pushsubscriptionchange`), and it has no way to
   * fetch it: the key comes from the API origin, and the worker holds no auth
   * token. This is the only channel that can carry it.
   *
   * ⚠️ IT CAN MISS THE FIRST LOAD. `controller` is null until a worker is
   * active and controlling this page, which on a first-ever visit is a moment
   * after this effect runs. The next load posts it again, so the window in
   * which the worker could be woken without a key is narrow — and the
   * `pushsubscriptionchange` handler treats "no key" as "ask the page" rather
   * than failing silently. Do not turn this into a retry loop.
   */
  useEffect(() => {
    if (!vapidPublicKey) return;
    try {
      navigator.serviceWorker?.controller?.postMessage({
        type: 'PUSH_VAPID_KEY',
        key: vapidPublicKey,
      });
    } catch {
      /* no controller yet — the next load posts it */
    }
  }, [vapidPublicKey]);

  /**
   * Re-register a subscription the browser replaced, on the worker's request.
   *
   * The backend upserts on `endpoint`, so re-posting an unchanged subscription
   * is a no-op and posting a new one repairs the row. `subscription` is null
   * when the worker had no key of its own and is telling us to redo the whole
   * thing — in that case we read whatever this device currently holds.
   */
  const resubscribe = useCallback(
    async (subscription: unknown): Promise<void> => {
      if (!isSignedIn) return;
      try {
        const token = await getToken();
        if (!token) return;
        let json = subscription as {
          endpoint?: string;
          keys?: { p256dh?: string; auth?: string };
        } | null;
        if (!json?.endpoint) {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = await reg?.pushManager.getSubscription();
          if (!sub) return;
          json = sub.toJSON();
        }
        if (!json?.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
        const r = await fetch(`${API_URL}/push/subscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
            userAgent: navigator.userAgent,
          }),
        });
        if (r.ok) setEnabled(true);
      } catch {
        /* Silent on purpose: the shape of this failure is "push stays off",
           and the opt-in is still visible on /settings and /notifications. */
      }
    },
    [getToken, isSignedIn],
  );

  useEffect(() => {
    const sw = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!sw || typeof sw.addEventListener !== 'function') return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; subscription?: unknown }
        | undefined;
      if (data?.type === 'PUSH_RESUBSCRIBE') {
        void resubscribe(data.subscription ?? null);
      }
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [resubscribe]);

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
