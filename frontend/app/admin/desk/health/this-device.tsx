'use client';

/**
 * HEALTH — this device.
 *
 * 🚨 EVERY OTHER CARD ON THIS BOARD MEASURES THE BOX. This one measures the
 * thing the operator is holding, and it is first because it is the first thing
 * that is ever wrong: a board that looks frozen is far more often a phone that
 * lost its signal, a tab that was left open since yesterday, or an installed
 * shell running an old build, than it is a production incident. Answering that
 * in four rows before the operator starts diagnosing the server is the whole
 * reason it exists.
 *
 * ⚠️ EVERY ROW IS READ IN AN EFFECT, NEVER DURING RENDER. `matchMedia`,
 * `navigator.onLine`, `Notification` and `serviceWorker` do not exist on the
 * server, and a value read during render is a hydration mismatch — React would
 * discard the server HTML for the whole subtree. So the card paints "reading…"
 * for one frame and then says what is true, which is also the honest reading:
 * before the effect runs, nothing has been measured.
 *
 * ⚠️ IT DOES NOT OFFER TO TURN NOTIFICATIONS ON, AND THAT IS THE POINT OF THE
 * ROW. POST /push/subscribe takes AuthGuard and keys the subscription on
 * `@CurrentUser()` — a MEMBER id. An admin JWT does not authenticate there at
 * all, so a permission prompt on this board would collect a subscription
 * nothing could ever deliver to, which is this repo's signature defect wearing
 * a bell. The row states the fact instead of offering the button.
 *
 * ⚠️ THE NARROW VERSION OF THAT, because the wide one is not true:
 * components/push-first-launch-prompt.tsx is mounted in the ROOT layout, which
 * wraps /admin as well as the shop. It is gated on a member sign-in and on
 * standalone display mode rather than on a path, so in a browser that holds a
 * member session AND is installed, that prompt CAN appear over the Desk. What
 * it would create is that member's subscription, not the operator's — so the
 * claim this row makes is "nothing sends to an admin", never "no bell can
 * appear on this screen".
 */
import * as React from 'react';
import { IconAlert, IconBell, IconCheck, IconClock, IconLock, Tag } from '../../../../components/desk';
import { clock } from '../../../../lib/desk-site';
import { Card, Row } from './board-bits';

interface DeviceFacts {
  /** Running from a home-screen icon rather than in a browser tab. */
  installed: boolean;
  online: boolean;
  /** A service worker is controlling this tab. See the note on the row. */
  workerControlling: boolean;
  /** The browser permission, for information. Nothing here asks for it. */
  notificationPermission: 'granted' | 'denied' | 'default' | 'unsupported';
}

function readDevice(): DeviceFacts {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari predates display-mode and still answers only this.
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return {
    installed: standalone,
    online: navigator.onLine !== false,
    workerControlling: Boolean(navigator.serviceWorker?.controller),
    notificationPermission:
      typeof Notification === 'undefined'
        ? 'unsupported'
        : (Notification.permission as 'granted' | 'denied' | 'default'),
  };
}

export function ThisDevice({ loadedAt }: { loadedAt: string | null }) {
  const [facts, setFacts] = React.useState<DeviceFacts | null>(null);

  React.useEffect(() => {
    const read = () => setFacts(readDevice());
    read();
    // ⚠️ BOTH EVENTS, AND A RE-READ ON VISIBILITY. `offline` alone leaves the
    // card asserting "offline" long after the signal came back, on a phone
    // that was in a pocket — which is the state this row exists to catch and
    // the state in which a stale answer is most believed.
    window.addEventListener('online', read);
    window.addEventListener('offline', read);
    document.addEventListener('visibilitychange', read);
    return () => {
      window.removeEventListener('online', read);
      window.removeEventListener('offline', read);
      document.removeEventListener('visibilitychange', read);
    };
  }, []);

  return (
    <Card
      label="This device"
      hint={facts === null ? 'reading…' : facts.installed ? 'installed' : 'browser tab'}
      footer="The Desk is never served from a cache: /admin is network-only in the service worker and has no offline fallback, deliberately, so a backend that is down errors visibly rather than showing yesterday's board. Everything on this card is read in this browser and travels nowhere."
    >
      <Row>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>Connection</span>
        {facts === null ? (
          <Tag kind="neutral" icon={null}>
            reading…
          </Tag>
        ) : facts.online ? (
          <Tag kind="ok" icon={IconCheck}>
            online
          </Tag>
        ) : (
          /* ⚠️ `navigator.onLine` FALSE IS RELIABLE; TRUE IS NOT. A browser
             says false only when it has no network interface at all, and says
             true on a captive portal or a dead uplink. So the amber state is
             asserted and the green one is not a promise the backend is
             reachable — the probe sweep below is what answers that. */
          <Tag kind="warn" icon={IconAlert}>
            no network on this device
          </Tag>
        )}
      </Row>

      <Row>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>Installed</span>
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', textAlign: 'right' }}>
          {facts === null
            ? '—'
            : facts.installed
              ? 'running from the home-screen icon'
              : 'a browser tab — Add to Home Screen installs the Desk, not the shop'}
        </span>
      </Row>

      <Row>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>Service worker</span>
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', textAlign: 'right' }}>
          {facts === null
            ? '—'
            : facts.workerControlling
              ? 'registered, and not serving this board — /admin is network-only'
              : 'not controlling this tab'}
        </span>
      </Row>

      <Row>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>Notifications</span>
        <Tag kind="neutral" icon={IconLock}>
          none
        </Tag>
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', textAlign: 'right', maxWidth: 260 }}>
          {/* Stated, never offered. The browser permission is shown only
              because an operator who granted it on the shop will otherwise
              wonder why this board is silent. */}
          {facts?.notificationPermission === 'granted'
            ? 'Nothing reaches an admin. The permission this browser holds belongs to a member session on the shop; no subscription is keyed to an operator.'
            : 'Nothing reaches an admin — push subscriptions are keyed to a member. The pile is checked by opening it.'}
        </span>
        <IconBell size={13} style={{ color: 'var(--dk-ink-3)', flex: 'none' }} />
      </Row>

      <Row last>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>Last good read</span>
        {loadedAt ? (
          <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
            {clock(loadedAt)}
          </span>
        ) : (
          /* ⚠️ NOT "never". The board may be mid-first-load or the read may
             have failed, and this card cannot tell those apart — the failure
             is stated where it happened, above. */
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconClock size={13} style={{ color: 'var(--dk-ink-3)' }} />
            <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>nothing has landed yet</span>
          </span>
        )}
      </Row>
    </Card>
  );
}
