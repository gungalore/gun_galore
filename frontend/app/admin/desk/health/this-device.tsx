'use client';

/**
 * HEALTH — this device.
 *
 * 🚨 EVERY OTHER CARD ON THIS BOARD MEASURES THE BOX. This one measures the
 * thing the operator is holding, and it is first because it is the first thing
 * that is ever wrong: a board that looks frozen is far more often a phone that
 * lost its signal, a tab that was left open since yesterday, or an installed
 * shell running an old build, than it is a production incident. Answering that
 * in a handful of rows before the operator starts diagnosing the server is the
 * whole reason it exists.
 *
 * ⚠️ EVERY ROW IS READ IN AN EFFECT, NEVER DURING RENDER. `matchMedia`,
 * `navigator.onLine`, `Notification`, `serviceWorker` and `caches` do not exist
 * on the server, and a value read during render is a hydration mismatch —
 * React would discard the server HTML for the whole subtree. So the card paints
 * "reading…" for one frame and then says what is true, which is also the honest
 * reading: before the effect runs, nothing has been measured.
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
 *
 * 🚨 IT DOES OFFER TO INSTALL, AND THAT IS A REVERSAL. The Install row used to
 * be a sentence telling the operator to "Add to Home Screen" with nothing on
 * the page that could do it: the inline capture script in app/layout.tsx calls
 * preventDefault() on `beforeinstallprompt` for EVERY route including /admin,
 * and components/install-prompt.tsx lists '/admin' in its suppressed prefixes —
 * so the Desk consumed the event nowhere and suppressed the browser's own
 * offer everywhere. A popup is the wrong shape for a worklist, so the offer is
 * a row on the board the operator already opens when something is odd. See
 * lib/desk-offline-device.ts for why the row will not fire a captured event
 * that belongs to the shop.
 */
import * as React from 'react';
import {
  Button,
  IconAlert,
  IconArrowDown,
  IconBell,
  IconCheck,
  IconClock,
  IconLock,
  Tag,
} from '../../../../components/desk';
import { clock } from '../../../../lib/desk-site';
import { DESK_OFFLINE_URL } from '../../../../lib/desk-offline';
import {
  deskInstallOffer,
  deskOfflineDocumentCached,
  documentNavigationUrl,
  promptBelongsToDesk,
  readLastGoodRead,
  rememberLastGoodRead,
  type DeskInstallOffer,
} from '../../../../lib/desk-offline-device';
import { useInstallPrompt } from '../../../../lib/use-install-prompt';
import { Card, Row } from './board-bits';

interface DeviceFacts {
  /** Running from a home-screen icon rather than in a browser tab. */
  installed: boolean;
  online: boolean;
  /** A service worker is controlling this tab. See the note on the row. */
  workerControlling: boolean;
  /** The browser permission, for information. Nothing here asks for it. */
  notificationPermission: 'granted' | 'denied' | 'default' | 'unsupported';
  /**
   * Is the Desk's stand-in document actually in the precache? `null` means the
   * browser gave no `caches` to look in, which is not the same as "no".
   */
  standInCached: boolean | null;
}

async function readDevice(): Promise<DeviceFacts> {
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
    standInCached: await deskOfflineDocumentCached(DESK_OFFLINE_URL),
  };
}

/**
 * The four sentences that are not a button.
 *
 * ⚠️ iOS SAFARI AND iOS ANYTHING-ELSE ARE DIFFERENT INSTRUCTIONS, not a
 * shorter and a longer version of one. Chrome, Firefox, Edge and every in-app
 * webview on iOS CANNOT install a PWA at all; telling that operator to tap
 * Share sends them looking for a menu item Apple does not give them.
 */
const INSTALL_WORDS: Record<Exclude<DeskInstallOffer, 'installed' | 'prompt'>, string> = {
  'ios-safari': 'a browser tab — Share, then Add to Home Screen, installs the Desk and not the shop',
  'ios-other': 'a browser tab — on iPhone only Safari can install it; open the Desk there first',
  menu: 'a browser tab — the browser’s own menu has Install app, and it installs the Desk, not the shop',
};

export function ThisDevice({ loadedAt }: { loadedAt: string | null }) {
  const [facts, setFacts] = React.useState<DeviceFacts | null>(null);
  const [remembered, setRemembered] = React.useState<string | null>(null);
  const [promptFailed, setPromptFailed] = React.useState(false);
  const install = useInstallPrompt();

  React.useEffect(() => {
    let live = true;
    const read = () => {
      void readDevice().then((d) => {
        if (live) setFacts(d);
      });
    };
    read();
    setRemembered(readLastGoodRead());
    // ⚠️ BOTH EVENTS, AND A RE-READ ON VISIBILITY. `offline` alone leaves the
    // card asserting "offline" long after the signal came back, on a phone
    // that was in a pocket — which is the state this row exists to catch and
    // the state in which a stale answer is most believed.
    window.addEventListener('online', read);
    window.addEventListener('offline', read);
    document.addEventListener('visibilitychange', read);
    return () => {
      live = false;
      window.removeEventListener('online', read);
      window.removeEventListener('offline', read);
      document.removeEventListener('visibilitychange', read);
    };
  }, []);

  /**
   * 🚨 THE REMEMBERING HAPPENS HERE, NOT IN THE PAGE, and only because this
   * file is the one that reads it back. `loadedAt` is state in
   * app/admin/desk/health/page.tsx: it is set after fetchHealthBoard()
   * resolves and destroyed by a reload — so the row said "nothing has landed
   * yet" every time an operator reloaded a board that had stopped answering,
   * which is the one moment the answer was worth having. app/admin/offline
   * reads the same key with the same meaning.
   */
  React.useEffect(() => {
    if (!loadedAt) return;
    rememberLastGoodRead(loadedAt);
    setRemembered(loadedAt);
  }, [loadedAt]);

  const offer = deskInstallOffer({
    isInstalled: install.isInstalled || facts?.installed === true,
    canInstall: install.canInstall && !promptFailed,
    isIosSafari: install.isIosSafari,
    isIosNonSafari: install.isIosNonSafari,
    promptBelongsToDesk: promptBelongsToDesk(documentNavigationUrl()),
  });

  /** The read on show: this session's if there is one, else what was kept. */
  const shownRead = loadedAt ?? remembered;

  return (
    <Card
      label="This device"
      hint={facts === null ? 'reading…' : facts.installed ? 'installed' : 'browser tab'}
      footer="No board is ever served from a cache: /admin and /api stay network-only in the service worker, so nothing on any Desk surface can be yesterday's figure. What IS stored is one static page with no data on it, shown in place of the browser's error screen when a board cannot be fetched. Everything on this card is read in this browser and travels nowhere."
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
        {facts === null ? (
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>—</span>
        ) : offer === 'installed' ? (
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', textAlign: 'right' }}>
            running from the home-screen icon
          </span>
        ) : offer === 'prompt' ? (
          /* The one browser state where an install can actually be opened from
             script. `promptInstall()` answers 'unavailable' if the captured
             event has already been spent, and that flips this row back to the
             menu instruction rather than leaving a button that does nothing. */
          <Button
            icon={IconArrowDown}
            onClick={() => {
              void install.promptInstall().then((outcome) => {
                if (outcome === 'unavailable') setPromptFailed(true);
              });
            }}
          >
            Install the Desk
          </Button>
        ) : (
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', textAlign: 'right', maxWidth: 300 }}>
            {INSTALL_WORDS[offer]}
          </span>
        )}
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
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>Offline stand-in</span>
        {/* 🚨 THIS ROW EXISTS BECAUSE THE SHOP'S STAND-IN WAS INERT FOR MONTHS
            AND NOTHING SAID SO. A serwist fallback is resolved only through
            matchPrecache(), so a page that is not in the precache is rethrown
            as the browser's own error screen — no warning, no log, and
            app/offline/page.tsx's own comment claiming it is precached. The
            only way to notice was to go offline and look. Now the board says
            it, on the device it is true of.

            🚨 AND IT IS NOW THE ONLY PLACE A FAILED STAND-IN FETCH SURFACES.
            app/sw.ts deliberately lets the install SUCCEED when the fetch for
            /admin/offline fails, because the alternative — the previous
            behaviour — was that one admin url answering non-200 cost every
            visitor, shoppers included, their service worker. The cost of that
            narrowing is paid here: a stand-in that never downloaded is
            invisible in the worker, so this row amber is the whole report.
            Weakening it, or dropping it to save a `caches` call, removes the
            last signal rather than a duplicate one. */}
        {facts === null ? (
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>—</span>
        ) : facts.standInCached === true ? (
          <Tag kind="ok" icon={IconCheck}>
            stored
          </Tag>
        ) : facts.standInCached === false ? (
          <Tag kind="warn" icon={IconAlert}>
            not stored — a failed board shows the browser’s error page
          </Tag>
        ) : (
          <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', textAlign: 'right' }}>
            this browser gives no cache to look in
          </span>
        )}
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
        {shownRead ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
              {clock(shownRead)}
            </span>
            {/* ⚠️ SAID WHEN IT IS REMEMBERED, and only then. A timestamp this
                session fetched and one kept from a previous visit are worth
                different amounts to somebody deciding whether the box went
                down five minutes or five hours ago. Marking both would be
                noise; marking neither is the version that misleads. */}
            {loadedAt ? null : (
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>remembered</span>
            )}
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
