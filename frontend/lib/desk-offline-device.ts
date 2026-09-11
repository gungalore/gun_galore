/**
 * THE BROWSER HALF OF PHASE 9 — what the Health board's "This device" card
 * can know, and what the offline stand-in can remember.
 *
 * 🚨 SPLIT FROM lib/desk-offline.ts ON PURPOSE. That file is compiled INTO the
 * service worker; this one touches `localStorage`, `caches` and
 * `beforeinstallprompt`, none of which exist in a worker. One file holding
 * both would put window-only code in the service-worker bundle, where the
 * failure is a worker that throws at install and takes the precache with it —
 * silently, because a service worker has nowhere to report to.
 *
 * Everything here is a pure decision or a guarded read, so it can be tested
 * without a DOM. Nothing under app/ is collected by vitest, which is why the
 * decidable part of this-device.tsx lives here rather than beside it.
 */
import { isAdminPath } from './desk-offline';

/**
 * Where the last successful board read is remembered.
 *
 * 🚨 IT IS REMEMBERED BECAUSE THE ONE MOMENT IT MATTERS IS THE ONE MOMENT IT
 * WAS GONE. `loadedAt` is React state in app/admin/desk/health/page.tsx, set
 * after fetchHealthBoard() resolves — so the card said "nothing has landed
 * yet" after every reload, and a reload is exactly what an operator does when
 * the board stops answering. The value they most wanted ("when did this last
 * work?") was destroyed by the act of asking for it.
 *
 * ⚠️ AN ISO STRING, NOT A FORMATTED ONE. clock() renders it in
 * Africa/Johannesburg at read time; storing the rendered text would pin the
 * timezone of whichever device wrote it.
 */
export const LAST_GOOD_READ_KEY = 'dk.lastGoodRead';

/**
 * ⚠️ EVERY ACCESS IS WRAPPED, INCLUDING THE GETTER ITSELF. `localStorage` does
 * not merely return null when site data is blocked — reading the PROPERTY
 * throws (a private window with storage blocked, an embedded webview, a
 * browser set to block site data). A bare `localStorage.getItem` inside a
 * React effect throws during render-adjacent work and blanks the card that was
 * supposed to explain what was wrong.
 */
export function readLastGoodRead(): string | null {
  try {
    const v = globalThis.localStorage?.getItem(LAST_GOOD_READ_KEY);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Same guard, same reason. A failed write is not worth an error. */
export function rememberLastGoodRead(iso: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_GOOD_READ_KEY, iso);
  } catch {
    /* storage blocked — the row falls back to "nothing has landed yet" */
  }
}

/**
 * Is the captured install event this browser is holding an offer to install
 * the DESK, or the shop?
 *
 * 🚨 THIS IS THE BUG app/admin/desk-manifest.ts EXISTS TO FIX, WEARING A
 * BUTTON. `beforeinstallprompt` is captured once per DOCUMENT by the inline
 * script in app/layout.tsx and parked on `window.__ggInstallEvent`; the event
 * carries the app the browser resolved from the manifest that was linked WHEN
 * IT FIRED. The Desk links its own manifest, the shop links the shop's — but a
 * client-side navigation from the storefront into /admin does not reload the
 * document and does not re-fire the event. Firing that event from the Health
 * board would put the SHOP on the operator's home screen, which is the exact
 * outcome the second manifest was written to prevent.
 *
 * So the offer is only made when the DOCUMENT was loaded under /admin. The
 * navigation entry's `name` is the URL this document was fetched from, which
 * is the moment the browser read a manifest. Anything else falls back to
 * telling the operator where the browser's own install item is — worse UX,
 * but it cannot install the wrong app.
 *
 * ⚠️ CONSERVATIVE ON PURPOSE: no navigation entry (an old engine, or the entry
 * buffer already dropped) reads as "not the Desk". The cost is an instruction
 * instead of a button; the cost of guessing the other way is the wrong app.
 */
export function promptBelongsToDesk(documentUrl: string | null | undefined): boolean {
  if (!documentUrl) return false;
  try {
    return isAdminPath(new URL(documentUrl, 'https://example.invalid').pathname);
  } catch {
    return false;
  }
}

/** The URL this document was fetched from, or null if the browser won't say. */
export function documentNavigationUrl(): string | null {
  try {
    const entries = performance.getEntriesByType('navigation');
    const name = (entries[0] as { name?: string } | undefined)?.name;
    return typeof name === 'string' && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * What the Install row can actually offer, on this browser, right now.
 *
 * The five outcomes are five different sentences, and collapsing any two of
 * them produces a control that lies:
 *
 *   • `installed`  — nothing to offer.
 *   • `prompt`     — a real one-tap install, and it installs the Desk.
 *   • `ios-safari` — no `beforeinstallprompt` exists on iOS at all. Share →
 *                    Add to Home Screen is the only path, and a button here
 *                    would be a button that cannot work.
 *   • `ios-other`  — Chrome/Firefox/Edge/webviews on iOS CANNOT install a PWA.
 *                    Instructions to tap Share are wrong here too: the step is
 *                    to reopen the page in Safari first.
 *   • `menu`       — Android/desktop Chrome with no captured event (the
 *                    engagement heuristic has not fired yet, or the event
 *                    belongs to the shop). The browser's own ⋮ → Install app
 *                    still works; there is no way to open it from script.
 */
export type DeskInstallOffer = 'installed' | 'prompt' | 'ios-safari' | 'ios-other' | 'menu';

export function deskInstallOffer(state: {
  isInstalled: boolean;
  canInstall: boolean;
  isIosSafari: boolean;
  isIosNonSafari: boolean;
  promptBelongsToDesk: boolean;
}): DeskInstallOffer {
  if (state.isInstalled) return 'installed';
  // ⚠️ iOS IS TESTED BEFORE `canInstall`, not after. `canInstall` is false on
  // iOS anyway today, but the order is what keeps it true if a future iOS ever
  // fires the event: an iPhone that reports both should be given the path that
  // is known to work, not the one that is known not to exist.
  if (state.isIosNonSafari) return 'ios-other';
  if (state.isIosSafari) return 'ios-safari';
  if (state.canInstall && state.promptBelongsToDesk) return 'prompt';
  return 'menu';
}

/**
 * Is the Desk's stand-in document actually in the precache?
 *
 * 🚨 THIS ROW EXISTS BECAUSE THE SHOP'S STAND-IN HAS BEEN INERT SINCE IT
 * SHIPPED AND NOTHING SAID SO. A serwist fallback resolves only through
 * `matchPrecache()`, so a document that is not precached means the original
 * error is rethrown and the browser draws its own page — no warning, no log,
 * and the page's own comment claiming it is precached. The only way to notice
 * is to go offline and look, which nobody does on a working day.
 *
 * ⚠️ `ignoreSearch: true` IS LOAD-BEARING, NOT TIDINESS. Serwist keys a
 * precached entry as `<url>?__WB_REVISION__=<revision>`, so a plain
 * `caches.match('/admin/offline')` misses every time and this row would report
 * a missing page on a perfectly good install — a check that cries wolf is a
 * check somebody deletes.
 *
 * Returns null when the browser gives no `caches` at all (no service worker,
 * an insecure origin), which is a different answer from "not cached" and the
 * row says so.
 */
export async function deskOfflineDocumentCached(url: string): Promise<boolean | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return (await caches.match(url, { ignoreSearch: true })) !== undefined;
  } catch {
    return null;
  }
}
